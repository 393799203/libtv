package service

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
	"libtv/internal/storage"

	"github.com/microcosm-cc/bluemonday"
	"gorm.io/gorm"
)

// 论坛相关错误
var (
	ErrPostTitleEmpty    = apperror.New(400, 400, "标题不能为空")
	ErrPostTitleTooLong  = apperror.New(400, 400, "标题不能超过100字")
	ErrPostContentEmpty  = apperror.New(400, 400, "正文不能为空")
	ErrPostContentTooBig = apperror.New(400, 400, "正文太长了，请精简后重试")
	ErrPostNotFound      = apperror.New(404, 404, "帖子不存在")
	ErrPostIDTaken       = apperror.New(409, 409, "该帖子已发布过了，请刷新页面后查看")
	ErrPostIDInvalid     = apperror.New(400, 400, "请求参数有误，请刷新页面后重试")
	ErrPostForbidden     = apperror.New(403, 403, "只能删除自己的帖子")
	ErrPostEditForbidden = apperror.New(403, 403, "只有作者本人或管理员可以修改")
	ErrReplyEmpty        = apperror.New(400, 400, "回复内容不能为空")
	ErrReplyTooBig       = apperror.New(400, 400, "回复太长了，请精简后重试")
	ErrReplyNotFound     = apperror.New(404, 404, "回复不存在")
	ErrReplyForbidden    = apperror.New(403, 403, "只能删除自己的回复")
)

// forumContentIDPattern 帖子/回复 id 必须是标准 UUID。
//
// 为什么必须校验：这个 id 会被拼进存储目录名（forum/<id>/），
// 一旦允许任意字符串，就能用 "../" 拼出别的目录，删帖时把不该删的东西删掉。
var forumContentIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ValidForumContentID 校验客户端传来的帖子/回复 id（空串表示由服务端生成，同样合法）
func ValidForumContentID(id string) bool {
	return id == "" || forumContentIDPattern.MatchString(id)
}

const (
	forumTitleMaxRunes   = 100
	forumContentMaxBytes = 100 * 1024 // 100KB 富文本 HTML 上限
)

// forumPolicy 论坛富文本白名单。
//
// 以 bluemonday 的 UGCPolicy 为基线（它默认剥掉 <script>/<style>/<iframe>、
// on* 事件属性、javascript: 协议等危险内容），再按 wangEditor 的输出补上
// 行内样式、对齐、颜色、代码块、表格这些正常排版能力。
//
// 帖子正文会被前端用 dangerouslySetInnerHTML 渲染，所以这里是唯一一道
// XSS 防线：任何新增的入库路径都必须走 SanitizeForumHTML。
var forumPolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	// 结构类标签（UGCPolicy 未覆盖的补齐）
	p.AllowElements("p", "br", "hr", "span", "div", "figure", "figcaption", "s", "del", "mark")
	p.AllowElements("h1", "h2", "h3", "h4", "h5")
	p.AllowElements("pre", "code", "blockquote", "ul", "ol", "li")
	p.AllowElements("table", "thead", "tbody", "tr", "td", "th")
	// 链接：强制 rel="nofollow noopener"，避免被当外链农场
	p.AllowAttrs("href", "title").OnElements("a")
	p.RequireNoFollowOnLinks(true)
	p.RequireNoReferrerOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	// 图片：只允许 http/https（bluemonday 会拦掉 javascript: 等协议）
	p.AllowAttrs("src", "alt", "title", "width", "height").OnElements("img")

	// 视频：发帖富文本支持上传视频（wangEditor 插入 <video src controls>）。
	// 只放行播放必需的属性：src/controls；poster/preload/playsinline 是移动端与首帧体验；
	// 不放 autoplay（论坛里自动播放很吵）。协议照旧由 bluemonday 卡 http/https。
	p.AllowElements("video")
	p.AllowAttrs("src", "poster").OnElements("video")
	p.AllowAttrs("controls", "preload", "playsinline", "muted", "width", "height").OnElements("video")
	p.AllowAttrs("style").OnElements("video")
	p.AllowElements("source")
	p.AllowAttrs("src", "type").OnElements("source")
	// wangEditor 的视频是 <div data-w-e-type="video"><video>…</video></div>：
	// 这两个 data 属性留着，帖子内容再回填编辑器时结构不会被拆散（对渲染无影响）。
	p.AllowAttrs("data-w-e-type", "data-w-e-is-void").OnElements("div")
	// 行内样式：字体色/底色/字号/对齐/缩进等排版属性；
	// bluemonday 会解析 style 并丢弃 url()/expression() 之类危险值
	p.AllowAttrs("style").OnElements("p", "span", "div", "li", "h1", "h2", "h3", "h4", "h5", "td", "th", "table", "img", "section")
	p.AllowStyles(
		"text-align", "text-indent", "color", "background-color",
		"font-size", "font-weight", "font-style", "font-family",
		"text-decoration", "line-height", "width", "height", "max-width",
	).Globally()
	// wangEditor 用 class 做代码块/引用等样式
	p.AllowAttrs("class").Globally()
	return p
}()

