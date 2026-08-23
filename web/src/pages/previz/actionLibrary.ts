import type { PrevizModelKind } from './types';

// 动作库：按人偶模型分组（clip 名与 GLB 内 AnimationClip.name 一致）
// 男体 Soldier / 女体 Xbot 均来自 three.js 官方示例模型，仅含移动/表演类常规动作

export interface PrevizActionDef {
  clip: string;  // GLB 动画名
  label: string; // 中文名
}

export interface PrevizActionGroup {
  category: string;
  items: PrevizActionDef[];
}

const MALE_LIBRARY: PrevizActionGroup[] = [
  {
    category: '移动',
    items: [
      { clip: 'Idle', label: '待机' },
      { clip: 'Walk', label: '走路' },
      { clip: 'Run', label: '跑步' },
      { clip: 'TPose', label: 'T姿势' },
    ],
  },
];

const FEMALE_LIBRARY: PrevizActionGroup[] = [
  {
    category: '移动',
    items: [
      { clip: 'idle', label: '待机' },
      { clip: 'walk', label: '走路' },
      { clip: 'run', label: '跑步' },
      { clip: 'sneak_pose', label: '潜行' },
    ],
  },
  {
    category: '表演',
    items: [
      { clip: 'agree', label: '同意' },
      { clip: 'headShake', label: '摇头' },
      { clip: 'sad_pose', label: '沮丧' },
    ],
  },
];

// ====== 人偶模型注册表 ======
export interface PrevizModelDef {
  kind: PrevizModelKind;
  label: string;
  url: string;
  idleClip: string;
  looping: Set<string>;
  library: PrevizActionGroup[];
}

export const MODEL_DEFS: Record<PrevizModelKind, PrevizModelDef> = {
  male: {
    kind: 'male',
    label: '男体',
    url: '/previz/male.glb',
    idleClip: 'Idle',
    looping: new Set(['Idle', 'Walk', 'Run']),
    library: MALE_LIBRARY,
  },
  female: {
    kind: 'female',
    label: '女体',
    url: '/previz/female.glb',
    idleClip: 'idle',
    looping: new Set(['idle', 'walk', 'run']),
    library: FEMALE_LIBRARY,
  },
};

// 按模型取定义；未设置/未知模型（如旧场景的 pete 素体）回退男体
export function modelDef(kind?: string): PrevizModelDef {
  return (kind && MODEL_DEFS[kind as PrevizModelKind]) || MODEL_DEFS.male;
}

// 按模型查动作中文名
export function actionLabel(kind: string | undefined, clip: string): string {
  for (const g of modelDef(kind).library) {
    for (const i of g.items) {
      if (i.clip === clip) return i.label;
    }
  }
  return clip;
}
