import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRedactionPack } from '../src/redactor.js';

test('redacts secrets, local paths, private hosts, and emails from workflow and logs', () => {
  const result = buildRedactionPack(JSON.stringify({
    '3': {
      class_type: 'LoadImage',
      inputs: {
        image: '/Users/artist/private/references/label.png',
        api_key: 'sk_test_private_1234567890abcdef'
      }
    },
    '7': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        upload_url: 'https://host.example.com/upload?token=abc123private&job=mv',
        callback: 'http://127.0.0.1:8188/view?filename=final.mp4'
      }
    }
  }), {
    logText: [
      'Authorization: Bearer ghp_1234567890abcdefghijklmnop',
      'FileNotFoundError: /Users/artist/private/references/label.png',
      'Contact producer@example.com'
    ].join('\n'),
    targetRecipient: 'repair provider'
  });

  assert.equal(result.workflowSummary.nodeCount, 2);
  assert.match(result.safeWorkflowJson, /\[REDACTED_SECRET\]/);
  assert.match(result.safeWorkflowJson, /\[LOCAL_PATH\]\/label\.png/);
  assert.match(result.safeWorkflowJson, /http:\/\/\[PRIVATE_HOST\]/);
  assert.doesNotMatch(result.safeWorkflowJson, /sk_test_private/);
  assert.doesNotMatch(result.safeWorkflowJson, /abc123private/);
  assert.doesNotMatch(result.safeLog, /ghp_123456/);
  assert.doesNotMatch(result.safeLog, /producer@example\.com/);
  assert.ok(result.exposures.some((item) => item.type === 'secret-field'));
  assert.ok(result.exposures.some((item) => item.type === 'url-secret'));
  assert.ok(result.exposures.some((item) => item.type === 'private-host'));
  assert.ok(result.metrics.some((item) => item.label === 'Share readiness' && item.value === 'redacted secrets'));
  assert.match(result.checkoutUrl, /source=github-safe-share/);
  assert.match(result.handoffBrief, /ComfyUI safe share package/);
  assert.match(result.handoffBrief, /Sanitized workflow JSON/);
});

test('keeps useful nonsecret workflow context intact', () => {
  const result = buildRedactionPack(JSON.stringify({
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: 'wan2.1_i2v_720p.safetensors'
      }
    },
    '8': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'cinematic frame, no secrets'
      }
    }
  }));

  assert.match(result.safeWorkflowJson, /wan2\.1_i2v_720p\.safetensors/);
  assert.match(result.safeWorkflowJson, /cinematic frame/);
  assert.equal(result.exposures.length, 0);
  assert.ok(result.checklist.some((item) => item.includes('sanitized workflow JSON')));
});

test('supports log-only redaction package', () => {
  const result = buildRedactionPack('', {
    logText: 'POST http://localhost:8188/prompt api_key=supersecret1234'
  });

  assert.equal(result.workflowSummary, null);
  assert.equal(result.safeWorkflowJson, '');
  assert.match(result.safeLog, /http:\/\/\[PRIVATE_HOST\]/);
  assert.match(result.safeLog, /api_key: \[REDACTED_SECRET\]/);
  assert.ok(result.checklist.some((item) => item.includes('Add workflow JSON')));
});