// stripTagsPolicy 只保留纯文本，用于判断「清洗后是不是空内容」
var stripTagsPolicy = bluemonday.StrictPolicy()

// SanitizeForumHTML 清洗论坛富文本，返回可安全渲染的 HTML。
func SanitizeForumHTML(html string) string {
	return strings.TrimSpace(forumPolicy.Sanitize(html))
}

// htmlPlainText 取清洗后的纯文本（用于空内容校验）
func htmlPlainText(html string) string {
	return strings.TrimSpace(stripTagsPolicy.Sanitize(html))
}

// forumMediaTagRe 会「自带内容」的元素。只插一张图、不打一个字，也是合法正文，
// 所以判断空内容不能只看纯文本。
var forumMediaTagRe = regexp.MustCompile(`(?i)<(img|video|audio)\b`)

// forumContentEmpty 判断清洗后的正文是否为空。
// 纯文本为空、且不含图片/视频/音频等媒体元素，才算空。
func forumContentEmpty(html string) bool {
	if htmlPlainText(html) != "" {
		return false
	}
	return !forumMediaTagRe.MatchString(html)
}

// PostItem 帖子列表条目（带作者信息）
type PostItem struct {
	model.ForumPost
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

// ReplyItem 回复列表条目（带作者信息）
type ReplyItem struct {
	model.ForumReply
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

// ForumService 论坛服务
type ForumService struct {
	forumRepo repository.ForumRepo
	userRepo  repository.UserRepo
	// storage 用于删帖/删回复时清理上传的图片、视频（可为 nil：测试或降级场景下不清理）
	storage storage.Storage
}

func NewForumService(forumRepo repository.ForumRepo, userRepo repository.UserRepo, store storage.Storage) *ForumService {
	return &ForumService{forumRepo: forumRepo, userRepo: userRepo, storage: store}
}

// enrichPostAuthors 批量补作者昵称/头像（避免逐条查库）
func (s *ForumService) enrichPostAuthors(ctx context.Context, posts []model.ForumPost) []PostItem {
	items := make([]PostItem, 0, len(posts))
	uids := make([]string, 0, len(posts))
	for _, p := range posts {
		uids = append(uids, p.UserID)
	}
	userByUID := s.usersByIDs(ctx, uids)
	for _, p := range posts {
		item := PostItem{ForumPost: p}
		if u, ok := userByUID[p.UserID]; ok {
			item.Nickname = u.Nickname
			item.AvatarURL = u.AvatarURL
		}
		items = append(items, item)
	}
	return items
}

func (s *ForumService) usersByIDs(ctx context.Context, ids []string) map[string]model.User {
	out := make(map[string]model.User, len(ids))
	for _, uid := range ids {
		if uid == "" {
			continue
		}
		if _, ok := out[uid]; ok {
			continue
		}
		if u, err := s.userRepo.FindByID(ctx, uid); err == nil && u != nil {
			out[uid] = *u
		}
	}
	return out
}

// CreatePost 发帖（正文先清洗再入库）
// CreatePost 发帖。
// id 由客户端在打开编辑器时生成（上传的图片/视频就存在 forum/<userID>/<id>/ 下），
// 这里直接用这个 id 建帖子，删帖时才能「按帖子目录」把媒体一次删干净；传空则照旧由模型生成。
func (s *ForumService) CreatePost(ctx context.Context, userID, id, title, content string) (*model.ForumPost, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, ErrPostTitleEmpty
	}
	if len([]rune(title)) > forumTitleMaxRunes {
		return nil, ErrPostTitleTooLong
	}
	if len(content) > forumContentMaxBytes {
		return nil, ErrPostContentTooBig
	}

	clean := SanitizeForumHTML(content)
	if forumContentEmpty(clean) {
		return nil, ErrPostContentEmpty
	}

	if !ValidForumContentID(id) {
		return nil, ErrPostIDInvalid
	}
	if id != "" {
		// 重复提交（比如发布成功但响应丢了，用户又点了一次）时给明确提示，而不是抛主键冲突
		if existing, err := s.forumRepo.FindPostByID(ctx, id); err == nil && existing != nil {
			return nil, ErrPostIDTaken
		}
	}

	post := &model.ForumPost{ID: id, UserID: userID, Title: title, Content: clean}
	if err := s.forumRepo.CreatePost(ctx, post); err != nil {
		return nil, err
	}
	return post, nil
}

// ListPosts 分页列出帖子（公开）
func (s *ForumService) ListPosts(ctx context.Context, keyword string, page, pageSize int) ([]PostItem, int64, error) {
	posts, total, err := s.forumRepo.ListPosts(ctx, strings.TrimSpace(keyword), (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, err
	}
	return s.enrichPostAuthors(ctx, posts), total, nil
}

// GetPost 帖子详情（公开，顺带浏览量 +1）
func (s *ForumService) GetPost(ctx context.Context, id string) (*PostItem, error) {
	post, err := s.forumRepo.FindPostByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrPostNotFound
		}
		return nil, err
	}
	// 浏览量 +1 失败不影响阅读
	_ = s.forumRepo.IncrPostView(ctx, id)
	post.ViewCount++

	items := s.enrichPostAuthors(ctx, []model.ForumPost{*post})
	return &items[0], nil
}

