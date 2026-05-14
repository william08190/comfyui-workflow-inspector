import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSetupQuote } from '../src/quoteEstimator.js';

test('builds setup quote with tier, scope, checkout URL, and evidence checklist', () => {
  const result = buildSetupQuote({
    '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'wan.safetensors' } },
    '4': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic prompt', clip: ['3', 1] } },
    '6': {
      class_type: 'WanVideoWrapper',
      inputs: {
        image: ['4', 0],
        positive: ['5', 0],
        width: 1280,
        height: 720,
        frames: 97,
        fps: 24,
        seed: 1234
      }
    },
    '9': { class_type: 'VHS_VideoCombine', inputs: { images: ['6', 0], frame_rate: 24, filename_prefix: 'final' } }
  }, {
    targetPlatform: 'RunningHub hosted ComfyUI',
    deliveryGoal: 'Final mp4 retrieval',
    failureLog: 'ImportError: No module named WanVideoWrapper\nFileNotFoundError: wan.safetensors'
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.nodeCount, 5);
  assert.ok(result.score > 25);
  assert.match(result.checkoutUrl, /source=github-quote/);
  assert.ok(result.metrics.some((metric) => metric.label === 'Quote tier'));
  assert.ok(result.scope.some((section) => section.items.some((item) => item.includes('WanVideo'))));
  assert.ok(result.scope.some((section) => section.items.some((item) => item.includes('prompt_id'))));
  assert.ok(result.risks.some((risk) => risk.includes('custom node')));
  assert.match(result.quoteBrief, /ComfyUI hosted workflow setup quote/);
  assert.match(result.quoteBrief, /9:VHS_VideoCombine/);
});

test('quotes UI export conversion and missing output risk', () => {
  const result = buildSetupQuote({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] }
    ]
  }, {
    urgency: 'rush'
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.scoreBreakdown.some((item) => item.label === 'UI export conversion'));
  assert.ok(result.scoreBreakdown.some((item) => item.label === 'Rush delivery coordination'));
  assert.ok(result.scope.some((section) => section.items.some((item) => item.includes('Convert UI workflow export'))));
  assert.ok(result.risks.some((risk) => risk.includes('UI workflow exports')));
  assert.match(result.quoteBrief, /manual selection required/);
});
