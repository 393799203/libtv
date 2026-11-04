# 分镜生成失败修复（2026-11-04）

排查范围：北京时间 2026-11-04 16:00–18:00，反馈账号的同一分镜节点。
证据来自线上 `workflow_executions` 和 `provider_tasks`，没有重新执行历史任务。

## 现象和原因

7 次生成中 2 次成功、5 次失败：

| 执行 | 提交时间 | 模型 | 结果 |
| --- | --- | --- | --- |
| 1619 | 16:25:42 | DeepSeek V4.1 Flash | `duration: 3.5` 无法解码到 Go `int` |
| 1620 | 16:29:16 | DeepSeek V4.1 Flash | `duration: 2.5` 无法解码到 Go `int` |
| 1621 | 16:55:52 | DeepSeek V4.1 Flash | 成功 |
| 1622 | 17:05:42 | DeepSeek V4.1 Flash | JSON 在字段值后出现非法 `+` |
| 1623 | 17:10:00 | GLM 5.3 Flash | 等待响应头满 5 分钟触发客户端超时 |
| 1624 | 17:32:52 | DeepSeek V4.1 Flash | 成功 |
| 1625 | 17:41:55 | DeepSeek V4.1 Flash | 输出 JSON 非法；错误摘要按字节截断中文，失败状态写入被数据库拒绝，后经人工修正 |

历史响应原文未完整保留，因此不能确定 1622 的 `+` 两侧具体内容，也不能重建 1625 的原始语法错误。
5 笔失败记录均已标记人工退费，每笔 30 积分。本次修复不改动历史账单或画布内容。

## 修复

- 分镜时长改为浮点数，保留 2.5、3.5 等小数秒；后续视频生成可接收这些数值，
  并在请求模型和计费之前统一取整、应用现有模型时长范围。
- 分镜请求使用 `response_format: {"type":"json_object"}`；只有上游明确拒绝该参数时
  才移除参数再请求。网络超时、5xx、429 或已经返回的无效内容不会自动再次生成。
- 提示词明确禁止字符串拼接和数值表达式；本地可安全合并字段值中的
  `"文本" + "文本"`，保留转义字符，不执行任意表达式，不猜补截断的镜头。
- 解析成功还需检查镜头非空、时长为正，避免无效结果被标记为交付。
- 分镜独立使用 10 分钟请求预算，同时覆盖客户端和响应头超时；共享客户端和调用方的
  更短取消期限保持有效。上游仍可能超时，未知结果继续沿用人工复核策略。
- GLM 5.3 分镜显式使用 `reasoning_effort: "low"`；上游明确拒绝该参数时单独移除，
  不影响 JSON 输出约束。官方文档说明该模型强制思考，默认强度为 `max`：
  <https://docs.bigmodel.cn/cn/guide/capabilities/thinking>。
- 错误摘要按 Unicode 字符边界截断；执行记录写入前再修复非法 UTF-8 并限制长度，
  避免错误文本阻止失败终态落库。

## 验证

默认测试不访问真实渠道：

```sh
cd server
go test ./...
go test -race ./internal/llm ./internal/repository ./internal/engine
```

真实渠道验证使用合成的 45 秒口播，直接调用配置中的电信渠道，不经过用户扣费或画布写入：

```sh
LIBTV_SCRIPT_E2E=1 LIBTV_SCRIPT_MODEL=deepseek-v4.1-flash \
  go test ./internal/llm -run '^TestManualE2E_Script$' -v -count=1 -timeout=12m
LIBTV_SCRIPT_E2E=1 LIBTV_SCRIPT_MODEL=glm-5.3-flash \
  go test ./internal/llm -run '^TestManualE2E_Script$' -v -count=1 -timeout=12m
```

真实渠道验证记录：

- DeepSeek 在 115.75 秒内返回 12 个镜头，总时长 45 秒；仅一次已受理调用。
- GLM 默认推理强度下，完整分镜请求等待 10 分钟仍未返回响应头。
- GLM 短 JSON 请求正常，增加 `reasoning_effort: "low"` 后短请求也正常。
- GLM 使用 `low` 后，完整分镜请求在 371.26 秒内返回 15 个镜头，总时长 45 秒；
  仅一次已受理调用。此次耗时仍超过原来的 5 分钟上限，10 分钟预算有实际作用。
- 最终后端修复于北京时间 21:14:52 上线；上线前后均检查无活跃生成，未强制中断任务。
  线上首页、公开 API 和部署文件一致性检查正常。
