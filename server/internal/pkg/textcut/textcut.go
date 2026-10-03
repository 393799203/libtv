// Package textcut 提供「按字节安全截断」的小工具。
//
// 存在的原因很具体：数据库里 note 是 varchar(255)，中文一个字 3 字节，
// 按字符截 250 会写出 750 字节被 Postgres 直接拒绝（整行写不进去，对账行就丢了）；
// 直接按字节硬切又会切在半个汉字上，同样是非法 UTF-8，一样被拒。
package textcut

import "unicode/utf8"

// NotLongerThan 把 s 截到不超过 maxBytes 字节，且保证不切断 UTF-8 字符。
// 截断时补一个省略号，让读的人知道这里被裁过。
func NotLongerThan(s string, maxBytes int) string {
	if maxBytes <= 0 || len(s) <= maxBytes {
		return s
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
