package repository

import (
	"context"
	"strings"
	"time"

	"libtv/internal/model"
	"libtv/internal/pkg/textcut"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ProviderTaskRepo 上游任务对账表仓库。
//
// 只做一件事：按任务号 upsert。同一上游任务会被多次写入（下发 → 失败/退费 → 续查…），
// 但**同一任务号只留一行**，状态与退费金额取最新 —— 这样一次生成怎么走完的
// 全部事实都在一行里，对账时不必再去拼日志。
type ProviderTaskRepo interface {
	Upsert(ctx context.Context, task *model.ProviderTask) error
	ListByTaskID(ctx context.Context, taskID string) (*model.ProviderTask, error)
	ListByProject(ctx context.Context, projectID string, limit int) ([]model.ProviderTask, error)
	// List 后台对账列表：按状态/项目/用户/任务号筛选，分页返回。
	// 排序固定「待人工退费优先、其次已退费，再按时间倒序」，并补齐项目名/用户名。
	List(ctx context.Context, filter ProviderTaskFilter) ([]ProviderTaskView, int64, error)
	// Stats 按当前筛选条件汇总：各状态条数 + 扣费/退费积分合计
	Stats(ctx context.Context, filter ProviderTaskFilter) (ProviderTaskStats, error)
	// ClaimForRefund 把一条「待人工决定」的任务原子地占住（CAS），返回该行。
	// 占位方式是把 refunded_amount 先写成扣费金额（状态不动，界面不会多出一个中间态）；
	// 已交付 / 已退费 / 没有扣费的行占不住（返回 nil）—— 人工退费绝不能重复退或退已交付的。
	ClaimForRefund(ctx context.Context, id int64, operator, note string) (*model.ProviderTask, error)
	// RevertRefund 退费失败时把行放回「待人工退费」（钱没退成功就不能显示成已退费）
	RevertRefund(ctx context.Context, id int64, note string) error
	// MarkRefundedFromClaim 占住之后退费成功：落终态与操作人
	MarkRefundedFromClaim(ctx context.Context, id int64, note string) error
	// SetAlert 一致性自检结果落库：alert 为空表示恢复正常（清标记）。
	// reason 为中文说明，会以固定前缀追加进备注；同一行的旧自动段落会被替换，不会重复堆积，
	// 也不会碰管理员手写的备注内容。
	SetAlert(ctx context.Context, id int64, alert, reason string) error
	// AlertedRows 当前被标记为异常的行（自检用来对比「该标记」与「已标记」，避免重复写库）
	AlertedRows(ctx context.Context) (map[int64]string, error)
}

// ProviderTaskView 对账列表的一行：除对账本身的事实外，补上给人看的名称
// （项目名、用户昵称/邮箱）。名称不落库、查询时批量补齐，避免对账表跟着改名跑。
type ProviderTaskView struct {
	model.ProviderTask
	ProjectName string `json:"project_name"`
	// ProjectNameSnapshot 项目被删除后仍能认出「这是哪个项目」的名称快照
	ProjectNameSnapshot string `json:"project_name_snapshot"`
	// UserName 昵称，UserEmail 邮箱（昵称可能为空，展示时优先昵称、其次邮箱）
	UserName  string `json:"user_name"`
	UserEmail string `json:"user_email"`
	// UpstreamTaskID 只有真·上游任务号才有值。
	// 同步调用（图片/文本/剧本/音频/白模解析）和「创建阶段就失败、没拿到任务号」的视频，
	// 库里那些以 sync: 开头的编号是我们自己造的对账 key，不是上游任务号，
	// 界面上不能当成任务号展示（用户会拿它去渠道后台查，根本查不到）。
	UpstreamTaskID string `json:"upstream_task_id"`
}

// ProviderTaskFilter 对账列表筛选条件（空值表示不筛）
type ProviderTaskFilter struct {
	Status string
	// OnlyAlert 只看异常行（一致性自检标记出来的）
	OnlyAlert bool
	TaskKind  string
	ProjectID string
	UserID    string
	TaskID    string
	Page      int
	PageSize  int
}

// ProviderTaskStats 对账汇总
type ProviderTaskStats struct {
	Total         int64 `json:"total"`
	Delivered     int64 `json:"delivered"`
	Failed        int64 `json:"failed"`
	PendingReview int64 `json:"pending_review"`
	Refunded      int64 `json:"refunded"`
	// AutoRefunded / ManualRefunded 已退费拆两类：
	// auto = 上游明确拒绝（上游不计费，我们没成本）；manual = 人工判断后退（可能已计费，真成本）
	AutoRefunded   int64 `json:"auto_refunded"`
	ManualRefunded int64 `json:"manual_refunded"`
	Submitted      int64 `json:"submitted"`
	// Alerted 一致性自检标出来的异常行数（只提示，不代表钱的状态被改过）
	Alerted        int64 `json:"alerted"`
	ChargedCredits int64 `json:"charged_credits"`
	RefundedCredit int64 `json:"refunded_credits"`
}

type providerTaskRepo struct {
	db *gorm.DB
}

// NewProviderTaskRepo 创建上游任务对账表仓库
func NewProviderTaskRepo(db *gorm.DB) ProviderTaskRepo {
	return &providerTaskRepo{db: db}
}

func (r *providerTaskRepo) Upsert(ctx context.Context, task *model.ProviderTask) error {
	if task == nil || task.TaskID == "" {
		return nil
	}
	// 项目名快照：只在写入时补一次。项目以后被删掉，这行仍认得出来是哪个项目
	// （对账行是永久记录，项目不是 —— 线上已经出现过删项目后整行认不出来的情况）。
	if task.ProjectID != "" && task.ProjectName == "" {
		var name string
		if err := r.db.WithContext(ctx).Model(&model.Project{}).
			Select("name").Where("id = ?", task.ProjectID).Scan(&name).Error; err == nil {
			task.ProjectName = name
		}
	}
	// 退款事实是「只能增」的：refunded_amount 取旧值和新值的较大者，refund_source 一旦
	// 写上就不再清空。理由有两条，都是钱：
	//  1. 人工退费的原子占位就是靠 refunded_amount 不为 0，若并发的引擎/看门狗写入把它清零，
	//     同一笔扣费能被占位两次 → 退两次；取较大值后这条路被堵死。
	//  2. 上游任务晚到的「已交付」写入不能把已经退给用户的那笔钱抹成 0
	//     （退费账单已经产生了，对账表显示没退，运营就会照着重退一次）。
	refundedAmountExpr := gorm.Expr("GREATEST(provider_tasks.refunded_amount, EXCLUDED.refunded_amount)")
	refundSourceExpr := gorm.Expr("CASE WHEN EXCLUDED.refund_source <> '' THEN EXCLUDED.refund_source ELSE provider_tasks.refund_source END")
	onConflict := clause.OnConflict{
		Columns: []clause.Column{{Name: "task_id"}},
		// 每次写入都是一份「更完整/更新」的现场：只更新有值的字段会留下半截记录，
		// 所以这里整体覆盖（退款两列例外，见上）；调用方必须传完整行。
		DoUpdates: clause.Assignments(map[string]interface{}{
			"provider":           gorm.Expr("EXCLUDED.provider"),
			"model":              gorm.Expr("EXCLUDED.model"),
			"exec_id":            gorm.Expr("EXCLUDED.exec_id"),
			"node_id":            gorm.Expr("EXCLUDED.node_id"),
			"user_id":            gorm.Expr("EXCLUDED.user_id"),
			"project_id":         gorm.Expr("EXCLUDED.project_id"),
			"status":             gorm.Expr("EXCLUDED.status"),
			"charged_amount":     gorm.Expr("EXCLUDED.charged_amount"),
			"note":               gorm.Expr("EXCLUDED.note"),
			"charge_resolution":  gorm.Expr("EXCLUDED.charge_resolution"),
			"charge_seconds":     gorm.Expr("EXCLUDED.charge_seconds"),
			"charge_ref_seconds": gorm.Expr("EXCLUDED.charge_ref_seconds"),
			"task_kind":          gorm.Expr("EXCLUDED.task_kind"),
			"result_url":         gorm.Expr("EXCLUDED.result_url"),
			"provider_url":       gorm.Expr("EXCLUDED.provider_url"),
			"refunded_amount":    refundedAmountExpr,
			"refund_source":      refundSourceExpr,
			"updated_at":         gorm.Expr("EXCLUDED.updated_at"),
		}),
	}
	// 交付/退费是既成事实，不能被随后补写的「非终态」抹回去
	//（否则对账表会把已经交付或已经退过费的任务显示成进行中/待退费，人工照着重退一次就真退重了）
	switch task.Status {
	case "refunded":
		// 退费终态：谁都不许改
		onConflict.Where = clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "provider_tasks.status <> ?", Vars: []interface{}{"refunded"}},
		}}
	case "delivered":
		// 交付写入：允许从进行中/待复核升级为已交付，但不许覆盖「已退费」
		onConflict.Where = clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "provider_tasks.status <> ?", Vars: []interface{}{"refunded"}},
		}}
	default:
		onConflict.Where = clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "provider_tasks.status NOT IN ?", Vars: []interface{}{[]string{"delivered", "failed", "refunded"}}},
		}}
	}
	return r.db.WithContext(ctx).Clauses(onConflict).Create(task).Error
}

