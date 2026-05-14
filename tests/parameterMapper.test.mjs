import assert from 'node:assert/strict';
import test from 'node:test';
import { mapParameters } from '../src/parameterMapper.js';

test('maps bindable hosted API parameters from prompt JSON', () => {
  const result = mapParameters({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1280, height: 720 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic product shot', clip: ['4', 1] } },
    '7': { class_type: 'KSampler', inputs: { seed: 123, positive: ['6', 0], sampler_name: 'euler' } },
    '8': { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 24, duration: 6, filename_prefix: 'final' } },
    '9': { class_type: 'LoadImage', inputs: { image: 'reference.png' } }
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.ok(result.groups.some((group) => group.category === 'prompt'));
  assert.ok(result.groups.some((group) => group.category === 'dimensions'));
  assert.ok(result.groups.some((group) => group.category === 'timing'));
  assert.ok(result.groups.some((group) => group.category === 'media'));
  assert.ok(result.bindings.some((binding) => binding.name === 'prompt_6_text'));
  assert.ok(result.bindings.some((binding) => binding.sourcePath === 'prompt["5"].inputs.width'));
  assert.ok(result.bindings.every((binding) => !binding.sourcePath.includes('positive')));
  assert.ok(result.bindings.every((binding) => !binding.sourcePath.includes('class_type')));
  assert.match(result.integrationBrief, /Recommended hosted API parameters/);
});

test('warns when UI exports need conversion before binding paths are direct', () => {
  const result = mapParameters({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] },
      { id: 2, type: 'EmptyLatentImage', widgets_values: [1024, 1024] },
      { id: 3, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE' }] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.risks.some((risk) => risk.includes('converted to prompt API JSON')));
});
