import api from './api';

/**
 * 上传图片到服务端 public/pic/ 目录
 * @param file 图片文件
 * @returns 可访问的图片 URL（如 /pic/xxx.png）
 */
export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await api.post<{ url: string }>('/upload/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return res.url;
}