// ListReplies 分页列出帖子的回复（公开，按时间正序）
func (s *ForumService) ListReplies(ctx context.Context, postID string, page, pageSize int) ([]ReplyItem, int64, error) {
	replies, total, err := s.forumRepo.ListReplies(ctx, postID, (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, err
	}
	uids := make([]string, 0, len(replies))
	for _, r := range replies {
		uids = append(uids, r.UserID)
	}
	userByUID := s.usersByIDs(ctx, uids)
	items := make([]ReplyItem, 0, len(replies))
	for _, r := range replies {
		item := ReplyItem{ForumReply: r}
		if u, ok := userByUID[r.UserID]; ok {
			item.Nickname = u.Nickname
			item.AvatarURL = u.AvatarURL
		}
		items = append(items, item)
	}
	return items, total, nil
}

// CreateReply 回复帖子（正文先清洗再入库），并同步帖子的回复数
// CreateReply 回复帖子。id 同 CreatePost：客户端生成，用于定位该条回复自己的媒体目录。
func (s *ForumService) CreateReply(ctx context.Context, postID, userID, id, content, replyToNickname string) (*model.ForumReply, error) {
	post, err := s.forumRepo.FindPostByID(ctx, postID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrPostNotFound
		}
		return nil, err
	}
	if len(content) > forumContentMaxBytes {
		return nil, ErrReplyTooBig
	}
	clean := SanitizeForumHTML(content)
	if forumContentEmpty(clean) {
		return nil, ErrReplyEmpty
	}

	if !ValidForumContentID(id) {
		return nil, ErrPostIDInvalid
	}
	if id != "" {
		if existing, err := s.forumRepo.FindReplyByID(ctx, id); err == nil && existing != nil {
			return nil, ErrPostIDTaken
		}
	}

	reply := &model.ForumReply{
		ID:              id,
		PostID:          post.ID,
		UserID:          userID,
		Content:         clean,
		ReplyToNickname: strings.TrimSpace(replyToNickname),
	}
	if err := s.forumRepo.CreateReply(ctx, reply); err != nil {
		return nil, err
	}
	if err := s.forumRepo.AddReplyCount(ctx, post.ID, 1); err != nil {
		// 计数失败不影响回复本身，下次列表读取以实际行数为准
		return reply, nil
	}
	return reply, nil
}

