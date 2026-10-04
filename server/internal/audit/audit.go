// Package audit 对账一致性自检。
//
// 存在的原因：钱的问题里最危险的一类不是「扣错了」，而是「扣了但没人知道」——
// 扣费流水在、对账行不在；或者对账行写着「已交付」却没有产物、没有交付凭据；
// 或者既退了费又交付了片子。这类不一致靠人翻对账页看不出来（页面只显示单行），
// 时间一长就成了说不清的账。
//
// 本包把四份数据交叉核对一遍：
//
//	对账行 provider_tasks  ↔  账单流水 billing_records
//	                      ↔  生成历史 generation_history（交付凭据）
//	                      ↔  Redis 任务登记 gen:task:*（重试复用凭据）
//
// 设计原则（很重要）：
//   - **只读 + 标记**：绝不自动改金额、绝不自动改状态、绝不自动退费；
//   - 发现异常 → 把那一行标出来（alert 列）+ 把中文原因写进备注（带固定前缀，可回滚）；
//   - 异常消失 → 自动清掉标记与那段备注，不留噪音；
//   - 宁可漏报不要误报：口径模糊的情况只写日志、不标记行（例如历史遗留的旧数据）。
package audit

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"libtv/internal/repository"
)

// 异常代码（写进 provider_tasks.alert，界面上按它决定文案与颜色）
const (
	AlertNoResult        = "no_result"        // 已交付但没有产物地址
	AlertNoHistory       = "no_history"       // 已交付但没有生成历史凭据
	AlertStuck           = "stuck"            // 卡在「进行中」超过阈值
	AlertRefundDelivered = "refund_delivered" // 既退费又交付（自相矛盾）
	AlertAmountMismatch  = "amount_mismatch"  // 与账单流水的金额对不上
	AlertNoUser          = "no_user"          // 没有归属用户（退费落不到人）
	AlertOrphanExec      = "orphan_exec"      // 关联的执行记录不存在
)

// stuckAfter 多久算「卡在进行中」：上游轮询预算是 25 分钟，看门狗也在兜底，
// 超过 45 分钟还没结算就说明确实有环节没走完。
const stuckAfter = 45 * time.Minute

// projectAlive 只看「项目还在」的行。
//
// 项目被删除时，业务数据（执行记录、画布、生成历史、AI 任务）会按设计级联清理，
// 而对账行是永久记录、必须留下 —— 于是引用必然悬空。这种悬空是**删除动作的正确结果**，
// 不是数据完整性问题，不该报给管理员（线上实例：10-03 14:40 另一用户删项目后的 story 行）。
const projectAlive = ` and (coalesce(p.project_id, '') = '' or exists (select 1 from projects pr where pr.id = p.project_id))`

// deliveredKinds 会产生产物文件的任务类型（只有这些才谈得上「交付凭据」）。
// 提示词/白模解析是同步接口，结果直接回给前端，不落生成历史，所以不在此列。
var deliveredKinds = []string{"ai.video", "ai.image", "ai.audio"}

// Finding 一条异常（行级：能对应到对账表里的某一行）
type Finding struct {
	RowID  int64  `json:"row_id"`
	Alert  string `json:"alert"`
	Reason string `json:"reason"`
}

// Report 一次自检的结果
type Report struct {
	StartedAt time.Time `json:"started_at"`
	Duration  string    `json:"duration"`
	Scanned   int       `json:"scanned"`
	// Findings 行级异常（已写入 alert + 备注）
	Findings []Finding `json:"findings"`
	// Marked / Cleared 本次新标记 / 本次清理的条数
	Marked  int `json:"marked"`
	Cleared int `json:"cleared"`
	// Orphans 没有对应行、只能记日志的问题（例如「有扣费流水但找不到对账行」）
	Orphans []string `json:"orphans"`
}

// Checker 一致性自检器
type Checker struct {
	db   *gorm.DB
	repo repository.ProviderTaskRepo
}

