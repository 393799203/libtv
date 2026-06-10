import api from './api';

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
 * 独立上传视频文件到 public/videos/ 目录（不依赖 show ID）
 * @param file 视频文件
 * @param onProgress 上传进度回调 0-100
 * @returns 上传结果（url + 压缩/缓存状态）
 */
export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; compressed: boolean; cached: boolean }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await api.post<{ url: string; compressed: boolean; cached: boolean }>(
    '/upload/video',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 视频转码可能需要较长时间，设置2分钟超时
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(Math.min(pct, 99));
        }
      },
    },
  );

  onProgress?.(100);
  return res;
}
