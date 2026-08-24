import { create } from 'zustand';
import type {
  PrevizCamera,
  PrevizCameraMove,
  PrevizCharacter,
  PrevizModelKind,
  PrevizObject,
  PrevizObjectType,
  PrevizPathPoint,
  PrevizScene,
  Vec3,
} from './types';
import { createEmptyScene } from './types';
import { POSE_CLIP } from './actionLibrary';

// 各元素类型的中文名（用于自动生成对象名）
export const OBJECT_TYPE_LABELS: Record<PrevizObjectType, string> = {
  // 基础几何
  box: '方块',
  cylinder: '圆柱',
  sphere: '球体',
  plane: '平面',
  wall: '墙体',
  // 建筑结构
  stairs: '楼梯',
  house: '房子',
  fence: '栅栏',
  ramp: '斜坡',
  platform: '平台',
  door: '门',
  window: '窗',
  arch: '拱门',
  railing: '栏杆',
  // 街道设施
  road: '路面',
  streetlamp: '路灯',
  bench: '长椅',
  signboard: '招牌',
  sidewalk: '人行道',
  utilitypole: '电线杆',
  // 家具
  table: '桌子',
  chair: '椅子',
  sofa: '沙发',
  bed: '床',
  cabinet: '柜子',
  screen: '屏幕',
  // 载具
  car: '车辆',
  truck: '卡车',
  motorcycle: '摩托',
  bicycle: '自行车',
  // 自然
  tree: '树',
  rock: '岩石',
  bush: '灌木',
  water: '水面',
  hill: '土坡',
};

// 白模默认灰色系颜色
const DEFAULT_COLOR = '#9ca3af';
// 路面深灰（区别于地面）
const ROAD_COLOR = '#4b5563';
// 人行道浅灰（区别于 road 深灰）
const SIDEWALK_COLOR = '#cbd5e1';
// 水面半透明蓝
const WATER_COLOR = '#60a5fa';

// 各类型新对象的默认变换与颜色（组合式组件内部比例写死、包围盒约 1m，scale 表达实际米数）
const OBJECT_DEFAULTS: Record<
  PrevizObjectType,
  { position: Vec3; rotation: Vec3; scale: Vec3; color?: string }
> = {
  // 基础几何
  box: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  cylinder: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  sphere: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  // plane 平躺已烘进几何（Viewport3D 的 mesh 层 rotation-x=-90°），rotation 恒为 [0,0,0]
  plane: { position: [0, 0.01, 0], rotation: [0, 0, 0], scale: [2, 2, 1] },
  wall: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [3, 2, 0.1] },
  // 建筑结构（组合组件几何从地面 y=0 起建，xz 居中）
  stairs: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1.5, 3] },
  house: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [6, 4, 6] },
  fence: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] },
  ramp: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1.2, 4] },
  platform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [3, 0.6, 3] },
  door: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 2.2, 0.1] },
  window: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1.5, 1.2, 0.05] },
  arch: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2.5, 0.3] },
  railing: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] },
  // 街道设施
  road: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [4, 1, 12], color: ROAD_COLOR },
  streetlamp: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 3.5, 1] },
  bench: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.8, 1, 1] },
  signboard: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 2.5, 1] },
  sidewalk: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 8], color: SIDEWALK_COLOR },
  utilitypole: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 6, 1] },
  // 家具
  table: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.6, 0.75, 0.9] },
  chair: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.45, 0.9, 0.45] },
  sofa: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 0.85, 0.9] },
  bed: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.8, 0.6, 2] },
  cabinet: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.2, 2, 0.5] },
  screen: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.2, 1, 0.7] },
  // 载具
  car: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [4.5, 1.6, 1.8] },
  truck: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [6, 2.6, 2.2] },
  motorcycle: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 0.6] },
  bicycle: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.8, 1.1, 0.5] },
  // 自然
  tree: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 3, 2] },
  rock: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.5, 1.2, 1.5] },
  bush: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.8, 0.6, 0.8] },
  water: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [4, 1, 4], color: WATER_COLOR },
  hill: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [8, 4, 8] },
};

