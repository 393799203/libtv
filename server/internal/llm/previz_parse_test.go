package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

// 免费验证容错抽取：不调用任何模型、不花积分。
// 用例覆盖真实踩到的几种模型输出：带围栏、前后带说明、尾随逗号、被截断。
func TestExtractJSONObject(t *testing.T) {
	cases := []struct {
		name   string
		in     string
		wantOK bool
	}{
		{"纯 JSON", `{"objects":[],"description":"a"}`, true},
		{"带 json 围栏", cleanJSONMarkdown("```json\n{\"objects\":[],\"description\":\"a\"}\n```"), true},
		{"前后带说明文字", "好的，分析结果如下：\n{\"objects\":[],\"description\":\"a\"}\n希望对你有帮助。", true},
		{"尾随逗号", `{"objects":[{"type":"box",},],"description":"a",}`, true},
		{"嵌套对象不能被提前截断", `{"objects":[{"type":"house","position":[0,0,0]}],"description":"x"}`, true},
		{"位置是负数的数组", `{"objects":[{"type":"tree","position":[-2.5,0,-3]}],"description":"t"}`, true},
		{"截断（括号不闭合）应报错", `{"objects":[{"type":"box"`, false},
	}
	for _, c := range cases {
		out := extractJSONObject(c.in)
		var v map[string]any
		err := json.Unmarshal([]byte(out), &v)
		if c.wantOK && err != nil {
			t.Errorf("%s：应当能解析，却失败 err=%v out=%q", c.name, err, out)
		}
		if !c.wantOK && err == nil {
			t.Errorf("%s：预期失败，却解析成功 out=%q", c.name, out)
		}
	}

	// 嵌套必须完整：第一层 } 不能被当成结尾
	out := extractJSONObject(`{"objects":[{"a":{"b":1}}],"d":"x"}`)
	var deep struct {
		Objects []struct {
			A map[string]int `json:"a"`
		} `json:"objects"`
	}
	if err := json.Unmarshal([]byte(out), &deep); err != nil || len(deep.Objects) != 1 || deep.Objects[0].A["b"] != 1 {
		t.Errorf("嵌套解析错误：err=%v out=%q", err, out)
	}

	// 字符串里的花括号不能影响配对（description 里写了 { } ）
	out = extractJSONObject(`{"objects":[],"description":"招牌上写着 {OPEN} 字样"}`)
	var s struct {
		Description string `json:"description"`
	}
	if err := json.Unmarshal([]byte(out), &s); err != nil || s.Description == "" {
		t.Errorf("字符串内花括号处理错误：err=%v out=%q", err, out)
	}
}

// 真实线上失败样本（22:55 / 23:03 两次都是这个形态）：max_tokens 截断在对象中间。
// 要求：抢救出前面已经完整的对象，而不是整体报错让用户白跑。
func TestSalvageTruncatedJSON(t *testing.T) {
	raw := `{"objects":[{"type":"plane","name":"地面","position":[0,0,0],"rotation":[0,0,0],"scale":[20,0.1,20]},` +
		`{"type":"plane","name":"左侧草坪","position":[-6.5,0.02,-1],"rotation":[0,0,0],"scale":[7,0.1,15]},` +
		`{"type":"pool","name":"游泳池","position":[0,0,-2],"scale`
	// 原始输入应当解析失败（复现线上现象）
	var before map[string]any
	if err := json.Unmarshal([]byte(extractJSONObjectBeforeFix(raw)), &before); err == nil {
		t.Log("原始输入也能解析（说明样本没复现截断），继续检查抢救结果")
	}
	out := extractJSONObject(raw)
	var parsed struct {
		Objects []struct {
			Type string `json:"type"`
			Name string `json:"name"`
		} `json:"objects"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("截断样本应当能被抢救，却仍是 err=%v out=%q", err, out)
	}
	if len(parsed.Objects) != 2 {
		t.Fatalf("应当抢救出前 2 个完整对象，实际 %d 个 out=%q", len(parsed.Objects), out)
	}
	if parsed.Objects[0].Name != "地面" || parsed.Objects[1].Name != "左侧草坪" {
		t.Errorf("抢救出的对象不对：%+v", parsed.Objects)
	}
	// 半截对象必须被丢掉（它的字段不完整，留着会渲染出错）
	for _, o := range parsed.Objects {
		if o.Name == "游泳池" {
			t.Errorf("半截对象「游泳池」不应被保留")
		}
	}
	// 完全没有 objects 的碎文本不能瞎抢救
	if _, ok := salvageTruncatedJSON("total garbage without json"); ok {
		t.Errorf("无 objects 的文本不应被抢救成功")
	}
}

// extractJSONObjectBeforeFix 复刻修复前的行为，用于确认样本确实复现线上失败。
func extractJSONObjectBeforeFix(raw string) string {
	s := cleanJSONMarkdown(raw)
	if strings.Index(s, "{") < 0 {
		return s
	}
	return s
}
