import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAcceptanceEvidence,
  buildAcceptanceEvidenceFromJson
} from '../src/acceptanceEvidence.js';

const workflow = {
  '8': { class_type: 'KSampler', inputs: { seed: 42 } },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'final'
    }
  },
  '17': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['8', 0]
    }
  }
};

test('builds acceptance report with final deliverable and preview exclusion', () => {
  const result = buildAcceptanceEvidence({
    'prompt-1': {
      status: { completed: true, status_str: 'success' },
      outputs: {
        '12': {
          gifs: [
            {
              filename: 'final_00001.mp4',
              subfolder: 'videos',
              type: 'output',
              format: 'video/mp4'
            }
          ]
        },
        '17': {
          images: [
            {
              filename: 'preview_00001.png',
              type: 'temp'
            }
          ]
        }
      }
    }
  }, {
    workflow,
    baseUrl: 'https://comfy.example.test'
  });

  assert.equal(result.outcome.status, 'ready_with_warnings');
  assert.equal(result.deliverableCount, 1);
  assert.equal(result.previewArtifactCount, 1);
  assert.match(result.customerReport, /final_00001\.mp4/);
  assert.match(result.customerReport, /preview\/temp artifacts/i);
  assert.ok(result.downloadCommands[0].includes('curl -L "https://comfy.example.test/view?filename=final_00001.mp4'));
});

test('blocks acceptance when only preview artifacts are present', () => {
  const result = buildAcceptanceEvidenceFromJson(JSON.stringify({
    result: {
      prompt_id: 'task-preview',
      status: { status_str: 'success' },
      outputs: {
        '17': {
          images: [
            {
              filename: 'preview.png',
              type: 'temp'
            }
          ]
        }
      }
    }
  }), {
    workflowJson: JSON.stringify(workflow)
  });

  assert.equal(result.outcome.status, 'blocked');
  assert.equal(result.deliverableCount, 0);
  assert.ok(result.missingEvidence.some((item) => item.includes('final deliverable')));
  assert.match(result.customerReport, /Missing evidence/);
});

test('reports missing workflow context as a warning', () => {
  const result = buildAcceptanceEvidence({
    'prompt-2': {
      status: { completed: true },
      outputs: {
        '99': {
          images: [
            {
              filename: 'image.png',
              type: 'output'
            }
          ]
        }
      }
    }
  });

  assert.equal(result.outcome.status, 'ready_with_warnings');
  assert.equal(result.workflowFormat, 'No workflow JSON provided');
  assert.ok(result.risks.some((risk) => risk.includes('No workflow JSON')));
});