func NewChecker(db *gorm.DB, repo repository.ProviderTaskRepo) *Checker {
	return &Checker{db: db, repo: repo}
}

var alertReasons = map[string]string{
	AlertNoResult:        "已交付但没有产物地址（结果没落库），请人工核查是否应退费",
	AlertNoHistory:       "已交付但没有生成历史凭据（可能是假成功），请人工核查产物是否真的存在",
	AlertStuck:           "长时间停留在「进行中」没有结算，请人工核查上游是否已完成、是否应退费",
	AlertRefundDelivered: "既已退费又显示已交付（自相矛盾），请人工核查并按实际情况修正",
	AlertAmountMismatch:  "与账单流水的金额对不上，请人工核查扣费/退费是否完整",
	AlertNoUser:          "没有归属用户，无法退费到人，请人工核查",
	AlertOrphanExec:      "关联的执行记录不存在（项目仍在），请人工核查数据完整性",
}

// RunOnce 跑一遍全部核对，把结果写进对账行并返回报告。
func (c *Checker) RunOnce(ctx context.Context) (*Report, error) {
	started := time.Now()
	report := &Report{StartedAt: started}

	found := map[int64]string{} // rowID → alert code
	if err := c.checkNoResult(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkNoHistory(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkStuck(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkRefundDelivered(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkAmountMismatch(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkNoUser(ctx, found); err != nil {
		return nil, err
	}
	if err := c.checkOrphanExec(ctx, found); err != nil {
		return nil, err
	}

	// 已有标记：用来判断哪些需要新写、哪些已经恢复正常需要清理
	existing, err := c.repo.AlertedRows(ctx)
	if err != nil {
		return nil, err
	}

	// 逐行落库。一个行只保留一个代码：多条命中时取第一条（口径以最严重的那条为准，
	// 顺序即上面的调用顺序：产物缺失 > 凭据缺失 > 卡住 > 矛盾 > 金额 > 归属 > 执行）
	for id, code := range found {
		if existing[id] == code {
			continue // 已经是这个标记，不重复写库、不重复追加备注
		}
		if err := c.repo.SetAlert(ctx, id, code, alertReasons[code]); err != nil {
			log.Printf("[Audit] ⚠️ 标记异常行失败: id=%d code=%s err=%v", id, code, err)
			continue
		}
		report.Marked++
		report.Findings = append(report.Findings, Finding{RowID: id, Alert: code, Reason: alertReasons[code]})
		log.Printf("[Audit] ⚠️ 对账异常 id=%d code=%s %s", id, code, alertReasons[code])
	}
	// 恢复正常（或换了另一种异常）的行：清理旧标记与备注段落
	for id, code := range existing {
		if newCode, ok := found[id]; ok && newCode == code {
			continue
		}
		if err := c.repo.SetAlert(ctx, id, "", ""); err != nil {
			log.Printf("[Audit] ⚠️ 清理异常标记失败: id=%d err=%v", id, err)
			continue
		}
		report.Cleared++
		log.Printf("[Audit] ✅ 对账异常已恢复: id=%d 原标记=%s", id, code)
	}

	if err := c.checkChargedWithoutLedger(ctx, report); err != nil {
		return nil, err
	}
	if err := c.countDeletedProjectRefs(ctx, report); err != nil {
		return nil, err
	}

	report.Duration = time.Since(started).Round(time.Millisecond).String()
	log.Printf("[Audit] 一致性自检完成: 异常=%d(新标记 %d) 恢复=%d 无主问题=%d 耗时=%s",
		len(found), report.Marked, report.Cleared, len(report.Orphans), report.Duration)
	return report, nil
}

// checkNoResult 已交付但没有产物地址 —— 交付了却说不出交付了什么。
//
// 只查会产生产物的类型（视频/图片/音频）：提示词生成、白模解析是同步接口，
// 结果直接回给前端、本来就不落产物地址，拿它们来判定只会制造误报。
func (c *Checker) checkNoResult(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertNoResult, `
		select id from provider_tasks
		 where status = 'delivered'
		   and coalesce(result_url, '') = ''
		   and task_kind in (?)`, deliveredKinds)
}

// checkNoHistory 已交付、也有产物地址，但生成历史里找不到对应凭据。
//
// 生成历史是「该节点确实交付了」最硬的凭据（上传成功后立刻写，用 detached ctx）。
// 它缺失意味着产物可能根本不存在于我们的存储里（假成功）—— 这类必须先看，别等用户发现死链。
func (c *Checker) checkNoHistory(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertNoHistory, `
		select p.id from provider_tasks p
		 where p.status = 'delivered'
		   and coalesce(p.result_url, '') <> ''
		   and coalesce(p.node_id, '') <> ''
		   and p.task_kind in (?)
		   and not exists (
		       select 1 from generation_history g
		        where g.node_id = p.node_id and g.result_url = p.result_url)`+projectAlive, deliveredKinds)
}

// checkStuck 长时间停在「进行中」
func (c *Checker) checkStuck(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertStuck, `
		select id from provider_tasks
		 where status = 'submitted' and created_at < now() - interval '1 minute' * ?`,
		int(stuckAfter.Minutes()))
}

// checkRefundDelivered 既退费又交付：钱退了、片子也给用户了（不该出现）
func (c *Checker) checkRefundDelivered(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertRefundDelivered, `
		select id from provider_tasks
		 where refunded_amount > 0 and status = 'delivered'`)
}

// checkAmountMismatch 对账行金额与账单流水对不上。
//
// 只在账单里能按任务号精确匹配时才判定（同步接口的账单不带任务号，用时间窗猜金额只会制造误报）。
//
// 两个方向**各自独立判定，且必须有对应类型的流水才比**：
//
//	扣费侧：只有存在带该任务号的 deduct 流水时才比金额；
//	退款侧：只有存在带该任务号的 refund 流水时才比金额。
//
// 为什么必须加这个前提（线上踩过）：视频的**退款**流水带任务号（退费时已经拿到上游任务号），
// 而**扣费**流水不带（扣费发生在上游创建任务之前，那时还没有任务号）。没有前提时会算出
// 「扣费侧合计 = 0 ≠ charged_amount」，把每一条自动退费的视频都误标成"金额对不上"。
// 实例：10-03 22:21 / 22:30 两条 dianxin 视频（上游因版权限制拒绝、已自动全额退 4530），
// 金额两侧其实完全一致，却被标红。宁可漏报也不要误报 —— 误报会让真异常淹没在噪音里。
func (c *Checker) checkAmountMismatch(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertAmountMismatch, `
		select p.id from provider_tasks p
		 where coalesce(p.task_id, '') <> ''
		   and (
		     (exists (select 1 from billing_records b
		               where b.task_id = p.task_id and b.type = 'deduct')
		      and coalesce((select sum(b.amount) from billing_records b
		                     where b.task_id = p.task_id and b.type = 'deduct'), 0) <> p.charged_amount)
		     or
		     (exists (select 1 from billing_records b
		               where b.task_id = p.task_id and b.type = 'refund')
		      and coalesce((select sum(b.amount) from billing_records b
		                     where b.task_id = p.task_id and b.type = 'refund'), 0) <> p.refunded_amount)
		   )`)
}

