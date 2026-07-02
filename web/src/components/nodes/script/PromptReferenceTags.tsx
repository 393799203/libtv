import { memo, useMemo, useState, useEffect } from 'react';
import { Tag, Tooltip } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ScriptCharacter, ScriptScene, ScriptProp } from '@/types/canvas';

// ✅ 性能优化：只接收必要的资产数据，而不是完整的 ScriptNodeData
interface PromptReferenceTagsProps {
  prompt: string; // 提示词文本（包含 @ 引用）
  characters: ScriptCharacter[]; // 角色列表
  scenes: ScriptScene[]; // 场景列表
  props: ScriptProp[]; // 道具列表
  delayMs?: number; // ✅ 延迟匹配时间（毫秒），默认300ms
}

/**
 * 提示词引用标签显示组件
 * - 解析括号内的 @ 符号引用（例如 （@角色-南方）、（@场景-水下洞穴主通道））
 * - 渲染为 Tag 标签形式
 * - 鼠标移上去显示对应资产的图片和描述
 * - ✅ 性能优化：延迟匹配，避免阻塞 Drawer 打开动画
 */
export const PromptReferenceTags = memo<PromptReferenceTagsProps>(
  function PromptReferenceTags({ prompt, characters, scenes, props, delayMs = 500 }) {
    // ✅ 从画布获取最新节点数据（用于获取图片节点的最新 imageUrl）
    const nodes = useCanvasStore((s) => s.nodes);

    // ✅ 延迟匹配状态：初始不匹配，等待 Drawer 打开后再匹配
    const [readyToMatch, setReadyToMatch] = useState(false);

    // ✅ 延迟匹配逻辑：等待 delayMs 后才开始匹配
    useEffect(() => {
      // 如果 prompt 为空，立即设置为 ready
      if (!prompt.trim()) {
        setReadyToMatch(true);
        return;
      }

      // 延迟 delayMs 后才开始匹配
      const timer = setTimeout(() => {
        setReadyToMatch(true);
      }, delayMs);

      // 清理定时器
      return () => clearTimeout(timer);
    }, [prompt, delayMs]);

    // ✅ 简化逻辑：直接通过 nodeId 获取图片，不需要 fallback
    const assetMap = useMemo(() => {
      const map = new Map<string, { type: string; asset: any }>();

      // 添加角色 - 直接通过 nodeId 获取图片
      characters.forEach(c => {
        const node = nodes.find(n => n.id === c.nodeId);
        const imageUrl = (node?.data?.imageUrl as string) || '';

        map.set(c.name, { type: '角色', asset: { ...c, imageUrl } });
      });

      // 添加场景 - 直接通过 nodeId 获取图片
      scenes.forEach(s => {
        const node = nodes.find(n => n.id === s.nodeId);
        const imageUrl = (node?.data?.imageUrl as string) || '';

        map.set(s.name, { type: '场景', asset: { ...s, imageUrl } });
      });

      // 添加道具 - 直接通过 nodeId 获取图片
      props.forEach(p => {
        const node = nodes.find(n => n.id === p.nodeId);
        const imageUrl = (node?.data?.imageUrl as string) || '';

        map.set(p.name, { type: '道具', asset: { ...p, imageUrl } });
      });

      return map;
    }, [nodes, characters, scenes, props]);

    // ✅ 解析提示词，提取括号内的 @ 引用并匹配资产数据
    // 只有在 readyToMatch=true 时才执行匹配，避免阻塞 Drawer 打开动画
    const references = useMemo(() => {
      // 如果还没准备好匹配，返回空数组（避免阻塞）
      if (!readyToMatch || !prompt.trim()) return [];

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
    }, [readyToMatch, prompt, assetMap]); // ✅ 新增 readyToMatch 依赖

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
                {ref.name} (未找到)
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