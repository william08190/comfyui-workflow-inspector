import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkflow, parseWorkflowJson } from '../src/analyzer.js';

test('analyzes prompt API workflow JSON', () => {
  const workflow = parseWorkflowJson(JSON.stringify({
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'wide cinematic shot' }
    },
    '2': {
      class_type: 'VHS_VideoCombine',
      inputs: { frame_rate: 24, duration: 8, filename_prefix: 'final' }
    },
    '3': {
      class_type: 'PreviewImage',
      inputs: { images: ['2', 0] }
    }
  }));

  const result = analyzeWorkflow(workflow);
  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.nodeCount, 3);
  assert.equal(result.outputNodes.length, 2);
  assert.equal(result.previewNodes.length, 1);
  assert.ok(result.durationFields.some((field) => field.key === 'duration'));
  assert.match(result.repairBrief, /Output-like nodes/);
});

test('analyzes UI workflow exports', () => {
  const workflow = {
    nodes: [
      { id: 10, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] },
      { id: 11, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE' }] }
    ]
  };

  const result = analyzeWorkflow(workflow);
  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.equal(result.nodeCount, 2);
  assert.equal(result.outputNodes[0].id, '11');
});

test('rejects invalid JSON', () => {
  assert.throws(() => parseWorkflowJson('{'), /Invalid JSON/);
});

test('rejects documents without nodes', () => {
  assert.throws(() => analyzeWorkflow([]), /No ComfyUI nodes/);
});
