import { persistCanvasBeforeRun } from '@/utils/persistCanvas';
import { workflowApi } from '@/services/workflowApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import type { LibTVNodeData } from '@/types/canvas';

/**
 * 提交执行后，立刻把节点在**本地**置为「生成中」。
 *
 * 节点上的"生成中"读的是 `data.status`（BaseNode → NodeLoadingState），
 * 而它只有两个来源：本页发起执行时主动写一次，或刷新后由
 * `GET /projects/:id/active-executions` 重建。只提交不写状态，
 * 表现就是"任务已下发、节点还是空白，刷新一次才显示生成中"。
 */
export function markNodesRunning(ids: string[]): void {
  if (ids.length === 0) return;
  const store = useCanvasStore.getState();
  for (const id of ids) {
    // transient：**不写进撤销历史**。历史是"内容态"（生成前 / 生成后），
    // 生成中只是过渡态 —— 记进去的后果是用户按撤销会停在"生成中"那一帧，看着像没反应。
    // （原来这里先走 updateNodeData 记一条历史、再调 updateNodeStatus 覆盖一次，两件事都做全了）
    store.updateNodeData(
      id,
      { status: 'running', progressMessage: undefined } as Partial<LibTVNodeData>,
      { transient: true },
    );
  }
}

/**
 * 按"正常生成"的完整流程启动若干节点的执行。
 *
 * 四步缺一不可（对齐 hooks/useNodeGeneration.ts 的做法）：
 *   1. 先把画布落库 —— 后端执行计划是在**已保存的画布**里找 startNodeId 的；
 *   2. 本地置「生成中」—— 否则要刷新才显示；
 *   3. 调 execute；
 *   4. **注册 SSE 订阅（addActiveStream）** —— 这一步最容易漏，漏了的后果是：
 *      - 节点上永远不出现 "已运行 Ns" 这类进度（那是 node_progress 事件写的 progressMessage）；
 *      - 执行结束后没有任何事件来收口，节点会**一直停在"正在生成中"**。
 */
export async function startNodeExecutions(projectId: string, nodeIds: string[]): Promise<void> {
  if (!projectId || nodeIds.length === 0) return;

  await persistCanvasBeforeRun(projectId);
  markNodesRunning(nodeIds);

  const canvas = useCanvasStore.getState();
  for (const nodeId of nodeIds) {
    try {
      const resp = await workflowApi.execute(projectId, nodeId);
      if (resp?.executionId == null) {
        canvas.updateNodeStatus(nodeId, 'failed');
        continue;
      }
      const exec = useExecutionStore.getState();
      // 多执行并行是支持的（activeStreams 是数组），每个 executionId 一个订阅
      exec.addActiveStream({ projectId, executionId: resp.executionId, nodeId });
      // currentExecution 只影响"当前执行"那一块 UI，正在跑别的执行时不要顶掉它
      if (!exec.currentExecution) {
        exec.setCurrentExecution({
          id: resp.executionId,
          status: 'running',
          nodes: [{ nodeId, status: 'running', progress: 0 }],
        } as never);
      }
    } catch (e) {
      canvas.updateNodeStatus(nodeId, 'failed');
      throw e;
    }
  }
}
