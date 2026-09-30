package handler

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/gif"  // ✅ 只导入副作用：自动注册 GIF 解码器
	_ "image/jpeg" // ✅ 只导入副作用：自动注册 JPEG 解码器
	_ "image/png"  // ✅ 只导入副作用：自动注册 PNG 解码器
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/repository"
	"libtv/internal/service"
	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
)

// UploadHandler 上传处理器（支持MinIO降级）
type UploadHandler struct {
	storage           storage.Storage
	fileUploadService *service.FileUploadService
	transcodeService  *service.TranscodeService
	projectRepo       repository.ProjectRepo
	userRepo          repository.UserRepo
}

// NewUploadHandler 创建上传处理器
func NewUploadHandler(s storage.Storage, fileUploadService *service.FileUploadService, transcodeService *service.TranscodeService, projectRepo repository.ProjectRepo, userRepo repository.UserRepo) *UploadHandler {
	return &UploadHandler{storage: s, fileUploadService: fileUploadService, transcodeService: transcodeService, projectRepo: projectRepo, userRepo: userRepo}
}

// isAdminUser 当前登录用户是否管理员（查库判断，不信任 token 里的角色，改了权限立刻生效）
func (h *UploadHandler) isAdminUser(c *gin.Context) bool {
	if h.userRepo == nil {
		return false
	}
	userID := middleware.GetUserID(c)
	if userID == "" {
		return false
	}
	user, err := h.userRepo.FindByID(c.Request.Context(), userID)
	return err == nil && user != nil && user.Role == "admin"
}

// forumVideoMaxSize 论坛视频大小上限：管理员 1GB，其他用户 200MB。
//
// 管理员常要传整段片子或素材，200MB 明显不够；普通用户 200MB 足够发一段演示视频，
// 也避免单个账号长时间占满出口带宽。
func forumVideoMaxSize(isAdmin bool) int64 {
	if isAdmin {
		return 1 << 30 // 1GB
	}
	return 200 << 20 // 200MB
}

// forumImageMaxSize 论坛图片上限：10MB（图片基本不会更大）
const forumImageMaxSize = 10 << 20

// canvasDirForProject 返回画布文件的存储目录前缀：
// 按项目属主存 users/<userID>/canvas（删用户时级联清理）；项目不存在时降级公共 canvas 目录
func (h *UploadHandler) canvasDirForProject(projectID string) string {
	if projectID == "" {
		return ""
	}
	project, err := h.projectRepo.FindByID(context.Background(), projectID)
	if err != nil || project == nil || project.UserID == "" {
		log.Printf("[UploadHandler] 项目不存在或无属主，降级存公共 canvas 目录: projectID=%s err=%v", projectID, err)
		return "canvas"
	}
	return "users/" + project.UserID + "/canvas"
}

// UploadVideo 上传视频（哈希去重，按项目ID分文件夹，TS自动转MP4）
func (h *UploadHandler) UploadVideo(c *gin.Context) {
	_, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// 目录选择：有项目ID存到 users/<userID>/canvas/<projectID>/，否则存到 videos/
	dir := "videos"
	if projectID != "" {
		dir = h.canvasDirForProject(projectID)
	}

	result, err := h.fileUploadService.UploadVideoWithTranscode(header, service.UploadOptions{
		Dir:       dir,
		ProjectID: projectID,
	}, h.transcodeService)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	// 同步完成（含命中去重）
	if !result.AsyncTranscode {
		msg := "上传成功"
		if result.Cached {
			msg = "上传成功（已存在）"
		}
		response.OKWithMsg(c, msg, gin.H{
			"url":          result.URL,
			"storage_type": result.StorageType,
			"filename":     result.ObjectName,
			"cached":       result.Cached,
			"compressed":   result.Compressed,
		})
		return
	}

	// 异步转码中
	response.OKWithMsg(c, "上传成功，正在转码", gin.H{
		"url":        "",
		"task_id":    result.TaskID,
		"filename":   result.ObjectName,
		"compressed": false,
	})
}

