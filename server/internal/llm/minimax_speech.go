package llm

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var minimaxPausePattern = regexp.MustCompile(`<#([^<>]*)#>`)
var minimaxPauseNumber = regexp.MustCompile(`^\d{1,2}(?:\.\d{1,2})?$`)

// ValidateMinimaxSpeech 不改写文本，明确无效的停顿在扣费前返回。
func ValidateMinimaxSpeech(text string) error {
	if utf8.RuneCountInString(text) >= 10000 {
		return fmt.Errorf("配音文本需少于 10000 个字符")
	}
	previousEnd := 0
	for _, match := range minimaxPausePattern.FindAllStringSubmatchIndex(text, -1) {
		value := text[match[2]:match[3]]
		seconds, err := strconv.ParseFloat(value, 64)
		if err != nil || !minimaxPauseNumber.MatchString(value) || seconds < 0.01 || seconds > 99.99 {
			return fmt.Errorf("停顿时长需为 0.01～99.99 秒，最多两位小数")
		}
		if strings.TrimSpace(text[previousEnd:match[0]]) == "" || strings.TrimSpace(text[match[1]:]) == "" {
			return fmt.Errorf("停顿需放在两段文本之间，且不能连续使用")
		}
		previousEnd = match[1]
	}
	if strings.Contains(minimaxPausePattern.ReplaceAllString(text, ""), "<#") {
		return fmt.Errorf("停顿格式应为 <#秒数#>")
	}
	return nil
}

func minimaxEmotion(tone string) (string, error) {
	switch tone {
	case "":
		return "", nil
	case "happy", "喜悦":
		return "happy", nil
	case "sad", "悲伤":
		return "sad", nil
	case "angry", "愤怒":
		return "angry", nil
	case "fearful", "恐惧":
		return "fearful", nil
	case "disgusted", "厌恶":
		return "disgusted", nil
	case "surprised", "惊讶":
		return "surprised", nil
	case "calm", "平静":
		return "calm", nil
	default:
		return "", fmt.Errorf("该语音模型不支持所选情绪")
	}
}

type minimaxVoiceSetting struct {
	VoiceID string  `json:"voice_id"`
	Speed   float64 `json:"speed"`
	Emotion string  `json:"emotion,omitempty"`
}

type minimaxSpeechRequest struct {
	Model          string  `json:"model"`
	Voice          string  `json:"voice"`
	Input          string  `json:"input"`
	Speed          float64 `json:"speed"`
	ResponseFormat string  `json:"response_format"`
	// OpenAI 兼容网关以 metadata 透传 MiniMax 原生参数。
	Metadata struct {
		VoiceSetting minimaxVoiceSetting `json:"voice_setting"`
	} `json:"metadata"`
}

func ValidateMinimaxSpeechSettings(speed float64, tone string) error {
	if speed != 0 && (speed < 0.5 || speed > 2) {
		return fmt.Errorf("语速需在 0.5～2 倍之间")
	}
	_, err := minimaxEmotion(tone)
	return err
}

func buildMinimaxSpeechRequest(model, input, voice string, speed float64, tone string) (minimaxSpeechRequest, error) {
	req := minimaxSpeechRequest{}
	if err := ValidateMinimaxSpeech(input); err != nil {
		return req, err
	}
	if speed == 0 {
		speed = 1
	}
	if err := ValidateMinimaxSpeechSettings(speed, tone); err != nil {
		return req, err
	}
	emotion, err := minimaxEmotion(tone)
	if err != nil {
		return req, err
	}
	req.Model, req.Voice, req.Input, req.Speed, req.ResponseFormat = model, ResolveAudioVoice(model, voice), input, speed, "wav"
	req.Metadata.VoiceSetting = minimaxVoiceSetting{VoiceID: req.Voice, Speed: speed, Emotion: emotion}
	return req, nil
}
