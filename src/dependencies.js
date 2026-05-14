import { parseWorkflowJson } from './analyzer.js';
import { scanDependencies } from './dependencyScanner.js';

const sampleWorkflow = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'sd_xl_base_1.0.safetensors'
    }
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic product shot, soft key light',
      clip: ['4', 1]
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 789123,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['5', 0],
      model: ['4', 0]
    }
  },
  '12': {
    class_type: 'IPAdapterAdvanced',
    inputs: {
      image: 'brand-reference.png',
      ipadapter_file: 'ip-adapter-plus_sdxl_vit-h.safetensors',
      clip_vision: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
      model: ['8', 0]
    }
  },
  '18': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'client-final'
    }
  },
  '22': {
    class_type: 'SeedVR2Upscaler',
    inputs: {
      model_name: 'seedvr2_ema_7b.pth',
      video: ['18', 0]
    }
  },
  '30': {
    class_type: 'ClientBrandSafetyNode',
    inputs: {
      reference_video: 'style-reference.mp4'
    }
  }
};

const input = document.querySelector('#workflowInput');
const scanButton = document.querySelector('#scanButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const packages = document.querySelector('#packages');
const assets = document.querySelector('#assets');
const unknown = document.querySelector('#unknownNodes');
const risks = document.querySelector('#risks');
const brief = document.querySelector('#installBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  runScanner();
});

scanButton.addEventListener('click', runScanner);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runScanner();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Dependency brief copied.', 'ok');
});

function runScanner() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = scanDependencies(workflow);
    renderResult(result);
    setStatus('Dependencies scanned locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Core nodes', result.packages.coreNodes.length],
    ['Package groups', result.packages.customPackages.length],
    ['Unknown nodes', result.packages.unknownCustomNodes.length],
    ['Model assets', result.assets.modelAssets.length],
    ['Media assets', result.assets.mediaAssets.length],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderPackages(result.packages.customPackages);
  renderAssets(result.assets);
  renderUnknown(result.packages.unknownCustomNodes);
  renderList(risks, result.risks, 'No obvious dependency risk detected from these checks.');
  brief.value = result.installBrief;
}

function renderPackages(customPackages) {
  packages.innerHTML = '';
  if (!customPackages.length) {
    renderList(packages, [], 'No known custom node package groups detected.');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  customPackages.forEach((dependency) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    const nodeRows = dependency.nodes
      .map((node) => `<li><code>${escapeHtml(node.nodeId)}:${escapeHtml(node.nodeType)}</code></li>`)
      .join('');
    card.innerHTML = [
      `<h3>${escapeHtml(dependency.packageName)}</h3>`,
      `<p>${escapeHtml(dependency.installHint)}</p>`,
      `<ul>${nodeRows}</ul>`
    ].join('');
    wrapper.append(card);
  });
  packages.append(wrapper);
}

function renderAssets(assetGroups) {
  assets.innerHTML = '';
  const rows = [
    ...assetGroups.modelAssets.map((asset) => ({ ...asset, group: 'model' })),
    ...assetGroups.mediaAssets.map((asset) => ({ ...asset, group: 'media' }))
  ];
  if (!rows.length) {
    renderList(assets, [], 'No model or media asset references detected.');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((asset) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(asset.group)} asset</h3>`,
      `<p><code>${escapeHtml(asset.nodeId)}:${escapeHtml(asset.key)}</code> ${escapeHtml(asset.value)}</p>`,
      `<p><code>${escapeHtml(asset.path)}</code></p>`,
      `<p>${escapeHtml(asset.nodeType)}</p>`
    ].join('');
    wrapper.append(card);
  });
  assets.append(wrapper);
}

function renderUnknown(nodes) {
  unknown.innerHTML = '';
  if (!nodes.length) {
    renderList(unknown, [], 'No unmatched non-core node types detected.');
    return;
  }
  renderList(
    unknown,
    nodes.map((node) => `${node.nodeId}:${node.nodeType}`),
    ''
  );
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