// checkNoUser 没有归属用户：这种行管理员点退费也退不到人
func (c *Checker) checkNoUser(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertNoUser, `
		select id from provider_tasks where coalesce(user_id, '') = ''`)
}

// checkOrphanExec 关联的执行记录不存在（且项目还在 —— 项目都删了就不算异常）
func (c *Checker) checkOrphanExec(ctx context.Context, found map[int64]string) error {
	return c.collect(ctx, found, AlertOrphanExec, `
		select p.id from provider_tasks p
		 where p.exec_id > 0
		   and not exists (select 1 from workflow_executions e where e.id = p.exec_id)`+projectAlive)
}

// countDeletedProjectRefs 统计「引用已随项目删除而消失」的行数，只记日志（不是异常，不必人工处理）
func (c *Checker) countDeletedProjectRefs(ctx context.Context, report *Report) error {
	var n int64
	err := c.db.WithContext(ctx).Raw(`
		select count(*) from provider_tasks p
		 where p.exec_id > 0
		   and coalesce(p.project_id, '') <> ''
		   and not exists (select 1 from workflow_executions e where e.id = p.exec_id)
		   and not exists (select 1 from projects pr where pr.id = p.project_id)`).Scan(&n).Error
	if err != nil {
		return err
	}
	if n > 0 {
		msg := fmt.Sprintf("有 %d 行对账记录引用的执行/项目已随项目删除而清理（属正常，无需处理）", n)
		report.Orphans = append(report.Orphans, msg)
		log.Printf("[Audit] ℹ️ %s", msg)
	}
	return nil
}

