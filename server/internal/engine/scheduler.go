package engine

import "fmt"

// BuildNodePlan 产出「只跑 nodeID 这一个节点」的执行计划。
//
// 为什么只有这一个计划构造器：产品的执行入口只有「节点上的生成按钮」，
// 全图执行与「重新生成下游」都没有入口（handler 会直接拒绝不传 startNodeId 的请求），
// 所以历史上一度存在的 mode/single/downstream 分支是多余的 —— 只剩这一种计划。
//
// 计划由两部分组成，各自都有硬理由：
//   - Levels **只含目标节点**：绝不重跑上游。若这里放全图，画布上每个节点都会被跑一遍
//     并逐个扣费（线上出过这个事故）。
//   - Schema **保留全图的 nodes 与 connections**：执行器要用
//     ExecutionContext.GetUpstreamSources / GetNodeData 反查上游已保存的数据 ——
//     图片节点的风格图通道、视频节点的 mentions 兜底、分镜节点读上游文本、
//     以及清晰化节点对「已有素材重做」的取值，全都依赖它。
//
// 环路检测与边校验由 Validate 负责（Kahn 算法），这里不再重复做拓扑排序：
// 单节点执行不需要层次信息，历史上那次 TopologicalSort 算出的分层会被立刻丢弃。
//
// 将来若要做「一键重跑下游」，在这里加一个 BuildDownstreamPlan(schema, nodeID) 即可：
// Validate 已含环检测，按邻接表取可达子图再分层约 20 行。
func BuildNodePlan(schema *WorkflowSchema, nodeID string) (*ExecutionPlan, error) {
	if schema == nil {
		return nil, fmt.Errorf("nil schema")
	}
	if err := Validate(schema); err != nil {
		return nil, err
	}
	if nodeID == "" {
		return nil, fmt.Errorf("nodeID is required: 只支持单节点执行")
	}

	var target *WorkflowNode
	for i := range schema.Nodes {
		if schema.Nodes[i].ID == nodeID {
			target = &schema.Nodes[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("node not found in canvas: %s", nodeID)
	}

	return &ExecutionPlan{
		Levels: [][]WorkflowNode{{*target}},
		Schema: *schema,
	}, nil
}