// applyFilter 组装筛选条件（列表与统计共用，保证两者口径一致）
func (r *providerTaskRepo) applyFilter(q *gorm.DB, filter ProviderTaskFilter) *gorm.DB {
	if filter.OnlyAlert {
		q = q.Where("coalesce(alert, '') <> ''")
	}
	if filter.Status != "" {
		q = q.Where("status = ?", filter.Status)
	}
	if filter.ProjectID != "" {
		// 项目名或项目 ID，都支持**部分输入**：
		//   - 名字模糊匹配（运营手里常常只有项目名）；
		//   - ID 模糊匹配 + 忽略连字符（UUID 从各种地方复制过来常常没带 "-"，或者只贴了其中一段）；
		//   - 大小写不敏感（UUID 里可能有十六进制大写字母）。
		kw := "%" + filter.ProjectID + "%"
		noDash := "%" + strings.ReplaceAll(filter.ProjectID, "-", "") + "%"
		q = q.Where(
			"project_id ILIKE ? OR replace(project_id, '-', '') ILIKE ? OR project_id IN (?)",
			kw, noDash,
			r.db.Model(&model.Project{}).Select("id").Where("name ILIKE ?", kw))
	}
	if filter.UserID != "" {
		// 昵称 / 邮箱 / 用户 ID 都支持部分输入（与项目筛选同一口径）
		kw := "%" + filter.UserID + "%"
		noDash := "%" + strings.ReplaceAll(filter.UserID, "-", "") + "%"
		q = q.Where(
			"user_id ILIKE ? OR replace(user_id, '-', '') ILIKE ? OR user_id IN (?)",
			kw, noDash,
			r.db.Model(&model.User{}).Select("id").
				Where("nickname ILIKE ? OR email ILIKE ?", kw, kw))
	}
	if filter.TaskKind != "" {
		q = q.Where("task_kind = ?", filter.TaskKind)
	}
	if filter.TaskID != "" {
		q = q.Where("task_id ILIKE ?", "%"+filter.TaskID+"%")
	}
	return q
}

