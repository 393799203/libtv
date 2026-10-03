package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"libtv/internal/cache"
)

// ==================== 异步生成任务引用（进程重启后续跑的关键）====================
//
// 背景：视频类模型是「先提交任务拿 taskID、再轮询取结果」的异步协议。
// 原实现把 taskID 只放在内存里，进程一旦重启（发版 / 崩溃）：
//   ① 任务被队列认领后**重新下发一次** —— 上游又生成一遍、用户又被扣一次费；
//   ② 而第一次那次上游其实还在跑、甚至已经跑完，结果白白丢掉。
//
// 因此把 taskID 在「拿到的瞬间」就落盘到 Redis（跨进程存活）：
// 续跑时优先**接着查这个任务的结果**，只有复用失败（任务过期 / 已失败 / 渠道模型不匹配）
// 才回退到重新下发。

// AsyncTaskRef 一次已下发给上游的异步生成任务
type AsyncTaskRef struct {
	Provider string `json:"provider"` // wasu / dianxin
	Model    string `json:"model"`
	TaskID   string `json:"taskID"`
	ExecID   int64  `json:"execID"`
	NodeID   string `json:"nodeID"`
	CreateAt string `json:"createAt"`
	// ChargedAmount 下发该任务时扣掉的积分。
	// 若最终发现该任务已不可复用（过期/失败），需要把这笔钱退还给用户后再重新下发，
	// 否则用户会「第一次白付 + 第二次再付」。
	ChargedAmount int64 `json:"chargedAmount"`
	// 下面三项是扣费时的计费口径（分辨率 / 计费总时长=输出+参考视频 / 其中参考视频时长），
	// 随任务登记一起持久化：进程重启后续跑时若发现任务不可复用，退费按同一口径写账单，
	// 退费记录与当初的扣费记录能一一对上（见 BillingService.Refund 的 ChargeExtra）。
	// 旧登记（本次改动前落盘）没有这三项，取出为零值，退费只少了展示信息不影响金额
	ChargeResolution string `json:"chargeResolution"`
	ChargeSeconds    int    `json:"chargeSeconds"`
	ChargeRefSeconds int    `json:"chargeRefSeconds"`
	// DownloadFailures 该上游任务「下载转存」失败的累计次数。
	// 视频已经生成但转存到自有存储失败时，不立即退费也不重新下发 —— 先靠队列重试复用
	// 这个已完成的上游任务重新转存（不重新扣费）。只有转存反复失败（达到上限）才退费收场，
	// 避免用户既拿不到视频又一直挂着这笔钱。
	DownloadFailures int `json:"downloadFailures"`
}

// asyncTaskTTL 登记有效期，与上游任务的可查询保留期（约 24h）对齐
const asyncTaskTTL = 24 * time.Hour

func asyncTaskKey(execID int64, nodeID string) string {
	return fmt.Sprintf("gen:task:%d:%s", execID, nodeID)
}

type asyncTaskHolderKey struct{}

// WithAsyncTaskHolder 注入任务引用 holder。
// holder 承担两种角色：
//   - TaskID 为空 → 由本次调用去创建上游任务，创建后由 client 写回 taskID 并落盘
//   - TaskID 非空 → 复用场景，client 应跳过创建、直接轮询该任务
func WithAsyncTaskHolder(ctx context.Context, ref *AsyncTaskRef) context.Context {
	return context.WithValue(ctx, asyncTaskHolderKey{}, ref)
}

// AsyncTaskHolder 取出当前调用的任务引用 holder（未注入时返回 nil）
func AsyncTaskHolder(ctx context.Context) *AsyncTaskRef {
	if ref, ok := ctx.Value(asyncTaskHolderKey{}).(*AsyncTaskRef); ok {
		return ref
	}
	return nil
}

// NewAsyncTaskRef 创建 holder（executor 在调用模型前调用）
func NewAsyncTaskRef(execID int64, nodeID string) *AsyncTaskRef {
	return &AsyncTaskRef{ExecID: execID, NodeID: nodeID}
}

