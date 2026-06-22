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

// FilterFromStart 把 ExecutionPlan 裁剪为只包含 startNodeID 及其所有上游节点
// （用于"只跑这个节点 + 上游依赖"的场景，避免下游节点空跑）
// 裁剪后重新做一次拓扑分层。
func FilterFromStart(plan *ExecutionPlan, startNodeID string) (*ExecutionPlan, error) {
	if startNodeID == "" {
		return plan, nil
	}

	// 检查起点节点存在
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

	// 反向邻接表：target -> [sources...]
	reverseAdj := make(map[string][]string)
	for _, c := range plan.Schema.Connections {
		reverseAdj[c.Target] = append(reverseAdj[c.Target], c.Source)
	}

	// BFS 收集从 startNodeID 出发所有可达祖先
	keep := map[string]bool{startNodeID: true}
	queue := []string{startNodeID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, src := range reverseAdj[cur] {
			if !keep[src] {
				keep[src] = true
				queue = append(queue, src)
			}
		}
	}

	// 筛选节点
	filtered := WorkflowSchema{
		Nodes:       make([]WorkflowNode, 0),
		Connections: make([]Connection, 0),
	}
	for _, n := range plan.Schema.Nodes {
		if keep[n.ID] {
			filtered.Nodes = append(filtered.Nodes, n)
		}
	}
	for _, c := range plan.Schema.Connections {
		if keep[c.Source] && keep[c.Target] {
			filtered.Connections = append(filtered.Connections, c)
		}
	}

	// 重新拓扑分层
	return TopologicalSort(&filtered)
}
