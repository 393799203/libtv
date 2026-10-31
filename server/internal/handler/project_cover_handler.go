package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// ProjectCoverHandler 项目封面维护接口（仅管理员）
type ProjectCoverHandler struct {
	backfill *service.CoverBackfillService
}

func NewProjectCoverHandler(backfill *service.CoverBackfillService) *ProjectCoverHandler {
	return &ProjectCoverHandler{backfill: backfill}
}

// BackfillCovers 给项目补封面：有视频抽**视频尾帧**，没视频用**最后一张图**，都没有则不写。
//
//	POST /api/admin/projects/backfill-covers?limit=200&cursor=<上一轮的 next_cursor>&dry_run=1
//	POST /api/admin/projects/backfill-covers?project_ids=id1,id2   # 规则变更后按 id 重做
//
// 为什么要这个接口：封面是视频生成成功那一刻才写进去的，在这之前产出的项目封面全空，
// 前端只能渲染占位图 —— 老用户不手动改一次项目就永远看不到自己项目的样子。
//
// 为什么要 project_ids：规则变过一次（第一版用的是「本次生成用的第一张素材图」，
// 现在改成「视频尾帧」）。那些已经被上一版写下封面的项目，默认的「只扫空封面」
// 根本不会碰到，只能按 id 精确重做。
//
// 为什么要 dry_run：干跑只统计、不写库、也**不抽帧**（抽帧会落一个没人引用的孤儿对象）。
// 代价是视频类项目的样例给不出 cover_url，只给出将要抽帧的 video_url。
//
// 为什么要 cursor：一轮处理不完（默认 200，上限 500），返回的 next_cursor 传给下一轮；
// done 为 true 表示已经扫完。
func (h *ProjectCoverHandler) BackfillCovers(c *gin.Context) {
	if h.backfill == nil {
		response.Fail(c, http.StatusServiceUnavailable, "回填服务未启用")
		return
	}

	opts := service.CoverBackfillOptions{
		Cursor: strings.TrimSpace(c.Query("cursor")),
		DryRun: c.Query("dry_run") == "1" || strings.EqualFold(c.Query("dry_run"), "true"),
	}
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		opts.Limit = v
	}
	// project_ids=id1,id2：按 id 精确重做，无视当前有没有封面
	if raw := strings.TrimSpace(c.Query("project_ids")); raw != "" {
		for _, id := range strings.Split(raw, ",") {
			if id = strings.TrimSpace(id); id != "" {
				opts.ProjectIDs = append(opts.ProjectIDs, id)
			}
		}
	}

	res, err := h.backfill.Run(c.Request.Context(), opts)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "回填失败: "+err.Error())
		return
	}

	log.Printf("[BackfillCovers] dry_run=%v cursor=%q ids=%d scanned=%d filled=%d(视频%d/图片%d) no_source=%d failed=%d done=%v next=%q",
		res.DryRun, opts.Cursor, len(opts.ProjectIDs), res.Scanned, res.Filled,
		res.FilledByVideo, res.FilledByImage, res.NoSource, res.Failed, res.Done, res.NextCursor)

	response.OKWithMsg(c, "回填完成", res)
}