// UploadCanvas 上传画布图片（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadCanvas(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// 无项目ID时存公共 canvas 目录，有项目ID时存 users/<userID>/canvas/项目ID/
	dir := h.canvasDirForProject(projectID)
	if dir == "" {
		dir = "canvas"
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            dir,
		ProjectID:      projectID,
		DefaultExt:     ".png",
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// UploadImage 通用图片上传（哈希去重）
// 如果传递 project_id 参数，存储到 users/<userID>/canvas/项目ID/ 目录
// 如果不传递 project_id，存储到 images/ 目录
func (h *UploadHandler) UploadImage(c *gin.Context) {
	projectID := c.PostForm("project_id")
	dir := "images"
	if projectID != "" {
		dir = h.canvasDirForProject(projectID)
	}
	h.uploadImageToDir(c, dir, projectID)
}

// UploadForumImage 论坛图片上传（需登录）：存到 forum/<userID>/。
//
// 为什么不复用公开的 UploadImage 再让前端传目录：目录一旦由客户端指定就能被伪造成
// 别人的目录，所以这里从 JWT 取当前用户，由服务端拼路径。
// 放在独立目录是为了能按作者/按论坛单独清理，也不再和全站 images/ 混在一起。
func (h *UploadHandler) UploadForumImage(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "请先登录")
		return
	}
	dir, ok := forumContentDir(c)
	if !ok {
		response.Fail(c, http.StatusBadRequest, "缺少内容 id，请刷新页面后重试")
		return
	}
	// 先在接口层挡掉超大文件：uploadImageToDir 会把整张图读进内存再解码尺寸，
	// 不限大小的话一个 2G 的「图片」就能把后端打爆（与前端 guardUpload 的 10MB 对齐）
	if f, header, err := c.Request.FormFile("file"); err == nil {
		_ = f.Close()
		if header.Size > forumImageMaxSize {
			response.Fail(c, http.StatusBadRequest, fmt.Sprintf("图片不能超过 %dMB", forumImageMaxSize>>20))
			return
		}
	}
	// 目录用客户端带来的「内容 id」（帖子/回复 id）：删帖删回复时按目录前缀一次删干净
	h.uploadImageToDir(c, "forum/"+dir, "")
}

// forumContentDir 取客户端带来的「内容 id」（帖子/回复 id），它就是上传物在 forum/ 下的目录名。
//
// 为什么按内容 id 而不是用户 id 分层：帖子 id、回复 id 本身就是全局唯一 UUID，
// 一条内容的媒体全在 forum/<内容id>/ 里，删帖删回复直接按这个前缀删，不会牵连别人、
// 也不用去解析正文反查对象。这里不校验内容是否存在——发帖时文件是先于帖子上传的。
//
// 只接受标准 UUID：目录名一旦能被客户端任意指定，就能用 "../" 写到别的目录去。
// 拿不到合法 id 就报错，绝不退回别的目录——否则文件会落在没人负责清理的地方。
func forumContentDir(c *gin.Context) (string, bool) {
	id := strings.TrimSpace(c.PostForm("draftId"))
	if id == "" {
		id = strings.TrimSpace(c.Query("draftId"))
	}
	if id == "" || !service.ValidForumContentID(id) {
		return "", false
	}
	return id, true
}

// forumPlayableVideoExts 论坛视频白名单：只放行浏览器能直接播放的容器。
//
// 为什么不用 service.VideoExts()（含 mkv/avi）：那套是给「转码队列」用的，
// 走 UploadVideo 会返回空 url + task_id（异步转码），而发帖要的是传完立刻能播。
// mkv/avi 基本都播不了，与其传上去显示一个黑框，不如当场退回让用户转成 mp4。
func forumPlayableVideoExts() map[string]bool {
	return map[string]bool{
		".mp4": true, ".m4v": true, ".webm": true, ".ogv": true, ".ogg": true, ".mov": true,
	}
}

