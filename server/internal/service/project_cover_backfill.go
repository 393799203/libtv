package service

import (
	"context"
	"encoding/json"
	"log"

	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

const (
	// coverBackfillDefaultLimit 单次默认处理的项目数
	coverBackfillDefaultLimit = 200
	// coverBackfillMaxLimit 单次上限。抽帧那条路每个项目要读一次远端视频、跑一次 ffmpeg，
	// 一次几百个已经是分钟级请求；再多应该由调用方拿 next_cursor 接着跑。
	coverBackfillMaxLimit = 500
	// coverBackfillSampleLimit 回传的样例条数：够人工抽查即可，没必要把整页回显
	coverBackfillSampleLimit = 20
	// coverBackfillMaxVideoCandidates 每个项目最多试抽几个视频。
	// 对象存储上的文件可能已经被删（实测有项目 8 个视频只剩 1 个），所以不能只试第一个；
	// 但每个候选都要下载一小段 + 跑一次 ffmpeg，必须有上限，否则一个项目就能拖住整批回填。
	coverBackfillMaxVideoCandidates = 3
	// coverBackfillMaxImageCandidates 每个项目最多往前找几张图。
	// 每张要探活缩略图和原图各一次（StatObject，走对象存储的 HEAD），也要封顶。
	coverBackfillMaxImageCandidates = 8
)

// CoverBackfillOptions 回填参数
type CoverBackfillOptions struct {
	// Limit 本次最多处理多少个项目（<=0 用默认值，超过上限按上限截断）
	Limit int
	// Cursor 游标：只处理 id 大于它的项目，传上一轮返回的 NextCursor
	Cursor string
	// DryRun 只统计与取样例，不写库、也不抽帧
	DryRun bool
	// ProjectIDs 指定要处理的项目（无视「当前有没有封面」）。
	// 用途：规则变更后重做**上一版回填写进去的**封面 —— 那些项目封面非空，
	// 默认的「只扫空封面」根本不会碰到它们。
	ProjectIDs []string
}

// CoverBackfillSample 单个项目的处理结果（人工抽查用）
type CoverBackfillSample struct {
	ProjectID   string `json:"project_id"`
	ProjectName string `json:"project_name"`
	// VideoURL 取到的、要抽尾帧的视频（source=video_last_frame 时有值）
	VideoURL string `json:"video_url,omitempty"`
	// ImageURL 取到的「最后一张图」原图地址（source=last_image 时，或尾帧失败退回时有值）
	ImageURL string `json:"image_url,omitempty"`
	// Source 封面取自哪里：video_last_frame / last_image
	Source string `json:"source,omitempty"`
	// CoverURL 实际写入（dry_run 时为「将要写入」）的封面地址。
	// 注意：source=video_last_frame 且 dry_run 时这里是空的 —— 尾帧要真抽才有地址，
	// 干跑阶段不抽帧（抽了就会落一个没人引用的孤儿对象）。
	CoverURL string `json:"cover_url,omitempty"`
	// Skipped 非空表示这个项目没写成，值是原因
	Skipped string `json:"skipped,omitempty"`
	// Note 非致命说明，例如「尾帧抽取失败，已退回最后一张图」
	Note string `json:"note,omitempty"`
}

// CoverBackfillResult 一轮回填的结果
type CoverBackfillResult struct {
	DryRun        bool                  `json:"dry_run"`
	Scanned       int                   `json:"scanned"`
	Filled        int                   `json:"filled"`
	FilledByVideo int                   `json:"filled_by_video"`
	FilledByImage int                   `json:"filled_by_image"`
	NoSource      int                   `json:"no_source"`
	Failed        int                   `json:"failed"`
	NextCursor    string                `json:"next_cursor"`
	Done          bool                  `json:"done"`
	Samples       []CoverBackfillSample `json:"samples"`
}

// CoverBackfillService 存量项目封面回填。
//
// 封面取值优先级（用户给定）：
//  1. 项目有视频 → 抽这条视频的**尾帧**当封面；
//  2. 没有视频 → 用画布里的**最后一张图**；
//  3. 两者都没有 → 不写，前端渲染渐变占位。
//
// 为什么不能直接用 generation_history 的 result_url：那张表存的是**产物**
// （视频行的 result_url 是视频本身），没有「这张封面该长什么样」的信息 ——
// 视频得真抽一帧，图片得回画布找。所以两条路都要回画布/历史里取素材。
type CoverBackfillService struct {
	projectRepo repository.ProjectRepo
	canvasRepo  repository.CanvasRepo
	historyRepo repository.GenerationHistoryRepo
	storage     storage.Storage
	// imageOps 抽尾帧用（本机 ffmpeg）。为 nil 时视频项目只能退回「最后一张图」。
	imageOps *ImageOpsService
}

func NewCoverBackfillService(
	projectRepo repository.ProjectRepo,
	canvasRepo repository.CanvasRepo,
	historyRepo repository.GenerationHistoryRepo,
	storage storage.Storage,
	imageOps *ImageOpsService,
) *CoverBackfillService {
	return &CoverBackfillService{
		projectRepo: projectRepo,
		canvasRepo:  canvasRepo,
		historyRepo: historyRepo,
		storage:     storage,
		imageOps:    imageOps,
	}
}

// Run 跑一轮回填。
//
// 幂等：只处理 cover_url 为空的**存量**项目，补上的下一轮就不会再出现，
// 因此可以用同一个 cursor 反复调，直到 Done 为 true。
// 指定了 ProjectIDs 时改为「按 id 精确重做」，不受封面是否为空影响。
func (s *CoverBackfillService) Run(ctx context.Context, opts CoverBackfillOptions) (*CoverBackfillResult, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = coverBackfillDefaultLimit
	}
	if limit > coverBackfillMaxLimit {
		limit = coverBackfillMaxLimit
	}

	projects, err := s.loadTargets(ctx, opts, limit)
	if err != nil {
		return nil, err
	}

	res := &CoverBackfillResult{
		DryRun:     opts.DryRun,
		Scanned:    len(projects),
		NextCursor: opts.Cursor,
		Samples:    make([]CoverBackfillSample, 0, 4),
	}
	for _, p := range projects {
		sample := s.backfillOne(ctx, p, opts.DryRun)
		switch {
		case sample.Skipped == "" && sample.Source == "video_last_frame":
			res.Filled++
			res.FilledByVideo++
		case sample.Skipped == "":
			res.Filled++
			res.FilledByImage++
		case sample.Skipped == "no_source":
			res.NoSource++
		default:
			res.Failed++
		}
		if len(res.Samples) < coverBackfillSampleLimit {
			res.Samples = append(res.Samples, sample)
		}
		// 游标推进到「已扫描过」的最后一个项目（不管有没有补成功）：
		// 补不上的项目留在结果集里也没用，下一轮重新扫一遍只是白花查询
		if len(opts.ProjectIDs) == 0 {
			res.NextCursor = p.ID
		}
	}
	// 取回的项目数不足一页 ⇒ 已经没有更多待回填的项目了
	res.Done = len(projects) < limit || len(opts.ProjectIDs) > 0

	log.Printf("[CoverBackfill] dry_run=%v cursor=%q ids=%d scanned=%d filled=%d(视频%d/图片%d) no_source=%d failed=%d done=%v",
		res.DryRun, opts.Cursor, len(opts.ProjectIDs), res.Scanned, res.Filled,
		res.FilledByVideo, res.FilledByImage, res.NoSource, res.Failed, res.Done)
	return res, nil
}