// 新角色默认位置（原点，面向 -Z 以外的默认朝向）
const CHARACTER_DEFAULT_POSITION: Vec3 = [0, 0, 0];

// 角色染色调色板（按添加顺序分配；白片喂视频模型时用颜色区分角色）
export const CHARACTER_PALETTE = [
  { color: '#ef4444', label: '红' },
  { color: '#3b82f6', label: '蓝' },
  { color: '#22c55e', label: '绿' },
  { color: '#eab308', label: '黄' },
  { color: '#a855f7', label: '紫' },
  { color: '#f97316', label: '橙' },
  { color: '#06b6d4', label: '青' },
  { color: '#ec4899', label: '粉' },
] as const;

// 颜色值 → 中文名（身份映射提示词用；未染色返回「灰」）
export function characterColorLabel(color?: string): string {
  return CHARACTER_PALETTE.find((p) => p.color === color)?.label ?? '灰';
}

// 生成节点 id
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// 路径点选中 id 的编解码（选中路径点时用于挂 TransformControls）
export function pathPointId(charId: string, index: number): string {
  return `pp:${charId}:${index}`;
}
export function parsePathPointId(id: string): { charId: string; index: number } | null {
  if (!id.startsWith('pp:')) return null;
  const [, charId, idx] = id.split(':');
  const index = Number(idx);
  if (!charId || Number.isNaN(index)) return null;
  return { charId, index };
}

// 相机机位点选中 id 的编解码（视口拖动相机起止机位用）
export function cameraPointId(camId: string, point: 'start' | 'end'): string {
  return `camp:${camId}:${point}`;
}
export function parseCameraPointId(id: string): { camId: string; point: 'start' | 'end' } | null {
  if (!id.startsWith('camp:')) return null;
  const parts = id.split(':');
  const point = parts[parts.length - 1];
  const camId = parts.slice(1, -1).join(':');
  if (!camId || (point !== 'start' && point !== 'end')) return null;
  return { camId, point };
}

// 骨骼选中 id 的编解码（姿态编辑模式下挂 TransformControls 到骨骼）
export function boneObjectId(charId: string, segment: string): string {
  return `bone:${charId}:${segment}`;
}
export function parseBoneId(id: string): { charId: string; segment: string } | null {
  if (!id.startsWith('bone:')) return null;
  const parts = id.split(':');
  const segment = parts[parts.length - 1];
  const charId = parts.slice(1, -1).join(':');
  if (!charId || !segment) return null;
  return { charId, segment };
}

interface PrevizState {
  objects: PrevizObject[];
  characters: PrevizCharacter[];
  cameras: PrevizCamera[];
  selectedId: string | null; // 几何体 id / 角色 id / 路径点 id（pp:charId:index）/ 相机机位点 id（camp:camId:start|end）
  duration: number; // 场景时长（秒）
  fps: number;

  // 播放状态（currentTime 每帧更新，组件请用 getState() 读取避免高频重渲染）
  playing: boolean;
  currentTime: number;
  /** 人偶 GLB 加载失败标记（面板提示用） */
  mannequinError: boolean;

  // 相机面板状态
  selectedCameraId: string | null; // 相机列表中选中的相机（编辑用）
  previewCameraId: string | null;  // 正在预览相机视角的相机（null = 自由视角）