// UploadForumVideo 论坛视频上传（需登录）：存到 forum/<userID>/，同步落盘、不做转码。
//
// 目录形如 forum/<帖子id>/（详见 forumContentDir）：一个内容的媒体集中在一个目录，
// 删帖删回复按前缀一次删净。成功后前端会往正文插入 <video src controls>，
// 所以这里必须给一个立刻可播的 URL（这也是不走 UploadVideo 异步转码的原因）。
// 安全说明：只按扩展名白名单放行，存储时的 Content-Type 由 ContentTypeForVideo
// 按扩展名给定（video/*），即使有人把别的文件改名成 .mp4，也只会以 video 类型被下载。
func (h *UploadHandler) UploadForumVideo(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "请先登录")
		return
	}

	dir, ok := forumContentDir(c)
	if !ok {
		response.Fail(c, http.StatusBadRequest, "缺少内容 id，请刷新页面后重试")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	// 上限按角色区分：管理员 1GB（要传整段片子），其他用户 200MB
	maxSize := forumVideoMaxSize(h.isAdminUser(c))
	if header.Size > maxSize {
		response.Fail(c, http.StatusBadRequest,
			fmt.Sprintf("视频不能超过 %dMB，请压缩后再上传", maxSize>>20))
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "forum/" + dir,
		DefaultExt:     ".mp4",
		AllowedExts:    forumPlayableVideoExts(),
		MaxSize:        maxSize,
		ContentTypeFor: service.ContentTypeForVideo,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	log.Printf("[UploadForumVideo] 论坛视频上传成功: user=%s file=%s size=%d url=%s", userID, header.Filename, header.Size, result.URL)
	response.OKWithMsg(c, "上传成功", gin.H{
		"url":      result.URL,
		"filename": result.ObjectName,
		"size":     header.Size,
	})
}

// uploadImageToDir 图片上传的公共实现：解码取尺寸 → 内容哈希去重落盘 → 生成缩略图。
// dir 由调用方按业务决定（images/、canvas/...、forum/<userID>/）。
func (h *UploadHandler) uploadImageToDir(c *gin.Context, dir, projectID string) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	// ✅ 读取图片数据到 buffer，用于解码获取尺寸
	imageData, err := io.ReadAll(file)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "读取文件失败")
		return
	}

	// ✅ 解码图片获取实际尺寸
	var width, height int
	imgConfig, format, err := image.DecodeConfig(bytes.NewReader(imageData))
	if err != nil {
		// 解码失败时记录错误，使用默认尺寸（不应该影响上传流程）
		log.Printf("[UploadImage] 图片解码失败: filename=%s size=%d bytes err=%v, 使用默认尺寸 1024×1024", header.Filename, len(imageData), err)
		width = 1024
		height = 1024
	} else {
		width = imgConfig.Width
		height = imgConfig.Height
		log.Printf("[UploadImage] 图片解码成功: filename=%s format=%s size=%d bytes dimensions=%d×%d", header.Filename, format, len(imageData), width, height)
	}

	// 扩展名以真实字节为准：客户端文件名后缀可能与内容不符（如 JPEG 命名为 .png）。
	// 存储名是内容哈希（hash+ext），原文件名只在取扩展名时用到，替换掉没有副作用；
	// 识别不出时仍用原文件名，白名单校验行为不变。
	uploadName := header.Filename
	if sniffedExt, _ := service.DetectImageExt(imageData); sniffedExt != "" {
		uploadName = "image" + sniffedExt
	}

	// ✅ 使用 bytes.NewReader 重新创建 reader（因为前面的 ReadAll 已经读完了）
	result, err := h.fileUploadService.UploadFromReader(bytes.NewReader(imageData), int64(len(imageData)), uploadName, service.UploadOptions{
		Dir:            dir,
		ProjectID:      projectID,
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	// ✅ 返回图片尺寸信息，统一数据格式
	// ✅ 同时尝试生成 640px webp 缩略图（失败不阻断主流程），供画布等轻量展示
	thumbURL := ""
	if thumbBytes, terr := service.GenerateImageThumbnail(imageData); terr == nil {
		thumbObject := service.ThumbnailObjectName(result.ObjectName)
		if perr := h.fileUploadService.PutBytes(thumbObject, thumbBytes, "image/webp"); perr != nil {
			log.Printf("[UploadImage] 缩略图写入失败: object=%s err=%v", thumbObject, perr)
		} else {
			thumbURL = h.fileUploadService.ObjectURL(thumbObject)
			log.Printf("[UploadImage] 缩略图生成成功: %s", thumbURL)
		}
	} else {
		log.Printf("[UploadImage] 缩略图生成跳过: %v", terr)
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"thumb_url":    thumbURL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
		"width":        width,  // ✅ 图片宽度
		"height":       height, // ✅ 图片高度
	})
}

// backfillThumbSuffixes 支持回填缩略图的图片后缀（与 ImageExts 一致）
var backfillThumbSuffixes = []string{".png", ".jpg", ".jpeg", ".webp", ".gif"}

