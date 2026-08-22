import { useState } from 'react';
import { DeleteOutlined, PlusOutlined, HighlightOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';
import { ACTION_LIBRARY, ACTION_LABELS } from './actionLibrary';

export function CharacterPanel() {
  const characters = usePrevizStore((s) => s.characters);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const mannequinError = usePrevizStore((s) => s.mannequinError);
  const addCharacter = usePrevizStore((s) => s.addCharacter);
  const removeCharacter = usePrevizStore((s) => s.removeCharacter);
  const updateCharacter = usePrevizStore((s) => s.updateCharacter);
  const addAction = usePrevizStore((s) => s.addAction);
  const removeAction = usePrevizStore((s) => s.removeAction);
  const updateActionStart = usePrevizStore((s) => s.updateActionStart);
  const addPathPoint = usePrevizStore((s) => s.addPathPoint);
  const removePathPoint = usePrevizStore((s) => s.removePathPoint);
  const updatePathPoint = usePrevizStore((s) => s.updatePathPoint);
  const pathDrawMode = usePrevizStore((s) => s.pathDrawMode);
  const setPathDrawMode = usePrevizStore((s) => s.setPathDrawMode);
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
      updateCharacter(editingId, { name: editingName.trim() });
    }
    setEditingId(null);
  };

  const selectedChar = characters.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="h-full flex flex-col">
      {/* 添加人偶 */}
      <div className="p-3 border-b border-gray-100">
        <button
          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
          onClick={addCharacter}
        >
          <PlusOutlined className="text-[10px]" />
          添加人偶
        </button>
        {mannequinError && (
          <div className="mt-2 text-[11px] text-red-400 leading-relaxed">
            人偶模型加载失败，已用占位体显示，请检查 /previz/mannequin.glb 是否存在
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 角色列表 */}
        <div className="p-2">
          {characters.length === 0 ? (
            <div className="text-xs text-gray-300 text-center py-6">暂无角色，点击上方添加</div>
          ) : (
            characters.map((char) => (
              <div
                key={char.id}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs ${
                  selectedId === char.id ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
                onClick={() => select(char.id)}
                onDoubleClick={() => startRename(char.id, char.name)}
              >
                {editingId === char.id ? (
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
                      {char.name}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity cursor-pointer shrink-0"
                      title="删除角色"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCharacter(char.id);
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

        {/* 选中角色的编辑区 */}
        {selectedChar && (
          <>
            {/* 动作库 */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1.5">
                动作库（点击加到播放头时刻）
              </div>
              {ACTION_LIBRARY.map((group) => (
                <div key={group.category} className="mb-2">
                  <div className="text-[10px] text-gray-300 mb-1">{group.category}</div>
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((item) => (
                      <button
                        key={item.clip}
                        className="px-1.5 py-0.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
                        title={item.clip}
                        onClick={() => addAction(selectedChar.id, item.clip)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 角色的动作片段列表 */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1.5">动作片段</div>
              {selectedChar.actions.length === 0 ? (
                <div className="text-[11px] text-gray-300">暂无动作，默认播待机</div>
              ) : (
                selectedChar.actions.map((action, i) => (
                  <div key={`${action.clip}-${i}`} className="group flex items-center gap-1.5 py-1">
                    <span className="flex-1 text-[11px] text-gray-600 truncate">
                      {ACTION_LABELS[action.clip] ?? action.clip}
                    </span>
                    <input
                      type="number"
                      className="w-14 bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-gray-800 outline-none focus:border-blue-400"
                      value={action.start}
                      min={0}
                      step={0.1}
                      title="开始时间（秒）"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v)) updateActionStart(selectedChar.id, i, Math.max(0, v));
                      }}
                    />
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity cursor-pointer shrink-0"
                      title="删除动作"
                      onClick={() => removeAction(selectedChar.id, i)}
                    >
                      <DeleteOutlined className="text-[11px]" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 走位路径 */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs text-gray-400 font-medium">走位路径</div>
                <div className="flex items-center gap-1">
                  <button
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                      pathDrawMode
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600'
                    }`}
                    title="开启后在视口地面连续点击绘制轨迹（每个点间隔1秒），再次点击或 ESC 结束"
                    onClick={() => setPathDrawMode(!pathDrawMode)}
                  >
                    <HighlightOutlined className="text-[9px]" />
                    {pathDrawMode ? '绘制中…' : '绘制轨迹'}
                  </button>
                  <button
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
                    title="在播放头时刻、角色当前位置添加路径点"
                    onClick={() => addPathPoint(selectedChar.id)}
                  >
                    <PlusOutlined className="text-[9px]" />
                    路径点
                  </button>
                </div>
              </div>
              {pathDrawMode && (
                <div className="text-[11px] text-blue-500 mb-1">
                  在地面点击添加路径点（首个点取当前播放头时刻，后续每点 +1 秒），拖小球可微调
                </div>
              )}
              {selectedChar.path.length === 0 ? (
                <div className="text-[11px] text-gray-300">暂无路径点（角色固定站位）</div>
              ) : (
                selectedChar.path.map((p, i) => (
                  <div key={`${p.t}-${i}`} className="group flex items-center gap-1 py-1">
                    <input
                      type="number"
                      className="w-14 bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-gray-800 outline-none focus:border-blue-400 shrink-0"
                      value={p.t}
                      min={0}
                      step={0.1}
                      title="时间（秒）"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v)) updatePathPoint(selectedChar.id, i, { t: Math.max(0, v) });
                      }}
                    />
                    {[0, 1, 2].map((axis) => (
                      <input
                        key={axis}
                        type="number"
                        className="w-12 bg-white border border-gray-300 rounded px-1 py-0.5 text-[11px] text-gray-800 outline-none focus:border-blue-400 shrink-0"
                        value={Math.round(p.position[axis] * 100) / 100}
                        step={0.1}
                        title={['X（左右）', 'Y（高度）', 'Z（前后）'][axis]}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isNaN(v)) return;
                          const position: [number, number, number] = [...p.position];
                          position[axis] = v;
                          updatePathPoint(selectedChar.id, i, { position });
                        }}
                      />
                    ))}
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity cursor-pointer shrink-0"
                      title="删除路径点"
                      onClick={() => removePathPoint(selectedChar.id, i)}
                    >
                      <DeleteOutlined className="text-[11px]" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
