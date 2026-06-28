import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Drawer, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type {
  ScriptCharacter,
  ScriptScene,
  ScriptProp,
} from '@/types/canvas';
import { uploadImage } from '@/services/uploadApi';

type AssetType = 'character' | 'scene' | 'prop';
type Asset = ScriptCharacter | ScriptScene | ScriptProp;

interface AssetEditDrawerProps {
  open: boolean;
  assetType: AssetType;
  asset: Asset | null;
  onClose: () => void;
  /** 图片上传后更新资产 */
  onUpload: (name: string, url: string) => void;
  /** 资产描述变更（失焦时自动保存） */
  onDescriptionChange: (name: string, description: string) => void;
}

/**
 * 通用资产编辑侧屏（角色/场景/道具）
 * - 顶部大图区域，可点击上传 / 右上角按钮基于描述生成视图
 * - 资产名称只读、资产描述可编辑（失焦自动保存）
 * - 根据资产类型显示不同的额外属性
 */
export const AssetEditDrawer = memo<AssetEditDrawerProps>(
  function AssetEditDrawer({
    open,
    assetType,
    asset,
    onClose,
    onUpload,
    onDescriptionChange,
  }) {
    const [uploading, setUploading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 描述本地草稿 + 上一份已保存的描述（用于失焦比对）
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const [savedDescription, setSavedDescription] = useState('');

    // 切换资产时同步本地草稿
    useEffect(() => {
      if (asset) {
        setDescriptionDraft(asset.description || '');
        setSavedDescription(asset.description || '');
      }
    }, [asset?.name, asset?.description, asset]);

    // 关闭时重置状态
    useEffect(() => {
      if (!open) {
        setUploading(false);
        setGenerating(false);
      }
    }, [open]);

    /** 点击图片区域 → 触发文件选择 */
    const handleImageClick = useCallback(() => {
      if (uploading || generating) return;
      fileInputRef.current?.click();
    }, [uploading, generating]);

    /** 上传图片到服务器 */
    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !asset) return;
        setUploading(true);
        try {
          const url = await uploadImage(file);
          onUpload(asset.name, url);
          message.success('上传成功');
        } catch {
          message.error('上传失败');
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      [asset, onUpload]
    );

    /**
     * 基于资产描述生成视图
     * 目前为占位：使用 description 作为 prompt 提示给用户，后续接入真实生图 API
     */
    const handleGenerate = useCallback(() => {
      if (!asset) return;
      setGenerating(true);
      // TODO: 接入后端生图接口（image executor），传入 asset.description 作为 prompt
      const viewText =
        assetType === 'character'
          ? '三视图'
          : assetType === 'scene'
            ? '四视图'
            : '六视图';
      message.loading({
        content: `正在生成${viewText}…`,
        key: 'gen',
        duration: 0,
      });
      setTimeout(() => {
        message.destroy('gen');
        message.info('生图接口待接入，当前仅作演示');
        setGenerating(false);
      }, 2000);
    }, [asset, assetType]);

    /** 描述输入 */
    const handleDescriptionChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDescriptionDraft(e.target.value);
      },
      []
    );

    /** 描述失焦：与上次保存值不同则保存 */
    const handleDescriptionBlur = useCallback(() => {
      if (!asset) return;
      if (descriptionDraft === savedDescription) return;
      onDescriptionChange(asset.name, descriptionDraft);
      setSavedDescription(descriptionDraft);
    }, [asset, descriptionDraft, savedDescription, onDescriptionChange]);

    /** 获取资产类型的标题 */
    const getTitle = () => {
      switch (assetType) {
        case 'character':
          return '编辑角色';
        case 'scene':
          return '编辑场景';
        case 'prop':
          return '编辑道具';
      }
    };

    /** 获取图片区域的标签 */
    const getImageLabel = () => {
      switch (assetType) {
        case 'character':
          return '角色形象';
        case 'scene':
          return '场景图';
        case 'prop':
          return '道具图';
      }
    };

    /** 获取描述占位符 */
    const getDescriptionPlaceholder = () => {
      switch (assetType) {
        case 'character':
          return '请输入角色描述，例如：年龄、性别、发型、服装、性格、三视图要求等';
        case 'scene':
          return '请输入场景描述，包含：空间布局、环境氛围、主要元素、风格特征、四视图要求等';
        case 'prop':
          return '请输入道具描述，包含：基本外观、细节特征、功能提示、风格调性、六视图要求等';
      }
    };

    /** 渲染资产特定属性 */
    const renderExtraFields = () => {
      if (!asset) return null;

      if (assetType === 'scene') {
        const scene = asset as ScriptScene;
        return (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                时段
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.timeOfDay}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                地点
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.location}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                氛围
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.mood}
              </div>
            </div>
          </div>
        );
      }

      if (assetType === 'prop') {
        const prop = asset as ScriptProp;
        return (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-2">
              分类
            </div>
            <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
              {prop.category}
            </div>
          </div>
        );
      }

      return null;
    };

    return (
      <Drawer
        title={getTitle()}
        placement="right"
        open={open}
        onClose={onClose}
        width={420}
        destroyOnClose
        styles={{ body: { padding: '16px 20px' } }}
      >
        {asset ? (
          <div className="flex flex-col gap-4">
            {/* 图片区域 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                {getImageLabel()}
              </div>
              <div
                className="relative w-full h-[320px] rounded-lg border border-gray-200 bg-gray-50 overflow-hidden group"
                onClick={handleImageClick}
              >
                {asset.imageUrl ? (
                  <>
                    <img
                      src={asset.imageUrl}
                      alt={asset.name}
                      className="w-full h-full object-contain bg-white"
                    />
                    {/* 悬浮遮罩 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                      <span className="px-3 py-1.5 bg-white text-xs rounded-md font-medium text-gray-700">
                        替换图片
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-400 cursor-pointer hover:text-blue-500 transition-colors">
                    {uploading || generating ? (
                      <LoadingOutlined className="text-2xl animate-spin" />
                    ) : (
                      <span className="text-xs">生成或上传参考图</span>
                    )}
                  </div>
                )}

                {/* 右上角生成按钮 */}
                {asset.description && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate();
                    }}
                    disabled={generating || uploading}
                    className="absolute top-2 right-2 px-3 h-8 rounded-md bg-gray-800/80 hover:bg-gray-900 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                    title={`基于描述生成${assetType === 'character' ? '三视图' : assetType === 'scene' ? '四视图' : '六视图'}`}
                  >
                    {generating ? (
                      <LoadingOutlined className="text-xs animate-spin" />
                    ) : (
                      <span className="leading-none">AI生成</span>
                    )}
                  </button>
                )}

                {/* 隐藏的文件 input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* 资产名称 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                名称
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {asset.name}
              </div>
            </div>

            {/* 资产描述 — 可编辑 textarea，失焦自动保存 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  描述
                </span>
                {descriptionDraft !== savedDescription && (
                  <span className="text-[10px] text-amber-500">
                    未保存（失焦后自动保存）
                  </span>
                )}
              </div>
              <textarea
                value={descriptionDraft}
                onChange={handleDescriptionChange}
                onBlur={handleDescriptionBlur}
                placeholder={getDescriptionPlaceholder()}
                className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700 leading-relaxed min-h-[280px] max-h-[340px] resize-y focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>

            {/* 资产特定属性 */}
            {renderExtraFields()}
          </div>
        ) : null}
      </Drawer>
    );
  }
);