// LoadAsyncTaskRef 读取此前已提交、尚未取回结果的任务；返回 nil 表示需要新提交
func LoadAsyncTaskRef(ctx context.Context, execID int64, nodeID string) *AsyncTaskRef {
	rdb := cache.Client()
	if rdb == nil {
		return nil
	}
	raw, err := rdb.Get(ctx, asyncTaskKey(execID, nodeID)).Result()
	if err != nil || raw == "" {
		return nil
	}
	var ref AsyncTaskRef
	if err := json.Unmarshal([]byte(raw), &ref); err != nil || ref.TaskID == "" {
		return nil
	}
	return &ref
}

// SaveAsyncTaskRef 把已提交任务落盘
func SaveAsyncTaskRef(ref *AsyncTaskRef) {
	rdb := cache.Client()
	if rdb == nil || ref == nil || ref.TaskID == "" {
		return
	}
	raw, err := json.Marshal(ref)
	if err != nil {
		return
	}
	// 用独立 ctx：调用方 ctx 可能正随进程关停被取消，而落盘必须完成
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Set(ctx, asyncTaskKey(ref.ExecID, ref.NodeID), raw, asyncTaskTTL).Err(); err != nil {
		log.Printf("[AsyncTask] ⚠️ 任务引用落盘失败（重启后将无法复用，会重新下发）: %v", err)
		return
	}
	log.Printf("[AsyncTask] 已登记上游任务: %s/%s taskID=%s exec=%d node=%s",
		ref.Provider, ref.Model, ref.TaskID, ref.ExecID, ref.NodeID)
}

// RecordSubmittedTask 在拿到上游 taskID 后立即登记（client 层调用）。
// 必须在轮询之前调用：先落盘再等待，进程若在轮询期间被杀，重启后可直接续查。
func RecordSubmittedTask(ctx context.Context, provider, model, taskID string) {
	h := AsyncTaskHolder(ctx)
	if h == nil || taskID == "" {
		return
	}
	// 只在有值时覆盖：调用方可能只知道 taskID（如华数取结果路径传空 model），
	// 空值覆盖会把执行器预先写入的模型名抹掉，导致看门狗退费时账单缺模型
	if provider != "" {
		h.Provider = provider
	}
	if model != "" {
		h.Model = model
	}
	h.TaskID = taskID
	if h.CreateAt == "" {
		h.CreateAt = time.Now().Format(time.RFC3339)
	}
	SaveAsyncTaskRef(h)
}

// TakeAsyncTaskRef 原子地「认领」任务登记（Redis GETDEL），返回被认领的那份登记；
// 同一份登记只会被认领一次，并发调用中只有一个能拿到，其余拿到 nil。
//
// 用途：「复用失败 → 退还当初下发它的那笔扣费」这条路径必须先认领再退费。
// 队列重投 / 前端重复触发会让同一个执行（execID 相同，登记 key 相同）并发跑多份，
// 若每份都各自读一次登记再退费，同一笔扣费就会被退多次 —— 线上实例：
// 2026-10-03 01:17–01:19 一个 20 秒窗口里 5 笔扣费退了 8 次，多退 13590 积分。
// 认领成功的那一份负责退费，其余执行退化为「跳过」（任务确实已不可复用，但钱只退一次）。
func TakeAsyncTaskRef(execID int64, nodeID string) *AsyncTaskRef {
	rdb := cache.Client()
	if rdb == nil {
		return nil
	}
	// 独立 ctx：调用方 ctx 往往已随失败/关停被取消，而认领必须完成（否则退费不会发生）
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	raw, err := rdb.GetDel(ctx, asyncTaskKey(execID, nodeID)).Result()
	if err != nil || raw == "" {
		return nil
	}
	var ref AsyncTaskRef
	if err := json.Unmarshal([]byte(raw), &ref); err != nil || ref.TaskID == "" {
		return nil
	}
	return &ref
}

