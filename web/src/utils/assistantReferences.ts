import type { LibTVNode } from '../types/canvas';
import type { AssistantNodeReference } from '../types/assistant';

export function nodeDisplayName(node: LibTVNode, nodes: LibTVNode[]): string {
  const label = String(node.data.label || '未命名节点');
  const sameName = nodes.filter(n => String(n.data.label || '未命名节点') === label);
  return sameName.length > 1 ? `${label}（${sameName.findIndex(n => n.id === node.id) + 1}）` : label;
}

export function referencedNodes(content: string, nodes: LibTVNode[], extra: AssistantNodeReference[] = []): AssistantNodeReference[] {
  const refs = new Map<string, AssistantNodeReference>();
  for (const node of nodes) {
    if (content.includes(node.id)) refs.set(node.id, { id: node.id, label: nodeDisplayName(node, nodes) });
  }
  for (const ref of extra) refs.set(ref.id, ref);
  return [...refs.values()];
}

type MarkdownNode = {
  type: string; value?: string; url?: string; children?: MarkdownNode[];
};

/** Suggestion buttons need plain labels, without nested links or buttons. */
export function nodeReferenceLabel(content: string, nodes: LibTVNode[], refs: AssistantNodeReference[] = []): string {
  let output = content.replace(/\[([^\]]+)\]\(#canvas-node=([^)]+)\)/g, (_, label, encoded) => {
    try {
      const id = decodeURIComponent(encoded);
      const node = nodes.find(n => n.id === id);
      return node ? nodeDisplayName(node, nodes) : refs.find(r => r.id === id)?.label || label;
    } catch { return label; }
  });
  for (const ref of referencedNodes(content, nodes, refs).sort((a, b) => b.id.length - a.id.length)) {
    const node = nodes.find(n => n.id === ref.id);
    const label = node ? nodeDisplayName(node, nodes) : ref.label;
    for (const token of [ref.id, ref.alias].filter(Boolean)) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      output = output.replace(new RegExp(`(?<![\\w:-])${escaped}(?![\\w:-])`, 'g'), label);
    }
  }
  return output;
}

/** Rewrite known internal references in prose and inline code into named links.
 * Unknown IDs are left untouched: never guess a canvas target from an ID prefix. */
export function nodeReferencePlugin(refs: AssistantNodeReference[]) {
  const tokens = new Map<string, AssistantNodeReference>();
  for (const ref of refs) {
    tokens.set(ref.id, ref);
    if (ref.alias) tokens.set(ref.alias, ref);
  }
  const alternatives = [...tokens.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = alternatives.length ? new RegExp(`(?<![\\w:-])(${alternatives.join('|')})(?![\\w:-])`, 'g') : null;
  const visit = (node: MarkdownNode) => {
    if (!node.children || ['link', 'linkReference', 'code', 'html'].includes(node.type)) return;
    node.children = node.children.flatMap(child => {
      if (!pattern || !['text', 'inlineCode'].includes(child.type) || !child.value) {
        visit(child);
        return [child];
      }
      const pieces: MarkdownNode[] = [];
      let offset = 0;
      for (const match of child.value.matchAll(pattern)) {
        if (match.index > offset) pieces.push({ type: 'text', value: child.value.slice(offset, match.index) });
        const ref = tokens.get(match[0]);
        pieces.push({ type: 'link', url: `#canvas-node=${encodeURIComponent(ref.id)}`, children: [{ type: 'text', value: ref.label }] });
        offset = match.index + match[0].length;
      }
      if (!pieces.length) return [child];
      if (offset < child.value.length) pieces.push({ type: 'text', value: child.value.slice(offset) });
      return pieces;
    });
  };
  return () => (tree: MarkdownNode) => visit(tree);
}