// checkChargedWithoutLedger 有扣费流水、却找不到对应的一行对账记录。
//
// 这是「钱静默消失」的守卫：扣费成功但对账行没写成功（进程被杀、写库失败）。
// 因为没有可靠的外键（账单不带对账编号），只能用「同用户 + 同金额 + ±3 分钟」判定，
// 所以**只记日志、不标记行**（没有行可标），并把可疑流水列进报告供人工排查。
func (c *Checker) checkChargedWithoutLedger(ctx context.Context, report *Report) error {
	var rows []struct {
		ID        int64
		UserID    string
		Amount    int64
		Action    string
		CreatedAt time.Time
	}
	err := c.db.WithContext(ctx).Raw(`
		select b.id, b.user_id, b.amount, b.action, b.created_at
		  from billing_records b
		 where b.type = 'deduct'
		   and b.action in ('ai.video','ai.image','ai.story','ai.script','ai.audio','ai.previz_analyze','prompt.generate')
		   and b.created_at > now() - interval '24 hours'
		   and not exists (
		       select 1 from provider_tasks p
		        where p.user_id = b.user_id
		          and p.charged_amount = b.amount
		          and p.created_at between b.created_at - interval '3 minutes' and b.created_at + interval '3 minutes')`).
		Scan(&rows).Error
	if err != nil {
		return err
	}
	for _, row := range rows {
		msg := fmt.Sprintf("扣费流水 #%d（用户 %s，%d 分，%s，%s）找不到对应的一行对账记录 —— 可能是扣费后写对账前进程中断，请人工核查",
			row.ID, row.UserID, row.Amount, row.Action, row.CreatedAt.Format("01-02 15:04:05"))
		report.Orphans = append(report.Orphans, msg)
		log.Printf("[Audit] ⚠️ %s", msg)
	}
	return nil
}

// collect 执行一条「返回 id 列表」的核对 SQL，把命中的行记进 found（已有标记的不覆盖）
func (c *Checker) collect(ctx context.Context, found map[int64]string, code, query string, args ...interface{}) error {
	var ids []int64
	if err := c.db.WithContext(ctx).Raw(query, args...).Scan(&ids).Error; err != nil {
		return fmt.Errorf("%s 核对失败: %w", code, err)
	}
	for _, id := range ids {
		if _, ok := found[id]; ok {
			continue // 已命中更严重的口径
		}
		found[id] = code
	}
	return nil
}

// AlertLabel 异常代码对应的中文短标签（界面用）
func AlertLabel(code string) string {
	switch code {
	case AlertNoResult:
		return "无产物地址"
	case AlertNoHistory:
		return "无交付凭据"
	case AlertStuck:
		return "卡在进行中"
	case AlertRefundDelivered:
		return "既退费又交付"
	case AlertAmountMismatch:
		return "金额对不上"
	case AlertNoUser:
		return "无归属用户"
	case AlertOrphanExec:
		return "执行记录缺失"
	}
	if strings.TrimSpace(code) == "" {
		return ""
	}
	return code
}
