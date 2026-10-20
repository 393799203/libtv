package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 视频截帧：从视频里取一帧存成图片（首帧 / 尾帧 / 指定时刻）。
//
// 为什么放服务端、而不是前端拿 <video> + canvas 截：
// 线上视频在对象存储域名（manwa.huadong-1.ctyunzos.cn），实测**不回 CORS 头**，
// 跨域视频画到 canvas 会污染画布，toBlob/toDataURL 直接抛 SecurityError；
// 就算加 crossOrigin="anonymous" 也一样（没有 Access-Control-Allow-Origin）。
// 绕开它只有两条路：把整个视频用本站代理拉一遍，或者服务端 ffmpeg —— 后者不用把
// 几十 MB 视频搬进浏览器，也是镜像里现成的能力（缩略图/切分/放大都在用）。
//
// 逐帧/首尾帧这类操作是**本机 ffmpeg**，不调上游模型、不扣积分（与「尺寸放大（本机免费）」一致）。

// VideoFrameMode 取哪一帧
type VideoFrameMode string

const (
	// VideoFrameFirst 首帧
	VideoFrameFirst VideoFrameMode = "first"
	// VideoFrameLast 尾帧（从结尾往回找一小段，取到的就是最后一帧附近）
	VideoFrameLast VideoFrameMode = "last"
	// VideoFrameAt 指定时刻（秒），前端传"播放器当前进度"
	VideoFrameAt VideoFrameMode = "at"
)

const (
	// 单条源视频上限。比图片的 64MB 放宽：一分钟的 1080p mp4 常见 20~60MB。
	// 而且这里**流式落临时文件**，不像图片那样整块进内存，放宽不会顶爆内存。
	videoFrameMaxSourceBytes = 512 << 20
	// 指定时刻上限（1 小时）。防的是"传个 1e9 让 ffmpeg 空转"。
	videoFrameMaxSeekSeconds = 3600
	// 尾帧回看的窗口：够跨过末尾可能存在的黑场/非关键帧，又不会退到倒数第二帧。
	videoFrameTailWindow = 0.5
)

// CaptureVideoFrame 取视频的一帧并落盘成图片，返回图片地址与尺寸。
//
// 流程：白名单校验 → 流式下载到临时文件 → ffmpeg 取帧成 PNG → 走与派生图一致的落盘
// （含 640px webp 缩略图），所以画布拿到的仍是 thumbUrl、不会为这一刻去拉整张原图。
func (s *ImageOpsService) CaptureVideoFrame(
	ctx context.Context,
	videoURL string,
	mode VideoFrameMode,
	atSeconds float64,
	opts UploadOptions,
) (*Tile, error) {
	if err := validateFrameMode(mode, atSeconds); err != nil {
		return nil, err
	}

	// 走缓存：截帧和缩略图/裁剪共用同一份源文件，同一支视频第二次起都是秒级
	path, cleanup, err := s.fetchVideoToFileCached(ctx, videoURL)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	frame, err := extractVideoFrameFile(path, mode, atSeconds)
	if err != nil {
		return nil, err
	}
	return s.saveDerived(frame, "frame.png", opts)
}

func validateFrameMode(mode VideoFrameMode, atSeconds float64) error {
	switch mode {
	case VideoFrameFirst, VideoFrameLast:
		return nil
	case VideoFrameAt:
		if atSeconds < 0 || atSeconds > videoFrameMaxSeekSeconds {
			return fmt.Errorf("截帧时刻需在 0~%d 秒之间", videoFrameMaxSeekSeconds)
		}
		return nil
	default:
		return fmt.Errorf("不支持的截帧方式: %s（仅 first/last/at）", mode)
	}
}

