package handler

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"libtv/internal/billing"
	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/apperror"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
)

/**
 * ObjectRecognizeHandler 点选识别：POST /api/images/recognize-object
 *
 * 作用：用户在图上点一下（归一化坐标）→ 视觉模型说出"那是什么"并给出外接框。
 * 前端拿到后把点选的小圆圈换成物体的真实外接框，并把名字显示出来；
 * 名字随改图请求一起发给后端，最终进入改图指令（"把「自动售货机」去掉"），
 * 补上"这个"没有指代的问题（详见 llm.RecognizeObjectAt 的注释）。
 *
 * 为什么不做成"每次点选都真调一次上游"：视觉模型要 5~16s，同一处连点几次
 * （用户想放大看看、改一下框）没必要重复付费，这里按 (图片, 点) 做 10 分钟缓存。
 *
 * 计费：按「点选识别」维度（node_type=recognize，默认 2 积分/次，价格管理页可改）扣费。
 * 扣费点在限流与缓存之后：同一处连点命中缓存不重复扣费；上游报错自动退还；
 * 被限流/余额不足时根本没调上游，也就没扣。
 */
type ObjectRecognizeHandler struct {
	llm            *llm.Client
	modelManager   *llm.ModelManager
	channelService *service.ChannelService
	ops            *service.ImageOpsService
	// biller 扣费：识别是一次真实的视觉模型调用，按「点选识别」维度（价格管理页可改）计费
	biller *billing.Service
	// providerTasks 对账账本：一次扣费 = 一次 AI 调用，要留痕；上游明确报错才自动退
	providerTasks *billing.Ledger
	cache         *recognizeCache
	limiter       *recognizeLimiter
}

func NewObjectRecognizeHandler(client *llm.Client, mm *llm.ModelManager, cs *service.ChannelService, ops *service.ImageOpsService, biller *billing.Service, ledger *billing.Ledger) *ObjectRecognizeHandler {
	return &ObjectRecognizeHandler{
		llm:            client,
		modelManager:   mm,
		channelService: cs,
		ops:            ops,
		biller:         biller,
		providerTasks:  ledger,
		cache:          newRecognizeCache(10 * time.Minute),
		limiter:        newRecognizeLimiter(30),
	}
}

// RecognizeObjectRequest 点选识别请求
type RecognizeObjectRequest struct {
	ImageURL  string  `json:"imageUrl"`  // 要识别的图（画布上当前显示的那张）
	X         float64 `json:"x"`         // 归一化坐标（左上为原点，0~1）
	Y         float64 `json:"y"`         //
	Radius    float64 `json:"radius"`    // 点选时的笔刷圈半径（相对图宽，0~1）：告诉模型要认的那一片多大
	Model     string  `json:"model"`     // 可选：指定视觉模型 ID
	ProjectID string  `json:"projectId"` // 所在项目（对账页显示项目名，可选）
	NodeID    string  `json:"nodeId"`    // 在哪个图片节点上点的（对账页据此解析节点名，可选）
}

// RecognizeObjectResponse 识别结果；label 与 box 可能只有其一（都没识别出来时返回 200 + 空值）
type RecognizeObjectResponse struct {
	Label string     `json:"label"`
	Box   *llm.Box2D `json:"box"`
	// Candidates 由具体到宽泛的层级（点鼻子 → 鼻子/人脸/人物），前端列出来让用户选用哪一层。
	// 空数组 = 只有一层（老行为），前端按老样子处理。
	Candidates []llm.RecognizedCandidate `json:"candidates,omitempty"`
	Model      string                    `json:"model"`
	Cached     bool                      `json:"cached"`
	// Charged 本次扣了多少积分（0 = 命中缓存或未配置价格；前端据此展示"扣 N 积分"）
	Charged  int64  `json:"charged"`
	ImageURL string `json:"imageUrl"` // 回显：前端据此丢弃过期的识别结果
}

