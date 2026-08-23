import { useMemo, useRef, useState } from 'react';
import { Modal, Select, App } from 'antd';
import { UploadOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { uploadImage } from '@/services/uploadApi';
import { previzApi, type AnalyzedSceneObject } from '@/services/previzApi';
import { usePrevizStore } from './previzStore';

// 图片来源 tab
type SourceTab = 'upload' | 'image' | 'video';

// 视觉模型选项（lite 快/便宜，pro 更准）
const MODEL_OPTIONS = [
  { value: 'doubao-seed-2.0-lite', label: 'doubao-seed-2.0-lite（默认，快/便宜）' },
  { value: 'doubao-seed-2.0-pro', label: 'doubao-seed-2.0-pro（更准）' },
];

// AI 建白模弹窗：上传图片 / 画布图片节点 / 视频节点抽帧 → 视觉模型解析 → 自动搭建白模场景
export function AIBuildModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const nodes = useCanvasStore((s) => s.nodes);

  const [sourceTab, setSourceTab] = useState<SourceTab>('upload');
  const [imageUrl, setImageUrl] = useState(''); // 最终用于解析的图片 URL
  const [model, setModel] = useState('doubao-seed-2.0-lite');
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // 解析完成且场景已有对象时，暂存结果等用户选择追加/重建
  const [pendingObjects, setPendingObjects] = useState<AnalyzedSceneObject[] | null>(null);
  const [description, setDescription] = useState('');

  // 视频抽帧：选中的视频节点 URL + video 元素引用
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 画布上可用的图片节点 / 视频节点
  const imageNodes = useMemo(
    () =>
      nodes
        .filter((n) => n.data.type === 'image' && (n.data as { imageUrl?: string }).imageUrl)
        .map((n) => ({
          id: n.id,
          label: (n.data as { label?: string }).label || '图片',
          url: (n.data as { imageUrl?: string }).imageUrl!,
        })),
    [nodes]
  );
  const videoNodes = useMemo(
    () =>
      nodes
        .filter((n) => n.data.type === 'video' && (n.data as { videoUrl?: string }).videoUrl)
        .map((n) => ({
          id: n.id,
          label: (n.data as { label?: string }).label || '视频',
          url: (n.data as { videoUrl?: string }).videoUrl!,
        })),
    [nodes]
  );

  // ====== 来源一：本地上传 ======
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file, projectId);
      setImageUrl(res.url);
    } catch (err) {
      console.error('上传参考图失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ====== 来源三：视频抽帧（截取 video 元素当前帧 → 上传）======
  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      message.warning('请先选择视频并等画面加载出来');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    );
    if (!blob) {
      message.error('抽帧失败');
      return;
    }
    setUploading(true);
    try {
      const file = new File([blob], `previz-frame-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const res = await uploadImage(file, projectId);
      setImageUrl(res.url);
      message.success('已截取当前帧');
    } catch (err) {
      console.error('抽帧上传失败:', err);
    } finally {
      setUploading(false);
    }
  };

  // ====== 导入结果到场景 ======
  const applyObjects = (objects: AnalyzedSceneObject[], mode: 'append' | 'replace') => {
    usePrevizStore.getState().importObjects(
      // 生成 id / 补默认颜色由 store 与这里共同完成，走既有序列化链路
      objects.map((o) => ({
        type: o.type,
        name: o.name,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        color: '#9ca3af',
      })),
      mode
    );
    message.success(`已生成 ${objects.length} 个场景对象`);
    onClose();
  };

  // ====== 开始解析 ======
  const handleAnalyze = async () => {
    if (!imageUrl) {
      message.warning('请先选择或上传参考图');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await previzApi.analyzeScene(imageUrl, model);
      if (!res.objects || res.objects.length === 0) {
        message.warning('未解析出场景对象，请换一张更清晰的参考图');
        return;
      }
      setDescription(res.description || '');
      // 已有对象时让用户选择追加/重建，否则直接追加
      if (usePrevizStore.getState().objects.length > 0) {
        setPendingObjects(res.objects);
      } else {
        applyObjects(res.objects, 'append');
      }
    } catch (err) {
      console.error('AI 建白模失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setAnalyzing(false);
    }
  };

  const sourceTabs: { key: SourceTab; label: string; icon: React.ReactNode }[] = [
    { key: 'upload', label: '上传图片', icon: <UploadOutlined /> },
    { key: 'image', label: '画布图片', icon: <PictureOutlined /> },
    { key: 'video', label: '视频抽帧', icon: <VideoCameraOutlined /> },
  ];

  return (
    <Modal
      title="AI 建白模"
      open
      width={520}
      onCancel={onClose}
      footer={
        pendingObjects ? (
          // 场景已有对象：追加 / 清空重建
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">当前场景已有对象，解析出 {pendingObjects.length} 个新对象</span>
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors cursor-pointer"
                onClick={() => applyObjects(pendingObjects, 'append')}
              >
                追加到现有场景
              </button>
              <button
                className="px-3 py-1.5 text-xs text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors cursor-pointer"
                onClick={() => applyObjects(pendingObjects, 'replace')}
              >
                清空后重建
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors cursor-pointer"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className={`px-3 py-1.5 text-xs text-white rounded transition-colors cursor-pointer ${
                analyzing ? 'bg-blue-300 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
              }`}
              disabled={analyzing}
              onClick={handleAnalyze}
            >
              {analyzing ? '解析中...' : '开始解析'}
            </button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {/* 图片来源 tab */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {sourceTabs.map((tab) => (
            <button
              key={tab.key}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                sourceTab === tab.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setSourceTab(tab.key)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* 来源一：本地上传 */}
        {sourceTab === 'upload' && (
          <div
            className="h-32 border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <UploadOutlined className="text-xl text-gray-300" />
            <span className="text-xs text-gray-400">
              {uploading ? '上传中...' : '点击上传参考图'}
            </span>
          </div>
        )}

        {/* 来源二：画布图片节点 */}
        {sourceTab === 'image' && (
          <div className="max-h-48 overflow-y-auto">
            {imageNodes.length === 0 ? (
              <div className="text-xs text-gray-300 text-center py-8">
                画布上还没有带图片的图像节点
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {imageNodes.map((n) => (
                  <div
                    key={n.id}
                    className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                      imageUrl === n.url ? 'border-blue-500' : 'border-transparent hover:border-blue-200'
                    }`}
                    title={n.label}
                    onClick={() => setImageUrl(n.url)}
                  >
                    <img src={n.url} alt={n.label} className="w-full h-20 object-cover" />
                    <div className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-[10px] px-1 py-0.5 truncate">
                      {n.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 来源三：画布视频节点抽帧 */}
        {sourceTab === 'video' && (
          <div className="flex flex-col gap-2">
            {videoNodes.length === 0 ? (
              <div className="text-xs text-gray-300 text-center py-8">
                画布上还没有带视频的视频节点
              </div>
            ) : (
              <>
                <Select
                  size="small"
                  placeholder="选择视频节点"
                  value={selectedVideoUrl || undefined}
                  options={videoNodes.map((n) => ({ value: n.url, label: n.label }))}
                  onChange={(v) => setSelectedVideoUrl(v)}
                />
                {selectedVideoUrl && (
                  <>
                    <video
                      ref={videoRef}
                      src={selectedVideoUrl}
                      className="w-full h-40 bg-black rounded-lg"
                      controls
                      crossOrigin="anonymous"
                    />
                    <button
                      className={`self-start px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
                        uploading
                          ? 'bg-gray-100 text-gray-400 cursor-wait'
                          : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                      }`}
                      disabled={uploading}
                      onClick={handleCaptureFrame}
                    >
                      {uploading ? '上传中...' : '截取当前帧作为参考图'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* 已选参考图预览 */}
        {imageUrl && (
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
            <img src={imageUrl} alt="参考图" className="w-16 h-16 object-cover rounded" />
            <span className="text-xs text-gray-500 flex-1">已选择参考图</span>
            <button
              className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
              onClick={() => setImageUrl('')}
            >
              移除
            </button>
          </div>
        )}

        {/* 模型选择 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-16 shrink-0">视觉模型</span>
          <Select
            size="small"
            className="flex-1"
            value={model}
            options={MODEL_OPTIONS}
            onChange={setModel}
          />
        </div>

        {/* 解析结果概述 */}
        {description && (
          <div className="text-xs text-gray-500 bg-blue-50 rounded-lg px-2.5 py-2">
            场景概述：{description}
          </div>
        )}
      </div>

      {/* 隐藏的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
    </Modal>
  );
}
