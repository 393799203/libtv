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
 * @param nodeIds 本执行需要核对的节点；成功收尾也包含残留 failed 的节点。
 */
export async function reconcileNodesOnTerminal(
  projectId: string,
  executionId: string | number,
  nodeIds: string[],
  finalStatus: 'success' | 'failed',
  errorMsg?: string,
): Promise<void> {
  const execStore = useExecutionStore.getState();
  if (useCanvasStore.getState().projectId !== projectId) {
    execStore.removeActiveStream(executionId);
    return;
  }
  const belongsToNewerRun = (id: string) =>
    useExecutionStore.getState().activeStreams.some(stream =>
      stream.projectId === projectId && Number(stream.executionId) > Number(executionId) &&
      (stream.nodeId === id || stream.nodeIds?.includes(id)));

  if (finalStatus === 'failed') {
    const store = useCanvasStore.getState();
    nodeIds.forEach((id) => {
      if (belongsToNewerRun(id)) return;
      // transient：失败没有产物、画布内容没变，不该占一格撤销；
      // 成功分支（下面）仍然记录 —— 那一格正是"生成后"的内容态。
      store.updateNodeData(id, {
        status: 'failed',
        error: errorMsg,
        progressMessage: undefined,
      } as never, { transient: true });
    });
  } else {
    for (const id of nodeIds) {
      try {
        const resp = await workflowApi.getStatus(projectId, String(executionId), id);
        const nodeData = (resp as unknown as { node_data?: Record<string, unknown> } | undefined)
          ?.node_data;
        const cur = useCanvasStore.getState();
        if (cur.projectId !== projectId ||
          !pendingNodeIdsOf([id], true, executionId, projectId).includes(id)) continue;
        const hasResult = nodeData && (
          nodeData.videoUrl || nodeData.imageUrl || nodeData.audioUrl ||
          nodeData.content || nodeData.scriptContent ||
          (Array.isArray(nodeData.imageUrls) && nodeData.imageUrls.length > 0) ||
          (Array.isArray(nodeData.shots) && nodeData.shots.length > 0)
        );
        if (nodeData?.status === 'failed') {
          // 旧执行的成功查询不能抹去后来一次真正失败的结果。
          continue;
        }
        if (nodeData && hasResult) {
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
        if (useCanvasStore.getState().projectId === projectId && !belongsToNewerRun(id)) {
          useCanvasStore.getState().updateNodeStatus(id, 'idle');
        }
      }
    }
  }

  // 同步执行级状态：否则 generatingNodeId 不会清除，生成按钮永久停在「生成中…」且重试被拦
  nodeIds.forEach((id) => {
    if (useCanvasStore.getState().projectId !== projectId || belongsToNewerRun(id)) return;
    const actual = useCanvasStore.getState().nodes.find(n => n.id === id)?.data.status;
    const status = actual === 'failed' ? 'failed' : finalStatus;
    execStore.updateNodeExecution(id, {
      status,
      progress: status === 'success' ? 100 : 0,
    });
  });
  execStore.removeActiveStream(executionId);
  if (!useExecutionStore.getState().activeStreams.some(s => s.projectId === projectId)) {
    execStore.setExecutionStatus(finalStatus === 'success' ? 'completed' : 'failed');
    execStore.setGeneratingNodeId(null);
    execStore.setLastError(null);
  }
}

/** 成功终态同时核对残留 failed；任何时候都不触碰较新的重试。 */
export function pendingNodeIdsOf(
  nodeIds: Iterable<string>,
  includeFailed = false,
  executionId?: string | number,
  projectId?: string,
): string[] {
  if (projectId && useCanvasStore.getState().projectId !== projectId) return [];
  const nodes = useCanvasStore.getState().nodes;
  const byId = new Map(nodes.map((n) => [n.id, n.data.status]));
  const out: string[] = [];
  // 用 for...of 而不是 forEach：入参是 Iterable<string>，没有 forEach 方法
  for (const id of nodeIds) {
    // 老执行的收尾不能把同节点较新的重试任务提前标成成功。
    const newerRun = useExecutionStore.getState().activeStreams.some(stream =>
      stream.projectId === projectId && Number(stream.executionId) > Number(executionId) &&
      (stream.nodeId === id || stream.nodeIds?.includes(id)));
    if (newerRun) continue;
    const s = byId.get(id);
    if (s === 'running' || s === 'pending' || (includeFailed && s === 'failed')) out.push(id);
  }
  return out;
}