// extractVideoFrameFile 用 ffmpeg 从本地视频文件里取一帧，返回 PNG 字节。
//
// 单独抽成纯函数（不碰网络与存储）是为了能在容器里直接断言："首帧是不是真的第一帧、
// 尾帧是不是真的最后一帧、指定时刻取的是不是那一刻"，而不用起 HTTP 服务。
func extractVideoFrameFile(path string, mode VideoFrameMode, atSeconds float64) ([]byte, error) {
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin"}
	switch mode {
	case VideoFrameLast:
		// -sseof 是**输入**选项，必须放在 -i 前面：从结尾往回 seek 一小段
		args = append(args, "-sseof", "-"+strconv.FormatFloat(videoFrameTailWindow, 'f', 3, 64))
	case VideoFrameAt:
		// -ss 放 -i 前面走 seek（不用从头解码），ffmpeg 默认 accurate_seek 保证落点是精确时刻
		args = append(args, "-ss", strconv.FormatFloat(atSeconds, 'f', 3, 64))
	}
	args = append(args,
		"-i", path,
		"-frames:v", "1",
		"-f", "image2pipe", "-vcodec", "png",
		"pipe:1",
	)

	cmd := exec.Command("ffmpeg", args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("ffmpeg 截帧失败: %w: %s", err, msg)
	}
	if out.Len() == 0 {
		return nil, errors.New("ffmpeg 截帧输出为空（视频可能没有视频轨或该时刻无画面）")
	}
	return out.Bytes(), nil
}

// fetchVideoToFile 把源视频流式下载到临时文件，返回路径与清理函数。
//
// 与 fetchImage 同一套 SSRF 防线：只允许 http(s) + 对象存储白名单域名，且不跟随 302
// （否则可以先把请求指向白名单域名、再跳去内网）。区别只在于写文件而不是进内存。
func (s *ImageOpsService) fetchVideoToFile(ctx context.Context, rawURL string) (string, func(), error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", func() {}, errors.New("视频地址为空")
	}
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return "", func() {}, fmt.Errorf("只支持 http(s) 视频地址: %s", rawURL)
	}
	if !s.HostAllowed(rawURL) {
		return "", func() {}, fmt.Errorf("视频来源域名不在白名单内: %s（如需放行，在 IMAGE_OPS_ALLOWED_HOSTS 里追加）", rawURL)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", func() {}, fmt.Errorf("构造请求失败: %w", err)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return "", func() {}, fmt.Errorf("下载视频失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", func() {}, fmt.Errorf("下载视频失败: HTTP %d", resp.StatusCode)
	}

	ext := filepath.Ext(rawURL)
	if len(ext) > 8 {
		ext = ""
	}
	f, err := os.CreateTemp("", "libtv-frame-*"+ext)
	if err != nil {
		return "", func() {}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	cleanup := func() {
		_ = os.Remove(f.Name())
	}

	written, err := io.Copy(f, io.LimitReader(resp.Body, videoFrameMaxSourceBytes+1))
	closeErr := f.Close()
	if err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("写入临时文件失败: %w", err)
	}
	if closeErr != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("写入临时文件失败: %w", closeErr)
	}
	if written > videoFrameMaxSourceBytes {
		cleanup()
		return "", func() {}, fmt.Errorf("视频超过 %dMB，拒绝处理", videoFrameMaxSourceBytes>>20)
	}
	if written == 0 {
		cleanup()
		return "", func() {}, errors.New("视频内容为空")
	}
	return f.Name(), cleanup, nil
}

// ---------------------------------------------------------------------------
// 缩略图条（filmstrip）：给前端的「片段选择条」当底图
// ---------------------------------------------------------------------------

// Filmstrip 一整条视频的缩略拼图：一次 ffmpeg tile 出来，前端当背景图铺在片段条上。
type Filmstrip struct {
	URL string `json:"url"`
	// Count 拼了多少格（前端不用管，回显便于核对）
	Count int `json:"count"`
	// Height 单格高度（像素）
	Height int `json:"height"`
	// Duration ffprobe 实测的源视频时长（秒）。顺带回给前端：
	// 浏览器侧的 <video> 探测可能被源站拦，这里给的才是准的，片段条的横轴用它。
	Duration float64 `json:"duration"`
}

