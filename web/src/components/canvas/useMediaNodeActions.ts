import { useCallback, useState } from 'react';
import { message } from '@/utils/antdApp';
import { assetApi } from '@/services/assetApi';
import { downloadFile } from '@/utils/download';

/**
 * 媒体节点的三个通用动作：下载 / 存到个人资产库 / 看生成历史。
 *
 * 抽出来是因为入口从**一个**变成了**两个**（右键菜单 + 图片节点工具条）：
 * 各写一遍必然走偏（下载中的文案、重复保存的温和提示、失败处理都会不一致）。
 * 右键菜单只管显示/禁用，具体怎么做都从这里来。
 */
export function useMediaNodeActions(opts: {
  url?: string;
  /** 文件名/资产名（一般就是节点标题） */
  name?: string;
  /**
   * 素材种类（只影响文案）。
   * 注意与"能不能存进资产库"是两件事：资产库只收 image/video（UserAssetType），
   * 音频能下载但存不进去 —— 由调用方按 assetType 决定要不要给那个按钮。
   */
  mediaType: 'image' | 'video' | 'audio';
  /**
   * 存进个人资产库时用的类型；**不传就是不能存**（资产库只支持 image/video）。
   * 与 mediaType 分开是因为音频也能下载，但存不进资产库。
   */
  assetType?: 'image' | 'video';
}) {
  const { url, name, mediaType, assetType } = opts;
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const typeLabel = mediaType === 'image' ? '图片' : mediaType === 'video' ? '视频' : '音频';

  const download = useCallback(async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      await downloadFile(url);
    } catch (err) {
      console.error('下载失败:', err);
      message.error(`下载${typeLabel}失败`);
    } finally {
      setDownloading(false);
    }
  }, [url, downloading, typeLabel]);

  const saveToLibrary = useCallback(async () => {
    if (!url || saving) return;
    if (!assetType) {
      message.warning('个人资产库只支持图片和视频');
      return;
    }
    setSaving(true);
    try {
      await assetApi.create({ type: assetType, url, name }, { silentError: true });
      message.success('已存入个人资产库');
    } catch (err) {
      console.error('保存资产失败:', err);
      // 重复保存：温和提示已保存；其他错误兜底提示
      if (err instanceof Error && err.message.includes('已保存')) {
        message.warning('当前资产已保存');
      } else {
        message.error('保存失败，请重试');
      }
    } finally {
      setSaving(false);
    }
  }, [url, saving, assetType, name]);

  return { download, saveToLibrary, downloading, saving, typeLabel };
}
