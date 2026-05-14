import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApiSmokePlan } from '../src/apiSmokePlanner.js';

test('builds ComfyUI API smoke test plan for prompt JSON', () => {
  const result = buildApiSmokePlan({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic prompt', clip: ['4', 1] } },
    '6': { class_type: 'KSampler', inputs: { seed: 123, positive: ['5', 0], model: ['4', 0] } },
    '7': { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
    '8': { class_type: 'VHS_VideoCombine', inputs: { images: ['6', 0], frame_rate: 24, filename_prefix: 'final' } }
  }, { baseUrl: 'https://api.example.com/comfy/' });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.baseUrl, 'https://api.example.com/comfy');
  assert.equal(result.preferredOutputNode.nodeId, '8');
  assert.ok(result.outputNodes.every((node) => node.nodeType !== 'EmptyLatentImage'));
  assert.ok(result.endpoints.some((endpoint) => endpoint.url === 'https://api.example.com/comfy/prompt'));
  assert.ok(result.endpoints.some((endpoint) => endpoint.url.includes('/history/{prompt_id}')));
  assert.ok(result.endpoints.some((endpoint) => endpoint.url.startsWith('wss://')));
  assert.ok(result.curlCommands.some((command) => command.includes('/view?filename={filename}')));
  assert.match(result.smokeBrief, /prompt_id/);
  assert.match(result.smokeBrief, /8:VHS_VideoCombine/);
});

test('adds conversion risk for UI workflow exports', () => {
  const result = buildApiSmokePlan({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] },
      { id: 2, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE' }] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.checklist[0].includes('Export or convert'));
  assert.ok(result.risks.some((risk) => risk.includes('/prompt endpoint')));
});

test('requires manual history lookup when no output node is detected', () => {
  const result = buildApiSmokePlan({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt' } }
  });

  assert.equal(result.preferredOutputNode, null);
  assert.ok(result.risks.some((risk) => risk.includes('No output node')));
});
