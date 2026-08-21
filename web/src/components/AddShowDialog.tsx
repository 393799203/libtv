import { useState, useRef, useEffect, useMemo } from 'react';
import { App, Select } from 'antd';
import {
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { showApi, type ShowItem, type ShowCategoryItem } from '@/services/showApi';
import { userApi, type UserItem } from '@/services/userApi';
import { uploadVideo } from '@/services/uploadApi';
import { useAuthStore } from '@/stores/authStore';

export interface AddShowDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  categories: ShowCategoryItem[];
  activeCategoryId?: string;
  /** 预填视频 URL（从画布视频节点带入） */
  prefillVideoUrl?: string;
  /** 创建时的状态：published（管理员直接发布）或 pending（画布提交待审核） */
  status?: string;
  /** 编辑模式时传入已有视频 */
  editingShow?: ShowItem | null;
  /** 关联画布项目ID */
  projectId?: string;
  /** 画布项目名称（用于预填标题） */
  projectName?: string;
}

export default function AddShowDialog({
  open,
  onClose,
  onSuccess,
  categories,
  activeCategoryId,
  prefillVideoUrl,
  status = 'published',
  editingShow = null,
  projectId,
  projectName,
}: AddShowDialogProps) {
  const { message } = App.useApp();
  const currentUser = useAuthStore((s) => s.user); // 当前登录用户（作者默认选中自己）
  // 画布侧提交（status=pending）作者锁定为当前用户，不可更改；管理后台可自由选择
  const lockAuthor = status === 'pending';
  const coverPickVideoRef = useRef<HTMLVideoElement>(null);

  const [addShowForm, setAddShowForm] = useState({ title: '', description: '', video_url: '', author_id: '', duration: 0, tags: '' });
  const [addShowFile, setAddShowFile] = useState<File | null>(null);
  const [addShowPreviewUrl, setAddShowPreviewUrl] = useState('');
  const [addShowVideoFile, setAddShowVideoFile] = useState<File | null>(null);
  const [addShowVideoName, setAddShowVideoName] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [videoUploadPhase, setVideoUploadPhase] = useState<'uploading' | 'processing' | 'pickCover'>('uploading');
  const [videoErrorMsg, setVideoErrorMsg] = useState('');
  const [videoUploadedUrl, setVideoUploadedUrl] = useState('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');
  const [addingShow, setAddingShow] = useState(false);
  const [authorOptions, setAuthorOptions] = useState<UserItem[]>([]);
  const [authorSearching, setAuthorSearching] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [existingShow, setExistingShow] = useState<ShowItem | null>(null);

  // ========== 通用视频处理工具函数 ==========

  const captureVideoFrame = async (
    videoUrl: string,
    timeInSeconds?: number
  ): Promise<{ file: File; dataUrl: string }> => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('视频加载失败'));
    });
    video.currentTime = timeInSeconds ?? Math.min(1, video.duration * 0.01 || 1);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const blob = await fetch(dataUrl).then(r => r.blob());
    const file = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' });
    return { file, dataUrl };
  };

  const getVideoDuration = async (videoUrl: string): Promise<number> => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = videoUrl;
    return new Promise<number>((resolve) => {
      video.onloadeddata = () => resolve(Math.round(video.duration) || 0);
      video.onerror = () => resolve(0);
    });
  };

  const captureVideoElementFrame = async (video: HTMLVideoElement): Promise<{ file: File; dataUrl: string }> => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const blob = await fetch(dataUrl).then(r => r.blob());
    const file = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' });
    return { file, dataUrl };
  };

  // 作者搜索：有关键词走服务端搜索（昵称/邮箱模糊匹配），无关键词拉全量
  const fetchAuthors = (keyword?: string) => {
    setAuthorSearching(true);
    (keyword ? userApi.search(keyword) : userApi.list())
      .then(res => {
        setAuthorOptions(res.items || []);
      })
      .catch(() => {})
      .finally(() => setAuthorSearching(false));
  };

  // 作者下拉选项：搜索结果（最多50条）+ 当前已选作者（不在结果里时补一条，避免显示成原始ID）
  const authorSelectOptions = useMemo(() => {
    const opts = authorOptions.slice(0, 50).map(u => ({ label: u.nickname || u.email, value: u.id }));
    if (addShowForm.author_id && !opts.some(o => o.value === addShowForm.author_id)) {
      let label = '';
      if (currentUser && addShowForm.author_id === currentUser.id) {
        label = currentUser.nickname || currentUser.email;
      } else {
        label = editingShow?.author || existingShow?.author || '';
      }
      if (label) opts.unshift({ label, value: addShowForm.author_id });
    }
    return opts;
  }, [authorOptions, addShowForm.author_id, currentUser, editingShow, existingShow]);

  // ========== 初始化/重置 ==========

  // 预填视频 URL：自动加载预览、获取时长、截取封面
  const applyPrefillVideo = async (url: string) => {
    if (!url) return;
    setAddShowForm(prev => ({ ...prev, video_url: url }));
    setVideoPreviewUrl(url);
    setVideoUploadedUrl(url);
    setAddShowVideoName(url.split('/').pop() || '');
    try {
      const dur = await getVideoDuration(url);
      if (dur) setAddShowForm(prev => ({ ...prev, duration: dur }));
      const { file: thumbFile, dataUrl: thumbDataUrl } = await captureVideoFrame(url);
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
    } catch (err) {
      console.error('预填视频加载失败:', err);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (editingShow) {
      setAddShowForm({
        title: editingShow.title,
        description: editingShow.description || '',
        video_url: editingShow.video_url,
        author_id: editingShow.author_id || '',
        duration: editingShow.duration,
        tags: (editingShow.tags || []).join(', '),
      });
      setAddShowFile(null);
      setAddShowPreviewUrl(editingShow.thumbnail_url || '');
      setAddShowVideoFile(null);
      setAddShowVideoName(editingShow.video_url ? editingShow.video_url.split('/').pop() || '' : '');
      setVideoUploadedUrl(editingShow.video_url || '');
      setVideoUploading(false);
      setVideoUploadProgress(0);
      setVideoUploadPhase('uploading');
      setVideoErrorMsg('');
      setSelectedCategoryId(editingShow.category_id);
    } else {
      setExistingShow(null);
      setAddShowForm({ title: projectName || '', description: '', video_url: '', author_id: currentUser?.id || '', duration: 0, tags: '' });
      setAddShowFile(null);
      setAddShowPreviewUrl('');
      setAddShowVideoFile(null);
      setAddShowVideoName('');
      setVideoUploadedUrl('');
      setVideoUploading(false);
      setVideoUploadProgress(0);
      setVideoUploadPhase('uploading');
      setVideoErrorMsg('');
      setVideoPreviewUrl('');
      setSelectedCategoryId(activeCategoryId || '');

      // 如果有 projectId，查询是否已有关联的 show
      if (projectId) {
        (async () => {
          try {
            const existing = await showApi.getByProjectId(projectId);
            if (existing) {
              // 之前提交过：沿用已提交记录的全部数据（包括视频 URL、封面、时长等）
              setExistingShow(existing);
              setAddShowForm({
                title: existing.title,
                description: existing.description || '',
                video_url: existing.video_url,
                author_id: lockAuthor ? (currentUser?.id || '') : (existing.author_id || ''),
                duration: existing.duration,
                tags: (existing.tags || []).join(', '),
              });
              setAddShowPreviewUrl(existing.thumbnail_url || '');
              setAddShowVideoName(existing.video_url ? existing.video_url.split('/').pop() || '' : '');
              setVideoUploadedUrl(existing.video_url || '');
              setSelectedCategoryId(existing.category_id);
            } else {
              // 没提交过：才用选中视频节点的 prefillVideoUrl
              await applyPrefillVideo(prefillVideoUrl);
            }
          } catch {
            await applyPrefillVideo(prefillVideoUrl);
          }
        })();
      } else if (prefillVideoUrl) {
        // 无 projectId，直接用 prefillVideoUrl
        applyPrefillVideo(prefillVideoUrl);
      }
    }
    if (authorOptions.length === 0) fetchAuthors('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ========== 事件处理 ==========

  const handleSelectShowFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setAddShowFile(file); setAddShowPreviewUrl(URL.createObjectURL(file)); }
  };

  const handleSelectShowVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAddShowVideoFile(file);
    setAddShowVideoName(file.name);
    setAddShowForm(prev => ({ ...prev, video_url: '' }));
    setVideoUploadedUrl('');
    setVideoUploadProgress(0);
    setVideoUploadPhase('uploading');
    setVideoErrorMsg('');
    setAddShowFile(null);

    try {
      setVideoUploading(true);
      setVideoUploadProgress(0);
      setVideoUploadPhase('uploading');
      const result = await uploadVideo(file, (pct, phase) => {
        setVideoUploadProgress(pct);
        if (phase) setVideoUploadPhase(phase);
      }, projectId);
      setAddShowForm(prev => ({ ...prev, video_url: result.url }));
      setVideoUploadedUrl(result.url);
      if (result.cached) {
        message.success('视频已存在，直接使用缓存');
      } else if (result.compressed) {
        message.success('视频上传并压缩完成');
      } else {
        message.success('视频上传完成');
      }
      setVideoUploadPhase('pickCover');
      const dur = await getVideoDuration(result.url);
      if (dur) setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
      const { file: thumbFile, dataUrl: thumbDataUrl } = await captureVideoFrame(result.url);
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
    } catch (err: any) {
      console.error('视频上传失败:', err);
      const msg = err?.response?.data?.msg || err?.message || '视频上传失败';
      setVideoErrorMsg(msg);
    } finally {
      setVideoUploading(false);
    }
  };

  const handleCaptureCover = async () => {
    const video = coverPickVideoRef.current;
    if (!video) return;
    const { file: thumbFile, dataUrl: thumbDataUrl } = await captureVideoElementFrame(video);
    setAddShowPreviewUrl(thumbDataUrl);
    setAddShowFile(thumbFile);
    setVideoUploadPhase('uploading');
    message.success('封面已截取');
  };

  const handleVideoUrlBlur = async (url: string) => {
    if (!url.trim() || videoUploading || addShowVideoFile || videoUploadedUrl) return;
    setVideoPreviewUrl('');
    const fullUrl = url.trim().startsWith('/') ? url.trim() : url.trim();
    try {
      setVideoPreviewUrl(fullUrl);
      const dur = await getVideoDuration(fullUrl);
      if (dur) setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
      const { file: thumbFile, dataUrl: thumbDataUrl } = await captureVideoFrame(fullUrl);
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
    } catch (err) {
      console.error('视频加载失败:', err);
      message.error('视频加载失败，请检查URL是否正确');
    }
  };

  const handleAddShowSubmit = async () => {
    if (alreadyApproved) {
      message.warning('该视频已审核通过，不能重复提交审核');
      return;
    }
    if (!addShowForm.title.trim()) return;
    if (!editingShow && !existingShow && !addShowFile) return;
    const categoryId = selectedCategoryId || activeCategoryId;
    if (!categoryId) {
      message.error('请选择标签');
      return;
    }
    // 管理员编辑 或 画布用户再次提交（更新已有记录）
    const updateId = editingShow?.id || existingShow?.id;
    setAddingShow(true);
    try {
      if (updateId) {
        await showApi.update(updateId, {
          category_id: categoryId,
          title: addShowForm.title.trim(),
          description: addShowForm.description.trim() || undefined,
          video_url: (videoUploadedUrl || addShowForm.video_url.trim()) || undefined,
          author_id: (lockAuthor ? currentUser?.id : addShowForm.author_id) || undefined,
          duration: addShowForm.duration || undefined,
          tags: addShowForm.tags ? addShowForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
          // 从画布再次提交时，重置状态为 pending（让管理员重新审核）
          ...(status === 'pending' ? { status: 'pending' } : {}),
        });
        if (addShowFile) {
          await showApi.uploadThumbnail(updateId, addShowFile);
        }
      } else {
        const res = await showApi.create({
          category_id: categoryId,
          title: addShowForm.title.trim(),
          description: addShowForm.description.trim() || undefined,
          video_url: addShowForm.video_url.trim(),
          author_id: (lockAuthor ? currentUser?.id : addShowForm.author_id) || undefined,
          duration: addShowForm.duration || undefined,
          tags: addShowForm.tags ? addShowForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
          status,
          project_id: projectId,
        });
        if (addShowFile) {
          await showApi.uploadThumbnail(res.id, addShowFile);
        }
      }
      handleClose();
      onSuccess?.();
    } catch {}
    setAddingShow(false);
  };

  const handleClose = () => {
    if (addShowPreviewUrl) URL.revokeObjectURL(addShowPreviewUrl);
    onClose();
  };

  // 画布侧提交时，关联的 show 已审核通过：不允许再次提交审核
  const alreadyApproved = status === 'pending' && existingShow?.status === 'published';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative w-[520px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10 max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 shrink-0 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-gray-800">{editingShow ? '编辑视频' : status === 'pending' ? '提交视频发布' : '添加视频'}</h3>
          {existingShow && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
              existingShow.status === 'pending' ? 'bg-orange-100 text-orange-600' :
              existingShow.status === 'published' ? 'bg-green-100 text-green-600' :
              existingShow.status === 'rejected' ? 'bg-red-100 text-red-600' : ''
            }`}>
              {existingShow.status === 'pending' ? '待审核' :
               existingShow.status === 'published' ? '审核通过' :
               existingShow.status === 'rejected' ? '已拒绝' : existingShow.status}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 已审核通过提示：画布侧不能再次提交 */}
          {alreadyApproved && (
            <div className="px-3 py-2 bg-green-50 border border-green-200 text-green-700 text-[12px] rounded-lg">
              该视频已审核通过并对外发布，无需再次提交审核
            </div>
          )}
          {/* 标签选择（当有多个分类时显示） */}
          {categories.length > 0 && (
            <div>
              <label className="block text-[12px] text-gray-500 mb-1.5">标签 <span className="text-red-400">*</span></label>
              <Select
                value={selectedCategoryId || undefined}
                onChange={val => setSelectedCategoryId(val || '')}
                placeholder="选择标签"
                showSearch
                allowClear
                options={categories.map(c => ({ label: c.name, value: c.id }))}
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                getPopupContainer={(trigger) => trigger.parentElement!}
                style={{ width: '100%', height: 38 }}
              />
            </div>
          )}

          {/* 标题 */}
          <div>
            <label className="block text-[12px] text-gray-500 mb-1.5">标题 <span className="text-red-400">*</span></label>
            <input
              value={addShowForm.title}
              onChange={e => setAddShowForm(prev => ({ ...prev, title: e.target.value }))}
              placeholder="输入视频标题"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-[12px] text-gray-500 mb-1.5">描述</label>
            <textarea
              value={addShowForm.description}
              onChange={e => setAddShowForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="输入视频描述"
              rows={2}
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none resize-none"
            />
          </div>

          {/* 视频 + 封面图（同一行） */}
          <div className="grid grid-cols-2 gap-3">
            {/* 左：视频预览/上传区域 */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[12px] text-gray-500">视频 {!editingShow && <span className="text-red-400">*</span>}</label>
                {(!videoUploading && videoUploadPhase === 'pickCover' && videoUploadedUrl) || (editingShow && !videoUploading) ? (
                  <div className="flex gap-1.5">
                    {videoUploadPhase === 'pickCover' ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCaptureCover(); }}
                        className="px-2.5 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-[11px] rounded shadow transition-colors cursor-pointer"
                      >
                        截取封面
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setVideoUploadPhase('pickCover');
                          if (!videoUploadedUrl) setVideoUploadedUrl(addShowForm.video_url);
                        }}
                        className="px-2.5 py-0.5 bg-green-50 hover:bg-green-100 text-green-600 text-[11px] rounded border border-green-200 transition-colors cursor-pointer"
                      >
                        换封面
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); document.getElementById('show-video-input')?.click(); }}
                      className="px-2.5 py-0.5 bg-orange-50 hover:bg-orange-100 text-orange-600 text-[11px] rounded border border-orange-200 transition-colors cursor-pointer"
                    >
                      换视频
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                onClick={() => {
                  if (videoUploading) return;
                  if (editingShow && addShowForm.video_url && !videoUploadedUrl) return;
                  document.getElementById('show-video-input')?.click();
                }}
                className={`w-full aspect-video border-2 rounded-lg flex items-center justify-center cursor-pointer transition-colors overflow-hidden relative ${
                  videoUploading ? 'border-blue-400 bg-blue-50 cursor-wait' :
                  videoErrorMsg ? 'border-red-300 bg-red-50' :
                  editingShow && !videoUploading && addShowForm.video_url ? 'border-gray-200' :
                  'border-dashed border-gray-200 hover:border-blue-300'
                }`}
              >
                {videoUploading ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
                      <div className="flex flex-col items-center gap-2 px-4">
                        <div className={`w-6 h-6 border-2 rounded-full animate-spin ${
                          videoUploadPhase === 'processing'
                            ? 'border-orange-200 border-t-orange-500'
                            : 'border-white/30 border-t-white'
                        }`} />
                        <span className={`text-[11px] font-medium ${
                          videoUploadPhase === 'processing' ? 'text-orange-400' : 'text-white'
                        }`}>
                          {videoUploadPhase === 'processing' ? `压缩转码中...` : `上传中 ${videoUploadProgress}%`}
                        </span>
                        <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-200 ${
                              videoUploadPhase === 'processing' ? 'bg-orange-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${videoUploadProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {videoPreviewUrl && (
                      <video src={videoPreviewUrl} className="w-full h-full object-contain" muted playsInline />
                    )}
                  </>
                ) : videoErrorMsg ? (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="text-xs text-red-500 text-center px-4">{videoErrorMsg}</span>
                    <button
                      className="px-3 py-1 text-[11px] bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); setVideoErrorMsg(''); document.getElementById('show-video-input')?.click(); }}
                    >
                      重新上传
                    </button>
                  </div>
                ) : !videoUploading && videoUploadPhase === 'pickCover' && videoUploadedUrl ? (
                  <video
                    ref={coverPickVideoRef}
                    src={videoUploadedUrl}
                    className="w-full h-full object-contain"
                    muted
                    playsInline
                    controls
                    crossOrigin="anonymous"
                    onClick={e => e.stopPropagation()}
                  />
                ) : editingShow && !videoUploading && addShowForm.video_url ? (
                  <video
                    src={addShowForm.video_url}
                    className="w-full h-full object-contain"
                    muted
                    playsInline
                    controls
                    crossOrigin="anonymous"
                    onClick={e => e.stopPropagation()}
                  />
                ) : videoUploadedUrl ? (
                  <video
                    src={videoUploadedUrl}
                    className="w-full h-full object-contain"
                    muted
                    playsInline
                    controls
                    onClick={e => e.stopPropagation()}
                  />
                ) : videoPreviewUrl ? (
                  <video src={videoPreviewUrl} className="w-full h-full object-contain" muted playsInline />
                ) : addShowVideoFile ? (
                  <div className="text-center">
                    <VideoCameraOutlined style={{ fontSize: 20 }} className="mb-1 block text-blue-500" />
                    <div className="text-[12px] text-blue-600 truncate max-w-[180px]">{addShowVideoName}</div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    <UploadOutlined style={{ fontSize: 18 }} className="mb-1" />
                    <div className="text-[11px]">点击上传视频</div>
                  </div>
                )}
              </div>
              <input id="show-video-input" type="file" accept=".mp4,.webm,.mov,.avi,.mkv,.ts" className="hidden" onChange={handleSelectShowVideo} />
            </div>

            {/* 右：封面图 */}
            <div>
              <label className="block text-[12px] text-gray-500 mb-1.5">
                封面图
                {(videoUploadPhase === 'pickCover') ? <span className="text-blue-500 ml-1">(等待截取)</span> : (videoUploadedUrl || videoPreviewUrl) ? <span className="text-green-500 ml-1">(已截取)</span> : !editingShow ? <span className="text-red-400">*</span> : null}
              </label>
              <div onClick={() => document.getElementById('show-file-input')?.click()} className="w-full aspect-[16/9] border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden">
                {addShowPreviewUrl ? (
                  <img src={addShowPreviewUrl} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-gray-400">
                    <UploadOutlined style={{ fontSize: 20 }} className="mb-1" />
                    <div className="text-[11px]">点击上传封面</div>
                  </div>
                )}
              </div>
              <input id="show-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={handleSelectShowFile} />
            </div>
          </div>

          {/* 视频地址 + 时长（同一行） */}
          <div className="flex gap-3">
            <div className="flex-1">
              <input
                value={addShowForm.video_url}
                onChange={e => setAddShowForm(prev => ({ ...prev, video_url: e.target.value }))}
                onBlur={e => handleVideoUrlBlur(e.target.value)}
                placeholder="或填写视频地址（失焦后自动加载预览）"
                disabled={!!videoUploading || !!videoUploadedUrl}
                className="w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <div className="w-24">
              <input
                type="number"
                value={addShowForm.duration || ''}
                onChange={e => setAddShowForm(prev => ({ ...prev, duration: parseInt(e.target.value) || 0 }))}
                placeholder="时长(秒)"
                className="w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
              />
            </div>
          </div>

          {/* 作者 + 标签 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-gray-500 mb-1.5">作者</label>
              <Select
                value={addShowForm.author_id || undefined}
                onChange={val => setAddShowForm(prev => ({ ...prev, author_id: val }))}
                onSearch={fetchAuthors}
                onOpenChange={(open) => { if (open) fetchAuthors(''); }}
                placeholder="点击选择或输入搜索"
                showSearch
                allowClear={!lockAuthor}
                disabled={lockAuthor}
                options={authorSelectOptions}
                notFoundContent={authorSearching ? '搜索中...' : '暂无匹配用户'}
                filterOption={false}
                getPopupContainer={(trigger) => trigger.parentElement!}
                style={{ width: '100%', height: 38 }}
              />
            </div>
            <div>
              <label className="block text-[12px] text-gray-500 mb-1.5">标签（逗号分隔）</label>
              <input
                value={addShowForm.tags}
                onChange={e => setAddShowForm(prev => ({ ...prev, tags: e.target.value }))}
                placeholder="标签1, 标签2"
                className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={handleClose} className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer">取消</button>
          <button onClick={handleAddShowSubmit} disabled={addingShow || alreadyApproved || (!editingShow && !existingShow && !addShowFile)} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
            {addingShow ? '提交中...' : alreadyApproved ? '已审核通过' : (editingShow ? '保存' : status === 'pending' ? '提交' : '创建')}
          </button>
        </div>
      </div>
    </div>
  );
}