const (
	// 12 格：片段条在 480px 宽时每格约 40px，再多就糊成一片、白费流量
	videoFilmstripDefaultCount = 12
	videoFilmstripMaxCount     = 24
	videoFilmstripMinCount     = 4
	// 单格 72px：条高 36px，72 够 2 倍屏，一张 16:9 的 12 格拼图约 1536×72
	videoFilmstripTileHeight = 72
)

// FilmstripVideo 把整条视频抽 N 张缩略图拼成一张 webp。
//
// 为什么放后端做（而不是前端 canvas 抽帧）：线上视频在对象存储里、**不回 CORS 头**，
// 前端把跨域视频画进 canvas 会污染画布，toDataURL 直接抛 SecurityError。
// 截帧那次已经确认过这个问题，所以缩略图只能由后端 ffmpeg 生成。
func (s *ImageOpsService) FilmstripVideo(
	ctx context.Context,
	videoURL string,
	count int,
	opts UploadOptions,
) (*Filmstrip, error) {
	if count == 0 {
		count = videoFilmstripDefaultCount
	}
	if count < videoFilmstripMinCount || count > videoFilmstripMaxCount {
		return nil, fmt.Errorf("缩略图格数需要在 %d~%d 之间", videoFilmstripMinCount, videoFilmstripMaxCount)
	}

	// 域名白名单校验（与下载路径同一道闸）：ffmpeg 会自己去取这个地址，必须先确认可信
	if !s.HostAllowed(videoURL) {
		return nil, fmt.Errorf("视频来源域名不在白名单内: %s（如需放行，在 IMAGE_OPS_ALLOWED_HOSTS 里追加）", videoURL)
	}

	// ---- 快路径：源文件已经在本地缓存里（见 fetchVideoToFileCached）----
	// 缓存命中时整条流程只要 1 秒级；没命中才走下面两条。
	if path, ok := cachedVideoSourcePath(videoURL); ok {
		if img, err := s.filmstripFromLocalFile(path, count); err == nil && len(img) > 0 {
			if saved, err := s.saveDerived(img, "filmstrip.webp", opts); err == nil {
				if d, dok := probeClipDuration(path); dok {
					return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight, Duration: d}, nil
				}
				return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight}, nil
			}
		}
	}

	// ---- 次选：整文件下载**并落缓存**。源站总带宽约 1.26MB/s，一支 37MB 的片子这条要 30 秒，
	//      但这 30 秒只花一次：之后同一支视频的取帧/缩略图/裁剪/重拍全都命中同一份缓存。----
	if path, cleanup, err := s.fetchVideoToFileCached(ctx, videoURL); err == nil {
		img, ferr := s.filmstripFromLocalFile(path, count)
		dur, dok := probeClipDuration(path)
		cleanup()
		if ferr == nil && len(img) > 0 {
			if saved, err := s.saveDerived(img, "filmstrip.webp", opts); err == nil {
				if dok {
					return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight, Duration: dur}, nil
				}
				return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight}, nil
			}
		}
	}

	// ---- 兜底：不下载整文件，每个时间点各 seek 一次（源站被限速到下载超时时还能出图）----
	// 实测依据（2026-10，那支 37MB/30s 的片子）：
	//   · 整文件下载：源站限速 + 会随访问量进一步变慢，30s → 115s → 200s+ 都见过；
	//   · 同一个地址发 Range 请求：200KB 只要 0.22s。
	//   · 8 个输入塞进**一个** ffmpeg：115s（每个 HTTP 输入都要重读一遍索引）。
	// 所以这里是一个时间点一个进程、各自 seek、各自只取一小段，最后本地拼图。
	if duration, ok := probeDurationFromURL(videoURL); ok && duration > 0 {
		if img, err := s.filmstripBySeeking(ctx, videoURL, count, duration); err == nil && len(img) > 0 {
			if saved, err := s.saveDerived(img, "filmstrip.webp", opts); err == nil {
				return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight, Duration: duration}, nil
			}
		}
	}

	duration, err := s.probeDurationWithFallback(ctx, videoURL)
	if err != nil {
		return nil, err
	}
	img, err := s.filmstripBySeeking(ctx, videoURL, count, duration)
	if err != nil {
		return nil, err
	}
	saved, err := s.saveDerived(img, "filmstrip.webp", opts)
	if err != nil {
		return nil, err
	}
	return &Filmstrip{URL: saved.URL, Count: count, Height: videoFilmstripTileHeight, Duration: duration}, nil
}

