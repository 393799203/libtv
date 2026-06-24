package engine

import "fmt"

// TopologicalSort 对 WorkflowSchema 进行拓扑排序，生成分层执行计划
func TopologicalSort(schema *WorkflowSchema) (*ExecutionPlan, error) {
	// 构建邻接表和入度
	nodeMap := make(map[string]WorkflowNode)
	adj := make(map[string][]string)
	inDegree := make(map[string]int)

	for _, node := range schema.Nodes {
		nodeMap[node.ID] = node
		inDegree[node.ID] = 0
	}

	for _, conn := range schema.Connections {
		adj[conn.Source] = append(adj[conn.Source], conn.Target)
		inDegree[conn.Target]++
	}

	// BFS 分层
	var levels [][]WorkflowNode
	queue := make([]string, 0)

	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}

	for len(queue) > 0 {
		// 当前层所有入度为0的节点
		level := make([]WorkflowNode, 0, len(queue))
		for _, id := range queue {
			level = append(level, nodeMap[id])
		}
		levels = append(levels, level)

		// 处理下一层
		var nextQueue []string
		for _, id := range queue {
			for _, target := range adj[id] {
				inDegree[target]--
				if inDegree[target] == 0 {
					nextQueue = append(nextQueue, target)
				}
			}
		}
		queue = nextQueue
	}

	if len(levels) == 0 {
		return nil, fmt.Errorf("empty execution plan")
	}

	return &ExecutionPlan{
		Levels: levels,
		Schema: *schema,
	}, nil
}

// FilterSingle 把 ExecutionPlan 裁剪为只跑 startNodeID 一个节点（Level）。
// 用于节点内"生成"按钮：用户改了一个节点的 prompt，只想重跑这个节点，
// 其它节点（包括上游）保持现状（由前端打 stale 标）。
//
// 注意：保留 Schema 的全部 connections + 全部 nodes.data（用于节点执行时从
// ExecutionContext.GetNodeData 读到上游已保存的数据），但 Levels 只跑当前节点。
func FilterSingle(plan *ExecutionPlan, startNodeID string) (*ExecutionPlan, error) {
	if startNodeID == "" {
		return plan, nil
	}

	var found bool
	for _, n := range plan.Schema.Nodes {
		if n.ID == startNodeID {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("startNodeID not found in plan: %s", startNodeID)
	}

	// 1) Levels 只跑 startNode
	filteredLevels := make([][]WorkflowNode, 0, 1)
	for _, level := range plan.Levels {
		newLevel := make([]WorkflowNode, 0, len(level))
		for _, n := range level {
			if n.ID == startNodeID {
				newLevel = append(newLevel, n)
			}
		}
		if len(newLevel) > 0 {
			filteredLevels = append(filteredLevels, newLevel)
		}
	}

	// 2) Schema 保留全部 nodes（含上游 data）和 connections（让执行器能反查上游）
	return &ExecutionPlan{
		Levels: filteredLevels,
		Schema: plan.Schema,
	}, nil
}

// FilterDownstream 把 ExecutionPlan 裁剪为 startNodeID 的所有 BFS 后代（不包含 startNodeID 本身执行）。
// 用于"上游节点改了，重新生成下游"按钮：从 startNode 出发，沿正向邻接表
// 收集所有可达节点。startNode 自身已生成过，不需要重新执行。
//
// 关键：保留 startNode 在 Schema 中（含其 data + 到下游的连接），
// 让下游执行器可以通过 ExecutionContext.GetUpstreamSources / GetNodeData 读取上游输出。
// 只在 Levels 中排除 startNode（不实际执行它）。
func FilterDownstream(plan *ExecutionPlan, startNodeID string) (*ExecutionPlan, error) {
	if startNodeID == "" {
		return plan, nil
	}

	var found bool
	for _, n := range plan.Schema.Nodes {
		if n.ID == startNodeID {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("startNodeID not found in plan: %s", startNodeID)
	}

	// 收集所有后代节点（不含 startNode 本身）
	downstreamOnly := map[string]bool{}
	queue := []string{startNodeID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range plan.Schema.Connections {
			if c.Source == cur && !downstreamOnly[c.Target] {
				downstreamOnly[c.Target] = true
				queue = append(queue, c.Target)
			}
		}
	}

	// keep 集合：下游节点 + startNode（保留 startNode data 供下游读取）
	keep := map[string]bool{}
	keep[startNodeID] = true
	for id := range downstreamOnly {
		keep[id] = true
	}

	// 构建 Schema：保留 startNode + 所有下游节点 + 相关连接（含 startNode→下游）
	filteredSchema := WorkflowSchema{
		Nodes:       make([]WorkflowNode, 0),
		Connections: make([]Connection, 0),
	}
	for _, n := range plan.Schema.Nodes {
		if keep[n.ID] {
			filteredSchema.Nodes = append(filteredSchema.Nodes, n)
		}
	}
	for _, c := range plan.Schema.Connections {
		// 保留涉及 keep 集合中节点的连接（包括 startNode → 下游）
		if keep[c.Source] && keep[c.Target] {
			filteredSchema.Connections = append(filteredSchema.Connections, c)
		}
	}

	// 构建 Levels：只包含下游节点（不执行 startNode）
	// 从原始 plan.Levels 中过滤掉 startNode
	filteredLevels := make([][]WorkflowNode, 0)
	for _, level := range plan.Levels {
		newLevel := make([]WorkflowNode, 0)
		for _, n := range level {
			if n.ID != startNodeID && downstreamOnly[n.ID] {
				newLevel = append(newLevel, n)
			}
		}
		if len(newLevel) > 0 {
			filteredLevels = append(filteredLevels, newLevel)
		}
	}

	return &ExecutionPlan{
		Levels: filteredLevels,
		Schema: filteredSchema,
	}, nil
}
