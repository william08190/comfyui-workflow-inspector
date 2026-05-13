import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';

const sampleWorkflow = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 123456,
      steps: 24,
      cfg: 6,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0]
    }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic neon performance, wide shot',
      clip: ['4', 1]
    }
  },
  '8': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['3', 0],
      frame_rate: 24,
      duration: 6,
      filename_prefix: 'mv-studio-final'
    }
  },
  '9': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['3', 0]
    }
  }
};

const input = document.querySelector('#workflowInput');
const analyzeButton = document.querySelector('#analyzeButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const risks = document.querySelector('#risks');
const outputs = document.querySelector('#outputs');
const details = document.querySelector('#details');
const brief = document.querySelector('#repairBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  runAnalysis();
});

analyzeButton.addEventListener('click', runAnalysis);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runAnalysis();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Repair brief copied.', 'ok');
});

function runAnalysis() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = analyzeWorkflow(workflow);
    renderResult(result);
    setStatus('Workflow analyzed locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Outputs', result.outputNodes.length],
    ['Preview outputs', result.previewNodes.length],
    ['Duration fields', result.durationFields.length],
    ['Prompt fields', result.promptFields.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderList(outputs, result.outputNodes.map((node) => `${node.id} - ${node.type}`), 'No output-like nodes detected.');
  renderList(risks, result.risks, 'No major routing risk detected from these simple checks.');
  renderDetails(result);
  brief.value = result.repairBrief;
}

function renderDetails(result) {
  const groups = [
    ['Duration, frame, and FPS fields', result.durationFields],
    ['Seed fields', result.seedFields],
    ['Prompt fields', result.promptFields],
    ['Model fields', result.modelFields]
  ];

  details.innerHTML = groups
    .map(([title, rows]) => {
      const body = rows.length
        ? rows.map((row) => `<li><code>${escapeHtml(row.nodeId)}:${escapeHtml(row.key)}</code> ${escapeHtml(row.value)}</li>`).join('')
        : '<li class="muted">None detected.</li>';
      return `<section><h3>${escapeHtml(title)}</h3><ul>${body}</ul></section>`;
    })
    .join('');
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