// loadTargets 取这一轮要处理的项目：指定了 id 就按 id 取（无视封面现状），
// 否则按「还没有封面」游标分页扫。
func (s *CoverBackfillService) loadTargets(ctx context.Context, opts CoverBackfillOptions, limit int) ([]*model.Project, error) {
	if len(opts.ProjectIDs) > 0 {
		out := make([]*model.Project, 0, len(opts.ProjectIDs))
		for _, id := range opts.ProjectIDs {
			if id == "" {
				continue
			}
			p, err := s.projectRepo.FindByID(ctx, id)
			if err != nil || p == nil {
				// 单个 id 查不到不该毁掉整批：跳过，让调用方从 scanned 对不上号时能发现
				log.Printf("[CoverBackfill] 指定项目查不到: id=%s err=%v", id, err)
				continue
			}
			out = append(out, p)
		}
		return out, nil
	}
	return s.projectRepo.ListMissingCover(ctx, opts.Cursor, limit)
}

// backfillOne 处理单个项目，返回可直接回显的样例（不返回 error：一个项目失败不该中断整批）
func (s *CoverBackfillService) backfillOne(ctx context.Context, p *model.Project, dryRun bool) CoverBackfillSample {
	sample := CoverBackfillSample{ProjectID: p.ID, ProjectName: p.Name}

	canvas, err := s.canvasRepo.FindByProjectID(ctx, p.ID)
	if err != nil {
		sample.Skipped = "no_canvas"
		return sample
	}
	parsed, err := parseBackfillCanvas(canvas.Content)
	if err != nil {
		sample.Skipped = "bad_canvas"
		log.Printf("[CoverBackfill] 画布解析失败: projectID=%s err=%v", p.ID, err)
		return sample
	}

	// ① 有视频 → 抽尾帧。这是用户点名的第一优先级。
	//
	// 候选要**逐个试**：对象存储上的文件可能已经不存在了（实测有个项目画布里的
	// 8 个视频只剩 1 个、17 张图全没了），只试第一个候选就会误判成「这个项目没有视频」，
	// 白白降级成素材图；也可能试到一半才发现文件被删。
	videos := s.videoCandidates(ctx, p.ID, parsed)
	if len(videos) > 0 {
		sample.VideoURL = videos[0]
		sample.Source = "video_last_frame"
		if dryRun {
			// 干跑不抽帧：抽帧会落一个对象，而干跑承诺「不写任何东西」。
			// 但可以**只探活不下载**，把已经不存在的候选跳过去 —— 否则样例里报的是
			// 第一个候选，而它很可能正是那个被删掉的文件（实测项目里 8 个视频只剩 1 个），
			// 干跑看起来一切正常，真跑却一个个失败。
			for i, videoURL := range videos {
				if i >= coverBackfillMaxVideoCandidates {
					break
				}
				sample.VideoURL = videoURL
				if s.objectExists(videoURL) {
					break
				}
			}
			// 仍然给不出 cover_url：那一帧要真抽出来才有地址
			return sample
		}
		if s.imageOps == nil {
			sample.Note = "抽帧服务未启用，退回最后一张图"
		} else {
			for i, videoURL := range videos {
				if i >= coverBackfillMaxVideoCandidates {
					break
				}
				sample.VideoURL = videoURL
				tile, ferr := s.imageOps.CaptureLastFrameAsCover(ctx, videoURL, UploadOptions{
					Dir:       canvasDirOf(p),
					ProjectID: p.ID,
				})
				if ferr != nil || tile == nil {
					log.Printf("[CoverBackfill] 抽尾帧失败，换下一个候选: projectID=%s video=%s err=%v", p.ID, videoURL, ferr)
					continue
				}
				cover := tile.ThumbURL
				if cover == "" {
					cover = tile.URL
				}
				if uerr := s.projectRepo.BackfillCover(ctx, p.ID, cover); uerr != nil {
					sample.Skipped = "update_failed"
					log.Printf("[CoverBackfill] 写封面失败: projectID=%s cover=%s err=%v", p.ID, cover, uerr)
					return sample
				}
				sample.CoverURL = cover
				return sample
			}
			sample.Note = "所有视频候选都抽不出帧，退回最后一张图"
		}
		// 抽帧失败：落到 ② 用图片兜住（宁可降级，也不要空着）。
		// 保留 sample.VideoURL 不清 —— 它就是「本来想抽的那条视频」，排障时要看这个；
		// Source 会被 ② 覆盖成 last_image，反映封面**实际**来自哪里。
		sample.Source = ""
		if sample.Note == "" {
			sample.Note = "抽帧失败，退回最后一张图"
		}
	}

	// ② 没有视频（或视频候选都抽不出帧）→ 用画布里最后一张**确实还在**的图。
	//
	// 逐个往前找，而不是只试最后一张：最后那张图的产物可能也已经被清理掉了，
	// 这时要往前退到还有文件的那张（cardCoverURL 现在会把「对象已不在」判成空串）。
	for i, imageURL := range parsed.imageCandidates() {
		if i >= coverBackfillMaxImageCandidates {
			break
		}
		cover := cardCoverURL(s.storage, imageURL)
		if cover == "" {
			continue
		}
		sample.ImageURL = imageURL
		sample.Source = "last_image"
		sample.CoverURL = cover
		if dryRun {
			return sample
		}
		// 用 BackfillCover 而不是 UpdateCover：后者会推 updated_at，
		// 一次回填几百个项目会把它们全顶到「最近项目」最前面（见 repo 里的注释）。
		if err := s.projectRepo.BackfillCover(ctx, p.ID, cover); err != nil {
			sample.Skipped = "update_failed"
			log.Printf("[CoverBackfill] 写封面失败: projectID=%s cover=%s err=%v", p.ID, cover, err)
			return sample
		}
		return sample
	}

	// ③ 两者都没有：不写，前端渲染渐变占位。
	// 覆盖两种情形：画布里本来就没有图片/视频；有但对应的文件全都已经不在存储上了。
	sample.Skipped = "no_source"
	return sample
}

