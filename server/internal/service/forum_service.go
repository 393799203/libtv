package service

import (
	"context"
	"regexp"
	"strings"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

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
	ErrPostForbidden     = apperror.New(403, 403, "只能删除自己的帖子")
	ErrReplyEmpty        = apperror.New(400, 400, "回复内容不能为空")
	ErrReplyTooBig       = apperror.New(400, 400, "回复太长了，请精简后重试")
	ErrReplyNotFound     = apperror.New(404, 404, "回复不存在")
	ErrReplyForbidden    = apperror.New(403, 403, "只能删除自己的回复")
)

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
}

func NewForumService(forumRepo repository.ForumRepo, userRepo repository.UserRepo) *ForumService {
	return &ForumService{forumRepo: forumRepo, userRepo: userRepo}
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
func (s *ForumService) CreatePost(ctx context.Context, userID, title, content string) (*model.ForumPost, error) {
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

	post := &model.ForumPost{UserID: userID, Title: title, Content: clean}
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
func (s *ForumService) CreateReply(ctx context.Context, postID, userID, content, replyToNickname string) (*model.ForumReply, error) {
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

	reply := &model.ForumReply{
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

// isAdmin 判断操作者是否管理员（与 comment_service 口径一致：非本人时回查角色）
func (s *ForumService) isAdmin(ctx context.Context, operatorID string) bool {
	operator, err := s.userRepo.FindByID(ctx, operatorID)
	return err == nil && operator != nil && operator.Role == "admin"
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
	if err := s.forumRepo.DeleteRepliesByPostID(ctx, post.ID); err != nil {
		return err
	}
	return s.forumRepo.DeletePost(ctx, post.ID)
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