  // 几何体
  addObject: (type: PrevizObjectType) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, upd: Partial<Omit<PrevizObject, 'id'>>) => void;
  /** 批量导入几何体（AI 建白模）：append 追加到现有场景 / replace 清空后重建 */
  importObjects: (list: Omit<PrevizObject, 'id'>[], mode: 'append' | 'replace') => void;

  // 角色
  addCharacter: (model?: PrevizModelKind) => void;
  removeCharacter: (id: string) => void;
  updateCharacter: (id: string, upd: Partial<Omit<PrevizCharacter, 'id' | 'path' | 'actions'>>) => void;

  // 角色动作
  addAction: (charId: string, clip: string) => void; // start 取当前播放头时间
  removeAction: (charId: string, index: number) => void;
  updateActionStart: (charId: string, index: number, start: number) => void;

  // 走位路径
  addPathPoint: (charId: string) => void; // t 取当前播放头时间，位置取角色在该时刻的实际位置（路径采样）
  removePathPoint: (charId: string, index: number) => void;
  updatePathPoint: (charId: string, index: number, upd: Partial<PrevizPathPoint>) => void;
  // 拖拽角色本体：把位置写进当前播放头时刻的路径点（有则更新，无则新建）
  upsertPathPointAt: (charId: string, t: number, position: Vec3) => void;
  // 路径绘制模式：视口地面点击直接添加路径点（首个点取当前播放头，后续每点 +1 秒）
  pathDrawMode: boolean;
  setPathDrawMode: (v: boolean) => void;
  appendDrawnPathPoint: (charId: string, position: Vec3) => void;
  // gizmo 拖拽中标记（拖拽时暂停位置采样回弹）
  gizmoDragging: boolean;
  setGizmoDragging: (v: boolean) => void;

  // 姿态编辑模式：目标角色 id（null = 关闭）；开启后该角色暂停动画驱动、显示骨骼小球
  poseEditingCharId: string | null;
  setPoseEditing: (charId: string | null) => void;
  /** 把姿势快照存成一条自定义姿势动作（挂到当前播放头时刻） */
  savePoseAction: (charId: string, pose: Record<string, [number, number, number, number]>) => void;
  // 重命名动作 / 复制动作（自定义姿势用；复制挂到当前播放头时刻）
  renameAction: (charId: string, index: number, name: string) => void;
  duplicateAction: (charId: string, index: number) => void;

  // 相机
  addCamera: () => void;
  removeCamera: (id: string) => void;
  updateCamera: (id: string, upd: Partial<Omit<PrevizCamera, 'id' | 'move'>>) => void;
  updateCameraMove: (id: string, upd: Partial<PrevizCameraMove>) => void;
  setSelectedCamera: (id: string | null) => void;
  setPreviewCamera: (id: string | null) => void;

  // 播放控制
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setFps: (f: number) => void;
  setMannequinError: (v: boolean) => void;

  select: (id: string | null) => void;
  reset: () => void;

  // 序列化 / 反序列化（与 previz 节点 data.scene 的 JSON 字符串互转）
  toJSON: () => string;
  fromJSON: (json: string) => void;
}

// 角色动作按 start 升序插入
function insertAction(actions: PrevizCharacter['actions'], action: PrevizCharacter['actions'][number]) {
  const next = [...actions, action];
  next.sort((a, b) => a.start - b.start);
  return next;
}

// 路径点按 t 升序插入
function insertPathPoint(path: PrevizPathPoint[], point: PrevizPathPoint) {
  const next = [...path, point];
  next.sort((a, b) => a.t - b.t);
  return next;
}

