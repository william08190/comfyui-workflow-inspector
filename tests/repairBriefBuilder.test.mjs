import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepairBrief } from '../src/repairBriefBuilder.js';

test('builds repair brief with dependencies, bindings, retrieval, and log signals', () => {
  const result = buildRepairBrief({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
    '5': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
    '6': { class_type: 'IPAdapterAdvanced', inputs: { image: ['5', 0], weight: 0.7, model: ['4', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic prompt', clip: ['4', 1] } },
    '8': { class_type: 'KSampler', inputs: { seed: 123, positive: ['7', 0], model: ['6', 0] } },
    '9': { class_type: 'VHS_VideoCombine', inputs: { images: ['8', 0], frame_rate: 24, filename_prefix: 'final' } }
  }, {
    targetPlatform: 'RunningHub hosted workflow',
    deliverable: 'Working video API handoff',
    failureLog: 'ImportError: No module named IPAdapterAdvanced\nFileNotFoundError: sdxl.safetensors'
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.nodeCount, 6);
  assert.ok(result.checkoutUrl.includes('source=github-repair-brief'));
  assert.ok(result.metrics.some((metric) => metric.label === 'Custom packages' && metric.value === 2));
  assert.ok(result.metrics.some((metric) => metric.label === 'Bindable inputs' && metric.value > 0));
  assert.ok(result.logSignals.some((signal) => signal.label.includes('Missing custom node')));
  assert.ok(result.priorityActions.some((action) => action.includes('Install and verify custom nodes')));
  assert.ok(result.priorityActions.some((action) => action.includes('Pin final output retrieval')));
  assert.ok(result.blockers.some((blocker) => blocker.includes('custom node')));
  assert.match(result.intakeBrief, /RunningHub hosted workflow/);
  assert.match(result.intakeBrief, /9:VHS_VideoCombine/);
  assert.match(result.intakeBrief, /prompt_id/);
});

test('flags UI workflow conversion and manual output selection', () => {
  const result = buildRepairBrief({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.priorityActions.some((action) => action.includes('Convert the UI workflow export')));
  assert.ok(result.priorityActions.some((action) => action.includes('Add or identify a final')));
  assert.ok(result.blockers.some((blocker) => blocker.includes('UI workflow exports')));
});
