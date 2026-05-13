import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetrievalPlan } from '../src/retrievalPlanner.js';

test('builds retrieval plan for final video node', () => {
  const result = buildRetrievalPlan({
    '1': { class_type: 'KSampler', inputs: { seed: 12 } },
    '2': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['1', 0],
        frame_rate: 24,
        duration: 6,
        filename_prefix: 'final'
      }
    },
    '3': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } }
  });

  assert.equal(result.retrievalNodes.length, 1);
  assert.equal(result.retrievalNodes[0].id, '2');
  assert.equal(result.retrievalNodes[0].artifactType, 'video');
  assert.equal(result.retrievalNodes[0].historyPath, 'outputs["2"]');
  assert.ok(result.apiChecklist.some((step) => step.includes('/history/{prompt_id}')));
  assert.match(result.retrievalBrief, /Preferred retrieval nodes: 2:VHS_VideoCombine/);
});

test('warns when only preview outputs exist', () => {
  const result = buildRetrievalPlan({
    '1': { class_type: 'KSampler', inputs: { seed: 12 } },
    '2': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } }
  });

  assert.equal(result.retrievalNodes.length, 1);
  assert.equal(result.retrievalNodes[0].id, '2');
  assert.ok(result.risks.some((risk) => risk.includes('Only preview-like outputs')));
});

test('adds conversion step for UI exports', () => {
  const result = buildRetrievalPlan({
    nodes: [
      { id: 1, type: 'KSampler' },
      { id: 2, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE' }] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.match(result.apiChecklist[0], /Convert the UI workflow export/);
});
