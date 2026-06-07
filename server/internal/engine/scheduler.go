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