// objectExists 只探活对象在不在（一次 HEAD），不下载内容。
// 干跑阶段用它挑出还活着的视频候选；storage 未配置或不是本站地址时一律当「不在」。
func (s *CoverBackfillService) objectExists(rawURL string) bool {
	if s.storage == nil || rawURL == "" {
		return false
	}
	obj, ok := s.storage.ParseObjectName(rawURL)
	if !ok {
		return false
	}
	_, err := s.storage.StatObject(obj)
	return err == nil
}

// videoCandidates 按「越接近最后一次生成越靠前」列出可以拿来抽尾帧的视频地址，已去重。
//
// 顺序：生成历史里最新那条视频 → 画布里从后往前的视频节点（节点数组大体按创建顺序追加）。
// 为什么不是一个地址：这些地址指向的对象可能已经被删（实测有个项目 8 个视频只剩 1 个，
// 而剩下的那个恰好**不是**生成历史里最新的那条）。只取一个候选就会误判成「没有视频」，
// 而多列几个候选，抽帧那边失败一个还能接着试下一个。
//
// 不校验节点是否还在画布里：视频已经落在对象存储上，节点删掉也照样能抽帧。
func (s *CoverBackfillService) videoCandidates(ctx context.Context, projectID string, parsed *backfillCanvas) []string {
	out := make([]string, 0, 4)
	seen := make(map[string]bool, 4)
	add := func(u string) {
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, u)
	}

	if s.historyRepo != nil {
		if h, err := s.historyRepo.LatestNodeByProjectType(ctx, projectID, "video"); err == nil && h != nil {
			add(h.ResultURL)
		}
	}
	for i := len(parsed.Nodes) - 1; i >= 0; i-- {
		if n := &parsed.Nodes[i]; n.Type == "video" {
			add(n.Data.VideoURL)
		}
	}
	return out
}

