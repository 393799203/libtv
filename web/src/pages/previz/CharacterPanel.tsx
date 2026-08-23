import { useEffect, useMemo, useState } from 'react';
import { Select, App, Slider } from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  HighlightOutlined,
  CopyOutlined,
  ManOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { usePrevizStore, CHARACTER_PALETTE, characterColorLabel, parseBoneId } from './previzStore';
import { MODEL_DEFS, actionLabel, modelDef } from './actionLibrary';
import { snapshotPose, getPoseBone, POSE_BONE_LABELS } from './poseBones';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ScriptNodeData } from '@/types/canvas';

export function CharacterPanel() {
  const { message } = App.useApp();
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
  const poseEditingCharId = usePrevizStore((s) => s.poseEditingCharId);
  const setPoseEditing = usePrevizStore((s) => s.setPoseEditing);
  const savePoseAction = usePrevizStore((s) => s.savePoseAction);
  const select = usePrevizStore((s) => s.select);
  const canvasNodes = useCanvasStore((s) => s.nodes);

  // 画布 script 节点里的剧本角色名（绑定角色下拉选项）
  const scriptCharacterNames = useMemo(() => {
    const names: string[] = [];
    for (const n of canvasNodes) {
      if (n.data.type !== 'script') continue;
      for (const c of (n.data as ScriptNodeData).characters ?? []) {
        if (c.name && !names.includes(c.name)) names.push(c.name);
      }
    }
    return names;
  }, [canvasNodes]);

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

  // 骨骼选中（bone:charId:segment）时定位到所属角色，保持角色详情/姿态滑杆可见
  const boneSel = selectedId ? parseBoneId(selectedId) : null;
  const selectedChar =
    characters.find((c) => c.id === selectedId) ??
    (boneSel ? characters.find((c) => c.id === boneSel.charId) ?? null : null);
  // 姿态编辑模式是否作用于当前选中角色
  const poseEditing = !!selectedChar && poseEditingCharId === selectedChar.id;

  // 保存当前姿势为一条「自定义姿势」动作（挂到当前播放头时刻）
  const handleSavePose = () => {
    if (!selectedChar) return;
    const pose = snapshotPose(selectedChar.id);
    if (!pose || Object.keys(pose).length === 0) {
      message.warning('未获取到骨骼数据，请确认人偶已加载');
      return;
    }
    savePoseAction(selectedChar.id, pose);
    message.success('已保存姿势到动作列表');
  };

  // 身份映射提示词：只列绑定了剧本角色的角色，颜色写中文名
  const boundChars = characters.filter((c) => c.assetName);
  const handleCopyMapping = async () => {
    if (boundChars.length === 0) return;
    const mapping = boundChars
      .map((c) => `${characterColorLabel(c.color)}色人物是「${c.assetName}」`)
      .join('，');
    const text = `Video 1 为白模预演参考：人物的走位、动作、镜头运动以 Video 1 为准。颜色与角色对应关系：${mapping}。（参考图 Image 1/Image 2 请按上述角色顺序提供）`;
    try {
      await navigator.clipboard.writeText(text);
      message.success('映射提示词已复制');
    } catch (err) {
      console.error('复制失败:', err);
      message.error('复制失败，请检查浏览器剪贴板权限');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 添加人偶（男体 / 女体） */}
      <div className="p-3 border-b border-gray-100">
        <div className="grid grid-cols-3 gap-1">
          {(Object.values(MODEL_DEFS)).map((m) => (
            <button
              key={m.kind}
              className="flex items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
              onClick={() => addCharacter(m.kind)}
            >
              <PlusOutlined className="text-[9px]" />
              {m.label}
            </button>
          ))}
        </div>
        {mannequinError && (
          <div className="mt-2 text-[11px] text-red-400 leading-relaxed">
            人偶模型加载失败，已用占位体显示，请检查 /previz/ 下的 GLB 模型文件是否存在
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
            {/* 染色（白片中区分角色） */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1.5">颜色</div>
              <div className="flex flex-wrap gap-1.5">
                {CHARACTER_PALETTE.map((p) => (
                  <button
                    key={p.color}
                    className={`w-5 h-5 rounded cursor-pointer transition-transform hover:scale-110 ${
                      selectedChar.color === p.color
                        ? 'ring-2 ring-offset-1 ring-blue-500'
                        : 'ring-1 ring-gray-200'
                    }`}
                    style={{ backgroundColor: p.color }}
                    title={`${p.label}色`}
                    onClick={() => updateCharacter(selectedChar.id, { color: p.color })}
                  />
                ))}
              </div>
            </div>

            {/* 绑定剧本角色（生成身份映射提示词用） */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1.5">绑定角色</div>
              {scriptCharacterNames.length > 0 ? (
                <Select
                  size="small"
                  className="w-full"
                  placeholder="选择剧本角色"
                  allowClear
                  value={selectedChar.assetName}
                  options={scriptCharacterNames.map((name) => ({ value: name, label: name }))}
                  onChange={(v) => updateCharacter(selectedChar.id, { assetName: v || undefined })}
                />
              ) : (
                <input
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 outline-none focus:border-blue-400"
                  placeholder="角色名，如：南方"
                  value={selectedChar.assetName ?? ''}
                  onChange={(e) =>
                    updateCharacter(selectedChar.id, { assetName: e.target.value.trim() || undefined })
                  }
                />
              )}
            </div>

            {/* 姿态编辑：骨骼小球 + gizmo 旋转摆姿势，可保存为自定义姿势动作 */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-400 font-medium">姿态编辑</div>
                <button
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                    poseEditing
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600'
                  }`}
                  title="开启后角色显示骨骼点，点击骨骼用 gizmo 旋转摆姿势"
                  onClick={() => setPoseEditing(poseEditing ? null : selectedChar.id)}
                >
                  <ManOutlined className="text-[9px]" />
                  {poseEditing ? '退出姿态编辑' : '姿态编辑'}
                </button>
              </div>
              {poseEditing && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <div className="text-[11px] text-blue-500 leading-relaxed">
                    视口中点击骨骼小球选中骨骼，用下方滑杆调整旋转（编辑期间该角色暂停动画）
                  </div>
                  <BonePoseSliders />
                  <button
                    className="flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
                    title="把当前姿势保存为动作（挂到当前播放头时刻）"
                    onClick={handleSavePose}
                  >
                    <SaveOutlined className="text-[9px]" />
                    保存为姿势
                  </button>
                </div>
              )}
            </div>

            {/* 动作库（按当前角色模型过滤：男体/女体各自支持的常规动作） */}
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1.5">
                动作库（点击加到播放头时刻）
              </div>
              {modelDef(selectedChar.model).library.map((group) => (
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
                      {actionLabel(selectedChar.model, action.clip)}
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
              {selectedChar.path.length >= 2 && (
                <label className="flex items-center gap-1.5 mb-1.5 text-[11px] text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!selectedChar.manualFacing}
                    onChange={(e) => updateCharacter(selectedChar.id, { manualFacing: !e.target.checked })}
                  />
                  行走时自动朝向前进方向（手动旋转过朝向则取消勾选）
                </label>
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

      {/* 身份映射提示词（白片喂视频模型时说明颜色 ↔ 角色对应关系） */}
      <div className="p-3 border-t border-gray-100 shrink-0">
        <button
          className={`w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded transition-colors cursor-pointer ${
            boundChars.length === 0
              ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
              : 'text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600'
          }`}
          disabled={boundChars.length === 0}
          title={boundChars.length === 0 ? '请先在上方为角色绑定剧本角色' : '复制颜色与角色对应关系提示词'}
          onClick={handleCopyMapping}
        >
          <CopyOutlined className="text-[10px]" />
          复制映射提示词
        </button>
        {boundChars.length === 0 && characters.length > 0 && (
          <div className="mt-1.5 text-[10px] text-gray-300 text-center">先为角色绑定剧本角色</div>
        )}
      </div>
    </div>
  );
}

// 骨骼旋转滑杆：选中骨骼小球后调整其 X/Y/Z 轴旋转（度）
function BonePoseSliders() {
  const selectedId = usePrevizStore((s) => s.selectedId);
  const boneSel = selectedId ? parseBoneId(selectedId) : null;
  const bone = boneSel ? getPoseBone(boneSel.charId, boneSel.segment) : undefined;
  const [euler, setEuler] = useState<[number, number, number]>([0, 0, 0]);

  // 选中骨骼变化时读取其当前旋转（度）
  useEffect(() => {
    if (bone) {
      setEuler([
        Math.round((bone.rotation.x * 180) / Math.PI),
        Math.round((bone.rotation.y * 180) / Math.PI),
        Math.round((bone.rotation.z * 180) / Math.PI),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boneSel?.charId, boneSel?.segment]);

  if (!boneSel || !bone) {
    return <div className="text-[11px] text-gray-300">未选中骨骼（点击视口中的骨骼小球）</div>;
  }

  const onAxis = (axis: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [...euler];
    next[axis] = v;
    setEuler(next);
    bone.rotation.set((next[0] * Math.PI) / 180, (next[1] * Math.PI) / 180, (next[2] * Math.PI) / 180);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] text-gray-600 font-medium">
        {POSE_BONE_LABELS[boneSel.segment] ?? boneSel.segment}
      </div>
      {(['X', 'Y', 'Z'] as const).map((label, axis) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400 w-3 shrink-0">{label}</span>
          <Slider
            className="flex-1"
            min={-180}
            max={180}
            step={1}
            value={euler[axis]}
            onChange={(v) => onAxis(axis as 0 | 1 | 2, v as number)}
          />
          <span className="text-[10px] text-gray-500 w-8 text-right shrink-0">{euler[axis]}°</span>
        </div>
      ))}
    </div>
  );
}
