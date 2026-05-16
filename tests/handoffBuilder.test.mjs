import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeploymentHandoff,
  buildDeploymentHandoffFromJson
} from '../src/handoffBuilder.js';

const promptWorkflow = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'sd_xl_base_1.0.safetensors'
    }
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: 1280,
      height: 720,
      batch_size: 1
    }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'handoff test prompt',
      clip: ['4', 1]
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 123456,
      steps: 20,
      positive: ['6', 0],
      latent_image: ['5', 0],
      model: ['4', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'handoff-final'
    }
  }
};

test('builds a hosted workflow deployment handoff from prompt API JSON', () => {
  const result = buildDeploymentHandoff(promptWorkflow, {
    platform: 'runninghub',
    baseUrl: 'https://comfy.example.test/'
  });

  assert.equal(result.platform.id, 'runninghub');
  assert.equal(result.baseUrl, 'https://comfy.example.test');
  assert.equal(result.nodeCount, 5);
  assert.equal(result.customPackageCount, 1);
  assert.equal(result.modelAssetCount, 1);
  assert.ok(result.runtimeInputCount >= 5);
  assert.equal(result.outputContract.preferredNodes[0].nodeId, '12');
  assert.equal(result.outputContract.preferredNodes[0].artifactType, 'video');
  assert.ok(result.setupItems.some((item) => item.includes('ComfyUI-VideoHelperSuite')));
  assert.ok(result.evidenceChecklist.some((item) => item.includes('task_id or prompt_id')));
  assert.ok(result.clientFiles.includes('runtime-parameter-map.md'));
  assert.match(result.handoffBrief, /Setup deposit: https:\/\/mv\.786668\.xyz\/service-checkout\.html/);
});

test('flags UI workflow exports that need prompt API conversion', () => {
  const uiWorkflow = {
    nodes: [
      {
        id: 1,
        type: 'CLIPTextEncode',
        widgets_values: ['test prompt']
      },
      {
        id: 2,
        type: 'PreviewImage',
        inputs: [{ name: 'images', type: 'IMAGE' }]
      }
    ]
  };

  const result = buildDeploymentHandoffFromJson(JSON.stringify(uiWorkflow), {
    platform: 'comfyui'
  });

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.setupItems.some((item) => item.includes('Convert the UI workflow export')));
  assert.ok(result.risks.some((risk) => risk.includes('UI workflow exports')));
});

test('falls back to manual output selection when no output node is detected', () => {
  const result = buildDeploymentHandoff({
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: 'model.safetensors'
      }
    }
  });

  assert.equal(result.outputNodeCount, 0);
  assert.equal(result.outputContract.fallbackNode, 'manual selection required');
  assert.ok(result.risks.some((risk) => risk.includes('No preferred final artifact node')));
});
