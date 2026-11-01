import type { NodeType } from './canvas';

export type AssistantNodeType = Extract<NodeType, 'text' | 'script' | 'image' | 'video' | 'audio'>;

// Project canvas plans complement the existing global assistant command protocol.

export interface AssistantSnapshot {
  nodes: { id: string; type: string; data: Record<string, unknown> }[];
  connections: { source: string; target: string }[];
  selectedNodeIds: string[];
  totalNodes: number;
}

export interface AssistantPlan {
  message: string;
  nextSteps: string[];
  createNodes: {
    id: string;
    type: AssistantNodeType;
    label: string;
    prompt: string;
    content?: string;
    scriptNodeId?: string;
    shotId?: string;
    refIndex?: number;
  }[];
  updateNodes: { nodeId: string; label?: string; prompt?: string }[];
  connections: { source: string; target: string }[];
  generateNodeIds: string[];
}

export interface AssistantTask {
  nodeIds: string[];
  basis: string;
  submitted: boolean;
  submittedNodeIds?: string[];
  error?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  nextSteps?: string[];
  result?: string;
  error?: boolean;
  task?: AssistantTask;
  references?: AssistantNodeReference[];
}

export interface AssistantNodeReference {
  id: string;
  label: string;
  alias?: string;
}
