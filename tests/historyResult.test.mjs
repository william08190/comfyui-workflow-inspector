import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractHistoryArtifacts,
  extractHistoryArtifactsFromJson
} from '../src/historyResult.js';

const workflow = {
  '8': { class_type: 'KSampler', inputs: { seed: 123 } },
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

test('extracts final and preview artifacts from a ComfyUI history response', () => {
  const result = extractHistoryArtifacts({
    'prompt-123': {
      status: {
        completed: true,
        status_str: 'success'
      },
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
              subfolder: '',
              type: 'temp'
            }
          ]
        }
      }
    }
  }, {
    baseUrl: 'https://comfy.example.test/',
    workflow
  });

  assert.deepEqual(result.promptIds, ['prompt-123']);
  assert.equal(result.historyCount, 1);
  assert.equal(result.completedCount, 1);
  assert.equal(result.artifactCount, 2);
  assert.equal(result.finalArtifactCount, 1);
  assert.equal(result.tempArtifactCount, 1);
  assert.equal(result.nodeSummaries[0].nodeId, '12');
  assert.equal(result.nodeSummaries[0].isPreferredFinal, true);
  assert.equal(result.artifacts[0].viewUrl, 'https://comfy.example.test/view?filename=final_00001.mp4&subfolder=videos&type=output');
  assert.ok(result.downloadCommands[0].includes('curl -L "https://comfy.example.test/view?filename=final_00001.mp4'));
  assert.ok(result.risks.some((risk) => risk.includes('Temporary or preview artifacts')));
  assert.match(result.evidenceBrief, /12:VHS_VideoCombine gifs\[0\] final_00001\.mp4/);
});

test('unwraps nested history payloads and reports missing preferred output nodes', () => {
  const result = extractHistoryArtifactsFromJson(JSON.stringify({
    result: {
      prompt_id: 'hosted-task-1',
      status: {
        status_str: 'success'
      },
      outputs: {
        '17': {
          images: [
            {
              filename: 'preview_00002.png',
              type: 'temp'
            }
          ]
        }
      }
    }
  }), {
    baseUrl: 'http://127.0.0.1:8188',
    workflowJson: JSON.stringify(workflow)
  });

  assert.deepEqual(result.promptIds, ['hosted-task-1']);
  assert.equal(result.finalArtifactCount, 0);
  assert.equal(result.tempArtifactCount, 1);
  assert.ok(result.risks.some((risk) => risk.includes('All detected artifacts look temporary')));
  assert.ok(result.risks.some((risk) => risk.includes('Preferred workflow output node(s) missing')));
  assert.match(result.evidenceBrief, /Preferred workflow output nodes: 12:VHS_VideoCombine/);
});

test('reports empty history payloads without artifacts', () => {
  const result = extractHistoryArtifacts({});

  assert.equal(result.historyCount, 0);
  assert.equal(result.artifactCount, 0);
  assert.ok(result.risks.includes('No ComfyUI history entries with outputs were found.'));
});
