// Package queue 基于 Redis Stream 的生成任务队列。
//
// 背景：原先生成任务由 handler 直接 `go func()` 起协程执行，存在三个问题：
//  1. 后端重启/发版会杀掉协程 —— 任务永久卡在 running，但积分已扣（历史僵尸记录即由此产生）；
//  2. 无并发上限，多人同时生成会一起打上游网关（易触发限流/失败）；
//  3. 失败没有重试，一次网络抖动就白费一次生成。
//
// 队列化后：任务入 Stream，worker 池消费（worker 数即并发闸门），
// 失败按指数退避重试，超次数进死信流；worker 崩溃或进程重启时，
// 未确认的消息由 XAUTOCLAIM 重新认领继续执行。
package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"libtv/internal/apperr"
	"libtv/internal/config"
)

// Task 生成任务载荷（入队时写入 Stream 字段）。
// 只携带「重建执行计划」所需的最小信息：worker 可能在另一个进程/重启后运行，
// 必须能凭这些字段重新加载画布并重建 plan，因此不携带内存对象。
type Task struct {
	ExecutionID int64  `json:"execution_id"`
	ProjectID   string `json:"project_id"`
	UserID      string `json:"user_id"`
	StartNodeID string `json:"start_node_id"`
	Retry       int    `json:"retry"` // 已重试次数
}

// Handler 任务处理器：由上层注入（调用 engine.Execute 并回写画布/执行状态）。
// 返回 nil 视为成功；返回 error 会触发重试。
type Handler func(ctx context.Context, t Task) error

// gateKey 「进行中」观测集合（score=开始时间，member=executionID）
const gateKey = "gate:gen:inflight"

// Queue Redis Stream 任务队列
type Queue struct {
	cfg     config.QueueConfig
	handler Handler
	rdb     *redis.Client

	retryKey     string // 延迟重试用的有序集合（score = 到期时间）
	maxStreamLen int64  // 流最大保留条目数（近似裁剪），避免无界增长
	wg           sync.WaitGroup
	cancel       context.CancelFunc
}

// New 创建队列（不连接，Start 时才建立消费组）
func New(cfg config.QueueConfig, rdb *redis.Client, handler Handler) *Queue {
	if cfg.Stream == "" {
		cfg.Stream = "libtv:gen:tasks"
	}
	if cfg.DeadStream == "" {
		cfg.DeadStream = "libtv:gen:dead"
	}
	if cfg.ConsumerGroup == "" {
		cfg.ConsumerGroup = "libtv:gen"
	}
	if cfg.Workers <= 0 {
		cfg.Workers = 4
	}
	if cfg.VisibilityTimeoutSec <= 0 {
		cfg.VisibilityTimeoutSec = 900
	}
	// Stream 保留上限：约 1000 条历史消息足够排查问题，同时约束内存占用
	return &Queue{
		cfg:          cfg,
		handler:      handler,
		rdb:          rdb,
		retryKey:     cfg.Stream + ":retry",
		maxStreamLen: 1000,
	}
}

// Enqueue 入队一个生成任务
func (q *Queue) Enqueue(ctx context.Context, t Task) error {
	payload, err := json.Marshal(t)
	if err != nil {
		return err
	}
	// MaxLen 近似裁剪：Stream 是无界追加日志，不裁剪会随任务量无限膨胀
	return q.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: q.cfg.Stream,
		MaxLen: q.maxStreamLen,
		Approx: true,
		Values: map[string]interface{}{"task": string(payload)},
	}).Err()
}

// ensureGroup 创建消费者组，幂等（已存在时忽略 BUSYGROUP）。
// 起始 ID 用 "0"：组首次创建或重建时，已入队但未投递的消息也会被投递给消费者。
//
// 之所以要反复调用而不只在启动时建一次：Redis 侧数据被清空或容器重建后，
// 消费者组会随之消失，而此时 XADD 仍会自动创建 stream（入队看起来是成功的），
// 但 worker 的 XREADGROUP 会一直报 NOGROUP —— 任务静默卡在 pending 永不执行。
func (q *Queue) ensureGroup(ctx context.Context) error {
	err := q.rdb.XGroupCreateMkStream(ctx, q.cfg.Stream, q.cfg.ConsumerGroup, "0").Err()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		return fmt.Errorf("创建消费者组失败: %w", err)
	}
	return nil
}

