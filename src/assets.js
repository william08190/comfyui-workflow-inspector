import { buildAssetManifestFromJson } from './assetManifest.js';

const sampleWorkflow = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'sd_xl_base_1.0.safetensors'
    }
  },
  '5': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'sdxl_vae.safetensors'
    }
  },
  '6': {
    class_type: 'LoraLoader',
    inputs: {
      model: ['4', 0],
      clip: ['4', 1],
      lora_name: 'brand-style-lora.safetensors',
      strength_model: 0.7,
      strength_clip: 0.7
    }
  },
  '7': {
    class_type: 'LoadImage',
    inputs: {
      image: 'client/reference-product.png'
    }
  },
  '8': {
    class_type: 'VHS_LoadVideo',
    inputs: {
      video: 'client/source-motion.mp4',
      force_rate: 24
    }
  },
  '9': {
    class_type: 'IPAdapterAdvanced',
    inputs: {
      ipadapter_file: 'ip-adapter-plus_sdxl_vit-h.safetensors',
      image: ['7', 0],
      model: ['6', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['9', 0],
      frame_rate: 24,
      filename_prefix: 'asset-manifest-final'
    }
  }
};

const input = document.querySelector('#workflowInput');
const sampleButton = document.querySelector('#sampleButton');
const buildButton = document.querySelector('#buildButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const folders = document.querySelector('#folders');
const assets = document.querySelector('#assets');
const uploads = document.querySelector('#uploads');
const verification = document.querySelector('#verification');
const risks = document.querySelector('#risks');
const manifestJson = document.querySelector('#manifestJson');
const brief = document.querySelector('#manifestBrief');
const copyJsonButton = document.querySelector('#copyJsonButton');
const copyBriefButton = document.querySelector('#copyBriefButton');

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

copyJsonButton.addEventListener('click', async () => {
  const text = manifestJson.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Asset manifest JSON copied.', 'ok');
});

copyBriefButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Asset handoff brief copied.', 'ok');
});

function runBuilder() {
  try {
    const result = buildAssetManifestFromJson(input.value);
    renderResult(result);
    setStatus('Asset manifest generated locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Total assets', result.itemCount],
    ['Models', result.modelCount],
    ['Media inputs', result.mediaCount],
    ['Config files', result.configCount],
    ['Host folders', result.folderCount],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderFolders(result.folderGroups);
  renderAssets(result.items);
  renderList(uploads, result.uploadChecklist, 'No media uploads detected.');
  renderList(verification, result.verificationChecklist, 'No verification checklist generated.');
  renderList(risks, result.risks, 'No major asset risk detected from these checks.');
  manifestJson.value = result.manifestJson;
  brief.value = result.manifestBrief;
}

function renderFolders(groups) {
  folders.innerHTML = '';
  if (!groups.length) {
    folders.innerHTML = '<p class="muted">No host folders detected.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  groups.forEach((group) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(group.folder)}</h3>`,
      `<p><strong>Files:</strong> ${escapeHtml(group.items.map((item) => item.value).join(', '))}</p>`,
      `<p><strong>Node refs:</strong> ${escapeHtml(group.items.map((item) => `${item.nodeId}:${item.key}`).join(', '))}</p>`
    ].join('');
    wrapper.append(card);
  });
  folders.append(wrapper);
}

function renderAssets(items) {
  assets.innerHTML = '';
  if (!items.length) {
    assets.innerHTML = '<p class="muted">No asset entries found.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(item.value)}</h3>`,
      `<p><strong>Kind:</strong> ${escapeHtml(item.kind)} · <strong>Folder:</strong> ${escapeHtml(item.folder)}</p>`,
      `<p><strong>Node:</strong> ${escapeHtml(`${item.nodeId}:${item.nodeType}`)}</p>`,
      `<p><strong>Source:</strong> <code>${escapeHtml(item.sourcePath)}</code></p>`,
      `<p>${escapeHtml(item.action)}</p>`,
      `<p><strong>Verify:</strong> ${escapeHtml(item.verify)}</p>`
    ].join('');
    wrapper.append(card);
  });
  assets.append(wrapper);
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
