package service

import (
	"context"
	"fmt"
	"log"

	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

type ProjectService struct {
	projectRepo   repository.ProjectRepo
	canvasRepo    repository.CanvasRepo
	executionRepo repository.ExecutionRepo
	aiTaskRepo    repository.AITaskRepo
	storage       storage.Storage
}

func NewProjectService(
	projectRepo repository.ProjectRepo,
	canvasRepo repository.CanvasRepo,
	executionRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
	storage storage.Storage,
) *ProjectService {
	return &ProjectService{
		projectRepo:   projectRepo,
		canvasRepo:    canvasRepo,
		executionRepo: executionRepo,
		aiTaskRepo:    aiTaskRepo,
		storage:       storage,
	}
}

func (s *ProjectService) Create(ctx context.Context, userID string, name, description string) (*model.Project, error) {
	project := &model.Project{
		UserID:      userID,
		Name:        name,
		Description: description,
	}
	if err := s.projectRepo.Create(ctx, project); err != nil {
		return nil, err
	}

	// 创建默认空画布
	canvas := &model.Canvas{
		ProjectID: project.ID,
		Content:   []byte(`{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`),
		Version:   1,
	}
	if err := s.canvasRepo.Save(ctx, canvas); err != nil {
		return nil, err
	}

	return project, nil
}

func (s *ProjectService) GetByID(ctx context.Context, id string) (*model.Project, error) {
	return s.projectRepo.FindByID(ctx, id)
}

// SetCoverFromMaterial 把一张素材图设为项目封面（项目卡片展示用）。
//
// 调用方（引擎）只负责挑「该用哪张图」，这里负责把它规整成适合当封面的地址并落库。
// 失败只返回 error 供调用方记日志：封面是展示信息，任何情况下都不该影响出片。
func (s *ProjectService) SetCoverFromMaterial(ctx context.Context, projectID, rawURL string) error {
	if projectID == "" || rawURL == "" {
		return nil
	}
	cover := cardCoverURL(s.storage, rawURL)
	if cover == "" {
		// 非本站存储的地址一律不采用：封面会在项目列表页被浏览器直接请求，
		// 收外链等于把「用户打开了自己的列表」这件事通知给第三方域名。
		// 画布里的产物本来就都在本站存储，正常不会走到这里。
		return fmt.Errorf("封面不是本站存储地址，跳过: %s", rawURL)
	}
	return s.projectRepo.UpdateCover(ctx, projectID, cover)
}

// SetCover 把「已经是封面尺寸、且已确认可展示」的地址直接写成项目封面。
//
// 与 SetCoverFromMaterial 的分工：那个收的是**素材原图**，要先换成 640px 缩略图再写；
// 这里收的是视频尾帧落盘时**顺手生成的缩略图地址**（见 CaptureLastFrameAsCover），
// 再走一遍缩略图推导只会得到 xxx.thumb.thumb.webp 这种不存在的路径。
//
// 仍然校验一次「是不是本站存储」：封面会在项目列表页被浏览器直接请求，
// 收外链等于把「用户打开了自己的列表」通知给第三方域名。
func (s *ProjectService) SetCover(ctx context.Context, projectID, coverURL string) error {
	if projectID == "" || coverURL == "" {
		return nil
	}
	if s.storage != nil {
		if _, ok := s.storage.ParseObjectName(coverURL); !ok {
			return fmt.Errorf("封面不是本站存储地址，跳过: %s", coverURL)
		}
	}
	return s.projectRepo.UpdateCover(ctx, projectID, coverURL)
}

// cardCoverURL 把原图地址换成卡片封面地址：优先 640px 缩略图（命名约定见 ThumbnailObjectName），
// 缩略图不存在时回退原图；**两者都不存在就返回空串**（宁可不写封面，也不写一个必然 404 的地址）。
//
// 为什么要换：卡片只有 128px 高，而原图动辄 1.9MB —— 一张卡片一次全量下载。
// 为什么要探活：缩略图是上传/生成时"顺手"写的，可能不存在（历史数据、那次请求没走完），
// 照约定拼一个不存在的地址会得到破图。
// 为什么回退原图也要探活：原图同样可能已经不在了（项目素材被清理、对象被删）。
// 这里踩过一次真实的坑：某项目画布里 17 张图 + 8 个视频的对象全被删光，
// 但画布 JSON 里还留着地址，不探活就会把一张 404 的图写成封面。
//
// 返回空串的两种含义由调用方区分：ParseObjectName 失败 = 不是本站存储（不该采用），
// 探活失败 = 本站存储但对象已不在（换个素材或干脆留空）。调用方现在的处理都是「留空/换候选」，
// 所以不额外区分错误类型。
//
// 做成包级函数而不是方法：存量回填（CoverBackfillService）要用同一套规整逻辑，
// dry_run 时只算不写，也需要单独调用它。
func cardCoverURL(st storage.Storage, rawURL string) string {
	if st == nil {
		return ""
	}
	objectName, ok := st.ParseObjectName(rawURL)
	if !ok {
		return ""
	}
	thumbObject := ThumbnailObjectName(objectName)
	if _, err := st.StatObject(thumbObject); err == nil {
		return st.GetURL(thumbObject)
	}
	if _, err := st.StatObject(objectName); err == nil {
		return st.GetURL(objectName)
	}
	return ""
}

func (s *ProjectService) ListByUserID(ctx context.Context, userID string, page, pageSize int) ([]*model.Project, int64, error) {
	offset := (page - 1) * pageSize
	return s.projectRepo.ListByUserID(ctx, userID, offset, pageSize)
}

func (s *ProjectService) Update(ctx context.Context, id string, name, description string) (*model.Project, error) {
	project, err := s.projectRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		project.Name = name
	}
	if description != "" {
		project.Description = description
	}
	if err := s.projectRepo.Update(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

func (s *ProjectService) Delete(ctx context.Context, id string) error {
	log.Printf("[ProjectService] 开始删除项目: projectID=%s", id)

	// 0. 先查项目拿属主用户ID（画布文件存于 users/<userID>/canvas/<projectID>/，需在删除项目记录前获取）
	ownerUserID := ""
	if project, err := s.projectRepo.FindByID(ctx, id); err == nil && project != nil {
		ownerUserID = project.UserID
	}

	// 1. 查询项目的所有 WorkflowExecution 记录
	executions, err := s.executionRepo.ListByProjectID(ctx, id)
	if err != nil {
		return err
	}

	// 2. 删除这些 WorkflowExecution 对应的所有 AITask 记录
	if len(executions) > 0 {
		executionIDs := make([]int64, len(executions))
		for i, exec := range executions {
			executionIDs[i] = exec.ID
		}
		if err := s.aiTaskRepo.DeleteByExecutionIDs(ctx, executionIDs); err != nil {
			return err
		}
		log.Printf("[ProjectService] 删除 AITask 记录: count=%d", len(executionIDs))
	}

	// 3. 删除 WorkflowExecution 记录
	if err := s.executionRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}
	log.Printf("[ProjectService] 删除 WorkflowExecution 记录")

	// 4. 删除关联的画布
	if err := s.canvasRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}
	log.Printf("[ProjectService] 删除 Canvas 记录")

	// 5. 删除存储中的项目目录：新路径 users/<userID>/canvas/<projectID>/，
	// 旧路径 canvas/<projectID>/ 一并清理（历史数据兼容）
	prefixes := []string{"canvas/" + id + "/"}
	if ownerUserID != "" {
		prefixes = append(prefixes, "users/"+ownerUserID+"/canvas/"+id+"/")
	}
	for _, prefix := range prefixes {
		if err := s.storage.DeleteObjectsByPrefix(prefix); err != nil {
			log.Printf("[ProjectService] 删除存储目录失败: prefix=%s err=%v", prefix, err)
			// 不中断流程，继续删除项目记录
		} else {
			log.Printf("[ProjectService] 删除存储目录成功: prefix=%s", prefix)
		}
	}

	// 6. 删除项目记录
	if err := s.projectRepo.Delete(ctx, id); err != nil {
		return err
	}

	log.Printf("[ProjectService] 项目删除完成: projectID=%s", id)
	return nil
}
