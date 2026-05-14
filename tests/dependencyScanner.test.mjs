import assert from 'node:assert/strict';
import test from 'node:test';
import { scanDependencies } from '../src/dependencyScanner.js';

test('groups known custom node packages and model assets', () => {
  const result = scanDependencies({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic prompt', clip: ['4', 1] } },
    '8': { class_type: 'IPAdapterAdvanced', inputs: { image: 'ref.png', ipadapter_file: 'ip-adapter.safetensors' } },
    '12': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: 'final', frame_rate: 24 } },
    '18': { class_type: 'SeedVR2Upscaler', inputs: { model_name: 'seedvr2.pth' } }
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.packages.coreNodes.length, 2);
  assert.ok(result.packages.customPackages.some((dependency) => dependency.packageName === 'ComfyUI_IPAdapter_plus'));
  assert.ok(result.packages.customPackages.some((dependency) => dependency.packageName === 'ComfyUI-VideoHelperSuite'));
  assert.ok(result.packages.customPackages.some((dependency) => dependency.packageName === 'ComfyUI-SeedVR2'));
  assert.ok(result.assets.modelAssets.some((asset) => asset.value === 'sdxl.safetensors'));
  assert.ok(result.assets.mediaAssets.some((asset) => asset.value === 'ref.png'));
  assert.ok(result.assets.modelAssets.every((asset) => asset.key !== 'sampler_name'));
  assert.ok(result.assets.mediaAssets.every((asset) => asset.key !== 'filename_prefix'));
  assert.match(result.installBrief, /Setup request/);
});

test('reports unknown custom-like nodes without treating metadata as assets', () => {
  const result = scanDependencies({
    '1': { class_type: 'ClientSpecificMagicNode', inputs: { class_type: 'not an asset', style_file: 'brand-style.json' } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } }
  });

  assert.equal(result.packages.unknownCustomNodes.length, 1);
  assert.equal(result.assets.modelAssets.length, 0);
  assert.ok(result.risks.some((risk) => risk.includes('could not be matched')));
});

test('warns that UI exports need prompt API JSON for exact host paths', () => {
  const result = scanDependencies({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] },
      { id: 2, type: 'VHS_VideoCombine', widgets_values: ['final'] }
    ]
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.risks.some((risk) => risk.includes('UI workflow exports')));
});
