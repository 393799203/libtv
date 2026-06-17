import { useState, useEffect, useCallback, useRef } from 'react';
import type { NodeExecutionStatus, ScriptShot } from '@/types/canvas';
import { workflowApi } from '@/services/workflowApi';

interface UseScriptGenerationOptions {
  nodeId: string;
  projectId: string | null;
  /** 当前节点执行状态 */
  status: NodeExecutionStatus;
  /** 轮询间隔（毫秒），默认 2000 */
  pollInterval?: number;
  /** 收到结果后的回调 */
  onResult?: (shots: ScriptShot[], scriptContent: string) => void;
  /** 状态变更回调 */
  onStatusChange?: (status: NodeExecutionStatus) => void;
  /** 进度变更回调 */
  onProgress?: (progress: number, message?: string) => void;
}

interface GenerationState {
  isPolling: boolean;
  progress: number;       // 0-100
  message: string;        // 当前阶段描述
  error: string | null;
}

/**
 * 脚本生成轮询 Hook
 *
 * 当 status 为 running/pending 时自动开始轮询，
 * 通过 workflowApi.getStatus 获取后台进度，
 * 完成后通过 onResult 回调返回分镜数据。
 *
 * 使用 ref 存储回调，避免 doPoll 因回调引用变化导致无限循环。
 */
export function useScriptGeneration({
  nodeId,
  projectId,
  status,
  pollInterval = 2000,
  onResult,
  onStatusChange,
  onProgress,
}: UseScriptGenerationOptions) {
  const [state, setState] = useState<GenerationState>({
    isPolling: false,
    progress: 0,
    message: '',
    error: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);

  // 用 ref 存储 callbacks，避免 doPoll 依赖它们导致重建
  const callbacksRef = useRef({ onResult, onStatusChange, onProgress });
  callbacksRef.current = { onResult, onStatusChange, onProgress };

  // 用 ref 存储动态参数
  const paramsRef = useRef({ nodeId, projectId });
  paramsRef.current = { nodeId, projectId };

  // 停止轮询 — 稳定引用
  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    pollingRef.current = false;
    setState((prev) => ({ ...prev, isPolling: false }));
  }, []);

  // 执行一次轮询请求 — 只依赖稳定的 ref，不会因外部变化而重建
  const doPoll = useCallback(async () => {
    const { projectId: pid, nodeId: nid } = paramsRef.current;
    if (!pid || !pollingRef.current) return;

    try {
      const res = await workflowApi.getStatus(pid, nid);
      const execution = res.data as unknown as {
        nodes: Array<{
          nodeId: string;
          status: string;
          progress: number;
          output?: Record<string, unknown>;
          error?: string;
        }>;
      };

      if (!execution?.nodes) return;

      const nodeExec = execution.nodes.find((n) => n.nodeId === nid);
      if (!nodeExec) return;

      // 更新进度
      const newProgress = nodeExec.progress ?? 0;
      setState((prev) => ({
        ...prev,
        progress: newProgress,
        error: null,
      }));
      callbacksRef.current.onProgress?.(newProgress, getProgressMessage(newProgress));

      // 根据状态决定下一步
      switch (nodeExec.status) {
        case 'running':
          break;

        case 'success':
          stopPolling();
          callbacksRef.current.onStatusChange?.('success');
          {
            const output = nodeExec.output ?? {};
            const shots = (output.shots as ScriptShot[]) ?? [];
            const content = (output.scriptContent as string) ?? '';
            callbacksRef.current.onResult?.(shots, content);
          }
          return;

        case 'failed':
          stopPolling();
          callbacksRef.current.onStatusChange?.('failed');
          setState((prev) => ({
            ...prev,
            error: nodeExec.error ?? '脚本生成失败',
          }));
          return;

        default:
          break;
      }
    } catch (err) {
      console.warn('脚本生成轮询失败:', err);
    }
  }, [stopPolling]); // 仅依赖 stopPolling（稳定引用）

  // 当 status 变为 running/pending 时启动轮询
  useEffect(() => {
    if ((status === 'running' || status === 'pending') && paramsRef.current.projectId && !pollingRef.current) {
      pollingRef.current = true;
      setState({ isPolling: true, progress: 0, message: '', error: null });

      // 首次立即请求
      doPoll();

      // 之后定时轮询
      timerRef.current = setInterval(doPoll, pollInterval);

      return () => {
        stopPolling();
      };
    }

    // 如果状态变为非运行中，停止轮询
    if (status !== 'running' && status !== 'pending') {
      stopPolling();
    }
  }, [status, pollInterval, doPoll, stopPolling]);

  // 手动触发开始生成（供外部调用）
  const startGenerating = useCallback(() => {
    if (status !== 'idle') return;
    callbacksRef.current.onStatusChange?.('running');
    setState({ isPolling: true, progress: 0, message: '', error: null });
  }, [status]);

  return {
    ...state,
    startGenerating,
    stopPolling,
  };
}

/** 根据进度百分比返回对应的提示文案 */
function getProgressMessage(progress: number): string {
  if (progress < 20) return '正在分析文本内容...';
  if (progress < 40) return '正在识别场景与角色...';
  if (progress < 60) return '正在拆解分镜镜头...';
  if (progress < 80) return '正在生成画面描述...';
  if (progress < 100) return '正在优化分镜细节...';
  return '生成完成';
}
