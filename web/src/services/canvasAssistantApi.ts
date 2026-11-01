import api from './api';
import type { AssistantPlan, AssistantSnapshot } from '@/types/assistant';

export function chatWithCanvasAssistant(
  projectId: string,
  request: {
    message: string;
    model: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    snapshot: AssistantSnapshot;
  },
  signal: AbortSignal,
): Promise<{ plan: AssistantPlan; model: string; charged: number; replayed?: boolean }> {
  return api.post(`/projects/${encodeURIComponent(projectId)}/assistant/chat`, request, {
    timeout: 180000,
    signal,
    silentError: true,
  });
}