func (r *providerTaskRepo) List(ctx context.Context, filter ProviderTaskFilter) ([]ProviderTaskView, int64, error) {
	q := r.applyFilter(r.db.WithContext(ctx).Model(&model.ProviderTask{}), filter)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	page, size := filter.Page, filter.PageSize
	if page <= 0 {
		page = 1
	}
	if size <= 0 || size > 200 {
		size = 20
	}

	var rows []model.ProviderTask
	// 纯时间倒序：列表就是"最近发生了什么"的时间线，不再按状态插队。
	// （原来把「待人工退费」「已退费」顶到最前，会让时间线错乱 —— 想只看需要动手的行，
	//   用「只看异常」或状态筛选，不该由排序去替使用者做判断。）
	err := q.Order("created_at DESC, id DESC").
		Offset((page - 1) * size).Limit(size).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	items := make([]ProviderTaskView, 0, len(rows))
	for _, row := range rows {
		view := ProviderTaskView{ProviderTask: row}
		// 只把真正的上游任务号透出去；本地编号（sync: 前缀）一律留空，界面上显示「-」
		if !strings.HasPrefix(row.TaskID, "sync:") {
			view.UpstreamTaskID = row.TaskID
		}
		items = append(items, view)
	}
	r.fillNames(ctx, items)
	return items, total, nil
}

