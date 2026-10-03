import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';

/**
 * 执行终态收口（SSE 与 polling 兜底共用同一份实现）。
 *
 * 为什么需要兜底：终态事件（node_completed / execution_completed）可能永远收不到 ——
 * ① 连接建立时执行刚好结束（终态事件已经发完，之后再也不会有事件）；
 * ② 引擎的订阅缓冲满而静默丢弃；③ 断线期间发生。
 * 漏掉一次，节点就会永久停在「生成中」；更糟的是收尾时会把 running 存进服务端画布，
 * 刷新后也回不到正确状态。
 *
 * 两条规则：
 *   - 只处理**本执行见过的节点**（seenNodeIds），不扫全画布 —— 并行执行时
 *     A 的终态不该把还在跑的 B 节点一起标掉；
 *   - 成功终态要回查后端最新节点数据补齐（真的没有产物就回到 idle，让用户能再点一次，
 *     停在 running 只会永久转圈且按钮不可用）。
 *
 * @param nodeIds 只传当前仍处于 running/pending 的节点（调用方先筛一遍）
 */
export async function reconcileNodesOnTerminal(
  projectId: string,
  executionId: string | number,
  nodeIds: string[],
  finalStatus: 'success' | 'failed',
  errorMsg?: string,
): Promise<void> {
  const execStore = useExecutionStore.getState();

  if (finalStatus === 'failed') {
    const store = useCanvasStore.getState();
    nodeIds.forEach((id) => {
      store.updateNodeData(id, {
        status: 'failed',
        error: errorMsg,
        progressMessage: undefined,
      } as never);
    });
  } else {
    for (const id of nodeIds) {
      try {
        const resp = await workflowApi.getStatus(projectId, String(executionId), id);
        const nodeData = (resp as unknown as { node_data?: Record<string, unknown> } | undefined)
          ?.node_data;
        const cur = useCanvasStore.getState();
        if (nodeData) {
          cur.updateNodeData(id, {
            ...nodeData,
            status: 'success',
            error: undefined,
            progressMessage: undefined,
          } as never);
        } else {
          // 后端也没有这个节点的产物（事件漏了、节点其实没跑）→ 回到 idle，
          // 让用户能再点一次生成
          cur.updateNodeStatus(id, 'idle');
        }
      } catch (e) {
        console.warn('[Terminal] 回查节点最新数据失败，置回 idle:', id, e);
        useCanvasStore.getState().updateNodeStatus(id, 'idle');
      }
    }
  }

  // 同步执行级状态：否则 generatingNodeId 不会清除，生成按钮永久停在「生成中…」且重试被拦
  nodeIds.forEach((id) => {
    execStore.updateNodeExecution(id, {
      status: finalStatus,
      progress: finalStatus === 'success' ? 100 : 0,
    });
  });
  execStore.setExecutionStatus(finalStatus === 'success' ? 'completed' : 'failed');
  execStore.setGeneratingNodeId(null);
  execStore.removeActiveStream(executionId);
  execStore.setLastError(null);
}

/** 筛出画布上仍处于 running/pending 的指定节点（终态收口只处理这些） */
export function pendingNodeIdsOf(nodeIds: Iterable<string>): string[] {
  const nodes = useCanvasStore.getState().nodes;
  const byId = new Map(nodes.map((n) => [n.id, n.data.status]));
  const out: string[] = [];
  nodeIds.forEach((id) => {
    const s = byId.get(id);
    if (s === 'running' || s === 'pending') out.push(id);
  });
  return out;
}