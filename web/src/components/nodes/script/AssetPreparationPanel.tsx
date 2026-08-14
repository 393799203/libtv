import { memo, useCallback, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import type {
  ScriptCharacter,
  ScriptScene,
  ScriptProp,
} from '@/types/canvas';
import { AssetEditModal } from './AssetEditModal';
import { NodeAssociateModal } from './NodeAssociateModal';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasApi } from '@/services/canvasApi';
import {
  updateAssetImageNodeUrl,
  createAssetImageNode,
  generateAssetImageNodeId,
  getAssetImageNodeId,
  associateExistingImageNode,
} from '@/utils/assetImageSync';

// ---- 单个资产卡片（角色/场景/道具通用）----
interface AssetCardProps<T extends { name: string; description: string }> {
  item: T;
  index: number;
  scriptNodeId: string;
  assetType: 'character' | 'scene' | 'prop';
  onAdd?: () => void; // 仅最后一个卡片显示"添加"
  showAdd?: boolean;
  /** 卡片点击回调（用于弹出编辑弹窗） */
  onClick?: () => void;
  /** "关联已有节点"按钮回调 */
  onAssociateClick?: () => void;
}

function AssetCard<T extends { name: string; description: string }>({
  item,
  scriptNodeId,
  assetType,
  onAdd,
  showAdd,
  onClick,
  onAssociateClick,
}: AssetCardProps<T>) {
  // ✅ 从画布图片节点实时读取 imageUrl（不再依赖脚本节点 data）
  const nodes = useCanvasStore((s) => s.nodes);
  const imageNodeId = getAssetImageNodeId(scriptNodeId, assetType, item.name);
  const imageNode = nodes.find(n => n.id === imageNodeId);
  const imageUrl = (imageNode?.data as any)?.imageUrl as string | undefined;

  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (showAdd && onAdd) {
        onAdd();
        return;
      }
      onClick?.();
    },
    [onClick, onAdd, showAdd]
  );

  const handleAssociateClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAssociateClick?.();
    },
    [onAssociateClick]
  );

  return (
    <div
      className="relative w-[160px] h-[120px] rounded-lg border border-gray-200 bg-white overflow-hidden group hover:border-blue-400 transition-colors cursor-pointer"
      onClick={handleCardClick}
    >
      {/* 图片区域 */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1">
          {showAdd && onAdd ? (
            /* "添加"占位 */
            <div className="flex flex-col items-center gap-0.5 text-gray-400 group-hover:text-blue-500 transition-colors">
              <PlusOutlined className="text-lg" />
              <span className="text-[10px]">添加</span>
            </div>
          ) : (
            /* 空状态占位 */
            <div className="flex flex-col items-center gap-1 text-gray-400 group-hover:text-blue-500 transition-colors">
              <span className="text-[10px]">暂无参考图</span>
            </div>
          )}
        </div>
      )}

      {/* 悬浮操作按钮（非"添加"卡片）：上传或生成 / 关联已有节点（上下排列） */}
      {!showAdd && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            className="px-2 py-1.5 bg-white text-xs rounded-md font-medium text-gray-700 hover:bg-gray-50"
            onClick={handleCardClick}
          >
            上传或生成
          </button>
          <button
            className="px-2 py-1.5 bg-white text-xs rounded-md font-medium text-gray-700 hover:bg-gray-50"
            onClick={handleAssociateClick}
          >
            关联已有节点
          </button>
        </div>
      )}

      {/* 底部名称 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
        <span className="text-[11px] text-white truncate block">{item.name}</span>
      </div>
    </div>
  );
}

// ---- 资产分组标题 + 描述 + 卡片列表 ----
interface AssetSectionProps<
  T extends { name: string; description: string }
> {
  title: string;
  items: T[];
  scriptNodeId: string;
  assetType: 'character' | 'scene' | 'prop';
  onAdd?: () => void;
  /** 卡片点击回调（用于角色编辑等场景） */
  onCardClick?: (item: T) => void;
  /** 卡片"关联已有节点"回调 */
  onCardAssociate?: (item: T) => void;
}

function AssetSection<
  T extends { name: string; description: string }
