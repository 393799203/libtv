import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActiveModel, normalizeImageModel } from '../src/utils/imageModel.ts';
import { PROMPT_PANEL_CONFIGS } from '../src/configs/promptConfig.ts';
import { isMinimaxSpeechModel, minimaxSpeechValidation, resolveAudioEmotion, resolveAudioVoice } from '../src/configs/audioModels.ts';

test('retired Lite resolves to Flash while explicit image choices remain intact', () => {
  assert.equal(normalizeImageModel('doubao-seedream-5.0-lite', 'dianxin'), 'doubao-seedream-5.0-flash');
  assert.equal(normalizeImageModel('doubao-seedream-5.0-lite', 'wasu'), 'doubao-seedream-5.0-lite');
  for (const id of ['', 'doubao-seedream-5.5', 'doubao-seedream-5.0-flash', 'doubao-seedream-5.0-pro', 'future-image']) {
    assert.equal(normalizeImageModel(id, 'dianxin'), id);
  }
  assert.equal(PROMPT_PANEL_CONFIGS.image.defaultModel, 'doubao-seedream-5.0-flash');
});

test('retired channel model IDs only map to their electric counterparts', () => {
  for (const [old, active] of [
    ['doubao-seedream-5.0-lite', 'doubao-seedream-5.0-flash'],
    ['doubao-seedance-2.0', 'cdance2.0-0807'],
    ['doubao-seedance-2.0-fast', 'cdance2.0-fast-0807'],
    ['doubao-seedance-2.5', 'cdance2.5-0807'],
    ['deepseek-v4-flash', 'deepseek-v4-flash-0731'],
  ]) assert.equal(normalizeActiveModel(old), active);
  for (const value of ['qwen3-tts-instruct-flash', 'qwen-image-3.0', 'future-model', '']) {
    assert.equal(normalizeActiveModel(value), value);
  }
});

test('speech controls validate native pauses and only offer supported emotions', () => {
  for (const text of ['前<#0.01#>后', '前<#99.99#>后', '第一段。\n\n第二段(laughs)。', '发音(he2)平']) {
    assert.equal(minimaxSpeechValidation(text), null);
  }
  for (const text of ['<#1#>开头', '末尾<#1#>', '前<#1#>\n<#2#>后', '前<#100#>后', '前<#1.234#>后', '前<#bad#>后', '前<#1后', '字'.repeat(10000)]) {
    assert.ok(minimaxSpeechValidation(text));
  }
  assert.equal(resolveAudioEmotion('minimax-speech-2.8-turbo', '喜悦'), 'happy');
  assert.equal(resolveAudioEmotion('minimax-speech-2.8-hd', 'whisper'), '');
  assert.equal(resolveAudioEmotion('qwen3-tts-instruct-flash', '低语'), '低语');
});

test('MiniMax selects valid voices while Qwen keeps its existing voice choice', () => {
  for (const model of ['minimax-speech-2.8-turbo', 'minimax-speech-2.8-hd']) {
    assert.equal(isMinimaxSpeechModel(model), true);
    assert.equal(resolveAudioVoice(model, 'default'), 'Chinese (Mandarin)_Reliable_Executive');
    assert.equal(resolveAudioVoice(model, 'Cherry'), 'Chinese (Mandarin)_Reliable_Executive');
    assert.equal(resolveAudioVoice(model, 'Chinese (Mandarin)_Sweet_Lady'), 'Chinese (Mandarin)_Sweet_Lady');
  }
  assert.equal(resolveAudioVoice('qwen3-tts-instruct-flash', 'Cherry'), 'Cherry');
  assert.equal(isMinimaxSpeechModel('qwen3-tts-instruct-flash'), false);
});