// canvasDirOf 与运行时一致的画布目录（engine.ExecutionContext.GetCanvasDir）：
// 抽出来的尾帧要和画布产物放在一起，项目删除时才能被同一套前缀清理带走。
func canvasDirOf(p *model.Project) string {
	if p.UserID != "" {
		return "users/" + p.UserID + "/canvas"
	}
	return "canvas"
}

// ---------------------------------------------------------------------------
// 画布解析
// ---------------------------------------------------------------------------

// backfillCanvas 回填只需要画布里的三类信息：节点类型、视频节点的产物地址、图片节点的图片地址。
//
// 为什么不复用 engine.CanvasDSL：engine 反向依赖 service（执行器用 FileUploadService 等），
// service 再引 engine 就成环。repository/canvas_repo.go 处理同样的冲突时也是这个办法
// （用最小结构体/map 解析，不依赖 engine 的 DSL 类型）。
type backfillCanvas struct {
	Nodes []backfillNode `json:"nodes"`
	Edges []backfillEdge `json:"edges"`

	byID map[string]*backfillNode
}

type backfillNode struct {
	ID   string `json:"id"`
	Type string `json:"type"` // text/image/video/audio/script/previz/enhance
	Data struct {
		VideoURL string `json:"videoUrl"`
		ImageURL string `json:"imageUrl"`
		// Mentions 提示词里 @ 引用的上游素材（这里只用来兜底取图，见 lastImageURL 的说明）
		Mentions []struct {
			NodeID   string `json:"nodeId"`
			NodeType string `json:"nodeType"`
			ImageURL string `json:"imageUrl"`
		} `json:"mentions"`
	} `json:"data"`
}

type backfillEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

func parseBackfillCanvas(raw []byte) (*backfillCanvas, error) {
	var c backfillCanvas
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	c.byID = make(map[string]*backfillNode, len(c.Nodes))
	for i := range c.Nodes {
		if c.Nodes[i].ID != "" {
			c.byID[c.Nodes[i].ID] = &c.Nodes[i]
		}
	}
	return &c, nil
}

// imageCandidates 列出画布里的图片地址，**从最后一张往前**。
//
// 「最后一张」按节点在数组里的位置算（前端追加节点，位置大体等于创建顺序），
// 也就是用户最近产出的那张图 —— 与「最后一次生成视频的尾帧」是同一个直觉。
// 返回整个列表而不是单张，是因为靠前的那几张对应的文件可能已经被清理掉了，
// 调用方要能继续往前找还有文件的那一张。
func (c *backfillCanvas) imageCandidates() []string {
	out := make([]string, 0, 4)
	seen := make(map[string]bool, 4)
	for i := len(c.Nodes) - 1; i >= 0; i-- {
		n := &c.Nodes[i]
		if n.Type != "image" || n.Data.ImageURL == "" || seen[n.Data.ImageURL] {
			continue
		}
		seen[n.Data.ImageURL] = true
		out = append(out, n.Data.ImageURL)
	}
	return out
}