// isNoGroupErr Redis 在 stream / 消费者组不存在时返回 NOGROUP 错误
func isNoGroupErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "NOGROUP")
}

// Start 建消费组、拉起 worker 池与回收协程
func (q *Queue) Start(parent context.Context) error {
	if err := q.ensureGroup(parent); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(parent)
	q.cancel = cancel

	// 清理上一个进程遗留的消费者记录。必须在本次 worker 开始消费前执行，
	// 且只删 PEL 为空的（删有未确认消息的消费者会把消息一起丢掉）
	q.clearStaleConsumers(ctx)

	for i := 0; i < q.cfg.Workers; i++ {
		q.wg.Add(1)
		go q.worker(ctx, i)
	}
	q.wg.Add(1)
	go q.reclaimLoop(ctx)

	log.Printf("[Queue] 已启动：workers=%d stream=%s group=%s 可见性超时=%ds 最大重试=%d",
		q.cfg.Workers, q.cfg.Stream, q.cfg.ConsumerGroup, q.cfg.VisibilityTimeoutSec, q.cfg.MaxRetry)
	return nil
}

// clearStaleConsumers 清理上一个进程遗留的消费者记录。
//
// 消费者名形如 w-<容器hostname>-<序号>，容器每次重建 hostname 都会变，
// 旧记录不会被 Redis 自动回收（XINFO 里会随每次发版无限累积）。
// 本进程刚启动，凡不属于本进程 worker 命名规则的消费者都属于上一个进程，可安全删除。
// 安全前提：只删 pending（未确认消息）为 0 的消费者 —— 删掉有 PEL 的消费者会丢消息。
func (q *Queue) clearStaleConsumers(ctx context.Context) {
	consumers, err := q.rdb.XInfoConsumers(ctx, q.cfg.Stream, q.cfg.ConsumerGroup).Result()
	if err != nil {
		return
	}
	// 本进程将要使用的消费者名（即便尚未创建也一并保护）
	alive := make(map[string]bool, q.cfg.Workers+1)
	for i := 0; i < q.cfg.Workers; i++ {
		alive[consumerName("w", i)] = true
	}
	alive[consumerName("reclaim", 0)] = true

	removed := 0
	for _, c := range consumers {
		if alive[c.Name] || c.Pending > 0 {
			continue
		}
		if err := q.rdb.XGroupDelConsumer(ctx, q.cfg.Stream, q.cfg.ConsumerGroup, c.Name).Err(); err == nil {
			removed++
		}
	}
	if removed > 0 {
		log.Printf("[Queue] 已清理 %d 个上次进程遗留的消费者记录", removed)
	}
}

// Stop 优雅停止：等待正在执行的任务跑完；超时则直接返回，
// 未确认的消息留待下次启动由 reclaim 认领续跑（不会丢）
func (q *Queue) Stop(timeout time.Duration) {
	if q.cancel == nil {
		return
	}
	q.cancel()
	done := make(chan struct{})
	go func() { q.wg.Wait(); close(done) }()
	select {
	case <-done:
		log.Printf("[Queue] 已停止")
	case <-time.After(timeout):
		log.Printf("[Queue] 停止超时：未完成的任务将由下次启动自动认领续跑")
	}
}

// Stats 观测：待处理条目数、死信数
func (q *Queue) Stats(ctx context.Context) (pending, dead int64, err error) {
	pending, err = q.rdb.XLen(ctx, q.cfg.Stream).Result()
	if err != nil {
		return 0, 0, err
	}
	dead, err = q.rdb.XLen(ctx, q.cfg.DeadStream).Result()
	if err != nil {
		// 死信流可能尚不存在
		return pending, 0, nil
	}
	return pending, dead, nil
}

// ==================== worker ====================

func consumerName(prefix string, id int) string {
	host, _ := os.Hostname()
	if host == "" {
		host = "host"
	}
	return fmt.Sprintf("%s-%s-%d", prefix, host, id)
}