// BackfillThumbnails 给缺失缩略图的图片补一张（管理员维护接口）。
//
// 为什么需要它：缩略图是在图片上传「成功返回前」生成的，那一次请求没走完
// （浏览器断开、容器重启等），这张图的缩略图就永远缺失 —— 事后没有任何补偿，
// 属于静默缺口。缺了也不报错：画布能按约定推导再回退原图，论坛正文更是完全不用缩略图，
// 所以没人会发现，只有翻存储目录才看得出来。
//
// 参数：prefix（可选，默认 forum/）；limit（可选，默认 200，单次最多 2000）。
// 返回扫描/已存在/本次生成/失败/剩余待补的数量，remaining > 0 时再调一次即可。
func (h *UploadHandler) BackfillThumbnails(c *gin.Context) {
	prefix := strings.TrimSpace(c.Query("prefix"))
	if prefix == "" {
		prefix = "forum/"
	}
	limit := 200
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		if v > 2000 {
			v = 2000
		}
		limit = v
	}

	objects, err := h.storage.ListObjects(prefix)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "列出对象失败: "+err.Error())
		return
	}

	existing := make(map[string]bool, len(objects))
	for _, obj := range objects {
		existing[obj] = true
	}

	type pendingThumb struct{ object, thumb string }
	todo := make([]pendingThumb, 0, 16)
	already, images := 0, 0
	for _, obj := range objects {
		lower := strings.ToLower(obj)
		if strings.HasSuffix(lower, ".thumb.webp") {
			continue
		}
		isImage := false
		for _, suffix := range backfillThumbSuffixes {
			if strings.HasSuffix(lower, suffix) {
				isImage = true
				break
			}
		}
		if !isImage {
			continue
		}
		images++
		thumb := service.ThumbnailObjectName(obj)
		if existing[thumb] {
			already++
			continue
		}
		todo = append(todo, pendingThumb{obj, thumb})
	}

	remaining := 0
	if len(todo) > limit {
		remaining = len(todo) - limit
		todo = todo[:limit]
	}

	generated, failed := 0, 0
	for _, item := range todo {
		rc, err := h.storage.GetObject(item.object)
		if err != nil {
			failed++
			log.Printf("[BackfillThumb] 读取失败 object=%s err=%v", item.object, err)
			continue
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			failed++
			log.Printf("[BackfillThumb] 读取出错 object=%s err=%v", item.object, err)
			continue
		}
		thumbBytes, err := service.GenerateImageThumbnail(data)
		if err != nil {
			failed++
			log.Printf("[BackfillThumb] 生成失败 object=%s err=%v", item.object, err)
			continue
		}
		if err := h.fileUploadService.PutBytes(item.thumb, thumbBytes, "image/webp"); err != nil {
			failed++
			log.Printf("[BackfillThumb] 写入失败 object=%s err=%v", item.thumb, err)
			continue
		}
		generated++
		log.Printf("[BackfillThumb] 已补缩略图: %s", item.thumb)
	}

	response.OKWithMsg(c, "回填完成", gin.H{
		"prefix":    prefix,
		"scanned":   len(objects),
		"images":    images,
		"already":   already,
		"generated": generated,
		"failed":    failed,
		"remaining": remaining,
	})
}

