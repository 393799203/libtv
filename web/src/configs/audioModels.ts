export const MINIMAX_VOICE_OPTIONS = [
  { value: 'Chinese (Mandarin)_Reliable_Executive', label: '沉稳高管', group: '普通话' },
  { value: 'Chinese (Mandarin)_News_Anchor', label: '新闻主播', group: '普通话' },
  { value: 'Chinese (Mandarin)_Gentleman', label: '温润男声', group: '普通话' },
  { value: 'Chinese (Mandarin)_Warm_Bestie', label: '温暖闺蜜', group: '普通话' },
  { value: 'Chinese (Mandarin)_Sweet_Lady', label: '甜美女声', group: '普通话' },
  { value: 'Chinese (Mandarin)_Lyrical_Voice', label: '抒情音色', group: '普通话' },
];

export function isMinimaxSpeechModel(model: string): boolean {
  return model === 'minimax-speech-2.8-turbo' || model === 'minimax-speech-2.8-hd';
}

export function resolveAudioVoice(model: string, voice: string): string {
  if (!isMinimaxSpeechModel(model)) return voice;
  return MINIMAX_VOICE_OPTIONS.some(option => option.value === voice)
    ? voice : MINIMAX_VOICE_OPTIONS[0].value;
}

export const MINIMAX_EMOTIONS = [
  { value: '', label: '自动' },
  { value: 'happy', label: '喜悦' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'disgusted', label: '厌恶' },
  { value: 'surprised', label: '惊讶' },
  { value: 'calm', label: '平静' },
];

export const MINIMAX_INTERJECTIONS = [
  { value: 'laughs', label: '笑声' }, { value: 'chuckle', label: '轻笑' },
  { value: 'coughs', label: '咳嗽' }, { value: 'clear-throat', label: '清嗓子' },
  { value: 'groans', label: '呻吟' }, { value: 'breath', label: '换气' },
  { value: 'pant', label: '喘气' }, { value: 'inhale', label: '吸气' },
  { value: 'exhale', label: '呼气' }, { value: 'gasps', label: '惊叹' },
  { value: 'sniffs', label: '吸鼻子' }, { value: 'sighs', label: '叹气' },
  { value: 'snorts', label: '鼻息' }, { value: 'burps', label: '打嗝' },
  { value: 'lip-smacking', label: '咂嘴' }, { value: 'humming', label: '哼唱' },
  { value: 'hissing', label: '嘶声' }, { value: 'emm', label: '嗯声' },
  { value: 'sneezes', label: '喷嚏' },
];

export function resolveAudioEmotion(model: string, emotion: string): string {
  if (!isMinimaxSpeechModel(model)) return emotion;
  return MINIMAX_EMOTIONS.find(option => option.value === emotion || option.label === emotion)?.value ?? '';
}

export function minimaxSpeechValidation(text: string): string | null {
  if ([...text].length >= 10000) return '配音文本需少于 10000 个字符';
  let previousEnd = 0;
  for (const match of text.matchAll(/<#([^<>]*)#>/g)) {
    const value = match[1];
    const seconds = Number(value);
    if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(value) || seconds < 0.01 || seconds > 99.99) {
      return '停顿时长需为 0.01～99.99 秒，最多两位小数';
    }
    const index = match.index!;
    if (!text.slice(previousEnd, index).trim() || !text.slice(index + match[0].length).trim()) {
      return '停顿需放在两段文本之间，且不能连续使用';
    }
    previousEnd = index + match[0].length;
  }
  if (text.replace(/<#([^<>]*)#>/g, '').includes('<#')) return '停顿格式应为 <#秒数#>';
  return null;
}