func (q *Queue) worker(ctx context.Context, id int) {
	defer q.wg.Done()
	consumer := consumerName("w", id)

	for {
		if ctx.Err() != nil {
			return
		}
		res, err := q.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    q.cfg.ConsumerGroup,
			Consumer: consumer,
			Streams:  []string{q.cfg.Stream, ">"},
			Count:    1,
			Block:    3 * time.Second,
		}).Result()
		if err == redis.Nil {
			continue // 阻塞超时，无新消息
		}
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[Queue] worker-%d 读取任务失败: %v", id, err)
			// 消费者组丢失（Redis 数据被清空/容器重建）→ 自愈重建后继续消费
			if isNoGroupErr(err) {
				if gerr := q.ensureGroup(ctx); gerr == nil {
					log.Printf("[Queue] worker-%d 检测到消费者组缺失，已重建并继续消费", id)
					continue
				} else {
					log.Printf("[Queue] worker-%d 重建消费者组失败: %v", id, gerr)
				}
			}
			time.Sleep(time.Second)
			continue
		}
		for _, stream := range res {
			for _, msg := range stream.Messages {
				q.handle(ctx, consumer, msg.ID, msg.Values)
			}
		}
	}
}

// handle 执行单条任务：幂等检查 → 处理 → ACK/重试/死信
func (q *Queue) handle(ctx context.Context, consumer, msgID string, values map[string]interface{}) {
	task, err := decodeTask(values)
	if err != nil {
		log.Printf("[Queue] 任务解析失败，转入死信: %v", err)
		q.toDead(values, "任务解析失败: "+err.Error())
		q.ack(msgID)
		return
	}

	// 幂等：同一 execution 已完成过则直接确认，避免重复投递导致重复生成/重复扣费
	doneKey := fmt.Sprintf("done:exec:%d", task.ExecutionID)
	if n, _ := q.rdb.Exists(ctx, doneKey).Result(); n > 0 {
		log.Printf("[Queue] 任务 %d 已完成过，跳过重复投递", task.ExecutionID)
		q.ack(msgID)
		return
	}

	// 处理中互斥：防止 reclaim 与正常消费同时执行同一任务
	lockKey := fmt.Sprintf("lock:exec:%d", task.ExecutionID)
	locked, err := q.rdb.SetNX(ctx, lockKey, consumer, time.Duration(q.cfg.VisibilityTimeoutSec)*time.Second).Result()
	if err != nil {
		// 锁本身出错（Redis 抖动）时**不要**继续往下跑：跳过这一轮，消息不 ACK，
		// 由 reclaim 重投。继续跑的风险是两个 worker 同时执行同一份计划 →
		// 同一个节点被扣两次费（拿不到锁就当成「可能有别人在跑」来对待）。
		log.Printf("[Queue] 任务 %d 加锁失败，本轮跳过，稍后由 reclaim 重投: %v", task.ExecutionID, err)
		return
	}
	if !locked {
		log.Printf("[Queue] 任务 %d 正被其他 worker 处理，稍后由 reclaim 重投", task.ExecutionID)
		return // 不 ACK，留待 reclaim
	}
	defer q.rdb.Del(context.Background(), lockKey)

	// 长任务续租：视频类执行的单次 attempt 上限是 30 分钟（其中上游轮询可达 25 分钟），
	// 而处理中锁的 TTL 与 reclaim 的 MinIdle 是同一个值 —— 不续租的话，执行跑到 TTL 就会被
	// reclaim 抢走、并在锁过期后与本 worker **并发重跑同一个 execution**
	// （线上实证：2026-10-03 01:17–01:19 一个 20 秒窗口里 5 笔扣费退了 8 次）。
	// 续租做两件事：延长处理中锁 + 重置消息 idle 时间（不动投递计数），
	// 让「我还在跑」这件事对 reclaim 可见。执行收尾（含 ACK）时停掉。
	stopRenewal := q.startLeaseRenewal(consumer, msgID, lockKey)
	defer stopRenewal()

	log.Printf("[Queue] ▶ 开始执行: execution=%d project=%s 第%d次尝试", task.ExecutionID, task.ProjectID, task.Retry+1)
	start := time.Now()

	// 登记到「进行中」观测集合（运营端可查看实时并发生成数）；
	// score 为开始时间，过期条目由读取方按时间滑出，worker 崩溃也不会残留
	taskID := strconv.FormatInt(task.ExecutionID, 10)
	_ = q.rdb.ZAdd(ctx, gateKey, redis.Z{Score: float64(start.Unix()), Member: taskID}).Err()
	defer func() { _ = q.rdb.ZRem(context.Background(), gateKey, taskID).Err() }()

	runErr := q.handler(ctx, task)
	elapsed := time.Since(start).Round(time.Millisecond)

	if runErr == nil {
		_ = q.rdb.Set(ctx, doneKey, "1", 24*time.Hour).Err()
		q.ack(msgID)
		log.Printf("[Queue] ✅ 执行成功: execution=%d 耗时=%s", task.ExecutionID, elapsed)
		return
	}

	// 失败：按指数退避重试，超出次数进死信
	log.Printf("[Queue] ❌ 执行失败: execution=%d 耗时=%s err=%v", task.ExecutionID, elapsed, runErr)
	// 「重试有害」的失败（如视频轮询超时：扣费已退、界面已显示失败）：
	// 重试要么重新下发重新扣费（用户以为失败却扣两次），要么复用旧上游任务（免费出片）。
	// 执行状态已由 handler 落为 failed，这里直接确认消息，不重试也不进死信
	if errors.Is(runErr, apperr.ErrNoRetry) {
		log.Printf("[Queue] ⛔ 失败被标记为不重试，直接确认: execution=%d", task.ExecutionID)
		q.ack(msgID)
		return
	}
	task.Retry++
	if task.Retry <= q.cfg.MaxRetry {
		backoff := retryBackoff(task.Retry)
		if err := q.scheduleRetry(ctx, task, backoff); err == nil {
			q.ack(msgID)
			log.Printf("[Queue] ↻ 已安排第 %d 次重试（%s 后）: execution=%d", task.Retry, backoff, task.ExecutionID)
			return
		}
		log.Printf("[Queue] 安排重试失败，转入死信: execution=%d", task.ExecutionID)
	}
	q.toDead(values, fmt.Sprintf("重试 %d 次仍失败: %v", task.Retry-1, runErr))
	q.ack(msgID)
}