// RecognizeObject 点选识别：POST /api/images/recognize-object
func (h *ObjectRecognizeHandler) RecognizeObject(c *gin.Context) {
	var req RecognizeObjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求参数错误: "+err.Error())
		return
	}
	if strings.TrimSpace(req.ImageURL) == "" {
		response.Fail(c, http.StatusBadRequest, "缺少图片地址")
		return
	}
	if h.ops != nil && !h.ops.HostAllowed(req.ImageURL) && !strings.HasPrefix(req.ImageURL, "data:") {
		response.Fail(c, http.StatusBadRequest, "图片来源域名不在白名单内（仅允许本站对象存储域名）")
		return
	}
	if req.X < 0 || req.X > 1 || req.Y < 0 || req.Y > 1 {
		response.Fail(c, http.StatusBadRequest, "点选坐标需为 0~1 的归一化值")
		return
	}

	userID := middleware.GetUserID(c)
	// 解析用户最终渠道，视觉模型走对应渠道的 token
	channel := "wasu"
	if h.channelService != nil {
		channel = h.channelService.ResolveUserChannel(c.Request.Context(), userID)
	}
	visionModel := h.pickVisionModel(channel, req.Model)
	if visionModel == nil {
		response.Fail(c, http.StatusBadRequest, "当前渠道没有可用的视觉模型")
		return
	}
	modelID := visionModel.ModelID
	// 输出预算取模型自己配置的额度（models.yaml 的 max_tokens）：
	// deepseek 系模型会先思考几百到几千 token，预算不足会返回空内容（"看起来不可用"）
	maxTokens := visionModel.MaxTokens

	// 反滥用：这条接口每次点击都真调一次上游（虽已扣费，但成本要挡住刷量），
	// 缓存只挡得住"同一处连点"，挡不住有人换着点把上游额度刷光。
	// 限流按用户自然分钟切窗口，用内存计数（单实例部署；不做成 Redis 是不想占用生成限流的配额桶）。
	// 超限只挡识别、不影响改图生成本身。
	if !h.limiter.allow(middleware.GetUserID(c), time.Now()) {
		response.Fail(c, http.StatusTooManyRequests, "识别太频繁了，稍等一下再点（每分钟 30 次）")
		return
	}

	// 缓存：同一张图、同一个点，10 分钟内不重复调上游
	key := fmt.Sprintf("%s|%.2f|%.2f|%s", req.ImageURL, req.X, req.Y, modelID)
	if hit, ok := h.cache.get(key); ok {
		hit.Cached = true
		// 命中缓存 = 没有再调上游 = **没有再扣费**：charged 必须回 0，
		// 否则前端会对着同一处点两下就显示两次"识别扣 2 积分"（实测发现过）。
		hit.Charged = 0
		response.OK(c, hit)
		return
	}

	start := time.Now()

	// ---- 扣费（必须在这里：前面已经过了限流与缓存，命中缓存时不该再扣一次）----
	// 渠道必须先进 ctx：定价按「渠道 + 节点 + 模型」查表，不注入会回退 wasu，
	// 电信独有的 glm-5.3-flash 在 wasu 价格表里查不到 → cost=0 → 既不扣费也不拦余额。
	billCtx := llm.WithUsageRecorder(llm.WithChannel(c.Request.Context(), channel))
	chargeKey := billing.NewChargeKey()
	billCtx = billing.WithChargeKey(billCtx, chargeKey)
	charged, err := h.biller.ChargeByModel(billCtx, userID, billing.ActionRecognizeObject, modelID, "点选识别", 1)
	if err != nil {
		// 余额不足等：直接按计费的错误语义回（前端不弹错，只在提示框里说明一句）
		c.JSON(apperror.HTTPStatusFromError(err), gin.H{
			"code": apperror.CodeFromError(err),
			"msg":  apperror.MsgFromError(err),
		})
		return
	}
	call := billing.SyncCall{
		Ledger: h.providerTasks, Biller: h.biller, ChargeKey: chargeKey,
		Kind: billing.ActionRecognizeObject, Scene: "点选识别", Model: modelID,
		Provider: llm.ChannelFrom(billCtx), UserID: userID, ProjectID: req.ProjectID,
		NodeID: trimID(req.NodeID), Charged: charged,
	}
	call.Write(billCtx, billing.StatusSubmitted, "", 0)

	// 图取回来缩到长边 1024 再传上游：实测 4K 直传要 8139 tokens / 59s，缩完 905 tokens / 16s
	ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Second)
	defer cancel()
	thumb, err := h.ops.FetchForVision(ctx, req.ImageURL, 1024)
	if err != nil {
		// URL 一定要打：之前这条日志只有错误没有地址，线上排查只能靠猜 ——
		// 我先猜成"缩略图"，实际是两个原图本身就是 webp 的节点（见 FetchForVision 的注释）
		log.Printf("[Recognize] 取图失败: 图片=%s err=%v", truncateURL(req.ImageURL), err)
		// 请求根本没发到上游，上游不可能计费 → 这钱必须退（与白模解析同一条规则）
		if refundErr := h.biller.RefundDetached(billCtx, userID, charged,
			billing.ActionRecognizeObject, modelID, "点选识别",
			"图片读取失败（未调用上游）", billing.ChargeExtra{ChargeKey: chargeKey}); refundErr != nil {
			log.Printf("[Recognize] 退费失败（取图失败）: %v", refundErr)
			call.Write(billCtx, billing.StatusPendingReview, "取图失败且退费失败，待人工处理", 0)
		} else {
			call.Write(billCtx, billing.StatusRefunded, "图片读取失败（未调用上游），已退还本次扣费", charged)
		}
		response.Fail(c, http.StatusBadGateway, "读取图片失败: "+err.Error())
		return
	}
	dataURI := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)

	// 视觉调用给 90s 上限：关思考后实测 2s，但模型偶尔会"想很久"（不关思考时见过 49s），
	// 没有上限会让请求一直挂着；超时按平台规则交人工（不退费）。
	//
	// 必须从 billCtx 派生而不是从 c.Request.Context() 派生：用量采集器挂在 billCtx 上，
	// 上游 token 由调用链登记进那个采集器，对账行再 Snapshot 取一次。之前这里另起了一个
	// 不带采集器的 ctx，结果对账行的 provider_tokens 永远是 0（对账页显示"上游未回带用量"）。
	ctx2, cancel2 := context.WithTimeout(billCtx, 90*time.Second)
	defer cancel2()
	rad := req.Radius
	if rad < 0 {
		rad = 0
	}
	if rad > 0.5 {
		rad = 0.5
	}
	// 两段式识别（实测数据决定的结构）：
	//   第一段关思考：deepseek 2~3s、23~34 tokens（比带思考快 5 倍、便宜 40 倍），
	//     清晰物体与背景（"无"）都判得又准又稳；
	//   但关思考偶尔会把**别处**的物体名字安到用户点的地方，所以加一道"框必须罩住点击处"的闸门：
	//     没罩住 → 第二段带思考再问一遍（4~14s，实测这一遍能把"房屋"这类判对）。
	// 只在"答错位置"时才付第二次调用的钱；答"无"不升级（背景判断本来就稳，不该白等十几秒）。
	escalated := false
	obj, err := h.recognizeAt(ctx2, modelID, dataURI, req.X, req.Y, rad, maxTokens, true)
	if err == nil && obj.FoundObject() && !obj.Box.ContainsPoint(req.X, req.Y, recognizePointTolerance) {
		log.Printf("[Recognize] 关思考的结果没罩住点击处，带思考再问一遍: model=%s label=%q box=%v 点=(%.3f,%.3f)",
			modelID, obj.Label, obj.Box, req.X, req.Y)
		if better, err2 := h.recognizeAt(ctx2, modelID, dataURI, req.X, req.Y, rad, maxTokens, false); err2 == nil && better.FoundObject() {
			// 带思考的结果优先（实测更准）；即使它也没罩住点击处，也比"答到别处"更可信
			escalated = true
			obj = better
		}
	}
	if err != nil {
		// 识别失败不是致命错误：前端会退回"用户自己画的那个圈"，不影响后续生成。
		// 钱按平台统一规则处理：上游明确报错 → 自动退；超时/没拿到结果 → 交人工（不退）。
		log.Printf("[Recognize] 识别失败: channel=%s model=%s 点=(%.3f,%.3f) err=%v", channel, modelID, req.X, req.Y, err)
		settled := call.Settle(llm.WithChannel(context.WithoutCancel(c.Request.Context()), llm.ChannelFrom(billCtx)), err)
		response.Fail(c, http.StatusBadGateway, "识别失败: "+settled.Error())
		return
	}
	call.Write(billCtx, billing.StatusDelivered, "", 0)

	out := &RecognizeObjectResponse{
		Label: obj.Label, Box: obj.Box, Candidates: obj.Candidates,
		Model: modelID, ImageURL: req.ImageURL, Charged: charged,
	}
	h.cache.put(key, out)
	// 日志带上 token 用量：这条接口不扣费，成本核算只能靠日志（用户问过"识别花了多少"）
	log.Printf("[Recognize] 完成: channel=%s model=%s 点=(%.3f,%.3f) label=%q box=%v tokens=%d+%d 扣费=%d 带思考补问=%v 耗时=%s 图片=%s",
		channel, modelID, req.X, req.Y, out.Label, out.Box, obj.PromptTokens, obj.CompletionTokens, charged, escalated,
		time.Since(start).Round(time.Millisecond), truncateURL(req.ImageURL))
	response.OK(c, out)
}

