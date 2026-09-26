package service

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// GenerateImageThumbnail 生成缩略图：640px 宽 webp（原图更小则保持原尺寸）。
// 用 ffmpeg 的 stdin/stdout 管道完成，不落盘、不额外依赖图像库。
// 缩略图生成失败返回错误，调用方应跳过（不阻断主流程）。
func GenerateImageThumbnail(src []byte) ([]byte, error) {
	cmd := exec.Command("ffmpeg",
		"-i", "pipe:0",
		"-vf", "scale='min(640,iw)':-2",
		"-f", "webp",
		"-q:v", "70",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(src)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return nil, fmt.Errorf("ffmpeg thumbnail: %w: %s", err, msg)
	}
	if out.Len() == 0 {
		return nil, errors.New("ffmpeg thumbnail: empty output")
	}
	return out.Bytes(), nil
}

// ThumbnailObjectName 约定式缩略图对象名：images/hash.png → images/hash.thumb.webp
// 与原图同目录并排存储，删除目录的前缀清理逻辑天然兼容
func ThumbnailObjectName(objectName string) string {
	ext := filepath.Ext(objectName)
	return strings.TrimSuffix(objectName, ext) + ".thumb.webp"
}