func (q *Queue) ack(msgID string) {
	// 用独立 ctx：即使上层 ctx 已取消（关机），ACK 也应完成
	c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := q.rdb.XAck(c, q.cfg.Stream, q.cfg.ConsumerGroup, msgID).Err(); err != nil {
		log.Printf("[Queue] ACK 失败 (%s): %v", msgID, err)
	}
}

func (q *Queue) toDead(values map[string]interface{}, reason string) {
	c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	payload, _ := json.Marshal(values)
	if err := q.rdb.XAdd(c, &redis.XAddArgs{
		Stream: q.cfg.DeadStream,
		MaxLen: q.maxStreamLen,
		Approx: true,
		Values: map[string]interface{}{"task": string(payload), "reason": reason, "at": time.Now().Format(time.RFC3339)},
	}).Err(); err != nil {
		log.Printf("[Queue] 写死信失败: %v", err)
		return
	}
	log.Printf("[Queue] ☠ 转入死信: %s", reason)
}

// HasExecutionLock 判断某个执行当前是否有 worker 在跑（处理中锁存在即为在跑）。
//
// 看门狗用它区分「真卡死」与「只是跑得久」：锁由 worker 持有并**定期续租**
// （见 startLeaseRenewal），所以锁在 = 有人活着在推进，不该被判失败。
func (q *Queue) HasExecutionLock(ctx context.Context, execID int64) bool {
	if q == nil || q.rdb == nil || execID <= 0 {
		return false
	}
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	n, err := q.rdb.Exists(c, fmt.Sprintf("lock:exec:%d", execID)).Result()
	return err == nil && n > 0
}

