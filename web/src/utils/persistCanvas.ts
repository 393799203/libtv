import { canvasApi } from '@/services/canvasApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { clearAllStale } from '@/utils/topology';

/**
 * 调后端"执行工作流"之前，**必须**先把画布落库。
 *
 * 为什么：`POST /projects/:id/workflows/execute` 只收一个 `startNodeId`，
 * 后端（handler/workflow_handler.go → engine.Parse(canvas.Content) → engine.BuildNodePlan）
 * 是拿它去**已保存的画布**里找节点来编排执行计划的。刚在前端建出来、还没 PUT 上去的节点
 * 会直接报：`build execution plan failed: node not found in canvas: <id>`。
 *
 * 这条规则本来就写在 hooks/useNodeGeneration.ts（"调后端前先 saveCanvas"），
 * 图片节点能力集里的「生成视图 / 4K 重生成 / 生成高清图」漏了它，
 * 结果新建的参考节点一提交就 node not found。统一收口到这里，避免再漏。
 */
export async function persistCanvasBeforeRun(projectId: string): Promise<void> {
  if (!projectId) return;
  const store = useCanvasStore.getState();
  const payload = store.exportCanvas();
  await canvasApi.saveCanvas(projectId, {
    ...payload,
    // 会话内的脏标（stale / progressMessage）不落库
    nodes: clearAllStale(payload.nodes),
  });
}
