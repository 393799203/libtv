/** 旧画布在再次生成时使用 Flash；读取历史记录时不做替换。 */
export function normalizeImageModel(model: string, channel: string): string {
  return channel === 'dianxin' && model === 'doubao-seedream-5.0-lite' ? 'doubao-seedream-5.0-flash' : model;
}

/** 只兼容有对应电信版本的旧模型；其他旧选择保留为不可用，要求用户重选。 */
export function normalizeActiveModel(model: string): string {
  const aliases: Record<string, string> = {
    'doubao-seedream-5.0-lite': 'doubao-seedream-5.0-flash',
    'doubao-seedance-2.0': 'cdance2.0-0807',
    'doubao-seedance-2.0-fast': 'cdance2.0-fast-0807',
    'doubao-seedance-2.5': 'cdance2.5-0807',
    'deepseek-v4-flash': 'deepseek-v4-flash-0731',
  };
  return aliases[model] ?? model;
}