// runFFmpegFilterOnFile 与 runFFmpegFilter 同样是"ffmpeg 出图"，区别是输入走**文件**而不是
// stdin：视频有 moov 原子，从管道读需要能来回 seek，走临时文件最稳（fetchVideoToFile 已经落了盘）。
func runFFmpegFilterOnFile(srcPath, filter, codec string) ([]byte, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("本机没有 ffmpeg，无法生成缩略图")
	}
	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", srcPath,
		"-vf", filter,
		"-frames:v", "1",
		"-f", codec,
	}
	if codec == "webp" {
		args = append(args, "-q:v", "80")
	}
	args = append(args, "pipe:1")

	cmd := exec.Command("ffmpeg", args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("ffmpeg 生成缩略图失败: %w: %s", err, msg)
	}
	return out.Bytes(), nil
}

// ---------------------------------------------------------------------------
// 源文件缓存：一支视频在一段时间内只下载一次
// ---------------------------------------------------------------------------

const (
	// 源站实测约 1.26MB/s（37MB 的 720p 片要 30 秒），所以下载一次的成果必须留下来：
	// 用户「先看缩略图条 → 再决定裁哪一段」是同一支视频上的连续操作，
	// 第二次如果还走网络，等待感就再叠 30 秒。
	// 6 小时：实测 30 分钟太短 —— 用户中途去喝杯水回来，缓存就过期了，
	// 于是"取首帧/缩略图/裁剪"又变成 30 秒。2GB 上限 + LRU 才是真正的兜底，TTL 只管别留隔夜垃圾。
	videoSourceCacheTTL      = 6 * time.Hour
	videoSourceCacheMaxBytes = int64(2) << 30 // 2GB：超了按最久未访问淘汰
)

