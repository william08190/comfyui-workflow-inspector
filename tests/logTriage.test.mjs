import assert from 'node:assert/strict';
import test from 'node:test';
import { triageComfyLog } from '../src/logTriage.js';

test('classifies missing node, missing model, and hosted output failures', () => {
  const result = triageComfyLog([
    'ImportError: No module named WanVideoWrapper',
    'FileNotFoundError: wan2.1_i2v_720p.safetensors',
    'POST /prompt returned prompt_id=abc123 but /history/abc123 had no outputs'
  ].join('\n'), {
    targetPlatform: 'RunningHub hosted ComfyUI',
    workflowJson: JSON.stringify({
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'wan2.1_i2v_720p.safetensors' } },
      '4': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
      '7': { class_type: 'WanVideoWrapper', inputs: { image: ['4', 0], width: 1280, height: 720, frames: 97 } },
      '12': { class_type: 'VHS_VideoCombine', inputs: { images: ['7', 0], frame_rate: 24 } }
    })
  });

  assert.equal(result.severity, 'blocker');
  assert.ok(result.signals.some((signal) => signal.id === 'missing-node'));
  assert.ok(result.signals.some((signal) => signal.id === 'missing-asset'));
  assert.ok(result.signals.some((signal) => signal.id === 'api-output'));
  assert.ok(result.workflowContext.customPackages.includes('ComfyUI-WanVideoWrapper'));
  assert.ok(result.workflowContext.retrievalNodes.includes('12:VHS_VideoCombine'));
  assert.ok(result.priorityActions.some((action) => action.includes('custom packages')));
  assert.ok(result.evidenceChecklist.some((item) => item.includes('/history/{prompt_id}')));
  assert.match(result.checkoutUrl, /source=github-log-triage/);
  assert.match(result.handoffBrief, /ComfyUI failure log triage/);
  assert.match(result.handoffBrief, /RunningHub hosted ComfyUI/);
});

test('classifies gpu and ffmpeg failures without workflow JSON', () => {
  const result = triageComfyLog([
    'RuntimeError: CUDA out of memory while allocating tensor',
    'VHS_VideoCombine failed because ffmpeg returned codec error'
  ].join('\n'));

  assert.equal(result.workflowContext, null);
  assert.equal(result.severity, 'high');
  assert.ok(result.signals.some((signal) => signal.id === 'gpu-memory'));
  assert.ok(result.signals.some((signal) => signal.id === 'ffmpeg-video'));
  assert.ok(result.blockers.includes('GPU memory or device allocation failure'));
  assert.match(result.handoffBrief, /CUDA out of memory/);
});

test('returns unclassified signal for unknown non-empty logs', () => {
  const result = triageComfyLog('Worker stopped unexpectedly after queue start.');

  assert.equal(result.severity, 'medium');
  assert.equal(result.signals[0].id, 'unclassified');
  assert.ok(result.priorityActions[0].includes('Capture more log context'));
});
