import { parseWorkflowJson } from './analyzer.js';
import { mapParameters } from './parameterMapper.js';

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
      text: 'cinematic product shot, neon rim light',
      clip: ['4', 1]
    }
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'low quality, blurry',
      clip: ['4', 1]
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 345678,
      steps: 24,
      cfg: 6,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      duration: 6,
      filename_prefix: 'hosted-final'
    }
  },
  '18': {
    class_type: 'LoadImage',
    inputs: {
      image: 'reference.png'
    }
  }
};

const input = document.querySelector('#workflowInput');
const mapButton = document.querySelector('#mapButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const groups = document.querySelector('#parameterGroups');
const bindings = document.querySelector('#bindings');
const risks = document.querySelector('#risks');
const brief = document.querySelector('#integrationBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  runMapper();
});

mapButton.addEventListener('click', runMapper);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runMapper();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Parameter brief copied.', 'ok');
});

function runMapper() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = mapParameters(workflow);
    renderResult(result);
    setStatus('Parameters mapped locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Parameter fields', result.fields.length],
    ['Bindable inputs', result.bindings.length],
    ['Groups', result.groups.length],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderGroups(result.groups);
  renderBindings(result.bindings);
  renderList(risks, result.risks, 'No major parameter mapping risk detected from these checks.');
  brief.value = result.integrationBrief;
}

function renderGroups(parameterGroups) {
  groups.innerHTML = '';
  if (!parameterGroups.length) {
    renderList(groups, [], 'No parameter groups detected.');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  parameterGroups.forEach((group) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    const rows = group.fields
      .map((field) => `<li><code>${escapeHtml(field.nodeId)}:${escapeHtml(field.key)}</code> ${escapeHtml(field.value)} <span class="muted">(${escapeHtml(field.valueKind)})</span></li>`)
      .join('');
    card.innerHTML = `<h3>${escapeHtml(group.category)}</h3><ul>${rows}</ul>`;
    wrapper.append(card);
  });
  groups.append(wrapper);
}

function renderBindings(parameterBindings) {
  bindings.innerHTML = '';
  if (!parameterBindings.length) {
    renderList(bindings, [], 'No directly bindable scalar parameters detected.');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  parameterBindings.forEach((binding) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(binding.name)}</h3>`,
      `<p><code>${escapeHtml(binding.sourcePath)}</code></p>`,
      `<p>${escapeHtml(binding.category)} input on ${escapeHtml(binding.nodeId)}:${escapeHtml(binding.nodeType)}</p>`,
      `<p>Current value: ${escapeHtml(binding.value)}</p>`
    ].join('');
    wrapper.append(card);
  });
  bindings.append(wrapper);
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