// startLeaseRenewal 周期性续租「处理中锁 + 队列消息」，返回停止函数（幂等）。
//
// 间隔取可见性超时的 1/3（上限 5 分钟、下限 30 秒）：任何时刻都留有两倍以上余量，
// 即使 Redis 短暂不可用也不会立刻失去租约。
//
// 注意 XClaimJustID 的语义：XCLAIM 会把消息的「最后投递时间」重置为现在（这正是我们要的），
// JUSTID 只是不把投递计数 +1（避免续租把重试次数耗光）。
// 认领到同一个 consumer 名下，消息归属不变。
func (q *Queue) startLeaseRenewal(consumer, msgID, lockKey string) func() {
	ttl := time.Duration(q.cfg.VisibilityTimeoutSec) * time.Second
	if ttl <= 0 {
		ttl = 900 * time.Second
	}
	interval := ttl / 3
	if interval > 5*time.Minute {
		interval = 5 * time.Minute
	}
	if interval < 30*time.Second {
		interval = 30 * time.Second
	}

	done := make(chan struct{})
	var once sync.Once
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
			}
			// 独立 ctx：执行 ctx 可能已取消（如执行超时），续租本身仍应完成
			c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := q.rdb.Expire(c, lockKey, ttl).Err(); err != nil && err != redis.Nil {
				log.Printf("[Queue] ⚠️ 续租处理中锁失败 (%s): %v", lockKey, err)
			}
			claimArgs := &redis.XClaimArgs{
				Stream:   q.cfg.Stream,
				Group:    q.cfg.ConsumerGroup,
				Consumer: consumer,
				MinIdle:  0, // 无条件重置投递时间
				Messages: []string{msgID},
			}
			if err := q.rdb.XClaimJustID(c, claimArgs).Err(); err != nil && err != redis.Nil {
				log.Printf("[Queue] ⚠️ 续租队列消息失败 (%s): %v", msgID, err)
			}
			cancel()
		}
	}()
	return func() {
		once.Do(func() { close(done) })
		wg.Wait()
	}
}

// retryBackoff 指数退避：30s → 1m → 2m → 4m（上限 10 分钟）
func retryBackoff(retry int) time.Duration {
	d := 30 * time.Second
	for i := 1; i < retry; i++ {
		d *= 2
		if d >= 10*time.Minute {
			return 10 * time.Minute
		}
	}
	return d
}

// scheduleRetry 写入延迟重试集合，由 reclaimLoop 到期后重新入队
func (q *Queue) scheduleRetry(ctx context.Context, t Task, after time.Duration) error {
	payload, err := json.Marshal(t)
	if err != nil {
		return err
	}
	return q.rdb.ZAdd(ctx, q.retryKey, redis.Z{
		Score:  float64(time.Now().Add(after).Unix()),
		Member: string(payload),
	}).Err()
}

// ==================== 回收协程（重启续跑的关键）====================

func (q *Queue) reclaimLoop(ctx context.Context) {
	defer q.wg.Done()
	consumer := consumerName("reclaim", 0)
	minIdle := time.Duration(q.cfg.VisibilityTimeoutSec) * time.Second
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// 启动恢复：本进程刚启动，此时 PEL 里的未确认消息必然来自**上一个进程**
	// （本进程尚无正在执行的任务），因此用极短的 idle 阈值立即认领，
	// 不必干等可见性超时 —— 否则发版重启后任务要拖十几分钟才续跑。
	// 阈值取 1 秒而非 0：给 worker 自身启动留一点余量，避免与在途投递竞争。
	// 注：该策略假设单实例部署；多实例时启动恢复可能抢到其他实例正在跑的任务。
	q.clearStaleLocks(ctx)
	q.reclaimOnce(ctx, consumer, time.Second)
	q.moveDueRetries(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		// 常规回收用完整可见性超时，避免抢走其他 worker 正在执行的任务
		q.reclaimOnce(ctx, consumer, minIdle)
		q.moveDueRetries(ctx)
	}
}

