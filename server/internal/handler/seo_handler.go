package handler

import (
	"encoding/xml"
	"net/http"
	"strings"
	"time"

	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// SeoHandler 搜索引擎相关接口。
//
// 目前只做 sitemap.xml：robots.txt 是纯静态文件（web/public/robots.txt），
// 由前端镜像直接发，不经过后端。
type SeoHandler struct {
	showService  *service.ShowService
	forumService *service.ForumService
}

func NewSeoHandler(showService *service.ShowService, forumService *service.ForumService) *SeoHandler {
	return &SeoHandler{showService: showService, forumService: forumService}
}

// sitemapMaxItems 单次最多收录多少条。
// sitemap 协议上限是 5 万条 / 50MB，这里取一个远小于上限的量级：既覆盖当前内容规模，
// 也不会让响应体无谓地变大（真到几千条内容时，再改成分页 sitemap index 也不迟）。
const sitemapMaxItems = 2000

type sitemapURL struct {
	Loc     string `xml:"loc"`
	LastMod string `xml:"lastmod,omitempty"`
}

type sitemapURLSet struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

// Sitemap 动态生成 sitemap.xml。
//
// 只收录**无需登录就能看到内容**的页面，这也是 SEO 的唯一有效资产：
//   - /                 首页（公开作品列表）
//   - /forum            论坛列表（公开可读）
//   - /videos/:id       作品详情（公开）
//   - /forum/:id        帖子详情（公开）
//
// 需要登录的应用页（/projects、/project/:id、/ai-models、/admin）一律不收录：
// 它们对爬虫没有可读内容，反而会污染索引（robots.txt 里也 Disallow 了，见 web/public/robots.txt）。
//
// 作品走 showService.ListShows —— 仓储层已固定过滤 status='published'，
// 所以待审/被拒的作品不会被写进 sitemap。
func (h *SeoHandler) Sitemap(c *gin.Context) {
	base := siteBaseURL(c)
	// 静态页的 lastmod 用当天：它们的内容随部署变化，用当天比用固定日期更贴近事实
	today := time.Now().Format("2006-01-02")

	urls := []sitemapURL{
		{Loc: base + "/", LastMod: today},
		{Loc: base + "/forum", LastMod: today},
	}

	// 已发布作品 → /videos/:id
	// 单个数据源失败不影响整体：宁可少几条 URL，也不要因为库里一次抖动就让整份 sitemap 503
	if h.showService != nil {
		if shows, _, err := h.showService.ListShows(c.Request.Context(), "", "", 1, sitemapMaxItems); err == nil {
			for _, s := range shows {
				if s == nil || s.ID == "" {
					continue
				}
				urls = append(urls, sitemapURL{Loc: base + "/videos/" + s.ID, LastMod: s.UpdatedAt.Format("2006-01-02")})
			}
		}
	}

	// 论坛帖子 → /forum/:id
	if h.forumService != nil {
		if posts, _, err := h.forumService.ListPosts(c.Request.Context(), "", 1, sitemapMaxItems); err == nil {
			for _, p := range posts {
				if p.ID == "" {
					continue
				}
				urls = append(urls, sitemapURL{Loc: base + "/forum/" + p.ID, LastMod: p.UpdatedAt.Format("2006-01-02")})
			}
		}
	}

	body, err := xml.MarshalIndent(sitemapURLSet{
		Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs:  urls,
	}, "", "  ")
	if err != nil {
		c.String(http.StatusInternalServerError, "sitemap generation failed")
		return
	}

	c.Header("Content-Type", "application/xml; charset=utf-8")
	// 允许 CDN/浏览器缓存半小时：sitemap 不需要实时
	c.Header("Cache-Control", "public, max-age=1800")
	c.String(http.StatusOK, xml.Header+"\n"+string(body))
}

// siteBaseURL 站点基地址。
//
// 用请求头里的 Host 而不是写死域名：同一个后端还挂在 8880（备案期回退入口）上，
// 写死会让那份 sitemap 里出现跨域 URL。协议优先取反代透传的 X-Forwarded-Proto
// （nginx 里已配置），取不到时默认 https —— 反代到后端这一段是明文 HTTP，
// 直接看 c.Request.TLS 会把协议判成 http，那是错的。
func siteBaseURL(c *gin.Context) string {
	host := c.Request.Host
	if host == "" {
		host = "manwa.yunqueai.cloud"
	}
	scheme := "https"
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1") {
		scheme = "http"
	}
	return scheme + "://" + host
}