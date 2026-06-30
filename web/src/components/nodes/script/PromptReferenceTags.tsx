import { memo, useMemo } from 'react';
import { Tag, Tooltip } from 'antd';
import type { ScriptNodeData } from '@/types/canvas';

interface PromptReferenceTagsProps {
  prompt: string; // 提示词文本（包含 @ 引用）
  scriptData: ScriptNodeData; // 脚本节点数据（包含角色、场景、道具列表）
}

/**
 * 提示词引用标签显示组件
 * - 解析 @ 符号引用（例如 @角色-南方、@场景-水下洞穴主通道）
 * - 渲染为 Tag 标签形式
 * - 鼠标移上去显示对应资产的图片和描述
 */
export const PromptReferenceTags = memo<PromptReferenceTagsProps>(
  function PromptReferenceTags({ prompt, scriptData }) {
    // 解析提示词，提取 @ 引用并匹配资产数据（按资产名称列表匹配）
    const references = useMemo(() => {
      if (!prompt.trim()) return [];

      // 构建资产名称映射表
      const assetMap = new Map<string, { type: string; asset: any }>();
      
      // 添加角色
      scriptData.characters.forEach(c => {
        assetMap.set(c.name, { type: '角色', asset: c });
      });
      
      // 添加场景
      scriptData.scenes.forEach(s => {
        assetMap.set(s.name, { type: '场景', asset: s });
      });
      
      // 添加道具
      scriptData.props.forEach(p => {
        assetMap.set(p.name, { type: '道具', asset: p });
      });

      // 遍历映射表，查找提示词中的 @ 引用
      const refs: Array<{ fullText: string; type: string; name: string; asset?: any }> = [];
      
      assetMap.forEach((value, name) => {
        const pattern = `@${value.type}-${name}`;
        if (prompt.includes(pattern)) {
          refs.push({
            fullText: pattern,
            type: value.type,
            name: name,
            asset: { ...value.asset, type: value.type },
          });
        }
      });

      return refs;
    }, [prompt, scriptData]);

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
                {ref.fullText}
              </Tag>
            </Tooltip>
          );
        })}
      </div>
    );
  }
);