import assert from 'node:assert/strict';
import test from 'node:test';
import { diffWorkflows } from '../src/diffAnalyzer.js';

test('diffs changed prompt API workflows', () => {
  const source = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'source prompt' } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'source' } }
  };
  const target = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'target prompt' } },
    '2': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], frame_rate: 24, duration: 6, filename_prefix: 'target' } },
    '3': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } }
  };

  const result = diffWorkflows(source, target);
  assert.equal(result.addedNodes.length, 1);
  assert.equal(result.removedNodes.length, 0);
  assert.equal(result.typeChanges[0].id, '2');
  assert.ok(result.fieldChanges.some((change) => change.key === 'text'));
  assert.match(result.migrationBrief, /Migration request/);
});

test('rejects missing workflow side', () => {
  assert.throws(() => diffWorkflows({}, { '1': { class_type: 'SaveImage' } }), /Both workflow/);
});