>({
  title,
  items,
  scriptNodeId,
  assetType,
  onAdd,
  onCardClick,
  onCardAssociate,
}: AssetSectionProps<T>) {
  return (
    <div className="mb-8">
      {/* 标题 */}
      <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>

      {/* 卡片列表 */}
      <div className="flex flex-wrap gap-3 mb-2">
        {items.map((item, idx) => (
          <AssetCard
            key={`${item.name}-${idx}`}
            item={item}
            index={idx}
            scriptNodeId={scriptNodeId}
            assetType={assetType}
            onClick={onCardClick ? () => onCardClick(item) : undefined}
            onAssociateClick={onCardAssociate ? () => onCardAssociate(item) : undefined}
          />
        ))}
        {/* 添加按钮（作为最后一个空卡片） */}
        {onAdd && (
          <AssetCard
            item={{ name: '', description: '' } as T}
            index={items.length}
            scriptNodeId={scriptNodeId}
            assetType={assetType}
            onAdd={onAdd}
            showAdd
          />
        )}
      </div>

      {/* 描述文本 */}
      {items.length > 0 && items[0].description && (
        <div className="text-xs text-gray-500 leading-relaxed space-y-1">
          {items.map((item) => (
            <div key={item.name}>
              <strong>{item.name}</strong>：
              {item.description
                .replace(/【三视图要求】[^\n]*/g, '')
                .replace(/【四视图要求】[^\n]*/g, '')
                .replace(/【六视图要求】[^\n]*/g, '')
                .trim()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 主面板 ----
export interface AssetPreparationData {
  characters: ScriptCharacter[];
  scenes: ScriptScene[];
  props: ScriptProp[];
}

interface AssetPreparationPanelProps {
  scriptNodeId: string;
  data: AssetPreparationData;
  onUpdate: (updates: Partial<AssetPreparationData>) => void;
}

export const AssetPreparationPanel = memo<AssetPreparationPanelProps>(
  function AssetPreparationPanel({ scriptNodeId, data, onUpdate }) {
    // 当前编辑中的资产（角色/场景/道具）
    const [editingCharacter, setEditingCharacter] = useState<ScriptCharacter | null>(null);
    const [editingScene, setEditingScene] = useState<ScriptScene | null>(null);
    const [editingProp, setEditingProp] = useState<ScriptProp | null>(null);

    // 正在"关联已有节点"的资产（弹出选择弹窗）
    const [associating, setAssociating] = useState<{
      assetType: 'character' | 'scene' | 'prop';
      name: string;
    } | null>(null);

    // ✅ 通用的画布实时保存函数（避免代码重复）
    const saveCanvasRealtime = useCallback(async () => {
      const store = useCanvasStore.getState();
      const projectId = store.projectId;
      if (!projectId) return;

      const viewport = store._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
      try {
        await canvasApi.saveCanvas(projectId, {
          nodes: store.nodes,
          edges: store.edges,
          viewport,
        });
        // ✅ 性能优化：移除console.log，避免阻塞主线程
        // console.log('[AssetPreparationPanel] 画布已实时保存');
      } catch (error) {
        console.error('[AssetPreparationPanel] 画布保存失败:', error);
      }
    }, []);

    // 角色图片上传
    const handleCharacterUpload = useCallback(
      async (name: string, url: string) => {
        const updated = data.characters.map((c) =>
          c.name === name ? { ...c, imageUrl: url } : c
        );
        onUpdate({ characters: updated });
        // 同步更新编辑中的角色（侧屏打开时实时刷新）
        setEditingCharacter((prev) =>
          prev && prev.name === name ? { ...prev, imageUrl: url } : prev
        );

        // ✅ 使用新的同步工具：直接通过 ID 映射更新图片节点
        const updatedNode = updateAssetImageNodeUrl(scriptNodeId, 'character', name, url);
        if (!updatedNode) {
          // 如果没有图片节点，创建新节点并写入数据
          const character = data.characters.find(c => c.name === name);
          if (character) {
            const created = createAssetImageNode(scriptNodeId, 'character', name);
            if (created) {
              const imageNodeId = generateAssetImageNodeId('character', name, scriptNodeId);
              useCanvasStore.getState().updateNodeData(imageNodeId, {
                imageUrl: url,
                prompt: character.description,
              } as any);
            }
          }
        }

        // ✅ 实时保存画布（确保不丢失更改）
        await saveCanvasRealtime();
      },
      [data.characters, onUpdate, scriptNodeId, saveCanvasRealtime]
    );

    // ✅ 关联画布上已有的图片节点到指定资产（写 nodeId + 连边 + 同步 imageUrl + 保存画布）
    const handleAssociateNode = useCallback(
      async (assetType: 'character' | 'scene' | 'prop', name: string, nodeId: string) => {
        const ok = associateExistingImageNode(scriptNodeId, assetType, name, nodeId);
        if (!ok) return;

        // 若关联节点已有图片，同步到资产的 imageUrl（与上传参考图行为一致）
        // ⚠️ 必须从 store 重新读取最新资产数组（已含刚写入的 nodeId），
        // 不能用 props 里的旧 data，否则 onUpdate 会把 nodeId 覆盖丢失
        const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId);
        const nodeImageUrl = (node?.data as { imageUrl?: string })?.imageUrl;
        if (nodeImageUrl) {
          const typeMap = { character: 'characters', scene: 'scenes', prop: 'props' } as const;
          const key = typeMap[assetType];
          const scriptNode = useCanvasStore.getState().nodes.find(n => n.id === scriptNodeId);
          const latestAssets = (scriptNode?.data as Record<string, Array<{ name: string }>>)?.[key];
          if (latestAssets) {
            const updated = latestAssets.map(a =>
              a.name === name ? { ...a, imageUrl: nodeImageUrl } : a
            );
            onUpdate({ [key]: updated } as Partial<AssetPreparationData>);
          }
        }

        // 实时保存画布（后端执行时才能读到新关联）
        await saveCanvasRealtime();
      },
      [scriptNodeId, onUpdate, saveCanvasRealtime]
    );

    // 角色描述变更（失焦时自动保存）
    const handleCharacterDescriptionChange = useCallback(
      (name: string, description: string) => {
        const updated = data.characters.map((c) =>
          c.name === name ? { ...c, description } : c
        );
        onUpdate({ characters: updated });
        // 同步更新编辑中的角色（侧屏打开时实时刷新）
        setEditingCharacter((prev) =>
          prev && prev.name === name ? { ...prev, description } : prev
        );
      },
      [data.characters, onUpdate]
    );

    // 场景图片上传
    const handleSceneUpload = useCallback(
      async (name: string, url: string) => {
        const updated = data.scenes.map((s) =>
          s.name === name ? { ...s, imageUrl: url } : s
        );
        onUpdate({ scenes: updated });
        // 同步更新编辑中的场景（侧屏打开时实时刷新）
        setEditingScene((prev) =>
          prev && prev.name === name ? { ...prev, imageUrl: url } : prev
        );

        // ✅ 使用新的同步工具：直接通过 ID 映射更新图片节点
        const updatedNode = updateAssetImageNodeUrl(scriptNodeId, 'scene', name, url);
        if (!updatedNode) {
          // 如果没有图片节点，创建新节点并写入数据
          const scene = data.scenes.find(s => s.name === name);
          if (scene) {
            const created = createAssetImageNode(scriptNodeId, 'scene', name);
            if (created) {
              const imageNodeId = generateAssetImageNodeId('scene', name, scriptNodeId);
              useCanvasStore.getState().updateNodeData(imageNodeId, {
                imageUrl: url,
                prompt: scene.description,
              } as any);
            }
          }
        }

        // ✅ 实时保存画布（确保不丢失更改）
        await saveCanvasRealtime();
      },
      [data.scenes, onUpdate, scriptNodeId, saveCanvasRealtime]
    );

    // 场景描述变更（失焦时自动保存）
    const handleSceneDescriptionChange = useCallback(
      (name: string, description: string) => {
        const updated = data.scenes.map((s) =>
          s.name === name ? { ...s, description } : s
        );
        onUpdate({ scenes: updated });
        // 同步更新编辑中的场景（侧屏打开时实时刷新）
        setEditingScene((prev) =>
          prev && prev.name === name ? { ...prev, description } : prev
        );
      },
      [data.scenes, onUpdate]
    );

    // 道具图片上传
    const handlePropUpload = useCallback(
      async (name: string, url: string) => {
        const updated = data.props.map((p) =>
          p.name === name ? { ...p, imageUrl: url } : p
        );
        onUpdate({ props: updated });
        // 同步更新编辑中的道具（侧屏打开时实时刷新）
        setEditingProp((prev) =>
          prev && prev.name === name ? { ...prev, imageUrl: url } : prev
        );

        // ✅ 使用新的同步工具：直接通过 ID 映射更新图片节点
        const updatedNode = updateAssetImageNodeUrl(scriptNodeId, 'prop', name, url);
        if (!updatedNode) {
          // 如果没有图片节点，创建新节点并写入数据
          const prop = data.props.find(p => p.name === name);
          if (prop) {
            const created = createAssetImageNode(scriptNodeId, 'prop', name);
            if (created) {
              const imageNodeId = generateAssetImageNodeId('prop', name, scriptNodeId);
              useCanvasStore.getState().updateNodeData(imageNodeId, {
                imageUrl: url,
                prompt: prop.description,
              } as any);
            }
          }
        }

        // ✅ 实时保存画布（确保不丢失更改）
        await saveCanvasRealtime();
      },
      [data.props, onUpdate, scriptNodeId, saveCanvasRealtime]
    );

    // 道具描述变更（失焦时自动保存）
    const handlePropDescriptionChange = useCallback(
      (name: string, description: string) => {
        const updated = data.props.map((p) =>
          p.name === name ? { ...p, description } : p
        );
        onUpdate({ props: updated });
        // 同步更新编辑中的道具（侧屏打开时实时刷新）
        setEditingProp((prev) =>
          prev && prev.name === name ? { ...prev, description } : prev
        );
      },
      [data.props, onUpdate]
    );

    return (
      <div className="px-5 py-4 overflow-y-auto">
        {/* 角色 */}
        <AssetSection
          title="角色"
          items={data.characters || []}
          scriptNodeId={scriptNodeId}
          assetType="character"
          onCardClick={(item) => setEditingCharacter(item as ScriptCharacter)}
          onCardAssociate={(item) => setAssociating({ assetType: 'character', name: item.name })}
        />

        {/* 场景 */}
        <AssetSection
          title="场景"
          items={data.scenes || []}
          scriptNodeId={scriptNodeId}
          assetType="scene"
          onCardClick={(item) => setEditingScene(item as ScriptScene)}
          onCardAssociate={(item) => setAssociating({ assetType: 'scene', name: item.name })}
        />

        {/* 道具 */}
        <AssetSection
          title="道具"
          items={data.props || []}
          scriptNodeId={scriptNodeId}
          assetType="prop"
          onCardClick={(item) => setEditingProp(item as ScriptProp)}
          onCardAssociate={(item) => setAssociating({ assetType: 'prop', name: item.name })}
        />

        {/* 底部提示 */}
        {(data.characters?.length ?? 0) > 0 ||
        (data.scenes?.length ?? 0) > 0 ||
        (data.props?.length ?? 0) > 0 ? null : (
          <div className="text-center py-12 text-gray-400 text-sm">
            暂无资产数据，请先在步骤 1 确认镜头后生成分镜脚本
          </div>
        )}

        {/* 角色编辑弹窗 */}
        <AssetEditModal
          open={!!editingCharacter}
          scriptNodeId={scriptNodeId}
          assetType="character"
          asset={editingCharacter}
          onClose={() => setEditingCharacter(null)}
          onUpload={handleCharacterUpload}
          onDescriptionChange={handleCharacterDescriptionChange}
        />

        {/* 场景编辑弹窗 */}
        <AssetEditModal
          open={!!editingScene}
          scriptNodeId={scriptNodeId}
          assetType="scene"
          asset={editingScene}
          onClose={() => setEditingScene(null)}
          onUpload={handleSceneUpload}
          onDescriptionChange={handleSceneDescriptionChange}
        />

        {/* 道具编辑弹窗 */}
        <AssetEditModal
          open={!!editingProp}
          scriptNodeId={scriptNodeId}
          assetType="prop"
          asset={editingProp}
          onClose={() => setEditingProp(null)}
          onUpload={handlePropUpload}
          onDescriptionChange={handlePropDescriptionChange}
        />

        {/* 关联已有图片节点弹窗 */}
        <NodeAssociateModal
          open={!!associating}
          assetName={associating?.name || ''}
          currentNodeId={
            associating
              ? getAssetImageNodeId(scriptNodeId, associating.assetType, associating.name)
              : null
          }
          onAssociate={(nodeId) => {
            if (associating) {
              handleAssociateNode(associating.assetType, associating.name, nodeId);
            }
          }}
          onClose={() => setAssociating(null)}
        />
      </div>
    );
  }
);