// fillNames 批量补项目名/用户名（两条 IN 查询，不做 N+1）
func (r *providerTaskRepo) fillNames(ctx context.Context, items []ProviderTaskView) {
	if len(items) == 0 {
		return
	}
	projectIDs := make([]string, 0, len(items))
	userIDs := make([]string, 0, len(items))
	for _, it := range items {
		if it.ProjectID != "" {
			projectIDs = append(projectIDs, it.ProjectID)
		}
		if it.UserID != "" {
			userIDs = append(userIDs, it.UserID)
		}
	}
	projectNames := map[string]string{}
	if len(projectIDs) > 0 {
		var projects []model.Project
		if err := r.db.WithContext(ctx).Select("id", "name").Where("id IN ?", projectIDs).Find(&projects).Error; err == nil {
			for _, p := range projects {
				projectNames[p.ID] = p.Name
			}
		}
	}
	type userRow struct {
		ID       string
		Email    string
		Nickname string
	}
	users := map[string]userRow{}
	if len(userIDs) > 0 {
		var rows []userRow
		if err := r.db.WithContext(ctx).Model(&model.User{}).
			Select("id", "email", "nickname").Where("id IN ?", userIDs).Find(&rows).Error; err == nil {
			for _, u := range rows {
				users[u.ID] = u
			}
		}
	}
	for i := range items {
		items[i].ProjectName = projectNames[items[i].ProjectID]
		// 名称快照单独给出去，不回填成 project_name —— 界面要靠「实时名为空」判断项目已删除，
		// 静默回填会让管理员以为项目还在。
		items[i].ProjectNameSnapshot = items[i].ProviderTask.ProjectName
		if u, ok := users[items[i].UserID]; ok {
			items[i].UserName = u.Nickname
			items[i].UserEmail = u.Email
		}
	}
}

func (r *providerTaskRepo) Stats(ctx context.Context, filter ProviderTaskFilter) (ProviderTaskStats, error) {
	var stats ProviderTaskStats
	q := r.applyFilter(r.db.WithContext(ctx).Model(&model.ProviderTask{}), filter)
	err := q.Select(`count(*) as total,
		count(*) filter (where status = 'delivered') as delivered,
		count(*) filter (where status = 'failed') as failed,
		count(*) filter (where status = 'pending_review' or status = 'failed') as pending_review,
		count(*) filter (where status = 'refunded') as refunded,
		count(*) filter (where status = 'refunded' and refund_source = 'auto') as auto_refunded,
		count(*) filter (where status = 'refunded' and refund_source = 'manual') as manual_refunded,
		count(*) filter (where status = 'submitted') as submitted,
		count(*) filter (where coalesce(alert, '') <> '') as alerted,
		coalesce(sum(charged_amount), 0) as charged_credits,
		coalesce(sum(refunded_amount), 0) as refunded_credit`).Scan(&stats).Error
	return stats, err
}