// clearStaleLocks 清理上一个进程遗留的「处理中」锁（lock:exec:*）。
//
// 进程被强杀时 defer 释放不会执行，锁会残留到 TTL 到期（= 可见性超时，默认 900s）。
// 若不清理，续跑任务认领后会因 SetNX 失败被判为"正被其他 worker 处理"而反复推迟，
// 相当于把可见性超时又叠加了一遍。本进程刚启动，不存在自己持有的锁，
// 因此这些锁必然属于已终止的上一个进程，可安全清除。
// 注：同样假设单实例部署；多实例下会误删其他实例正在持有的锁。
func (q *Queue) clearStaleLocks(ctx context.Context) {
	var cursor uint64
	cleared := 0
	for {
		keys, next, err := q.rdb.Scan(ctx, cursor, "lock:exec:*", 100).Result()
		if err != nil {
			log.Printf("[Queue] 清理遗留锁失败: %v", err)
			return
		}
		if len(keys) > 0 {
			if err := q.rdb.Del(ctx, keys...).Err(); err == nil {
				cleared += len(keys)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	if cleared > 0 {
		log.Printf("[Queue] 已清理 %d 个上次进程遗留的处理中锁（避免续跑被误判占用）", cleared)
	}
}

// reclaimOnce 认领「超过可见性超时仍未确认」的消息并继续执行。
// 这些消息来自崩溃的 worker 或被重启杀掉的进程 —— 即重启续跑的实现。
func (q *Queue) reclaimOnce(ctx context.Context, consumer string, minIdle time.Duration) {
	msgs, _, err := q.rdb.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   q.cfg.Stream,
		Group:    q.cfg.ConsumerGroup,
		Consumer: consumer,
		MinIdle:  minIdle,
		Start:    "0-0",
		Count:    10,
	}).Result()
	if err != nil {
		if ctx.Err() == nil && err != redis.Nil {
			log.Printf("[Queue] 认领超时任务失败: %v", err)
			if isNoGroupErr(err) {
				_ = q.ensureGroup(ctx)
			}
		}
		return
	}
	if len(msgs) == 0 {
		return
	}
	log.Printf("[Queue] ♻ 认领 %d 个未确认任务（worker 中断/进程重启），继续执行", len(msgs))
	for _, msg := range msgs {
		q.handle(ctx, consumer, msg.ID, msg.Values)
	}
}

// moveDueRetries 把到期的重试任务重新入队
func (q *Queue) moveDueRetries(ctx context.Context) {
	now := float64(time.Now().Unix())
	members, err := q.rdb.ZRangeByScore(ctx, q.retryKey, &redis.ZRangeBy{
		Min: "-inf", Max: strconv.FormatFloat(now, 'f', 0, 64), Count: 20,
	}).Result()
	if err != nil || len(members) == 0 {
		return
	}
	for _, m := range members {
		var t Task
		if err := json.Unmarshal([]byte(m), &t); err != nil {
			_ = q.rdb.ZRem(ctx, q.retryKey, m).Err()
			continue
		}
		payload, _ := json.Marshal(t)
		if err := q.rdb.XAdd(ctx, &redis.XAddArgs{
			Stream: q.cfg.Stream,
			MaxLen: q.maxStreamLen,
			Approx: true,
			Values: map[string]interface{}{"task": string(payload)},
		}).Err(); err != nil {
			log.Printf("[Queue] 重试任务重新入队失败: %v", err)
			continue
		}
		_ = q.rdb.ZRem(ctx, q.retryKey, m).Err()
		log.Printf("[Queue] ↻ 重试任务已重新入队: execution=%d", t.ExecutionID)
	}
}

// decodeTask 解析消息载荷
func decodeTask(values map[string]interface{}) (Task, error) {
	var t Task
	raw, ok := values["task"]
	if !ok {
		return t, fmt.Errorf("消息缺少 task 字段")
	}
	s, ok := raw.(string)
	if !ok {
		return t, fmt.Errorf("task 字段类型异常: %T", raw)
	}
	if err := json.Unmarshal([]byte(s), &t); err != nil {
		return t, err
	}
	if t.ExecutionID == 0 {
		return t, fmt.Errorf("execution_id 为空")
	}
	return t, nil
}