// recognizePointTolerance 判定"框是否罩住点击处"的容差（归一化；0.02 ≈ 4K 图 77px）
const recognizePointTolerance = 0.02

// recognizeAt 调一次视觉识别（thinking 开关由调用方定），失败原样返回错误。
func (h *ObjectRecognizeHandler) recognizeAt(ctx context.Context, modelID, dataURI string, x, y, radius float64, maxTokens int, disableThinking bool) (*llm.RecognizedObject, error) {
	start := time.Now()
	obj, err := h.llm.RecognizeObjectAt(ctx, llm.RecognizeRequest{
		Model:           modelID,
		ImageDataURI:    dataURI,
		X:               x,
		Y:               y,
		Radius:          radius,
		DisableThinking: disableThinking,
		MaxTokens:       maxTokens, // 模型配置里的额度（deepseek 给少了会返回空）
	})
	if err != nil {
		return nil, err
	}
	if disableThinking {
		log.Printf("[Recognize] 首段（关思考）: model=%s 点=(%.3f,%.3f) → label=%q box=%v tokens=%d+%d 耗时=%s",
			modelID, x, y, obj.Label, obj.Box, obj.PromptTokens, obj.CompletionTokens,
			time.Since(start).Round(time.Millisecond))
	}
	return obj, nil
}

