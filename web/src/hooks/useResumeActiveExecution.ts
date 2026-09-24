import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi, type ActiveExecutionItem } from '@/services/workflowApi';

/**
 * 等待画布真正就绪。
 *
 * 必须同时满足三个条件，缺一个恢复就会"看起来没生效"：
 * 1. isLoading=false —— updateNodeStatus 在 isLoading 期间是空操作，写了也丢
 * 2. projectId 已切到目标项目 —— 否则 updateNodeStatus 写进了别的项目（或直接 return {}）
 * 3. nodes 已进 store —— 画布是异步加载的，节点还没到就没有可恢复的对象
 */
function waitCanvasReady(projectId: string, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const s = useCanvasStore.getState();
      if (!s.isLoading && s.projectId === projectId && s.nodes.length > 0) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

/** 统计目标节点中有多少已经处于"生成中"状态（用于校验恢复是否被覆盖） */
function countRestored(ids: Set<string>): number {
  return useCanvasStore
    .getState()
    .nodes.filter(
      (n) => ids.has(n.id) && (n.data.status === 'running' || n.data.status === 'pending'),
    ).length;
}

/**
 * 进入项目时恢复"仍在进行中的生成"。
 *
 * 背景：生成是在后端队列里跑的，与页面无关；但前端订阅进度用的 executionId
 * 只存在内存里，刷新/关闭页面就丢了 —— 于是任务明明还在跑，界面上却显示着上一次的
 * 旧图（节点还带着后端写回的 status=success），用户很容易以为没在生成而再点一次
 * （多生成一次、多扣一次费），然后旧图"突变"成新图。
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
        if (cancelled) return;
        if (list.length === 0) {
          console.log('[ResumeActive] 该项目没有进行中的生成');
          return;
        }

        const ready = await waitCanvasReady(projectId);
        if (cancelled) return;
        if (!ready) {
          console.warn('[ResumeActive] 画布未在超时内就绪，放弃恢复节点状态');
          // 订阅仍然要建，保证结果能回填
          list.forEach((item) =>
            useExecutionStore.getState().addActiveStream({ projectId, executionId: item.executionId }),
          );
          return;
        }

        // 目标节点（只在画布上存在的才算）
        const canvas = useCanvasStore.getState();
        const targets: Array<{ id: string; status: 'pending' | 'running' }> = [];
        for (const item of list) {
          for (const nodeId of item.nodeIds ?? []) {
            if (canvas.nodes.some((n) => n.id === nodeId)) {
              // pending = 还在队列里排队，running = 已在执行
              targets.push({ id: nodeId, status: item.status === 'pending' ? 'pending' : 'running' });
            } else {
              console.warn('[ResumeActive] 执行中的节点已不在画布上:', nodeId);
            }
          }
        }

        const apply = () => {
          const store = useCanvasStore.getState();
          targets.forEach((t) => store.updateNodeStatus(t.id, t.status));
        };

        apply();
        // 画布加载与恢复存在异步竞态：若加载在恢复之后完成，会用后端数据把状态冲回 success，
        // 界面上就退化成"显示旧图"。这里做几次确认，被冲掉就重设。
        const targetIds = new Set(targets.map((t) => t.id));
        for (let i = 0; i < 5 && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 400));
          if (countRestored(targetIds) >= targets.length) break;
          console.log('[ResumeActive] 节点状态被画布加载覆盖，重新设置');
          apply();
        }

        list.forEach((item) =>
          useExecutionStore.getState().addActiveStream({ projectId, executionId: item.executionId }),
        );
        useExecutionStore.getState().setExecutionStatus('running');

        const restored = countRestored(targetIds);
        console.log('[ResumeActive] 已恢复进行中的生成:', {
          executions: list.map((i) => i.executionId),
          restoredNodes: restored,
          targets: targets.length,
        });
        if (restored > 0) {
          message.info(`检测到 ${list.length} 个仍在进行的生成，已恢复进度显示`);
        }
      } catch (e) {
        // 恢复失败不影响正常使用（生成与结果都在后端）
        console.warn('[ResumeActive] 查询进行中执行失败:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);
}