// progressReporterKey 上游进度上报回调的 ctx 键
type progressReporterKey struct{}

// WithProgressReporter 注入「上游进度」回调（executor 注入 → 轮询把真实进度透出到节点）。
//
// 用途：视频轮询期间界面原来只有「已运行 12s」这种自说自话的计时，用户无法判断
// 上游到底在不在动、走到哪一步。轮询每 5 秒就能拿到上游的真实 status/进度，
// 透出去以后节点上显示的是「上游处理中 62% · 已等待 3m20s」。
func WithProgressReporter(ctx context.Context, fn func(message string, percent int)) context.Context {
	if fn == nil {
		return ctx
	}
	return context.WithValue(ctx, progressReporterKey{}, fn)
}

// reportProgress 上报一次上游进度（未注入回调时是空操作）
func reportProgress(ctx context.Context, message string, percent int) {
	if ctx == nil {
		return
	}
	if fn, ok := ctx.Value(progressReporterKey{}).(func(string, int)); ok && fn != nil {
		fn(message, percent)
	}
}

// refundedKeyPrefix 退费幂等标记的键前缀。按「上游任务号」而不是节点维度记账。
//
// 为什么按任务号：同一个节点在一次执行里可能被重新下发（退款后重试会拿到新的 taskID），
// 那时新任务对应的扣费当然要允许再退；而**同一个上游任务**对应的那笔扣费只应退一次。
// 队列重投、并发副本、失败后重试复用登记这几条路径都可能对同一笔扣费发起退费。
const refundedKeyPrefix = "refunded:task:"

func refundedKey(taskID string) string { return refundedKeyPrefix + taskID }

// TryMarkRefunded 认领「这笔扣费由我负责退」的资格（SETNX）。
//
// 返回 true = 本次调用去退费；false = 这笔扣费已经退过（或正在退），应跳过。
// taskID 为空（提交阶段就失败，没拿到上游任务号）时一律返回 true：
// 那种情况没有登记可被复用（重试必然重新下发并重新扣费），不存在重复退费路径。
// Redis 不可用/写失败时也返回 true —— 退费优先于幂等，宁可走老的 GETDEL 认领保护。
func TryMarkRefunded(taskID string) bool {
	if taskID == "" {
		return true
	}
	rdb := cache.Client()
	if rdb == nil {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ok, err := rdb.SetNX(ctx, refundedKey(taskID), "1", asyncTaskTTL).Result()
	if err != nil {
		log.Printf("[AsyncTask] ⚠️ 退费幂等标记写入失败（改为直接退费）: %v", err)
		return true
	}
	return ok
}

// UnmarkRefunded 撤销退费幂等标记：只在「认领到了资格、但退费本身失败」时调用，
// 让后续重试还能把这次扣费补退给用户。
func UnmarkRefunded(taskID string) {
	if taskID == "" {
		return
	}
	rdb := cache.Client()
	if rdb == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = rdb.Del(ctx, refundedKey(taskID)).Err()
}

// ClearAsyncTaskRef 清除单个节点的任务登记（该节点结果已产出，不再需要复用）
func ClearAsyncTaskRef(execID int64, nodeID string) {
	rdb := cache.Client()
	if rdb == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = rdb.Del(ctx, asyncTaskKey(execID, nodeID)).Err()
}

// ClearAsyncTaskRefsOfExecution 清理某次执行的全部任务登记（执行结束时调用）
func ClearAsyncTaskRefsOfExecution(execID int64) {
	rdb := cache.Client()
	if rdb == nil || execID <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pattern := fmt.Sprintf("gen:task:%d:*", execID)
	var cursor uint64
	removed := 0
	for {
		keys, next, err := rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return
		}
		if len(keys) > 0 {
			if err := rdb.Del(ctx, keys...).Err(); err == nil {
				removed += len(keys)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	if removed > 0 {
		log.Printf("[AsyncTask] 已清理执行 %d 的 %d 条任务登记", execID, removed)
	}
}
