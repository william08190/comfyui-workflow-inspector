import { diffWorkflowJson } from './diffAnalyzer.js';

const sourceSample = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 111,
      steps: 20,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['6', 0],
      latent_image: ['5', 0]
    }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'clean studio portrait' }
  },
  '8': {
    class_type: 'SaveImage',
    inputs: { images: ['3', 0], filename_prefix: 'source-output' }
  }
};

const targetSample = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 222,
      steps: 28,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      positive: ['6', 0],
      latent_image: ['5', 0]
    }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'cinematic music video portrait, rim light' }
  },
  '8': {
    class_type: 'VHS_VideoCombine',
    inputs: { images: ['3', 0], frame_rate: 24, duration: 6, filename_prefix: 'target-final' }
  },
  '9': {
    class_type: 'PreviewImage',
    inputs: { images: ['3', 0] }
  }
};

const sourceInput = document.querySelector('#sourceWorkflow');
const targetInput = document.querySelector('#targetWorkflow');
const sourceFile = document.querySelector('#sourceFile');
const targetFile = document.querySelector('#targetFile');
const sampleButton = document.querySelector('#sampleDiffButton');
const diffButton = document.querySelector('#diffButton');
const copyButton = document.querySelector('#copyDiffButton');
const statusBox = document.querySelector('#diffStatus');
const metrics = document.querySelector('#diffMetrics');
const added = document.querySelector('#addedNodes');
const removed = document.querySelector('#removedNodes');
const changed = document.querySelector('#changedFields');
const outputs = document.querySelector('#outputCompare');
const brief = document.querySelector('#migrationBrief');

sampleButton.addEventListener('click', () => {
  sourceInput.value = JSON.stringify(sourceSample, null, 2);
  targetInput.value = JSON.stringify(targetSample, null, 2);
  runDiff();
});

diffButton.addEventListener('click', runDiff);
sourceFile.addEventListener('change', () => loadFile(sourceFile, sourceInput));
targetFile.addEventListener('change', () => loadFile(targetFile, targetInput));

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Migration brief copied.', 'ok');
});

async function loadFile(fileInput, target) {
  const file = fileInput.files?.[0];
  if (!file) return;
  target.value = await file.text();
  if (sourceInput.value.trim() && targetInput.value.trim()) runDiff();
}

function runDiff() {
  try {
    const result = diffWorkflowJson(sourceInput.value, targetInput.value);
    renderResult(result);
    setStatus('Workflow diff completed locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Source nodes', result.sourceNodeCount],
    ['Target nodes', result.targetNodeCount],
    ['Added', result.addedNodes.length],
    ['Removed', result.removedNodes.length],
    ['Type changes', result.typeChanges.length],
    ['Field changes', result.fieldChanges.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderList(added, result.addedNodes.map(formatNode), 'No added nodes.');
  renderList(removed, result.removedNodes.map(formatNode), 'No removed nodes.');
  renderList(changed, [
    ...result.typeChanges.map((change) => `${change.id} type: ${change.from} -> ${change.to}`),
    ...result.fieldChanges.slice(0, 24).map((change) => `${change.nodeId}:${change.key} ${change.from} -> ${change.to}`)
  ], 'No parameter or type changes detected.');
  renderList(outputs, [
    `Source: ${result.sourceOutputs.map(formatNode).join(', ') || 'none detected'}`,
    `Target: ${result.targetOutputs.map(formatNode).join(', ') || 'none detected'}`
  ], 'No output comparison available.');
  brief.value = result.migrationBrief;
}

function renderList(target, rows, emptyText) {
  target.innerHTML = '';
  const list = document.createElement('ul');
  const values = rows.length ? rows : [emptyText];
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    if (!rows.length) item.className = 'muted';
    list.append(item);
  });
  target.append(list);
}

function formatNode(node) {
  return `${node.id} - ${node.type}`;
}

function setStatus(message, tone) {
  statusBox.textContent = message;
  statusBox.dataset.tone = tone;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