func videoSourceCacheDir() string {
	dir := filepath.Join(os.TempDir(), "libtv-src-cache")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// 键用 URL 的 sha256：带签名参数的地址会各自成键、各自过期，语义正确
func videoSourceCacheKey(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	ext := filepath.Ext(rawURL)
	if len(ext) > 8 {
		ext = ""
	}
	return hex.EncodeToString(sum[:]) + ext
}

// fetchVideoToFileCached 与 fetchVideoToFile 行为一致，但把下载结果留在磁盘上复用。
// 命中的路径返回 no-op cleanup（文件归缓存管，由 TTL/LRU 清理），调用方无需改动。
func (s *ImageOpsService) fetchVideoToFileCached(ctx context.Context, rawURL string) (string, func(), error) {
	path := filepath.Join(videoSourceCacheDir(), videoSourceCacheKey(rawURL))
	if fi, err := os.Stat(path); err == nil && time.Since(fi.ModTime()) < videoSourceCacheTTL {
		now := time.Now()
		_ = os.Chtimes(path, now, now) // 刷新访问时间，供 LRU 淘汰
		return path, func() {}, nil
	}

	tmp, cleanup, err := s.fetchVideoToFile(ctx, rawURL)
	if err != nil {
		return "", func() {}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		// 落缓存失败不影响功能：直接把临时文件交给调用方（只是这次白下了）
		return tmp, cleanup, nil
	}
	cleanup() // 原临时路径已经不在，调用它无害
	go pruneVideoSourceCache()
	return path, func() {}, nil
}

// pruneVideoSourceCache 清掉过期项，并保证总量不超过上限（按最久未访问淘汰）
func pruneVideoSourceCache() {
	dir := videoSourceCacheDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	var items []item
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if time.Since(info.ModTime()) >= videoSourceCacheTTL {
			_ = os.Remove(filepath.Join(dir, e.Name()))
			continue
		}
		items = append(items, item{filepath.Join(dir, e.Name()), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= videoSourceCacheMaxBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })
	for _, it := range items {
		if total <= videoSourceCacheMaxBytes {
			break
		}
		if err := os.Remove(it.path); err == nil {
			total -= it.size
		}
	}
}

// filmstripBySeeking 每个时间点起一个 ffmpeg 进程，靠 -ss 让 ffmpeg 自己发 Range 请求，
// 只取解码那一帧所需的字节；8 张 PNG 收齐后本地 hstack 成一张 webp。
//
// 为什么不是一个进程 8 个输入：HTTP 输入每开一个都要重新读一遍索引，8 个输入就是 8 遍，
// 实测 115 秒，比整文件下载还慢。拆成 8 个进程后每个只读自己那一小段。
func (s *ImageOpsService) filmstripBySeeking(
	ctx context.Context,
	videoURL string,
	count int,
	duration float64,
) ([]byte, error) {
	ffmpegBin, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, errors.New("本机没有 ffmpeg，无法生成缩略图")
	}

	tmpDir, err := os.MkdirTemp("", "libtv-strip-*")
	if err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	// 8 个时间点**并行**取：它们互不依赖，串行等于把每格的开销乘 8。
	// 单格开销的大头是 ffmpeg 默认的媒体探测（probesize 默认 5MB，在 1.26MB/s 的源站上就是 4 秒），
	// 所以同时把探测窗口收小：mp4 的索引里已经写全了编码信息，200KB 足够认出流。
	type result struct {
		idx  int
		path string
		err  error
		msg  string
	}
	tiles := make([]string, count)
	results := make(chan result, count)
	for i := 0; i < count; i++ {
		go func(i int) {
			// 每格取该段中点，避免都落在片头/转场上
			at := duration * (float64(i) + 0.5) / float64(count)
			outPath := filepath.Join(tmpDir, fmt.Sprintf("t%02d.png", i))
			cmd := exec.CommandContext(ctx, ffmpegBin,
				"-hide_banner", "-loglevel", "error", "-nostdin",
				"-rw_timeout", "20000000",
				"-protocol_whitelist", "file,http,https,tcp,tls,crypto",
				"-probesize", "200000",
				"-analyzeduration", "500000",
				"-ss", strconv.FormatFloat(at, 'f', 3, 64),
				"-i", videoURL,
				"-frames:v", "1",
				"-vf", fmt.Sprintf("scale=-2:%d", videoFilmstripTileHeight),
				"-an", "-f", "image2", "-vcodec", "png",
				outPath,
			)
			var errBuf bytes.Buffer
			cmd.Stderr = &errBuf
			if err := cmd.Run(); err != nil {
				msg := strings.TrimSpace(errBuf.String())
				if len(msg) > 200 {
					msg = msg[:200]
				}
				results <- result{idx: i, err: err, msg: msg}
				return
			}
			if fi, serr := os.Stat(outPath); serr != nil || fi.Size() == 0 {
				results <- result{idx: i, err: errors.New("输出为空")}
				return
			}
			results <- result{idx: i, path: outPath}
		}(i)
	}
	for n := 0; n < count; n++ {
		r := <-results
		if r.err != nil {
			return nil, fmt.Errorf("按时间点取帧失败(第 %d 格): %w: %s", r.idx+1, r.err, r.msg)
		}
		tiles[r.idx] = r.path
	}

	// 本地拼图：全是本地文件，几百毫秒
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin"}
	for _, p := range tiles {
		args = append(args, "-i", p)
	}
	var graph strings.Builder
	for i := range tiles {
		if i > 0 {
			graph.WriteString(";")
		}
		fmt.Fprintf(&graph, "[%d:v]setsar=1[v%d]", i, i)
	}
	graph.WriteString(";")
	for i := range tiles {
		fmt.Fprintf(&graph, "[v%d]", i)
	}
	fmt.Fprintf(&graph, "hstack=inputs=%d[out]", len(tiles))
	args = append(args,
		"-filter_complex", graph.String(),
		"-map", "[out]",
		"-frames:v", "1",
		"-f", "webp", "-q:v", "80",
		"pipe:1",
	)

	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return nil, fmt.Errorf("拼缩略图条失败: %w: %s", err, msg)
	}
	if out.Len() == 0 {
		return nil, errors.New("拼缩略图条失败: 输出为空")
	}
	return out.Bytes(), nil
}

