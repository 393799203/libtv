// 动作库：mannequin.glb 内动画名 → 中文名映射，按用途分组
// clip 名与 GLB 内 AnimationClip.name 一致

export interface PrevizActionDef {
  clip: string;  // GLB 动画名
  label: string; // 中文名
}

export interface PrevizActionGroup {
  category: string;
  items: PrevizActionDef[];
}

export const ACTION_LIBRARY: PrevizActionGroup[] = [
  {
    category: '打斗',
    items: [
      { clip: 'Unarmed_Melee_Attack_Punch_A', label: '直拳A' },
      { clip: 'Unarmed_Melee_Attack_Punch_B', label: '直拳B' },
      { clip: 'Unarmed_Melee_Attack_Kick', label: '回旋踢' },
      { clip: '1H_Melee_Attack_Chop', label: '单手劈砍' },
      { clip: '1H_Melee_Attack_Slice_Diagonal', label: '单手斜斩' },
      { clip: '2H_Melee_Attack_Spin', label: '双手回旋斩' },
      { clip: 'Dualwield_Melee_Attack_Slice', label: '双持挥斩' },
    ],
  },
  {
    category: '防御/闪避',
    items: [
      { clip: 'Block', label: '格挡' },
      { clip: 'Blocking', label: '持续格挡' },
      { clip: 'Block_Attack', label: '格挡反击' },
      { clip: 'Block_Hit', label: '格挡受击' },
      { clip: 'Dodge_Forward', label: '前闪避' },
      { clip: 'Dodge_Backward', label: '后闪避' },
      { clip: 'Dodge_Left', label: '左闪避' },
      { clip: 'Dodge_Right', label: '右闪避' },
    ],
  },
  {
    category: '受击/倒地',
    items: [
      { clip: 'Hit_A', label: '受击A' },
      { clip: 'Hit_B', label: '受击B' },
      { clip: 'Death_A', label: '倒地A' },
      { clip: 'Death_B', label: '倒地B' },
    ],
  },
  {
    category: '移动',
    items: [
      { clip: 'Idle', label: '待机' },
      { clip: 'Walking_A', label: '走路' },
      { clip: 'Walking_B', label: '走路B' },
      { clip: 'Walking_Backwards', label: '后退走' },
      { clip: 'Running_A', label: '跑步' },
      { clip: 'Running_B', label: '跑步B' },
    ],
  },
  {
    category: '跳跃',
    items: [
      { clip: 'Jump_Start', label: '起跳' },
      { clip: 'Jump_Idle', label: '滞空' },
      { clip: 'Jump_Land', label: '落地' },
      { clip: 'Jump_Full_Long', label: '长跳' },
    ],
  },
];

// clip 名 → 中文名（查表用）
export const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  ACTION_LIBRARY.flatMap((g) => g.items.map((i) => [i.clip, i.label]))
);

// 循环播放的动作（其余为单次动作，播完停在最后一帧）
export const LOOPING_CLIPS = new Set([
  'Idle',
  'Walking_A',
  'Walking_B',
  'Walking_Backwards',
  'Running_A',
  'Running_B',
  'Blocking',
  'Jump_Idle',
]);

// 无动作时的默认动画
export const IDLE_CLIP = 'Idle';
