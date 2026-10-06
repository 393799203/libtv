import { useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { clearAllStale } from '@/utils/topology';
import { message } from '@/utils/antdApp';
import type { LibTVNodeData, NodeType } from '@/types/canvas';

export interface UseNodeGenerationOptions {
  /** 节点 ID */
  nodeId: string;
}

/** 会用提示词面板（也就是有「生成」按钮）的节点类型 */
const PROMPT_NODE_TYPES: NodeType[] = ['text', 'image', 'video', 'audio', 'script'];

/** 节点上可能承载"用户输入"的字段：文本/音频/脚本节点的输入字段名各不相同 */
const INPUT_FIELDS = ['prompt', 'content', 'text', 'scriptContent'] as const;

/**
 * 必须自己写提示词、上游连线替代不了的类型（与后端执行器语义对齐）：
 * - text：TextExecutor 不读上游（只看自己的 prompt/content）；
 * - image：ImageExecutor 没有提示词就直接判失败，上游参考图/风格图只是附加条件；
 * - script：ScriptExecutor 要求提示词里有 @ 引用（或已有剧本内容走透传）。
 * 其余类型（audio 会读上游文本、video 的首尾帧/参考模式可能只靠素材）有连线就算有输入。
 */
const PROMPT_REQUIRED_TYPES: NodeType[] = ['text', 'image', 'script'];

/** 各类型的提示语：说清"该补什么"，而不是笼统地都说"请先输入提示词" */
const EMPTY_INPUT_HINTS: Partial<Record<NodeType, string>> = {
  text: '请先写下要生成的内容（提示词），再点生成',
  image: '请先描述要生成什么（提示词）；上游参考图/风格图只是附加，不能替代提示词',
  video: '请先输入提示词再生成；首尾帧 / 参考模式也可以只连上游素材',
  audio: '请先输入要配音的文字，或连一个文本节点作为输入',
  script: '请先输入创作提示词；若要基于上游剧本，请用 @ 引用插入',
};

/**
 * 生成前的输入自检：节点既没有提示词、也没有可用上游输入时，返回要提示用户的话；
 * 可以生成则返回 null。
 *
 * 为什么必须挡在发请求之前（这些都是线上真出现过的后果）：
 * - 文本节点：后端「没有用户输入就直接透传」，会返回 **success + 空内容** ——
 *   前端连红点都没有，用户看到的就是"点了生成什么也没发生"；
 * - 图片/视频节点：空提示词发给上游，换回一个技术性报错（白跑一趟，还要等）；
 * - 音频/脚本节点：后端虽有兜底报错（「没有输入文本，无法生成音频」等），
 *   但也是先发请求、再在节点上亮红点。能提前一句话说清，就不该让用户等这一趟。
 *
 * 后端现在有同样的校验（server/internal/engine/executor_input_guard_test.go 锁着），
 * 这里只是提前一步、用更贴近操作的说法把话说在点按钮之前。
 */
function checkInputBeforeGenerate(nodeId: string): string | null {
  const { nodes, edges } = useCanvasStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null; // 找不到节点就别拦，交给下面正常报错
  const type = node.type as NodeType | undefined;
  if (!type || !PROMPT_NODE_TYPES.includes(type)) return null;

  const data = (node.data || {}) as Record<string, unknown>;
  const hasInput = INPUT_FIELDS.some(
    (key) => typeof data[key] === 'string' && (data[key] as string).trim() !== '',
  );
  if (hasInput) return null;

  // 只有"上游连线能当输入"的类型才把连线算作有输入
  if (!PROMPT_REQUIRED_TYPES.includes(type) && edges.some((e) => e.target === nodeId)) return null;

  return EMPTY_INPUT_HINTS[type] ?? '请先输入提示词再生成';
}

export interface UseNodeGenerationResult {
  /** 当前节点的执行 ID（订阅 SSE 用） */
  executionId: string | number | null;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 进度 0-100 */
  progress: number;
  /** 错误信息 */
  error: string | null;
  /** 单节点生成 */
  generate: () => Promise<void>;
  /** 暂存画布（只保存不生成） */
  saveCanvas: () => Promise<void>;
  /** 手动清掉错误 */
  clearError: () => void;
}

/**
 * 单节点生成 hook — 统一入口
 *
 * 行为：
 * - generate() 调后端执行接口（必须带 nodeId）：后端只支持单节点执行，只跑当前节点
 * - 调后端前先 saveCanvas
 * - 订阅 SSE 接收 node_completed 事件，由 useExecutionStream 自动写回画布
 */
export function useNodeGeneration(
  options: UseNodeGenerationOptions,
): UseNodeGenerationResult {
  const { nodeId } = options;

  const projectId = useCanvasStore((s) => s.projectId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeStatus = useCanvasStore((s) => s.updateNodeStatus);

  const currentExecution = useExecutionStore((s) => s.currentExecution);
  const nodeExec = currentExecution?.nodes?.find((n) => n.nodeId === nodeId);
  const generatingNodeId = useExecutionStore((s) => s.generatingNodeId);
  const setGeneratingNodeId = useExecutionStore((s) => s.setGeneratingNodeId);
  const setCurrentExecution = useExecutionStore((s) => s.setCurrentExecution);

  const activeStreams = useExecutionStore((s) => s.activeStreams);
  const addActiveStream = useExecutionStore((s) => s.addActiveStream);

  // 查找当前节点的活跃流（支持多节点并行执行）
  const myStream = activeStreams.find((s) => s.nodeId === nodeId);
  const executionId = myStream?.executionId ?? null;

  // 简化逻辑：只要当前节点是 generatingNodeId，就显示生成中
  const isGenerating = generatingNodeId === nodeId || (!!executionId && (nodeExec?.status === 'running' || nodeExec?.status === 'pending'));
  const progress = nodeExec?.progress ?? 0;
  // 注：这里不再对外暴露 error —— 节点自己的红点 + Tooltip 就是错误提示的唯一出口

  // 监听节点状态：完成后清除 generatingNodeId
  useEffect(() => {
    if (nodeExec?.status === 'success' || nodeExec?.status === 'failed') {
      if (generatingNodeId === nodeId) {
        setGeneratingNodeId(null);
      }
    }
  }, [nodeExec?.status, generatingNodeId, nodeId, setGeneratingNodeId]);

  const persistCanvas = useCallback(async () => {
    if (!projectId) return;
    const fresh = useCanvasStore.getState();
    await canvasApi.saveCanvas(projectId, {
      nodes: clearAllStale(fresh.nodes),
      edges: fresh.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  }, [projectId]);

  const generate: UseNodeGenerationResult['generate'] = useCallback(
    async (params) => {
      if (!projectId) return;

      // 防重复点击：如果已经在生成中，直接返回
      if (generatingNodeId === nodeId) {
        console.log('[useNodeGeneration] 当前节点正在生成，忽略重复点击');
        return;
      }

      // 0) 输入自检：空节点直点生成不该发请求（文本节点会静默"成功"、图片/视频白跑一趟上游）。
      //    放在最前面，连"置生成中"都不做 —— 用户看到的应该是一句提示，而不是一闪的生成中
      const inputHint = checkInputBeforeGenerate(nodeId);
      if (inputHint) {
        message.warning(inputHint);
        return;
      }

      // 1) 立即设置为生成中（按钮马上显示状态）
      setGeneratingNodeId(nodeId);

      // 2) 持久化画布 + 置节点为运行中
      //    这两步必须在 try 里：原来 persistCanvas 在 try 之外，一旦存盘抛错（网络/401/4xx）
      //    就再没人清 generatingNodeId —— 按钮永久停在「生成中…」，重试又被防重复点击拦住，
      //    用户只能刷新页面。
      try {
        await persistCanvas();

        // 3) 设置节点运行状态（只跑这一个节点，直接置运行中）
        updateNodeData(nodeId, { status: 'running' } as Partial<LibTVNodeData>);
        updateNodeStatus(nodeId, 'running');
      } catch (e) {
        console.error('[useNodeGeneration] 生成前置步骤失败（画布存盘/置状态）:', e);
        setGeneratingNodeId(null);
        updateNodeStatus(nodeId, 'idle');
        return;
      }

      // 4) 调后端 API
      try {
        const resp = await workflowApi.execute(projectId, nodeId);
        if (resp?.executionId != null) {
          setCurrentExecution({
            id: resp.executionId,
            status: 'running',
            nodes: [{ nodeId, status: 'running', progress: 0 }],
          } as never);
          addActiveStream({ projectId, executionId: resp.executionId, nodeId });

        } else {
          updateNodeStatus(nodeId, 'failed');
          setGeneratingNodeId(null);
          await persistCanvas();
        }
      } catch (e) {
        console.error('[useNodeGeneration] execute failed:', e);
        updateNodeStatus(nodeId, 'failed');
        setGeneratingNodeId(null);
        await persistCanvas();
      }
    },
    [projectId, nodeId, generatingNodeId, updateNodeData, updateNodeStatus, setGeneratingNodeId, setCurrentExecution, persistCanvas, addActiveStream],
  );

  return {
    executionId,
    isGenerating,
    progress,
    generate,
    saveCanvas: persistCanvas,
  };
}
