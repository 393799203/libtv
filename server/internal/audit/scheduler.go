package audit

import (
	"context"
	"log"
	"time"
)

// Start 启动定时自检：启动后先跑一次（等主流程就绪），之后每 interval 跑一遍。
//
// 为什么用进程内 ticker 而不是外部 cron：这是一个单实例后端，且自检只读本地库，
// 放进进程里少一个部署件、也天然跟着服务一起重启。多实例时要改成分布式锁（届时再动）。
func (c *Checker) Start(ctx context.Context, interval time.Duration, initialDelay time.Duration) {
	if c == nil {
		return
	}
	if interval <= 0 {
		interval = 10 * time.Minute
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(initialDelay):
		}
		c.runLogged(ctx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("[Audit] 一致性自检已停止")
				return
			case <-ticker.C:
				c.runLogged(ctx)
			}
		}
	}()
	log.Printf("[Audit] 一致性自检已启动：首次 %s 后，之后每 %s 一次", initialDelay, interval)
}

// RunLogged 手动触发一次（后台「立即核对」按钮用）
func (c *Checker) RunLogged(ctx context.Context) *Report {
	return c.runLogged(ctx)
}

func (c *Checker) runLogged(ctx context.Context) *Report {
	report, err := c.RunOnce(ctx)
	if err != nil {
		log.Printf("[Audit] ⚠️ 一致性自检失败: %v", err)
		return nil
	}
	return report
}
