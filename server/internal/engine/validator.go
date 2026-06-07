package engine

import (
	"fmt"
)

// Validate 校验 WorkflowSchema 的合法性
func Validate(schema *WorkflowSchema) error {
	if len(schema.Nodes) == 0 {
		return fmt.Errorf("no nodes in workflow")
	}

	// 构建邻接表
	nodeSet := make(map[string]bool)
	for _, node := range schema.Nodes {
		nodeSet[node.ID] = true
	}

	adj := make(map[string][]string)   // source → targets
	inDegree := make(map[string]int)    // nodeID → 入度

	for _, node := range schema.Nodes {
		inDegree[node.ID] = 0
	}

	for _, conn := range schema.Connections {
		if !nodeSet[conn.Source] {
			return fmt.Errorf("edge source node %s not found", conn.Source)
		}
		if !nodeSet[conn.Target] {
			return fmt.Errorf("edge target node %s not found", conn.Target)
		}
		adj[conn.Source] = append(adj[conn.Source], conn.Target)
		inDegree[conn.Target]++
	}

	// 环路检测 (Kahn's algorithm)
	queue := make([]string, 0)
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}

	visited := 0
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		visited++
		for _, next := range adj[node] {
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
		}
	}

	if visited != len(schema.Nodes) {
		return fmt.Errorf("cycle detected in workflow")
	}

	return nil
}
