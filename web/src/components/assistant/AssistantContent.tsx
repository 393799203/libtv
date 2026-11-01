import ReactMarkdown from 'react-markdown';
import { AimOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeDisplayName, nodeReferencePlugin, referencedNodes } from '@/utils/assistantReferences';
import type { AssistantNodeReference } from '@/types/assistant';
import { useAssistantNodeFocus } from './useAssistantNodeFocus';

export function AssistantNodeLink({ reference }: { reference: AssistantNodeReference }) {
  const nodes = useCanvasStore(s => s.nodes);
  const focus = useAssistantNodeFocus();
  const node = nodes.find(n => n.id === reference.id);
  const label = node ? nodeDisplayName(node, nodes) : reference.label;
  return (
    <button type="button" className="assistant-node-link" disabled={!node}
      aria-label={node ? `定位节点：${label}` : `${label}（已删除或撤销）`}
      title={node ? '选中并定位到画布' : '节点已删除或撤销'}
      onClick={() => focus([reference.id])}>
      <AimOutlined />{label}{!node && '（已删除）'}
    </button>
  );
}

export function AssistantContent({ content, references = [] }: {
  content: string; references?: AssistantNodeReference[];
}) {
  const nodes = useCanvasStore(s => s.nodes);
  const refs = referencedNodes(content, nodes, references);
  // Normalize Markdown labels too: a model may put an opaque ID in the link's
  // visible text, or emit an internal link for a node which no longer exists.
  const displayContent = content.replace(/\[([^\]]*)\]\(#canvas-node=([^)]+)\)/g, (_, _label, encoded) => {
    let id = '';
    try { id = decodeURIComponent(encoded); } catch { return '所引用节点不可用'; }
    const ref = refs.find(r => r.id === id || r.alias === id);
    const node = nodes.find(n => n.id === id);
    const label = node ? nodeDisplayName(node, nodes) : ref?.label;
    if (!label) return '所引用节点不可用';
    return `[${label.replace(/[[\]\\]/g, '\\$&')}](#canvas-node=${encodeURIComponent(ref?.id || id)})`;
  });
  return (
    <ReactMarkdown remarkPlugins={[nodeReferencePlugin(refs)]} components={{
      a: ({ href, children }) => {
        if (href?.startsWith('#canvas-node=')) {
          let id = '';
          try { id = decodeURIComponent(href.slice('#canvas-node='.length)); } catch { /* Invalid link stays text. */ }
          const ref = refs.find(r => r.id === id || r.alias === id);
          const node = nodes.find(n => n.id === id);
          if (ref || node) return <AssistantNodeLink reference={ref || { id, label: String(node.data.label) }} />;
          return <span>所引用节点不可用</span>;
        }
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      },
    }}>{displayContent}</ReactMarkdown>
  );
}
