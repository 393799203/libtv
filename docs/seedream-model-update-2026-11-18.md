# 电信生图与语音模型更新

仅修改电信模型清单，华数模型及价格不新增、不替换。

- 电信移除 `doubao-seedream-5.0-lite`，默认改为 `doubao-seedream-5.0-flash`，新增 `doubao-seedream-5.5`，保留 Pro。新模型使用 `/images/generations`，目前只展示 2K、每次一张。旧节点的 4K 在再次调用时改为 2K，按 2K 计费；旧 Lite 再次调用时统一用 Flash，历史记录不批量改写。
- 电信新增 `minimax-speech-2.8-turbo`（默认）和 `minimax-speech-2.8-hd`。使用 OpenAI 兼容的 `/audio/speech`，输出 WAV；`speed` 使用数值，情绪经 `metadata.voice_setting.emotion` 传递，音色使用 MiniMax 系统音色 ID。
- 初始价格：Flash 继承电信 Lite，5.5 继承电信 Pro；两个语音模型沿用站内已有 Qwen 每百字单价（发布前查询为 26 积分／100 字），不覆盖已配置的新模型价格（包括 0），不修改华数价格及历史账单。

## 音频提示词框

MiniMax 节点显示“分段”“停顿”“语气动作”；工具在当前光标处插入，放大编辑也可用。分段保留换行，不拼接额外提示词。停顿可选预设或自定义 0.01～99.99 秒，序列化为 `<#秒数#>`。语气动作显示中文标签，提交时使用 `(laughs)`、`(sighs)` 等官方原生标记。

全句情绪独立于句中动作：支持自动、喜悦、悲伤、愤怒、恐惧、厌恶、惊讶、平静。不展示这两个模型不支持的 whisper、fluent 或 Qwen instructions 风格选项。音色和 0.5～2 倍语速沿用工具栏。

文本中的换行、普通括号及拼音发音标注原样保留。停顿不能位于首尾或连续出现，文本少于 10000 字符；前端校验和后端扣费前校验口径一致。计费继续按原有输入字符数与每百字单价计算，没有新增试听计费入口。

明确的 JSON 拒绝保留原始正文、错误码、request_id/trace_id；未知错误不猜测原因。超时和 5xx 的退款分类沿用现有逻辑，输入校验失败不扣费。

协议依据：MiniMax 同步语音文档 `platform.minimax.io/docs/api-reference/speech-t2a-http.md`、系统音色表 `platform.minimax.io/docs/faq/system-voice-id.md`，以及 OpenAI 兼容网关的 MiniMax metadata 透传结构。

## 验证

```sh
cd server
go test ./...
cd ../web
node --import ./tests/register-loader.mjs --test tests/image-model.test.ts
npx tsc --noEmit -p tsconfig.app.json
npm run build
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/seedream-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/minimax-speech-browser.mjs
```

HTTP 测试使用本地模拟上游，检查渠道、模型 ID、图片参考顺序、语音原生标记、换行、情绪参数和音频字节。价格测试检查渠道隔离、分辨率、幂等及已有价格保留。浏览器使用模拟 API 检查模型、光标插入、校验、参数保存、放大编辑与刷新恢复，并确认华数节点没有新增控件。

2026-11-18 通过只读目录确认电信已列出四个新 ID。未发起真实付费生图或语音合成，真实效果及电信网关对原生参数的实际透传效果未做付费验证。
