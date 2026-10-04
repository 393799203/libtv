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

  const [addShowForm, setAddShowForm] = useState({ title: '', description: '', video_url: '', author_id: '', duration: 0, tags: '' });
  const [addShowFile, setAddShowFile] = useState<File | null>(null);
  const [addShowPreviewUrl, setAddShowPreviewUrl] = useState('');
  const [addShowVideoFile, setAddShowVideoFile] = useState<File | null>(null);
  // 取封面阶段的播放器引用：只为读 currentTime（"截取当前帧"），不做 canvas 取帧，故不受跨域影响
  const coverPickVideoRef = useRef<HTMLVideoElement>(null);
  const [capturingCover, setCapturingCover] = useState<'current' | 'auto' | null>(null);
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
    // 注意：这里**不设** crossOrigin。本函数只用于 blob URL（本地文件），同源媒体本来
    // 就不会污染画布，加 crossOrigin 反而把请求变成 CORS 模式、徒增失败面；
    // 远端地址（对象存储无 CORS 头）一律走服务端抽帧，见 captureFrameViaServer。
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

  // 把 data URL 转成 File（服务端抽帧返回的就是 data URL）。
  // 用 atob 直接解字节，**不要** fetch(dataUrl)：既不依赖网络层、也不受 CSP/隐私设置影响，
  // 之前"点了截取但封面不换图"最可能就卡在这一步（fetch 失败被 catch 吞成一句错误提示）。
  const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('封面数据格式不对');
    const mime = /data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] || 'image/jpeg';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  };

  // 用**本地文件**截帧：blob URL 与页面同源，画布不会被污染，也不要求对象存储给 CORS 头。
  // 上传场景优先走这条：不用把视频再从 CDN 拉一遍，画质也不打折。
  const captureFrameFromFile = async (file: File, timeInSeconds?: number) => {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await captureVideoFrame(objectUrl, timeInSeconds);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  // 远端地址截帧：交给服务端 ffmpeg。
  // 浏览器 canvas 取帧必须让视频以 crossOrigin=anonymous 加载（否则 toDataURL 直接抛
  // SecurityError），而这要求对象存储返回 Access-Control-Allow-Origin —— 天翼云 ZOS
  // 不返回任何 CORS 头，所以远端地址（粘贴的 URL、给老作品换封面）只能服务端抽帧。
  const captureFrameViaServer = async (videoUrl: string, time?: number) => {
    const res = (await showApi.captureCover(videoUrl, time)) as
      | { data_url?: string; time?: number }
      | undefined;
    const dataUrl = res?.data_url;
    if (!dataUrl) throw new Error('服务端没有返回封面数据');
    return { file: dataUrlToFile(dataUrl, 'cover.jpg'), dataUrl, time: res?.time };
  };

  /**
   * 截封面：**服务端优先**，本地文件兜底。
   *
   * 为什么服务端优先：选帧算法只有服务端这一份 —— 很多视频开头是黑场/淡入，固定取第 1 秒
   * 会截出纯黑封面（线上实测某 208s 视频第 1 秒平均亮度只有 49/255，第 10 秒更黑）。
   * 服务端按时长取多个候选点、按亮度+细节挑最好的一帧。本地兜底只在服务端不可用时用一下
   * （比如域名不在白名单、网络抖动）。
   *
   * time：指定时间点（"截取当前帧"传播放头位置）；不传则由服务端自动挑帧。
   */
  const captureCoverSmart = async (
    opts: { file?: File | null; url?: string; time?: number }
  ): Promise<{ file: File; dataUrl: string; time?: number }> => {
    if (opts.url) {
      try {
        return await captureFrameViaServer(opts.url, opts.time);
      } catch (err) {
        console.warn('服务端抽帧失败，尝试用本地文件兜底:', err);
        if (!opts.file) throw err;
      }
    }
    if (!opts.file) throw new Error('没有可用的视频来源');
    const local = await captureFrameFromFile(opts.file, opts.time);
    return { ...local, time: opts.time };
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
      // 这里拿到的是远端地址（对象存储无 CORS），只能服务端抽帧
      const { file: thumbFile, dataUrl: thumbDataUrl } = await captureFrameViaServer(url);
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
    } catch (err) {
      console.warn('预填封面/时长失败（不影响提交，可手动上传封面）:', err);
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
      // 封面这一段与上传解耦：截不到封面不该显示成"上传失败"（视频其实已经传好了）
      try {
        const dur = await getVideoDuration(result.url);
        if (dur) setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
        message.loading({ content: '正在自动截取封面…', key: 'cover-auto', duration: 0 });
        const { file: thumbFile, dataUrl: thumbDataUrl } = await captureCoverSmart({ file, url: result.url });
        message.destroy('cover-auto');
        setAddShowPreviewUrl(thumbDataUrl);
        setAddShowFile(thumbFile);
      } catch (err) {
        message.destroy('cover-auto');
        console.warn('封面自动截取失败:', err);
        message.warning('视频已上传，但封面自动截取失败：可点「截当前帧」重试，或直接上传封面图');
      }
    } catch (err: any) {
      console.error('视频上传失败:', err);
      const msg = err?.response?.data?.msg || err?.message || '视频上传失败';
      setVideoErrorMsg(msg);
    } finally {
      setVideoUploading(false);
    }
  };

  /** 取播放头位置（"截取当前帧"用）：播放器同源，读 currentTime 不涉及跨域 */
  const currentVideoTime = (): number | undefined => {
    const t = coverPickVideoRef.current?.currentTime;
    return t && t > 0 ? t : undefined;
  };

  /** 截取封面，两种模式：
   *  - 'current'：用播放器当前画面（用户自己拖到想要的画面，所见即所得；取不到播放头就退到第 1 秒）
   *  - 'auto'   ：服务端自动挑一帧（按时长取多个候选点并行抽帧、按画面质量打分，避开片头黑场）
   *  两种都带"进行中"提示：自动挑帧要起多次 ffmpeg，没有反馈会被误以为按钮没反应。 */
  const handleCaptureCover = async (mode: 'current' | 'auto' = 'current') => {
    const url = videoUploadedUrl || addShowForm.video_url;
    const at = mode === 'auto' ? undefined : currentVideoTime() || 1;
    setCapturingCover(mode);
    message.loading({
      content: mode === 'auto' ? '正在自动挑帧（约 2~3 秒）…' : '正在截取当前帧…',
      key: 'cover-capture',
      duration: 0,
    });
    try {
      const { file: thumbFile, dataUrl: thumbDataUrl, time } = await captureCoverSmart({
        file: addShowVideoFile,
        url,
        time: at,
      });
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
      setVideoUploadPhase('uploading');
      message.success({
        content: `封面已截取（第 ${(time ?? at ?? 0).toFixed(1)} 秒画面）`,
        key: 'cover-capture',
      });
    } catch (err) {
      console.error('截取封面失败:', err);
      const msg = (err as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (err as { message?: string })?.message;
      message.error({ content: `截取封面失败：${msg || '请手动上传封面图'}`, key: 'cover-capture' });
    } finally {
      setCapturingCover(null);
    }
  };

  const handleVideoUrlBlur = async (url: string) => {
    if (!url.trim() || videoUploading || addShowVideoFile || videoUploadedUrl) return;
    setVideoPreviewUrl('');
    const fullUrl = url.trim().startsWith('/') ? url.trim() : url.trim();
    try {
      setVideoPreviewUrl(fullUrl);
      const dur = await getVideoDuration(fullUrl);
      if (dur) setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
      message.loading({ content: '正在自动截取封面…', key: 'cover-auto', duration: 0 });
      const { file: thumbFile, dataUrl: thumbDataUrl } = await captureFrameViaServer(fullUrl);
      message.destroy('cover-auto');
      setAddShowPreviewUrl(thumbDataUrl);
      setAddShowFile(thumbFile);
    } catch (err) {
      message.destroy('cover-auto');
      console.error('封面自动截取失败:', err);
      const msg = (err as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (err as { message?: string })?.message
        || '封面自动截取失败，请手动上传封面图';
      message.warning(msg);
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
                    {videoUploadPhase === 'pickCover' ? (<>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCaptureCover('current'); }}
                        disabled={capturingCover !== null}
                        title="先把进度拖到想要的画面，再点这里截取当前帧做封面"
                        className="px-2.5 py-0.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-[11px] rounded shadow transition-colors cursor-pointer"
                      >
                        {capturingCover === 'current' ? '截取中…' : '截当前帧'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCaptureCover('auto'); }}
                        disabled={capturingCover !== null}
                        title="服务端自动挑一帧画面清晰的做封面（避开片头黑场），约 2~3 秒"
                        className="px-2.5 py-0.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-600 text-[11px] rounded border border-blue-200 transition-colors cursor-pointer"
                      >
                        {capturingCover === 'auto' ? '挑帧中…' : '自动挑帧'}
                      </button></>
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
                    onClick={e => e.stopPropagation()}
                  />
                ) : editingShow && !videoUploading && addShowForm.video_url ? (
                  <video
                    src={addShowForm.video_url}
                    className="w-full h-full object-contain"
                    muted
                    playsInline
                    controls
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
