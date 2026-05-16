import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetManifest } from '../src/assetManifest.js';

test('builds host folders for model and media assets', () => {
  const result = buildAssetManifest({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: 'sdxl_vae.safetensors' } },
    '6': { class_type: 'LoraLoader', inputs: { lora_name: 'brand.safetensors', model: ['4', 0] } },
    '7': { class_type: 'IPAdapterAdvanced', inputs: { ipadapter_file: 'ip-adapter.safetensors', image: ['8', 0] } },
    '8': { class_type: 'LoadImage', inputs: { image: 'client/ref.png' } },
    '9': { class_type: 'VHS_LoadVideo', inputs: { video: 'client/source.mp4' } },
    '12': { class_type: 'VHS_VideoCombine', inputs: { images: ['9', 0], filename_prefix: 'final', frame_rate: 24 } }
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.modelCount, 4);
  assert.equal(result.mediaCount, 2);
  assert.ok(result.folderGroups.some((group) => group.folder === 'models/checkpoints'));
  assert.ok(result.folderGroups.some((group) => group.folder === 'models/loras'));
  assert.ok(result.folderGroups.some((group) => group.folder === 'models/vae'));
  assert.ok(result.folderGroups.some((group) => group.folder === 'models/ipadapter'));
  assert.ok(result.folderGroups.some((group) => group.folder === 'input/images'));
  assert.ok(result.folderGroups.some((group) => group.folder === 'input/videos'));
  assert.match(result.manifestJson, /sdxl\.safetensors/);
  assert.match(result.manifestBrief, /Setup deposit/);
});

test('warns about UI workflow exports and preserves asset refs', () => {
  const result = buildAssetManifest({
    nodes: [
      { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['dreamshaper.safetensors'] },
      { id: 2, type: 'LoadImage', widgets_values: ['reference.png'] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.risks.some((risk) => risk.includes('UI workflow exports')));
  assert.ok(result.items.some((item) => item.value === 'dreamshaper.safetensors'));
  assert.ok(result.items.some((item) => item.value === 'reference.png'));
});

test('ignores prompts, sampler values, and output filename prefixes', () => {
  const result = buildAssetManifest({
    '1': {
      class_type: 'KSampler',
      inputs: {
        sampler_name: 'euler',
        scheduler: 'normal',
        seed: 123,
        prompt: 'cinematic image with no file references'
      }
    },
    '2': {
      class_type: 'SaveImage',
      inputs: {
        images: ['1', 0],
        filename_prefix: 'not-an-input-file'
      }
    }
  });

  assert.equal(result.itemCount, 0);
  assert.ok(result.risks.some((risk) => risk.includes('No asset manifest entries')));
});
