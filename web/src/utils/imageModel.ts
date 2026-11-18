/** 旧画布在再次生成时使用 Flash；读取历史记录时不做替换。 */
export function normalizeImageModel(model: string, channel: string): string {
  return channel === 'dianxin' && model === 'doubao-seedream-5.0-lite' ? 'doubao-seedream-5.0-flash' : model;
}
