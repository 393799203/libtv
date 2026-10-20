/**
 * 全站层级（z-index）的**唯一来源**。要调层级只改这里，不要再往组件里写裸数字。
 *
 * 分层规则（从低到高）：
 *
 *   canvasFloat  600  画布上"跟着节点/鼠标走"的浮层：节点工具条、hover 提示条、
 *                     拖拽预览、框选矩形。它们只需要高于画布本身，
 *                     所以必须低于一切弹窗 —— body 级 fixed 本身就高于画布。
 *   canvasMenu   900  画布内弹出层：右键菜单、节点选择弹窗、锚定节点的面板。
 *   modalInline 1000  与 antd 弹窗同一层（antd zIndexPopupBase 默认 1000）。
 *                     自绘弹窗若要和 antd 弹窗互相可嵌套覆盖，就用这一档。
 *                     注意本档与 antd 弹窗的先后由挂载顺序决定。
 *   overlay     1200  沉浸式预览（双击看大图）、全屏加载遮罩。
 *                     高于 antd 弹窗基线，低于 antd 全局提示（message/notification ≈2000），
 *                     这样预览铺满全屏时"保存成功"之类的提示仍然看得见。
 *   modalTop    9999  自绘全屏模态：样式管理、新增剧集、后台弹窗等，压住画布与 antd 弹层。
 *   modalTopAbove 10000  上面这层再叠一层（例如样式管理里弹出的确认框）。
 *
 * 踩过的坑：图片节点工具条曾用 1300，比 antd 弹窗默认的 1000 高 ——
 * 双击查看大图时工具条压在弹窗上面；画布右键菜单（1000）同样被它盖住。
 * 层级的正确关系是"画布浮层 < antd 弹层 < 沉浸式预览 < 全局提示 < 全屏模态"。
 *
 * 不属于本表的层级（画布内部相对关系，留在各自组件/CSS 里即可）：
 * react-flow 节点内部的分层（index.css 的 1000!important / 0、覆盖层内的 10~30）。
 */
export const Z = {
  canvasFloat: 600,
  canvasMenu: 900,
  modalInline: 1000,
  overlay: 1200,
  modalTop: 9999,
  modalTopAbove: 10000,
} as const;
