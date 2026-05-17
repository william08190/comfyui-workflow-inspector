import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSupportIntakePacket,
  buildSupportIntakePacketFromJson
} from '../src/intakePacket.js';

const promptWorkflow = {
  '3': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'wan2.1_i2v_720p.safetensors'
    }
  },
  '4': {
    class_type: 'LoadImage',
    inputs: {
      image: 'product-reference.png'
    }
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic product video',
      clip: ['3', 1]
    }
  },
  '6': {
    class_type: 'WanVideoWrapper',
    inputs: {
      image: ['4', 0],
      positive: ['5', 0],
      width: 1280,
      height: 720,
      frames: 121,
      fps: 24,
      seed: 245891
    }
  },
  '9': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['6', 0],
      frame_rate: 24,
      filename_prefix: 'client-final'
    }
  }
};

const historyJson = JSON.stringify({
  'prompt-123': {
    status: { completed: true },
    outputs: {
      '9': {
        videos: [
          {
            filename: 'client-final_00001.mp4',
            subfolder: '2026-05-17',
            type: 'output',
            format: 'video/mp4'
          }
        ]
      }
    }
  }
});

test('builds a checkout-ready support intake packet with history evidence', () => {
  const result = buildSupportIntakePacket(promptWorkflow, {
    targetPlatform: 'RunningHub hosted ComfyUI',
    deliveryGoal: 'Final mp4 API delivery',
    issueSummary: 'Hosted output retrieval is not mapped',
    failureLog: 'ImportError: No module named WanVideoWrapper\nFileNotFoundError: wan2.1_i2v_720p.safetensors\nPOST /prompt returned prompt_id',
    historyJson
  });

  assert.equal(result.format, 'ComfyUI prompt API JSON');
  assert.equal(result.nodeCount, 5);
  assert.equal(result.historyEvidence.finalArtifactCount, 1);
  assert.ok(result.readiness.score >= 70);
  assert.match(result.checkoutUrl, /source=github-intake/);
  assert.ok(result.attachments.some((item) => item.name === 'history-response.json' && item.status === 'included'));
  assert.ok(result.attachments.some((item) => item.name === 'model-asset-manifest.md'));
  assert.ok(result.questions.some((question) => question.includes('custom node')));
  assert.ok(result.evidenceChecklist.some((item) => item.includes('final output node')));
  assert.match(result.packetBrief, /ComfyUI workflow support intake packet/);
  assert.match(result.packetBrief, /client-final_00001\.mp4|Final artifacts: 1/);
});

test('flags missing evidence for UI exports without history or logs', () => {
  const result = buildSupportIntakePacketFromJson(JSON.stringify({
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['portrait prompt'] },
      { id: 2, type: 'PreviewImage', inputs: [{ name: 'images', type: 'IMAGE' }] }
    ]
  }));

  assert.equal(result.format, 'ComfyUI UI workflow export');
  assert.ok(result.attachments.some((item) => item.name === 'failure-log.txt' && item.status === 'missing'));
  assert.ok(result.attachments.some((item) => item.name === 'final-output-evidence.txt' && item.status === 'missing'));
  assert.ok(result.blockers.some((blocker) => blocker.includes('prompt API JSON conversion')));
  assert.ok(result.questions.some((question) => question.includes('prompt API JSON')));
  assert.match(result.packetBrief, /manual selection required|History prompt ids: not provided/);
});