func (r *providerTaskRepo) ListByTaskID(ctx context.Context, taskID string) (*model.ProviderTask, error) {
	var task model.ProviderTask
	if err := r.db.WithContext(ctx).Where("task_id = ?", taskID).First(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *providerTaskRepo) ListByProject(ctx context.Context, projectID string, limit int) ([]model.ProviderTask, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var items []model.ProviderTask
	err := r.db.WithContext(ctx).Where("project_id = ?", projectID).
		Order("created_at desc").Limit(limit).Find(&items).Error
	return items, err
}

// ClaimForRefund 人工退费的原子占位：
//   - 只允许 status in (pending_review, failed) 且 refunded_amount = 0 的行被占住
//     （failed 是历史遗留状态，Stats 把它计入「待人工决定」，所以它必须真的能退）；
//     刻意**不含 submitted**（进行中）：那时 AI 调用还在跑，退完它若又失败，引擎会再自动退一次
//     —— 同一笔扣费退两遍；若又成功，用户等于白拿一次。进行中的任务由看门狗判定超时后
//     落成 pending_review 再退，路径是通的。
//   - 用 UPDATE ... RETURNING 一步完成「检查 + 占位」，两个管理员同时点也只有一个能成，
//     不会出现同一笔扣费退两次。
func (r *providerTaskRepo) ClaimForRefund(ctx context.Context, id int64, operator, note string) (*model.ProviderTask, error) {
	var task model.ProviderTask
	res := r.db.WithContext(ctx).Raw(`
		UPDATE provider_tasks
		SET refunded_amount = charged_amount, note = left(?, 250), updated_at = now()
		WHERE id = ? AND refunded_amount = 0 AND status IN ('pending_review', 'failed')
		RETURNING id, task_id, task_kind, provider, model, exec_id, node_id, user_id, project_id, status,
		          charged_amount, refunded_amount, charge_resolution, charge_seconds, charge_ref_seconds, note
	`, note, id).Scan(&task)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 || task.ID == 0 {
		return nil, nil
	}
	return &task, nil
}

// MarkRefundedFromClaim 占位后钱退成功了 → 落终态
func (r *providerTaskRepo) MarkRefundedFromClaim(ctx context.Context, id int64, note string) error {
	return r.db.WithContext(ctx).Model(&model.ProviderTask{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"status": "refunded", "refund_source": "manual", "note": textcut.NotLongerThan(note, 240), "updated_at": time.Now(),
			// 金额一并写实：占位值与 charged_amount 相等，这里再写一次，
			// 避免出现「status=refunded 但 refunded_amount=0」这种自相矛盾的行
			"refunded_amount": gorm.Expr("charged_amount"),
		}).Error
}

// RevertRefund 钱没退成功 → 放回待人工退费（不能显示成已退费）
func (r *providerTaskRepo) RevertRefund(ctx context.Context, id int64, note string) error {
	return r.db.WithContext(ctx).Model(&model.ProviderTask{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"status": "pending_review", "refunded_amount": 0, "note": note, "updated_at": time.Now(),
		}).Error
}

// 自动核对写进备注的段落用一对标记包起来：【自动核对】…【核对结束】。
//
// 为什么要包起来（而不是只写前缀）：管理员可能在机器写完之后又往备注里补话，
// 只按前缀「从标记删到结尾」会把管理员的话一起删掉。包起来之后自检可以精确地
// 只摘掉自己那一段，两边的人工内容都不受影响。重跑自检时整段替换，也不会越堆越长。
const (
	alertNoteOpen  = "【自动核对】"
	alertNoteClose = "【核对结束】"
)

// alertSegment 生成机器段落
func alertSegment(reason string) string {
	return alertNoteOpen + reason + alertNoteClose
}

func (r *providerTaskRepo) SetAlert(ctx context.Context, id int64, alert, reason string) error {
	var row struct {
		ID   int64
		Note string
	}
	if err := r.db.WithContext(ctx).Model(&model.ProviderTask{}).
		Select("id", "note").Where("id = ?", id).Scan(&row).Error; err != nil {
		return err
	}
	if row.ID == 0 {
		return nil
	}

	// 1) 先摘掉上一次自动写入的段落（只摘自己写的那段，人工备注原样保留）
	note := stripAlertSegment(row.Note)
	if alert != "" && reason != "" {
		if note == "" {
			note = alertSegment(reason)
		} else {
			note = note + "；" + alertSegment(reason)
		}
	}
	// 备注是 varchar(255)：按字节安全截断（切在半个汉字上会让整行写不进去，反而把异常标记丢了）
	note = textcut.NotLongerThan(note, 240)

	updates := map[string]interface{}{
		"note":       note,
		"updated_at": time.Now(),
	}
	if alert == "" {
		updates["alert"] = ""
		updates["alert_at"] = nil
	} else {
		updates["alert"] = alert
		updates["alert_at"] = time.Now()
	}
	return r.db.WithContext(ctx).Model(&model.ProviderTask{}).Where("id = ?", id).Updates(updates).Error
}

// stripAlertSegment 去掉备注里由自检写入的段落（含历史遗留下来的多段），保留人工内容。
//
// 三种情况：
//   - 有结束标记 → 精确删除这一段（连带处理它两侧的分隔符，避免留下「；；」或把两句话粘死）；
//   - 没有结束标记（旧数据/被截断）→ 从标记处删到结尾；
//   - 本来就没有机器段落 → 原样返回。
func stripAlertSegment(note string) string {
	for {
		i := strings.Index(note, alertNoteOpen)
		if i < 0 {
			break
		}
		j := strings.Index(note[i:], alertNoteClose)
		if j < 0 {
			note = note[:i]
			break
		}
		start, end := i, i+j+len(alertNoteClose)

		hadPrevSep := start >= len("；") && note[start-len("；"):start] == "；"
		if hadPrevSep {
			start -= len("；")
		}
		hadNextSep := strings.HasPrefix(note[end:], "；")
		if hadNextSep {
			end += len("；")
		}
		// 删掉这一段后，如果两侧都还有人工内容、且两侧都不带分隔符了 → 补一个，
		// 否则会把用户写的两句话粘成一句（"前段后段"）。
		left, right := note[:start], note[end:]
		join := ""
		if left != "" && right != "" && !strings.HasSuffix(left, "；") && !strings.HasPrefix(right, "；") {
			join = "；"
		}
		note = left + join + right
	}
	note = strings.TrimSpace(note)
	return strings.TrimSuffix(note, "；")
}

func (r *providerTaskRepo) AlertedRows(ctx context.Context) (map[int64]string, error) {
	var rows []struct {
		ID    int64
		Alert string
	}
	err := r.db.WithContext(ctx).Model(&model.ProviderTask{}).
		Select("id", "alert").Where("coalesce(alert, '') <> ''").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, row := range rows {
		out[row.ID] = row.Alert
	}
	return out, nil
}
