import { useCallback, useState } from 'react';
import { App, Tooltip } from 'antd';
import { useReactFlow, useStore } from '@xyflow/react';
import { BgColorsOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { createNode } from '@/utils/nodeFactory';
import { StyleMarketModal } from '@/components/style/StyleMarketModal';
import type { StyleItem } from '@/services/styleApi';

/**
 * 风格节点相对图片节点的水平偏移（与节点内选风格一致：风格节点永远在左侧）。
 * -350 而不是 -320（节点宽度）：留 30px 给连线，两个节点不至于贴在一起。
 */
const STYLE_NODE_OFFSET_X = -350;

/**
 * 画布左边缘的「风格素材」入口（挂在个人资产库把手下方）
 *
 * 与节点内「风格」按钮的区别：节点内那个是「给已有节点换风格」，
 * 这里解决的是「我想按某个画风起一张图」——还没有节点的时候先挑风格。
 * 所以点一个风格就一步到位：建图片节点 + 建风格节点 + 连好线 + 选中新节点
 * （选中会让右侧提示词面板自动打开，接着补提示词即可）。
 *
 * 本组件只画把手和弹窗，位置由父级（WorkspacePage 的左边缘把手列）决定。
 */
export function StyleMaterialEntry() {
  const { message } = App.useApp();
  const { screenToFlowPosition } = useReactFlow();
  // 画布可视区容器：弹窗 portal 到 body，拿不到画布的父级 ref，只能从 React Flow 的 store 里取
  const domNode = useStore((s) => s.domNode);
  const [open, setOpen] = useState(false);

  const handlePick = useCallback((style: StyleItem) => {
    const store = useCanvasStore.getState();
    // addNode 在「没有项目 / 还在加载」时是静默 no-op，这里必须先拦一下，否则用户点了没反应
    if (!store.projectId || store.isLoading) {
      message.error('画布还没准备好，稍后再试');
      return;
    }

    // 落点＝画布可视区中心（不是鼠标位置：弹窗里点卡片时鼠标在弹窗上，与画布无关）
    const rect = domNode?.getBoundingClientRect();
    const screenCenter = rect && rect.width > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const imagePos = screenToFlowPosition(screenCenter);

    // 1) 图片节点
    const imageNode = createNode('image', imagePos);
    store.addNode(imageNode);

    // 2) 风格节点：id 前缀 style- + data.styleId 两个标记都给上。
    //    后端认「id 以 style- 开头」或「有 styleId 字段」，据此把它当风格图（只提取画风/色彩，
    //    不当作内容参考图），所以这里沿用节点内选风格的同一套字段。
    const styleNodeId = `style-${Date.now()}`;
    const styleNode = createNode('image', { x: imagePos.x + STYLE_NODE_OFFSET_X, y: imagePos.y }, {
      id: styleNodeId,
    });
    // styleId 不在 LibTVNodeData 的类型里（历史上是随节点数据一起存的扩展字段），
    // 与节点内选风格保持一致：显式断言一次，避免在类型上开一个口子。
    styleNode.data = {
      ...styleNode.data,
      label: `风格-${style.name}`,
      imageUrl: style.image_url,
      styleId: style.id,
    } as typeof styleNode.data;
    store.addNode(styleNode);

    // 3) 连线：风格节点 → 图片节点（后端从上游连线收集风格图）
    store.addEdge({
      id: `e-${styleNodeId}-${imageNode.id}`,
      source: styleNodeId,
      target: imageNode.id,
      type: 'dataFlow',
    });

    // 4) 选中新节点 → 右侧提示词面板随之打开，直接可以补提示词
    store.onNodesChange([{ type: 'select', id: imageNode.id, selected: true }]);

    message.success(`已创建图片节点，风格：${style.name}`);
  }, [domNode, screenToFlowPosition, message]);

  return (
    <>
      <Tooltip title="风格素材：挑一个风格，直接在画布上建出带该风格的图片节点" placement="right">
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-r-lg bg-white/95 border border-l-0 border-gray-200 shadow-md text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <BgColorsOutlined className="text-[14px]" />
          <span className="text-[11px] tracking-wider [writing-mode:vertical-rl]">风格素材</span>
        </button>
      </Tooltip>

      {open && (
        <StyleMarketModal
          onClose={() => setOpen(false)}
          onPick={handlePick}
          hint="选择风格后，会在画布中央自动创建一个图片节点，并把该风格连到它上面；接着在右侧补提示词即可生成。"
        />
      )}
    </>
  );
}