export const usePrevizStore = create<PrevizState>()((set, get) => ({  objects: [],
  characters: [],
  cameras: [],
  selectedId: null,
  duration: 10,
  fps: 24,
  playing: false,
  currentTime: 0,
  mannequinError: false,
  selectedCameraId: null,
  previewCameraId: null,
  gizmoDragging: false,
  pathDrawMode: false,
  poseEditingCharId: null,

  setGizmoDragging: (v) => set({ gizmoDragging: v }),
  setPathDrawMode: (v) => set({ pathDrawMode: v }),

  // 进入/退出姿态编辑模式；退出时若选中的是骨骼则一并清除选中
  setPoseEditing: (charId) =>
    set((state) => ({
      poseEditingCharId: charId,
      selectedId:
        !charId && state.selectedId?.startsWith('bone:') ? null : state.selectedId,
    })),

  savePoseAction: (charId, pose) => {
    const { currentTime } = get();
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        // 默认名：姿势 N（按该角色现有姿势动作计数）
        const poseCount = c.actions.filter((a) => a.pose).length;
        return {
          ...c,
          actions: insertAction(c.actions, {
            clip: POSE_CLIP,
            start: Math.round(currentTime * 100) / 100,
            pose,
            name: `姿势 ${poseCount + 1}`,
          }),
        };
      }),
    }));
  },

  // 重命名动作（自定义姿势用）
  renameAction: (charId, index, name) => {
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const actions = c.actions.map((a, i) =>
          i === index ? { ...a, name: name.trim() || undefined } : a
        );
        return { ...c, actions };
      }),
    }));
  },

  // 复制动作（自定义姿势用）：复制姿势数据，挂在当前播放头时刻
  duplicateAction: (charId, index) => {
    const { currentTime } = get();
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const src = c.actions[index];
        if (!src) return c;
        return {
          ...c,
          actions: insertAction(c.actions, {
            ...src,
            pose: src.pose ? { ...src.pose } : undefined,
            name: src.name ? `${src.name} 副本` : undefined,
            start: Math.round(currentTime * 100) / 100,
          }),
        };
      }),
    }));
  },

  // 绘制模式添加路径点：首个点取当前播放头时刻，后续每个点自动 +1 秒
  appendDrawnPathPoint: (charId, position) => {
    const { currentTime } = get();
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const last = c.path[c.path.length - 1];
        const t = last ? Math.round((last.t + 1) * 100) / 100 : Math.round(currentTime * 100) / 100;
        return { ...c, path: [...c.path, { t, position }] };
      }),
    }));
  },

  // ====== 几何体 ======
  addObject: (type) => {
    const { objects } = get();
    const defaults = OBJECT_DEFAULTS[type];
    const count = objects.filter((o) => o.type === type).length + 1;
    const obj: PrevizObject = {
      id: genId('obj'),
      type,
      name: `${OBJECT_TYPE_LABELS[type]} ${count}`,
      position: [...defaults.position],
      rotation: [...defaults.rotation],
      scale: [...defaults.scale],
      color: defaults.color ?? DEFAULT_COLOR,
    };
    set({ objects: [...objects, obj], selectedId: obj.id });
  },

  removeObject: (id) => {
    set((state) => ({
      objects: state.objects.filter((o) => o.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
  },

  updateObject: (id, upd) => {
    set((state) => ({
      objects: state.objects.map((o) => (o.id === id ? { ...o, ...upd } : o)),
    }));
  },

  importObjects: (list, mode) => {
    const items: PrevizObject[] = list.map((o) => ({ ...o, id: genId('obj') }));
    set((state) => ({
      objects: mode === 'replace' ? items : [...state.objects, ...items],
      selectedId: null,
    }));
  },

  // ====== 角色 ======
  addCharacter: (model) => {
    const { characters } = get();
    const char: PrevizCharacter = {
      id: genId('char'),
      name: `角色 ${characters.length + 1}`,
      model: model ?? 'male',
      position: [...CHARACTER_DEFAULT_POSITION],
      rotationY: 0,
      // 按添加顺序从调色板分配染色（超过 8 个循环使用）
      color: CHARACTER_PALETTE[characters.length % CHARACTER_PALETTE.length].color,
      path: [],
      actions: [],
    };
    set({ characters: [...characters, char], selectedId: char.id });
  },

  removeCharacter: (id) => {
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
      selectedId:
        state.selectedId === id ||
        state.selectedId?.startsWith(`pp:${id}:`) ||
        state.selectedId?.startsWith(`bone:${id}:`)
          ? null
          : state.selectedId,
      poseEditingCharId: state.poseEditingCharId === id ? null : state.poseEditingCharId,
    }));
  },

  updateCharacter: (id, upd) => {
    set((state) => ({
      characters: state.characters.map((c) => (c.id === id ? { ...c, ...upd } : c)),
    }));
  },

  // ====== 角色动作 ======
  addAction: (charId, clip) => {
    const { currentTime } = get();
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === charId
          ? { ...c, actions: insertAction(c.actions, { clip, start: Math.round(currentTime * 100) / 100 }) }
          : c
      ),
    }));
  },

  removeAction: (charId, index) => {
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === charId ? { ...c, actions: c.actions.filter((_, i) => i !== index) } : c
      ),
    }));
  },

  updateActionStart: (charId, index, start) => {
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const actions = c.actions.map((a, i) => (i === index ? { ...a, start } : a));
        actions.sort((a, b) => a.start - b.start);
        return { ...c, actions };
      }),
    }));
  },

  // ====== 走位路径 ======
  addPathPoint: (charId) => {
    const { currentTime } = get();
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === charId
          ? {
              ...c,
              // 记录「播放头时刻 + 角色在该时刻的实际位置」（路径插值采样，无路径时为基准位置）
              path: insertPathPoint(c.path, {
                t: Math.round(currentTime * 100) / 100,
                position: sampleCharacterPosition(c, currentTime),
              }),
            }
          : c
      ),
    }));
  },

  // 拖拽角色本体时调用：把位置写进「当前播放头时刻」的路径点（已存在该时刻的点则更新，否则新建）
  upsertPathPointAt: (charId, t, position) => {
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const EPS = 0.05; // 同一时刻判定容差（秒）
        const idx = c.path.findIndex((p) => Math.abs(p.t - t) <= EPS);
        if (idx >= 0) {
          const path = c.path.map((p, i) => (i === idx ? { ...p, position } : p));
          return { ...c, path };
        }
        return { ...c, path: insertPathPoint(c.path, { t: Math.round(t * 100) / 100, position }) };
      }),
    }));
  },

  removePathPoint: (charId, index) => {
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === charId ? { ...c, path: c.path.filter((_, i) => i !== index) } : c
      ),
      selectedId:
        state.selectedId === pathPointId(charId, index) ? charId : state.selectedId,
    }));
  },

  updatePathPoint: (charId, index, upd) => {
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== charId) return c;
        const path = c.path.map((p, i) => (i === index ? { ...p, ...upd } : p));
        path.sort((a, b) => a.t - b.t);
        return { ...c, path };
      }),
    }));
  },

  // ====== 相机 ======
  addCamera: () => {
    const { cameras, duration } = get();
    // 默认机位：斜上方看向原点；endPos 默认沿视线推进一半距离（推镜常用默认值）
    const startPos: Vec3 = [6, 4, 6];
    const startLook: Vec3 = [0, 1, 0];
    const dir: Vec3 = [startLook[0] - startPos[0], startLook[1] - startPos[1], startLook[2] - startPos[2]];
    const cam: PrevizCamera = {
      id: genId('cam'),
      name: `相机 ${cameras.length + 1}`,
      fov: 50,
      move: {
        type: 'static',
        startPos,
        endPos: [startPos[0] + dir[0] / 2, startPos[1] + dir[1] / 2, startPos[2] + dir[2] / 2],
        startLook,
        endLook: [...startLook],
        duration: Math.min(5, duration),
        start: 0,
      },
    };
    set({ cameras: [...cameras, cam], selectedCameraId: cam.id });
  },

  removeCamera: (id) => {
    set((state) => ({
      cameras: state.cameras.filter((c) => c.id !== id),
      selectedCameraId: state.selectedCameraId === id ? null : state.selectedCameraId,
      previewCameraId: state.previewCameraId === id ? null : state.previewCameraId,
      selectedId: state.selectedId?.startsWith(`camp:${id}:`) ? null : state.selectedId,
    }));
  },

  updateCamera: (id, upd) => {
    set((state) => ({
      cameras: state.cameras.map((c) => (c.id === id ? { ...c, ...upd } : c)),
    }));
  },

  updateCameraMove: (id, upd) => {
    set((state) => ({
      cameras: state.cameras.map((c) =>
        c.id === id ? { ...c, move: { ...c.move, ...upd } } : c
      ),
    }));
  },

  setSelectedCamera: (id) => set({ selectedCameraId: id }),

  setPreviewCamera: (id) => set({ previewCameraId: id }),

  // ====== 播放控制 ======
  setPlaying: (playing) => set({ playing }),

  setCurrentTime: (t) => {
    const { duration } = get();
    set({ currentTime: Math.max(0, Math.min(t, duration)) });
  },

  setDuration: (d) => {
    const dur = Math.max(1, d);
    set((state) => ({
      duration: dur,
      currentTime: Math.min(state.currentTime, dur),
    }));
  },

  setFps: (f) => set({ fps: f }),

  setMannequinError: (v) => set({ mannequinError: v }),

  // 切换选中对象时自动退出姿态编辑模式（选中该角色本体/其骨骼时保持）
  select: (id) =>
    set((state) => ({
      selectedId: id,
      poseEditingCharId:
        state.poseEditingCharId &&
        id !== state.poseEditingCharId &&
        !id?.startsWith(`bone:${state.poseEditingCharId}:`)
          ? null
          : state.poseEditingCharId,
    })),

  reset: () => {
    const scene = createEmptyScene();
    set({
      objects: [],
      characters: [],
      cameras: [],
      selectedId: null,
      duration: scene.duration,
      fps: scene.fps,
      playing: false,
      currentTime: 0,
      mannequinError: false,
      selectedCameraId: null,
      previewCameraId: null,
      poseEditingCharId: null,
    });
  },

  toJSON: () => {
    const { objects, characters, cameras, duration, fps } = get();
    const scene: PrevizScene = {
      objects,
      characters,
      cameras,
      duration,
      fps,
    };
    return JSON.stringify(scene);
  },

  fromJSON: (json) => {
    try {
      const scene = JSON.parse(json) as PrevizScene;
      set({
        objects: Array.isArray(scene.objects) ? scene.objects : [],
        characters: Array.isArray(scene.characters) ? scene.characters : [],
        cameras: Array.isArray(scene.cameras) ? scene.cameras : [],
        selectedId: null,
        duration: scene.duration ?? 10,
        fps: scene.fps ?? 24,
        playing: false,
        currentTime: 0,
        selectedCameraId: null,
        previewCameraId: null,
      });
    } catch (err) {
      console.error('解析白模场景 JSON 失败:', err);
      get().reset();
    }
  },
}));

