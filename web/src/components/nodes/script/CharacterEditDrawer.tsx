import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Drawer, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type { ScriptCharacter } from '@/types/canvas';
import { uploadImage } from '@/services/uploadApi';

interface CharacterEditDrawerProps {
  open: boolean;
  character: ScriptCharacter | null;
  onClose: () => void;
  /** 图片上传后更新角色 */
  onUpload: (name: string, url: string) => void;
  /** 角色描述变更（失焦时自动保存） */
  onDescriptionChange: (name: string, description: string) => void;
}

/**
 * 角色编辑侧屏
 * - 顶部大图区域，可点击上传 / 右上角按钮基于描述生成三视图
 * - 角色名称只读、角色描述可编辑（失焦自动保存）
 */
export const CharacterEditDrawer = memo<CharacterEditDrawerProps>(
  function CharacterEditDrawer({
    open,
    character,
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

    // 切换角色时同步本地草稿
    useEffect(() => {
      if (character) {
        setDescriptionDraft(character.description || '');
        setSavedDescription(character.description || '');
      }
    }, [character?.name, character?.description, character]);

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
        if (!file || !character) return;
        setUploading(true);
        try {
          const url = await uploadImage(file);
          onUpload(character.name, url);
          message.success('上传成功');
        } catch {
          message.error('上传失败');
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      [character, onUpload]
    );

    /**
     * 基于角色描述生成三视图
     * 目前为占位：使用 description 作为 prompt 提示给用户，后续接入真实生图 API
     */
    const handleGenerate = useCallback(() => {
      if (!character) return;
      setGenerating(true);
      // TODO: 接入后端生图接口（image executor），传入 character.description 作为 prompt
      message.loading({ content: '正在生成三视图…', key: 'gen', duration: 0 });
      setTimeout(() => {
        message.destroy('gen');
        message.info('生图接口待接入，当前仅作演示');
        setGenerating(false);
      }, 2000);
    }, [character]);

    /** 描述输入 */
    const handleDescriptionChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDescriptionDraft(e.target.value);
      },
      []
    );

    /** 描述失焦：与上次保存值不同则保存 */
    const handleDescriptionBlur = useCallback(() => {
      if (!character) return;
      if (descriptionDraft === savedDescription) return;
      onDescriptionChange(character.name, descriptionDraft);
      setSavedDescription(descriptionDraft);
    }, [character, descriptionDraft, savedDescription, onDescriptionChange]);

    return (
      <Drawer
        title="编辑角色"
        placement="right"
        open={open}
        onClose={onClose}
        width={420}
        destroyOnClose
        styles={{ body: { padding: '16px 20px' } }}
      >
        {character ? (
          <div className="flex flex-col gap-4">
            {/* 角色形象区 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                角色形象
              </div>
              <div
                className="relative w-full h-[320px] rounded-lg border border-gray-200 bg-gray-50 overflow-hidden group"
                onClick={handleImageClick}
              >
                {character.imageUrl ? (
                  <>
                    <img
                      src={character.imageUrl}
                      alt={character.name}
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
                      <span className="text-xs">生成或上传角色图</span>
                    )}
                  </div>
                )}

                {/* 右上角生成按钮 */}
                {character.description && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate();
                    }}
                    disabled={generating || uploading}
                    className="absolute top-2 right-2 px-3 h-8 rounded-md bg-gray-800/80 hover:bg-gray-900 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                    title="基于描述生成三视图"
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

            {/* 角色名称 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                角色名称
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {character.name}
              </div>
            </div>

            {/* 角色描述 — 可编辑 textarea，失焦自动保存 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  角色描述
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
                placeholder="请输入角色描述，例如：年龄、性别、发型、服装、性格等"
                className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700 leading-relaxed min-h-[280px] max-h-[340px] resize-y focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    );
  }
);
