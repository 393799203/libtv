import api from './api';

/** 视频转码任务状态 */
export type VideoTaskStatus = 'processing' | 'done' | 'failed';

export interface VideoTaskResult {
  status: VideoTaskStatus;
  url?: string;
  compressed: boolean;
  error?: string;
}

/**
 * 上传图片到服务端 public/canvas/ 目录（按项目 ID 分文件夹）
 * @param file 图片文件
 * @param projectId 可选的项目 ID，传入后图片存入 canvas/{projectId}/ 子目录
 * @returns 可访问的图片 URL（如 /media/canvas/xxx.png 或 /media/canvas/{projectId}/xxx.png）
 */
export async function uploadImage(file: File, projectId?: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  if (projectId) formData.append('project_id', projectId);

  const res = await api.post<{ url: string }>('/upload/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return res.url;
}

/**
 * 查询视频转码任务状态
 */
export async function getVideoTaskStatus(taskId: string): Promise<VideoTaskResult> {
  const res = await api.get<VideoTaskResult>(`/upload/video/status/${taskId}`);
  return res;
}

/**
 * 上传视频文件（异步模式：上传完成后如需转码则后台执行，前端轮询状态）
 *
 * 流程：
 *   1. 上传文件 → 返回 url 或 task_id
 *   2. 有 task_id 时轮询 /upload/video/status/:taskId
 *   3. 转码完成返回最终 url
 *
 * @param file 视频文件
 * @param onProgress 进度回调 0-100（上传阶段）+ 可选阶段文字
 * @param projectId 项目 ID
 * @returns 上传结果
 */
export async function uploadVideo(
  file: File,
  onProgress?: (percent: number, phase?: 'uploading' | 'processing') => void,
  projectId?: string,
): Promise<{ url: string; compressed: boolean; cached: boolean }> {
  const formData = new FormData();
  formData.append('file', file);
  if (projectId) formData.append('project_id', projectId);

  // 第一阶段：上传文件
  const uploadRes = await api.post<{
    url: string;
    task_id: string;
    compressed: boolean;
    cached: boolean;
  }>('/upload/video', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000, // 5分钟超时（大文件上传需要足够时间）
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(Math.min(pct, 99), 'uploading');
      }
    },
  });

  // 无需转码，直接返回结果
  if (!uploadRes.task_id) {
    onProgress?.(100);
    return {
      url: uploadRes.url,
      compressed: uploadRes.compressed,
      cached: uploadRes.cached,
    };
  }

  // 第二阶段：轮询转码状态
  onProgress?.(99, 'processing');

  const POLL_INTERVAL = 1500; // 1.5秒轮询一次
  const MAX_WAIT = 10 * 60 * 1000; // 最长等待10分钟
  const startTime = Date.now();

  while (true) {
    // 超时检查
    if (Date.now() - startTime > MAX_WAIT) {
      throw new Error('视频转码超时，请稍后重试');
    }

    // 等待后轮询
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    const task = await getVideoTaskStatus(uploadRes.task_id);

    if (task.status === 'done') {
      if (!task.url) {
        throw new Error('转码完成但未获取到视频地址');
      }
      onProgress?.(100);
      return {
        url: task.url,
        compressed: task.compressed,
        cached: false,
      };
    }

    if (task.status === 'failed') {
      throw new Error(task.error || '视频转码失败');
    }

    // still processing → continue loop
  }
}

/**
 * 删除指定项目的 canvas 文件夹（删除项目时调用）
 * @param projectId 项目 ID
 */
export async function deleteCanvasDir(projectId: string): Promise<void> {
  await api.delete(`/upload/canvas/${projectId}`);
}
