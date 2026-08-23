import { useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { usePrevizStore, OBJECT_TYPE_LABELS } from './previzStore';
import { OBJECT_CATEGORIES } from './types';

export function ObjectsPanel() {
  const objects = usePrevizStore((s) => s.objects);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const addObject = usePrevizStore((s) => s.addObject);
  const removeObject = usePrevizStore((s) => s.removeObject);
  const updateObject = usePrevizStore((s) => s.updateObject);
  const select = usePrevizStore((s) => s.select);

  // 改名状态（双击名称进入编辑）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      updateObject(editingId, { name: editingName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 添加元素（按分类分组；AI 建白模的补充） */}
      <div className="p-3 border-b border-gray-100 max-h-72 overflow-y-auto">
        <div className="text-xs text-gray-400 font-medium mb-2">添加元素</div>
        {OBJECT_CATEGORIES.map((cat) => (
          <div key={cat.key} className="mb-2">
            <div className="text-[10px] text-gray-300 mb-1">{cat.label}</div>
            <div className="grid grid-cols-3 gap-1">
              {cat.types.map((type) => (
                <button
                  key={type}
                  className="flex items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
                  onClick={() => addObject(type)}
                >
                  <PlusOutlined className="text-[9px]" />
                  {OBJECT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 对象列表（微调/删除） */}
      <div className="flex-1 overflow-y-auto p-2">
        {objects.length === 0 ? (
          <div className="text-xs text-gray-300 text-center py-8 leading-relaxed">
            空场景
            <br />
            点击上方按钮添加，或用顶栏「AI 建白模」生成
          </div>
        ) : (
          objects.map((obj) => (
            <div
              key={obj.id}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs ${
                selectedId === obj.id ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => select(obj.id)}
              onDoubleClick={() => startRename(obj.id, obj.name)}
            >
              {editingId === obj.id ? (
                <input
                  className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-gray-800 outline-none focus:border-blue-400"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <>
                  <span className="flex-1 truncate" title="双击改名">
                    {obj.name}
                  </span>
                  <span className="text-gray-300 text-[10px] shrink-0">
                    {OBJECT_TYPE_LABELS[obj.type]}
                  </span>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity cursor-pointer shrink-0"
                    title="删除对象"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeObject(obj.id);
                    }}
                  >
                    <DeleteOutlined className="text-[11px]" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