// probeDurationFromURL 用 ffprobe 直接读远端时长（只读头部，走 Range，通常几百毫秒）
func probeDurationFromURL(rawURL string) (float64, bool) {
	bin := findFFprobe()
	if bin == "" {
		return 0, false
	}
	out, err := exec.Command(bin,
		"-v", "error",
		"-rw_timeout", "20000000",
		"-protocol_whitelist", "file,http,https,tcp,tls,crypto",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		rawURL,
	).Output()
	if err != nil {
		return 0, false
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || d <= 0 {
		return 0, false
	}
	return d, true
}

// filmstripFromLocalFile 本地文件出缩略图条：整条视频按 fps 采样再 tile，几百毫秒
func (s *ImageOpsService) filmstripFromLocalFile(path string, count int) ([]byte, error) {
	duration, ok := probeClipDuration(path)
	if !ok || duration <= 0 {
		return nil, errors.New("读不到这条视频的时长，暂时做不出缩略图条")
	}
	// fps = 格数 / 时长 → 整条视频正好吐出 count 帧；tile 把它们横向拼成一张
	filter := fmt.Sprintf("fps=%.6f,scale=-2:%d,tile=%dx1", float64(count)/duration, videoFilmstripTileHeight, count)
	img, err := runFFmpegFilterOnFile(path, filter, "webp")
	if err != nil {
		return nil, err
	}
	if len(img) == 0 {
		return nil, errors.New("缩略图条生成结果为空")
	}
	return img, nil
}

// cachedVideoSourcePath 缓存命中就返回路径（不刷新访问时间，只做判断）
func cachedVideoSourcePath(rawURL string) (string, bool) {
	path := filepath.Join(videoSourceCacheDir(), videoSourceCacheKey(rawURL))
	fi, err := os.Stat(path)
	if err != nil || fi.IsDir() || fi.Size() == 0 {
		return "", false
	}
	if time.Since(fi.ModTime()) >= videoSourceCacheTTL {
		return "", false
	}
	return path, true
}

// probeDurationWithFallback 先试远端（快），失败再下载到缓存后探本地
func (s *ImageOpsService) probeDurationWithFallback(ctx context.Context, videoURL string) (float64, error) {
	if d, ok := probeDurationFromURL(videoURL); ok && d > 0 {
		return d, nil
	}
	path, cleanup, err := s.fetchVideoToFileCached(ctx, videoURL)
	if err != nil {
		return 0, err
	}
	defer cleanup()
	d, ok := probeClipDuration(path)
	if !ok || d <= 0 {
		return 0, errors.New("读不到这条视频的时长，暂时做不出缩略图条")
	}
	return d, nil
}

// WarmVideoSourceCache 把远端源文件拉到本地缓存（按 URL 去重）。
//
// 用途：视频刚生成/上传完成时后台预热一次。源站总带宽约 1.26MB/s，一支 37MB 的片子要 30 秒，
// 与其让用户点「片段重拍」时干等，不如在视频诞生那一刻就把这 30 秒花掉 ——
// 用户看到画面、想清楚要重拍哪一段，通常远不止 30 秒。
func (s *ImageOpsService) WarmVideoSourceCache(ctx context.Context, videoURL string) error {
	videoURL = strings.TrimSpace(videoURL)
	if videoURL == "" || (!strings.HasPrefix(videoURL, "http://") && !strings.HasPrefix(videoURL, "https://")) {
		return errors.New("视频地址为空或不是 http(s)")
	}
	if !s.HostAllowed(videoURL) {
		return fmt.Errorf("视频来源域名不在白名单内: %s", videoURL)
	}
	if _, ok := cachedVideoSourcePath(videoURL); ok {
		return nil // 已经预热过
	}
	_, cleanup, err := s.fetchVideoToFileCached(ctx, videoURL)
	if err != nil {
		return err
	}
	cleanup()
	return nil
}
