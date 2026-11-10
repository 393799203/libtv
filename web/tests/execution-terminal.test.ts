import test from 'node:test';
import assert from 'node:assert/strict';
import { useCanvasStore } from '../src/stores/canvasStore.ts';
import { useExecutionStore } from '../src/stores/executionStore.ts';
import { workflowApi } from '../src/services/workflowApi.ts';
import { createNode } from '../src/utils/nodeFactory.ts';
import { pendingNodeIdsOf, reconcileNodesOnTerminal } from '../src/utils/executionTerminal.ts';

function setup() {
  const store = useCanvasStore.getState();
  store.setProjectId('terminal-test');
  const node = createNode('video', {x: 0, y: 0}, { data: { status: 'failed', error: 'old rejection', videoUrl: 'old.mp4' } });
  store.loadCanvas({nodes: [node], edges: [], viewport: {x: 0, y: 0, zoom: 1}});
  useExecutionStore.setState({activeStreams: []});
  return node.id;
}

test('successful terminal reconciliation repairs a failed node and clears its old error', async () => {
  const id = setup();
  assert.deepEqual(pendingNodeIdsOf([id], true, 10, 'terminal-test'), [id]);
  const getStatus = workflowApi.getStatus;
  workflowApi.getStatus = async () => ({status: 'done', node_data: {status: 'success', videoUrl: 'new.mp4'}} as never);
  try {
    await reconcileNodesOnTerminal('terminal-test', 10, [id], 'success');
    const data = useCanvasStore.getState().nodes.find(n => n.id === id)!.data;
    assert.equal(data.status, 'success');
    assert.equal(data.error, undefined);
    assert.equal((data as {videoUrl?:string}).videoUrl, 'new.mp4');
  } finally { workflowApi.getStatus = getStatus; }
});

test('old successful execution cannot complete a newer retry or update a different project', async () => {
  const id = setup();
  useExecutionStore.setState({activeStreams: [{projectId: 'terminal-test', executionId: 11, nodeId: id}]});
  assert.deepEqual(pendingNodeIdsOf([id], true, 10, 'terminal-test'), []);
  assert.deepEqual(pendingNodeIdsOf([id], true, 10, 'other-project'), []);
  useExecutionStore.setState({generatingNodeId: id});
  const getStatus = workflowApi.getStatus;
  workflowApi.getStatus = async () => ({status: 'done', node_data: {status: 'success', videoUrl: 'older.mp4'}} as never);
  try {
    await reconcileNodesOnTerminal('terminal-test', 10, [id], 'success');
    assert.equal(useCanvasStore.getState().nodes.find(n => n.id === id)!.data.status, 'failed');
    assert.equal(useExecutionStore.getState().generatingNodeId, id);
    assert.equal(useExecutionStore.getState().activeStreams.length, 1);
  } finally { workflowApi.getStatus = getStatus; }
});

test('previous media is not proof that the latest failed attempt succeeded', async () => {
  const id = setup();
  const getStatus = workflowApi.getStatus;
  workflowApi.getStatus = async () => ({status: 'done', node_data: {status: 'failed', error: 'latest rejection', videoUrl: 'old.mp4'}} as never);
  try {
    await reconcileNodesOnTerminal('terminal-test', 10, [id], 'success');
    assert.equal(useCanvasStore.getState().nodes.find(n => n.id === id)!.data.status, 'failed');
  } finally { workflowApi.getStatus = getStatus; }
});