// ========== 论坛媒体清理 ==========
//
// 存储布局：上传时前端会带一个「内容 id」（就是帖子/回复的 id，编辑器打开时就生成了），
// 文件存到 forum/<内容id>/ 下。一条内容的媒体就是一个目录，所以：
//   - 删帖/删回复：按目录前缀删，一次删净，也不会牵连别人的文件
//   - 编辑帖子：列出该目录，删掉新正文里已经不引用的文件
// （早期那种扁平 forum/<userID>/ 布局的兜底代码已经移除 —— 那种数据已经没有了，
//  留着只会让删帖逻辑分叉。）

// forumMediaURLRe 抓富文本引用的媒体地址（图片 src、视频 src/poster）
var forumMediaURLRe = regexp.MustCompile(`(?i)(?:src|poster)\s*=\s*"([^"]+)"`)

// deleteMediaPrefix 删除某条内容专属的媒体目录 forum/<内容id>/
func (s *ForumService) deleteMediaPrefix(ctx context.Context, contentID string) {
	if s.storage == nil || contentID == "" {
		return
	}
	// 双保险：目录名只允许 UUID，绝不允许出现路径分隔符
	if !forumContentIDPattern.MatchString(contentID) {
		log.Printf("[Forum] 跳过可疑的媒体目录清理 contentID=%q", contentID)
		return
	}
	prefix := fmt.Sprintf("forum/%s/", contentID)
	if err := s.storage.DeleteObjectsByPrefix(prefix); err != nil {
		// 清理失败不影响删帖本身：内容已经从库里删掉了，这里只记日志
		log.Printf("[Forum] 清理媒体目录失败 prefix=%s err=%v", prefix, err)
	}
}

// forumMediaURLs 抽出这些正文里引用的媒体地址（去重）
func forumMediaURLs(htmls ...string) []string {
	seen := make(map[string]bool)
	urls := make([]string, 0, 4)
	for _, html := range htmls {
		for _, m := range forumMediaURLRe.FindAllStringSubmatch(html, -1) {
			if seen[m[1]] {
				continue
			}
			seen[m[1]] = true
			urls = append(urls, m[1])
		}
	}
	return urls
}

// cleanupContentMedia 清理某条内容目录 forum/<内容id>/ 里、新正文已不再引用的文件
// （编辑帖子删掉图片/换图时用）
func (s *ForumService) cleanupContentMedia(ctx context.Context, contentID, newContent string) {
	if s.storage == nil || !forumContentIDPattern.MatchString(contentID) {
		return
	}
	prefix := fmt.Sprintf("forum/%s/", contentID)
	objects, err := s.storage.ListObjects(prefix)
	if err != nil {
		log.Printf("[Forum] 列出媒体目录失败 prefix=%s err=%v", prefix, err)
		return
	}

	keep := make(map[string]bool)
	for _, url := range forumMediaURLs(newContent) {
		if objectName, ok := s.storage.ParseObjectName(url); ok {
			keep[objectName] = true
		}
	}
	for _, objectName := range objects {
		if keep[objectName] {
			continue
		}
		if err := s.storage.DeleteObject(objectName); err != nil {
			log.Printf("[Forum] 清理帖子内已移除的媒体失败 object=%s err=%v", objectName, err)
			continue
		}
		log.Printf("[Forum] 已清理帖子内已移除的媒体: %s", objectName)
	}
}

