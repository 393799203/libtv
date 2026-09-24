import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi, type ActiveExecutionItem } from '@/services/workflowApi';

/**
 * 等待画布加载完成。
 * 画布是异步加载的，而 updateNodeStatus 在 isLoading 期间是空操作，
 * 所以必须等节点真正进入 store 之后再恢复状态，否则"生成中"设置会丢。
 * 空画布项目等不到节点，超时后放弃（那时也没有节点需要恢复）。
 */
function waitCanvasReady(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const s = useCanvasStore.getState();
      if (!s.isLoading && s.nodes.length > 0) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * 进入项目时恢复"仍在进行中的生成"。
 *
 * 背景：生成是在后端队列里跑的，与页面无关；但前端订阅进度用的 executionId
 * 只存在内存里，刷新/关闭页面就丢了 —— 于是任务明明还在跑，界面上却一片空白，
 * 用户很容易以为没在生成而再点一次（多生成一次、多扣一次费）。
 *
 * 这里在进入项目时向后端查一次进行中的执行：把相关节点恢复为「生成中」，
 * 并重新注册 SSE 订阅（activeStreams → StreamSubscriber → useExecutionStream），
 * 之后进度和结果会照常自动回填。
 */
export function useResumeActiveExecution(projectId: string | null | undefined): void {
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || handledRef.current === projectId) return;
    handledRef.current = projectId;
    let cancelled = false;

    (async () => {
      try {
        const resp = await workflowApi.getActive(projectId);
        const list: ActiveExecutionItem[] = resp?.executions ?? [];
        if (cancelled || list.length === 0) return;

        const ready = await waitCanvasReady();
        if (cancelled || !ready) return;

        const canvas = useCanvasStore.getState();
        const exec = useExecutionStore.getState();
        let restoredNodes = 0;

        for (const item of list) {
          for (const nodeId of item.nodeIds ?? []) {
            if (canvas.nodes.some((n) => n.id === nodeId)) {
              // pending = 还在队列里排队，running = 已在执行
              canvas.updateNodeStatus(nodeId, item.status === 'pending' ? 'pending' : 'running');
              restoredNodes++;
            } else {
              // 节点可能已被删除（画布改过）：只恢复订阅，不强行造节点
              console.warn('[ResumeActive] 执行中的节点已不在画布上:', nodeId);
            }
          }
          exec.addActiveStream({ projectId, executionId: item.executionId });
        }

        exec.setExecutionStatus('running');
        if (restoredNodes > 0) {
          message.info(`检测到 ${list.length} 个仍在进行的生成，已恢复进度显示`);
        }
      } catch (e) {
        // 恢复失败不影响正常使用（画布与结果仍在后端）
        console.warn('[ResumeActive] 查询进行中执行失败:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);
}