import { memo, useCallback, useState } from 'react';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { message, Upload } from 'antd';
import type {
  ScriptCharacter,
  ScriptScene,
  ScriptProp,
} from '@/types/canvas';
import { uploadImage } from '@/services/uploadApi';

// ---- 单个资产卡片（角色/场景/道具通用）----
interface AssetCardProps<T extends { name: string; description: string; imageUrl?: string }> {
  item: T;
  index: number;
  onUpload: (index: string, url: string) => void;
  onAdd?: () => void; // 仅最后一个卡片显示"添加"
  showAdd?: boolean;
}

function AssetCard<T extends { name: string; description: string; imageUrl?: string }>({
  item,
  onUpload,
  onAdd,
  showAdd,
}: AssetCardProps<T>) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const url = await uploadImage(file);
        onUpload(item.name, url);
        message.success('上传成功');
      } catch {
        message.error('上传失败');
      } finally {
        setUploading(false);
      }
      return false; // 阻止默认上传行为
    },
    [item.name, onUpload]
  );

  return (
    <div className="relative w-[160px] h-[120px] rounded-lg border border-gray-200 bg-white overflow-hidden group hover:border-blue-400 transition-colors">
      {/* 图片区域 */}
      {item.imageUrl ? (
        <div className="w-full h-full relative">
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
          {/* 悬浮替换按钮 */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={handleUpload}
              disabled={uploading}
            >
              <button className="px-3 py-1.5 bg-white text-xs rounded-md font-medium text-gray-700 hover:bg-gray-50">
                替换图片
              </button>
            </Upload>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1">
          {showAdd && onAdd ? (
            /* "添加"占位 */
            <button
              onClick={onAdd}
              className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-blue-500 transition-colors cursor-pointer"
            >
              <PlusOutlined className="text-lg" />
              <span className="text-[10px]">添加</span>
            </button>
          ) : (
            /* 上传占位 */
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={handleUpload}
              disabled={uploading}
            >
              <div className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-500 transition-colors cursor-pointer">
                {uploading ? (
                  <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <UploadOutlined className="text-base" />
                    <span className="text-[10px]">点击上传参考图</span>
                  </>
                )}
              </div>
            </Upload>
          )}
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
  T extends { name: string; description: string; imageUrl?: string }
> {
  title: string;
  items: T[];
  onUpload: (itemName: string, url: string) => void;
  onAdd?: () => void;
}

function AssetSection<
  T extends { name: string; description: string; imageUrl?: string }
>({
  title,
  items,
  onUpload,
  onAdd,
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
            onUpload={(name, url) => onUpload(name, url)}
          />
        ))}
        {/* 添加按钮（作为最后一个空卡片） */}
        {onAdd && (
          <AssetCard
            item={
              { name: '', description: '', imageUrl: undefined } as T & {
                name: '';
                description: '';
                imageUrl?: string;
              }
            }
            index={items.length}
            onUpload={() => {}}
            onAdd={onAdd}
            showAdd
          />
        )}
      </div>

      {/* 描述文本 */}
      {items.length > 0 && items[0].description && (
        <p className="text-xs text-gray-500 leading-relaxed">
          {items.map((item) => (
            <span key={item.name}>
              <strong>{item.name}</strong>：{item.description}{' '}
            </span>
          ))}
        </p>
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
  data: AssetPreparationData;
  onUpdate: (updates: Partial<AssetPreparationData>) => void;
}

export const AssetPreparationPanel = memo<AssetPreparationPanelProps>(
  function AssetPreparationPanel({ data, onUpdate }) {
    // 角色图片上传
    const handleCharacterUpload = useCallback(
      (name: string, url: string) => {
        const updated = data.characters.map((c) =>
          c.name === name ? { ...c, imageUrl: url } : c
        );
        onUpdate({ characters: updated });
      },
      [data.characters, onUpdate]
    );

    // 场景图片上传
    const handleSceneUpload = useCallback(
      (name: string, url: string) => {
        const updated = data.scenes.map((s) =>
          s.name === name ? { ...s, imageUrl: url } : s
        );
        onUpdate({ scenes: updated });
      },
      [data.scenes, onUpdate]
    );

    // 道具图片上传
    const handlePropUpload = useCallback(
      (name: string, url: string) => {
        const updated = data.props.map((p) =>
          p.name === name ? { ...p, imageUrl: url } : p
        );
        onUpdate({ props: updated });
      },
      [data.props, onUpdate]
    );

    return (
      <div className="px-5 py-4 overflow-y-auto">
        {/* 角色 */}
        <AssetSection
          title="角色"
          items={data.characters || []}
          onUpload={handleCharacterUpload}
        />

        {/* 场景 */}
        <AssetSection
          title="场景"
          items={data.scenes || []}
          onUpload={handleSceneUpload}
        />

        {/* 道具 */}
        <AssetSection
          title="道具"
          items={data.props || []}
          onUpload={handlePropUpload}
        />

        {/* 底部提示 */}
        {(data.characters?.length ?? 0) > 0 ||
        (data.scenes?.length ?? 0) > 0 ||
        (data.props?.length ?? 0) > 0 ? null : (
          <div className="text-center py-12 text-gray-400 text-sm">
            暂无资产数据，请先在步骤 1 确认镜头后生成分镜脚本
          </div>
        )}

        {/* 校验提示 */}
        {(() => {
          const missingChars =
            (data.characters || []).filter((c) => !c.imageUrl).length;
          const missingScenes =
            (data.scenes || []).filter((s) => !s.imageUrl).length;
          const missingProps =
            (data.props || []).filter((p) => !p.imageUrl).length;

          if (!missingChars && !missingScenes && !missingProps) return null;

          const parts: string[] = [];
          if (missingChars > 0)
            parts.push(`${missingChars} 个人物角色`);
          if (missingScenes > 0)
            parts.push(`${missingScenes} 个场景`);
          if (missingProps > 0)
            parts.push(`${missingProps} 个道具`);

          return (
            <div className="mt-4 pt-3 border-t border-orange-100 flex items-start gap-1.5">
              <span className="text-orange-400 mt-0.5">⚠</span>
              <p className="text-xs text-orange-600 leading-relaxed">
                检测到有{parts.join('和')}没有设定图，您可以手动上传或让AI批量生成
              </p>
            </div>
          );
        })()}
      </div>
    );
  }
);