// isAdmin 判断操作者是否管理员（与 comment_service 口径一致：非本人时回查角色）
func (s *ForumService) isAdmin(ctx context.Context, operatorID string) bool {
	operator, err := s.userRepo.FindByID(ctx, operatorID)
	return err == nil && operator != nil && operator.Role == "admin"
}

// UpdatePost 修改帖子：作者本人或管理员。
// 改完要清理这篇帖子目录里「新正文已经不再引用」的文件（用户删图/换图的情况），
// 否则那些文件会一直留在存储里，谁都看不见也删不掉。
func (s *ForumService) UpdatePost(ctx context.Context, id, operatorID, title, content string) (*model.ForumPost, error) {
	post, err := s.forumRepo.FindPostByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrPostNotFound
		}
		return nil, err
	}
	if post.UserID != operatorID && !s.isAdmin(ctx, operatorID) {
		return nil, ErrPostEditForbidden
	}

	title = strings.TrimSpace(title)
	if title == "" {
		return nil, ErrPostTitleEmpty
	}
	if len([]rune(title)) > forumTitleMaxRunes {
		return nil, ErrPostTitleTooLong
	}
	if len(content) > forumContentMaxBytes {
		return nil, ErrPostContentTooBig
	}
	clean := SanitizeForumHTML(content)
	if forumContentEmpty(clean) {
		return nil, ErrPostContentEmpty
	}

	if err := s.forumRepo.UpdatePost(ctx, post.ID, title, clean); err != nil {
		return nil, err
	}
	post.Title = title
	post.Content = clean

	s.cleanupContentMedia(ctx, post.ID, clean)
	return post, nil
}

// DeletePost 删帖：本人或管理员；连带删除该帖全部回复
func (s *ForumService) DeletePost(ctx context.Context, id, operatorID string) error {
	post, err := s.forumRepo.FindPostByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return ErrPostNotFound
		}
		return err
	}
	if post.UserID != operatorID && !s.isAdmin(ctx, operatorID) {
		return ErrPostForbidden
	}
	// 回复要在删行之前取出来：每条回复也有自己的媒体目录，删帖要连带删掉
	replies, err := s.forumRepo.ListRepliesForCleanup(ctx, post.ID)
	if err != nil {
		return err
	}

	if err := s.forumRepo.DeleteRepliesByPostID(ctx, post.ID); err != nil {
		return err
	}
	if err := s.forumRepo.DeletePost(ctx, post.ID); err != nil {
		return err
	}

	// 数据库删干净之后再清存储：帖子目录 + 各回复目录
	s.deleteMediaPrefix(ctx, post.ID)
	for _, reply := range replies {
		s.deleteMediaPrefix(ctx, reply.ID)
	}

	return nil
}

// DeleteReply 删回复：本人或管理员；同步回退帖子的回复数
func (s *ForumService) DeleteReply(ctx context.Context, id, operatorID string) error {
	reply, err := s.forumRepo.FindReplyByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return ErrReplyNotFound
		}
		return err
	}
	if reply.UserID != operatorID && !s.isAdmin(ctx, operatorID) {
		return ErrReplyForbidden
	}
	if err := s.forumRepo.DeleteReply(ctx, reply.ID); err != nil {
		return err
	}
	_ = s.forumRepo.AddReplyCount(ctx, reply.PostID, -1)

	s.deleteMediaPrefix(ctx, reply.ID)
	return nil
}

// SetPinned 置顶/取消置顶（仅管理员，权限在路由层用 RequireAdmin 控制）
func (s *ForumService) SetPinned(ctx context.Context, id string, pinned bool) error {
	if _, err := s.forumRepo.FindPostByID(ctx, id); err != nil {
		if err == gorm.ErrRecordNotFound {
			return ErrPostNotFound
		}
		return err
	}
	return s.forumRepo.SetPinned(ctx, id, pinned)
}