// ====== 播放采样辅助（供视口/动画使用）======

// 采样角色在 t 时刻的位置：按走位路径线性插值；无路径时用基准位置
export function sampleCharacterPosition(char: PrevizCharacter, t: number): Vec3 {
  const path = char.path;
  if (path.length === 0) return char.position;
  if (t <= path[0].t) return path[0].position;
  const last = path[path.length - 1];
  if (t >= last.t) return last.position;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (t >= a.t && t <= b.t) {
      const ratio = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return [
        a.position[0] + (b.position[0] - a.position[0]) * ratio,
        a.position[1] + (b.position[1] - a.position[1]) * ratio,
        a.position[2] + (b.position[2] - a.position[2]) * ratio,
      ];
    }
  }
  return last.position;
}

// 取 t 时刻应播放的动作（start <= t 的最近一个）；无则返回 null（播待机）
export function activeActionAt(char: PrevizCharacter, t: number) {
  let active: PrevizCharacter['actions'][number] | null = null;
  for (const a of char.actions) {
    if (a.start <= t) active = a;
    else break; // actions 按 start 升序
  }
  return active;
}

// 调试钩子：E2E/控制台可直接读取和操作 store（选择骨骼、读取角色等）
if (typeof window !== 'undefined') {
  (window as unknown as { __previzStore: typeof usePrevizStore }).__previzStore = usePrevizStore;
}