/**
 * pickVisionModel 选视觉模型，返回模型配置（要读它的 max_tokens 当输出预算）。
 *
 * 默认值来自实测（2026-10-17，用户指定的 deepseek 优先）：
 *   deepseek-v4.1-flash —— 关思考后 **2s**，框最紧、成本最低（598+34 tokens）；
 *        不关思考时思考量在 453~3441 token 间飘，耗时 5~28s（点在空白处甚至 49s 还在想）。
 *        **必须给足 max_tokens 或关思考**：预算不足时它把预算全花在思考上，返回空 content。
 *   glm-5.3-flash —— 9~26s，思考 319~618 token，结论一致，作兜底；
 *        注意它**不接受** thinking 参数（dianxin 会回 InvalidParameter）。
 *   doubao-seed-2.1-turbo —— 3~5s，也接受关思考。
 *
 * 前端可传 model 覆盖，但必须在该渠道的模型清单里（FindModelByIDForChannel 会挡）。
 */
func (h *ObjectRecognizeHandler) pickVisionModel(channel, requested string) *llm.ModelConfig {
	if h.modelManager == nil {
		return nil
	}
	if requested != "" {
		if cfg := h.modelManager.FindModelByIDForChannel(channel, requested); cfg != nil {
			return cfg
		}
	}
	fallbacks := []string{"deepseek-v4.1-flash", "doubao-seed-2.1-turbo", "glm-5.3-flash"}
	if channel == "dianxin" {
		fallbacks = []string{"deepseek-v4.1-flash", "glm-5.3-flash", "doubao-seed-2.1-turbo"}
	}
	for _, id := range fallbacks {
		if cfg := h.modelManager.FindModelByIDForChannel(channel, id); cfg != nil {
			return cfg
		}
	}
	return nil
}