// UploadAvatar 上传当前登录用户的头像（哈希去重）
// 存储到用户专属目录 users/<userID>/avatar/，不再占用公共 images/ 目录
// （用户存储目录约定：users/<userID>/avatar/ 头像；users/<userID>/assets/ 用户资产）
func (h *UploadHandler) UploadAvatar(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "users/" + userID + "/avatar",
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// UploadAudio 上传音频文件（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadAudio(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// 有项目ID时存到 users/<userID>/canvas/项目ID/，否则存到 audio/
	dir := "audio"
	if projectID != "" {
		dir = h.canvasDirForProject(projectID)
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:        dir,
		ProjectID:  projectID,
		DefaultExt: ".mp3",
		AllowedExts: map[string]bool{
			".mp3": true, ".wav": true, ".ogg": true, ".m4a": true, ".flac": true,
		},
		ContentTypeFor: service.ContentTypeForAudio,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// GetFile 获取文件（代理MinIO，支持Range请求）
func (h *UploadHandler) GetFile(c *gin.Context) {
	filePath := c.Param("filepath")
	filePath = strings.TrimPrefix(filePath, "/")

	// 获取文件信息
	info, err := h.storage.StatObject(filePath)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	// 设置响应头
	c.Header("Content-Type", info.ContentType)
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "public, max-age=31536000") // 缓存1年

	// 处理Range请求
	rangeHeader := c.GetHeader("Range")
	if rangeHeader != "" {
		// 解析Range请求（如 "bytes=0-1023"）
		start, end := parseRange(rangeHeader, info.Size)
		length := end - start + 1

		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, info.Size))
		c.Header("Content-Length", fmt.Sprintf("%d", length))
		c.Status(http.StatusPartialContent)

		// 获取文件指定范围
		reader, err := h.storage.GetObjectRange(filePath, start, end)
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		defer reader.Close()

		buf := make([]byte, 32*1024)
		_, _ = io.CopyBuffer(c.Writer, reader, buf)
	} else {
		// 完整文件请求
		c.Header("Content-Length", fmt.Sprintf("%d", info.Size))
		c.Status(http.StatusOK)

		reader, err := h.storage.GetObject(filePath)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer reader.Close()

		buf := make([]byte, 32*1024)
		_, _ = io.CopyBuffer(c.Writer, reader, buf)
	}
}

// parseRange 解析Range请求头
func parseRange(rangeHeader string, fileSize int64) (start, end int64) {
	// 格式: "bytes=0-1023" 或 "bytes=0-"
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return 0, fileSize - 1
	}

	rangeStr := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.Split(rangeStr, "-")
	if len(parts) != 2 {
		return 0, fileSize - 1
	}

	// 解析起始位置
	if parts[0] == "" {
		start = 0
	} else {
		// P2-14 改用 strconv.ParseInt 替代自造 parseInt64
		if v, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			start = v
		}
	}

	// 解析结束位置
	if parts[1] == "" {
		end = fileSize - 1
	} else {
		if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
			end = v
		}
	}

	// 确保范围有效
	if start < 0 {
		start = 0
	}
	if end >= fileSize {
		end = fileSize - 1
	}
	if start > end {
		start = 0
		end = fileSize - 1
	}

	return start, end
}

// DeleteFile 删除文件
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	filePath := c.Param("filepath")
	filePath = strings.TrimPrefix(filePath, "/")

	if err := h.storage.DeleteObject(filePath); err != nil {
		response.Fail(c, http.StatusInternalServerError, "删除失败")
		return
	}

	response.OKWithMsg(c, "删除成功", nil)
}

// GetStorageStatus 获取存储状态
func (h *UploadHandler) GetStorageStatus(c *gin.Context) {
	status := map[string]interface{}{
		"type":      h.storage.GetType(),
		"available": h.storage.IsAvailable(),
	}

	// 如果是降级存储，获取详细信息
	if fallback, ok := h.storage.(*storage.FallbackStorage); ok {
		status = fallback.GetStatus()
	}

	response.OK(c, status)
}

// GetVideoStatus 获取视频转码任务状态
func (h *UploadHandler) GetVideoStatus(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		response.Fail(c, http.StatusBadRequest, "缺少 task_id")
		return
	}

	task, ok := h.transcodeService.GetTask(taskID)
	if !ok {
		response.Fail(c, http.StatusNotFound, "任务不存在或已过期")
		return
	}

	response.OK(c, task)
}

// DeleteCanvasDir 删除画布目录
func (h *UploadHandler) DeleteCanvasDir(c *gin.Context) {
	projectID := c.Param("projectId")
	if projectID == "" || projectID == "." || projectID == ".." {
		response.Fail(c, http.StatusBadRequest, "无效的项目 ID")
		return
	}

	// 新路径 users/<userID>/canvas/<projectID>/；旧路径 canvas/<projectID>/ 一并清理（历史数据兼容）
	prefixes := []string{"canvas/" + projectID + "/"}
	if dir := h.canvasDirForProject(projectID); dir != "canvas" && dir != "" {
		prefixes = append(prefixes, dir+"/"+projectID+"/")
	}
	for _, prefix := range prefixes {
		if err := h.storage.DeleteObjectsByPrefix(prefix); err != nil {
			response.Fail(c, http.StatusInternalServerError, fmt.Sprintf("删除目录失败: %v", err))
			return
		}
	}

	response.OKWithMsg(c, "目录已删除", nil)
}
