import { memo, useMemo } from 'react';
import { Tag, Tooltip } from 'antd';
import type { ScriptCharacter, ScriptScene, ScriptProp } from '@/types/canvas';

// ✅ 性能优化：只接收必要的资产数据，而不是完整的 ScriptNodeData
interface PromptReferenceTagsProps {
  prompt: string; // 提示词文本（包含 @ 引用）
  characters: ScriptCharacter[]; // 角色列表
  scenes: ScriptScene[]; // 场景列表
  props: ScriptProp[]; // 道具列表
}

/**
 * 提示词引用标签显示组件
 * - 解析 @ 符号引用（例如 @角色-南方、@场景-水下洞穴主通道）
 * - 渲染为 Tag 标签形式
 * - 鼠标移上去显示对应资产的图片和描述
 */
export const PromptReferenceTags = memo<PromptReferenceTagsProps>(
  function PromptReferenceTags({ prompt, characters, scenes, props }) {
    // ✅ 性能优化：先缓存资产映射表，避免每次 prompt 变化都重新遍历所有资产
    const assetMap = useMemo(() => {
      const map = new Map<string, { type: string; asset: any }>();

      // 添加角色
      characters.forEach(c => {
        map.set(c.name, { type: '角色', asset: c });
      });

      // 添加场景
      scenes.forEach(s => {
        map.set(s.name, { type: '场景', asset: s });
      });

      // 添加道具
      props.forEach(p => {
        map.set(p.name, { type: '道具', asset: p });
      });

      return map;
    }, [characters, scenes, props]); // 只依赖资产数组

    // 解析提示词，提取括号内的 @ 引用并匹配资产数据
    const references = useMemo(() => {
      if (!prompt.trim()) return [];

      // ✅ 简化匹配：只提取括号内的 @引用部分
      // 新格式：资产名称（@类型-资产名称），只匹配括号内的 @类型-名称
      const refs: Array<{ fullText: string; type: string; name: string; asset?: any }> = [];

      // 使用正则表达式提取括号内的 @引用
      // 匹配格式：（@类型-名称）或 (@类型-名称)
      const regex = /[（(]@(角色|场景|道具)-([\u4e00-\u9fa5a-zA-Z0-9_-]+)[）)]/g;
      const matches = prompt.matchAll(regex);

      // ✅ 去重：使用Map记录已处理的资产，避免重复显示
      const seenAssets = new Map<string, boolean>();

      for (const match of matches) {
        const type = match[1]; // 角色|场景|道具
        const name = match[2]; // 资产名称
        const fullText = match[0]; // 完整的括号内容，如 "（@角色-南方）"

        // 去重key：类型+名称
        const key = `${type}-${name}`;

        // 如果已经处理过这个资产，跳过
        if (seenAssets.has(key)) {
          continue;
        }
        seenAssets.set(key, true);

        // 从assetMap查找对应资产
        const assetInfo = assetMap.get(name);
        if (assetInfo && assetInfo.type === type) {
          refs.push({
            fullText,
            type,
            name,
            asset: { ...assetInfo.asset, type },
          });
        } else {
          // 未找到匹配的资产，显示为红色标签
          refs.push({
            fullText,
            type,
            name,
            asset: undefined,
          });
        }
      }

      return refs;
    }, [prompt, assetMap]); // 依赖 prompt 和缓存的 assetMap

    if (references.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {references.map((ref, index) => {
          // 未匹配到资产，显示为红色标签
          if (!ref.asset) {
            return (
              <Tag key={index} color="red">
                {ref.fullText} (未找到)
              </Tag>
            );
          }

          // 匹配到资产，显示为带 Tooltip 的标签
          const colorMap = {
            '角色': 'blue',
            '场景': 'green',
            '道具': 'orange',
          };

          return (
            <Tooltip
              key={index}
              placement="top"
              title={
                <div className="max-w-xs">
                  {ref.asset.imageUrl && (
                    <img
                      src={ref.asset.imageUrl}
                      alt={ref.asset.name}
                      className="w-full h-auto rounded mb-2"
                      style={{ maxHeight: '200px', objectFit: 'contain' }}
                    />
                  )}
                  <div className="font-medium text-white">{ref.asset.name}</div>
                  <div className="text-xs text-gray-300 mt-1">{ref.asset.type}</div>
                  {ref.asset.description && (
                    <div className="text-xs text-gray-400 mt-1 line-clamp-3">
                      {ref.asset.description.substring(0, 100)}...
                    </div>
                  )}
                </div>
              }
              mouseEnterDelay={0.2}
            >
              <Tag color={colorMap[ref.type] || 'default'} className="cursor-pointer">
                {ref.name}
              </Tag>
            </Tooltip>
          );
        })}
      </div>
    );
  }
);