// ========== 结果缓存 ==========

// recognizeCache 极简 TTL 缓存：同一张图同一个点的重复点击不重复调上游。
// 刻意不做 LRU 淘汰的复杂实现：键里带 10 分钟窗口，条目自然作废；条目数上限兜住内存。
type recognizeCache struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]recognizeCacheEntry
}

type recognizeCacheEntry struct {
	at     time.Time
	result *RecognizeObjectResponse
}

const recognizeCacheMaxEntries = 512

func newRecognizeCache(ttl time.Duration) *recognizeCache {
	return &recognizeCache{ttl: ttl, data: make(map[string]recognizeCacheEntry)}
}

func (c *recognizeCache) get(key string) (*RecognizeObjectResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.data[key]
	if !ok || time.Since(entry.at) > c.ttl {
		delete(c.data, key)
		return nil, false
	}
	// 返回副本：调用方会往结构里写 cached 字段，不能污染缓存里的那份
	cp := *entry.result
	return &cp, true
}

func (c *recognizeCache) put(key string, result *RecognizeObjectResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.data) >= recognizeCacheMaxEntries {
		// 满了就清掉过期项；仍然满就整体清空（这种量级说明有人在刷，重来一遍比扩内存划算）
		for k, v := range c.data {
			if time.Since(v.at) > c.ttl {
				delete(c.data, k)
			}
		}
		if len(c.data) >= recognizeCacheMaxEntries {
			c.data = make(map[string]recognizeCacheEntry)
		}
	}
	cp := *result
	c.data[key] = recognizeCacheEntry{at: time.Now(), result: &cp}
}

// truncateURL 日志里只留文件名，避免刷屏
func truncateURL(u string) string {
	if len(u) <= 60 {
		return u
	}
	if i := strings.LastIndex(u, "/"); i >= 0 && i < len(u)-1 {
		return "…/" + u[i+1:]
	}
	return u[:60] + "…"
}

// ========== 反滥用限流 ==========

// recognizeLimiter 每用户每分钟的识别次数上限（内存固定窗口）。
//
// 为什么用内存而不是现成的 Redis 限流：cache.AllowRate 的 key 与"生成限流"共用
// （rl:gen:<user>:<window>），复用会让点选识别消耗用户的生成配额，甚至把生成挡掉 ——
// 识别只是改图的辅助步骤，绝不能影响主流程。单实例部署下内存计数足够。
type recognizeLimiter struct {
	mu       sync.Mutex
	perMin   int
	counters map[string]recognizeWindow
}

type recognizeWindow struct {
	window int64
	count  int
}

func newRecognizeLimiter(perMinute int) *recognizeLimiter {
	return &recognizeLimiter{perMin: perMinute, counters: make(map[string]recognizeWindow)}
}

// allow 判断该用户本分钟是否还能识别；未登录（userID 为空）不计数（鉴权中间件已挡在前面）
func (l *recognizeLimiter) allow(userID string, now time.Time) bool {
	if l == nil || l.perMin <= 0 || userID == "" {
		return true
	}
	window := now.Unix() / 60
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.counters) > 4096 {
		// 兜住内存：条目多了就丢掉过期的（正常量级到不了这里）
		for k, v := range l.counters {
			if v.window != window {
				delete(l.counters, k)
			}
		}
	}
	cur := l.counters[userID]
	if cur.window != window {
		cur = recognizeWindow{window: window}
	}
	cur.count++
	l.counters[userID] = cur
	return cur.count <= l.perMin
}

// trimID 收敛前端传来的 id：只留合理长度（防超长字段把对账行写炸），空值原样返回。
func trimID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) > 64 {
		return id[:64]
	}
	return id
}
