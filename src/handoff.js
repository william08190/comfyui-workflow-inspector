import { buildDeploymentHandoffFromJson } from './handoffBuilder.js';

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
      text: 'cinematic product video, clean lighting, final delivery',
      clip: ['4', 1]
    }
  },
  '7': {
    class_type: 'LoadImage',
    inputs: {
      image: 'reference/product-shot.png'
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 246802,
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
      images: ['8', 0]
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

const input = document.querySelector('#workflowInput');
const platformInput = document.querySelector('#platformInput');
const baseUrlInput = document.querySelector('#baseUrlInput');
const sampleButton = document.querySelector('#sampleButton');
const buildButton = document.querySelector('#buildButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const setup = document.querySelector('#setup');
const inputs = document.querySelector('#inputs');
const output = document.querySelector('#output');
const evidence = document.querySelector('#evidence');
const files = document.querySelector('#files');
const risks = document.querySelector('#risks');
const brief = document.querySelector('#handoffBrief');
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
  setStatus('Deployment handoff copied.', 'ok');
});

function runBuilder() {
  try {
    const result = buildDeploymentHandoffFromJson(input.value, {
      platform: platformInput.value,
      baseUrl: baseUrlInput.value
    });
    renderResult(result);
    setStatus('Deployment handoff generated locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Platform', result.platform.label],
    ['Nodes', result.nodeCount],
    ['Custom packages', result.customPackageCount],
    ['Unknown nodes', result.unknownCustomNodeCount],
    ['Model assets', result.modelAssetCount],
    ['Runtime inputs', result.runtimeInputCount],
    ['Output nodes', result.outputNodeCount],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderList(setup, result.setupItems, 'No setup items generated.');
  renderInputs(result.runtimeInputs);
  renderOutput(result.outputContract);
  renderList(evidence, result.evidenceChecklist, 'No evidence checklist generated.');
  renderList(files, result.clientFiles, 'No handoff files generated.');
  renderList(risks, result.risks, 'No major deployment risk detected from these checks.');
  brief.value = result.handoffBrief;
}

function renderInputs(rows) {
  inputs.innerHTML = '';
  if (!rows.length) {
    inputs.innerHTML = '<p class="muted">No directly bindable scalar runtime inputs detected.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((row) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(row.name)}</h3>`,
      `<p><strong>Category:</strong> ${escapeHtml(row.category)}</p>`,
      `<p><strong>Node:</strong> ${escapeHtml(row.nodeRef)}</p>`,
      `<p><strong>Path:</strong> <code>${escapeHtml(row.sourcePath)}</code></p>`,
      `<p><strong>Current:</strong> ${escapeHtml(row.currentValue)}</p>`
    ].join('');
    wrapper.append(card);
  });
  inputs.append(wrapper);
}

function renderOutput(contract) {
  output.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  const overview = document.createElement('article');
  overview.className = 'node-card';
  overview.innerHTML = [
    `<h3>Result contract</h3>`,
    `<p><strong>Result id:</strong> ${escapeHtml(contract.resultIdName)}</p>`,
    `<p>${escapeHtml(contract.retrievalNote)}</p>`,
    `<p><strong>Download:</strong> <code>${escapeHtml(contract.downloadPattern)}</code></p>`,
    `<p><strong>Preview/temp nodes:</strong> ${escapeHtml(contract.previewNodes.join(', ') || 'none detected')}</p>`
  ].join('');
  wrapper.append(overview);

  contract.preferredNodes.forEach((node) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(node.nodeId)} - ${escapeHtml(node.nodeType)}</h3>`,
      `<p><strong>Artifact:</strong> ${escapeHtml(node.artifactType)}</p>`,
      `<p><strong>History path:</strong> <code>${escapeHtml(node.historyPath)}</code></p>`,
      `<p>${escapeHtml(node.downloadHint)}</p>`
    ].join('');
    wrapper.append(card);
  });

  output.append(wrapper);
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
