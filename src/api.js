import { parseWorkflowJson } from './analyzer.js';
import { buildApiSmokePlan } from './apiSmokePlanner.js';

const sampleWorkflow = {
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
      text: 'cinematic workflow smoke test, clean final frame',
      clip: ['4', 1]
    }
  },
  '7': {
    class_type: 'KSampler',
    inputs: {
      seed: 567890,
      steps: 24,
      cfg: 6,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['6', 0],
      latent_image: ['5', 0],
      model: ['4', 0]
    }
  },
  '10': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['7', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['7', 0],
      frame_rate: 24,
      filename_prefix: 'api-smoke-final'
    }
  }
};

const input = document.querySelector('#workflowInput');
const baseUrlInput = document.querySelector('#baseUrlInput');
const buildButton = document.querySelector('#buildButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const endpoints = document.querySelector('#endpoints');
const checklist = document.querySelector('#checklist');
const commands = document.querySelector('#commands');
const risks = document.querySelector('#risks');
const brief = document.querySelector('#smokeBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  runBuilder();
});

buildButton.addEventListener('click', runBuilder);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runBuilder();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Smoke test brief copied.', 'ok');
});

function runBuilder() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = buildApiSmokePlan(workflow, { baseUrl: baseUrlInput.value });
    renderResult(result);
    setStatus('API smoke test plan generated locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Output nodes', result.outputNodes.length],
    ['Preview outputs', result.previewNodes.length],
    ['Preferred node', result.preferredOutputNode ? result.preferredOutputNode.nodeId : 'manual'],
    ['Bindable inputs', result.bindableParameters.length],
    ['Endpoints', result.endpoints.length],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderEndpoints(result.endpoints);
  renderList(checklist, result.checklist, 'No checklist generated.');
  renderCommands(result.curlCommands);
  renderList(risks, result.risks, 'No major API smoke test risk detected from these checks.');
  brief.value = result.smokeBrief;
}

function renderEndpoints(rows) {
  endpoints.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((endpoint) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(endpoint.label)}</h3>`,
      `<p><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.url)}</code></p>`,
      `<p>${escapeHtml(endpoint.purpose)}</p>`
    ].join('');
    wrapper.append(card);
  });
  endpoints.append(wrapper);
}

function renderCommands(rows) {
  commands.innerHTML = '';
  const block = document.createElement('textarea');
  block.className = 'brief';
  block.readOnly = true;
  block.value = rows.join('\n');
  commands.append(block);
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
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
