import { buildRetrievalPlan, buildRetrievalPlanFromJson } from './retrievalPlanner.js';

const sampleWorkflow = {
  '4': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'dramatic singer under rain, cinematic lighting',
      clip: ['2', 1]
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 321777,
      steps: 28,
      cfg: 6.5,
      positive: ['4', 0],
      latent_image: ['7', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      duration: 8,
      filename_prefix: 'runninghub-final-mv'
    }
  },
  '17': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['8', 0]
    }
  }
};

const input = document.querySelector('#workflowInput');
const sampleButton = document.querySelector('#sampleButton');
const planButton = document.querySelector('#planButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const retrievalNodes = document.querySelector('#retrievalNodes');
const checklist = document.querySelector('#checklist');
const risks = document.querySelector('#risks');
const brief = document.querySelector('#retrievalBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  runPlanner();
});

planButton.addEventListener('click', runPlanner);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runPlanner();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Retrieval brief copied.', 'ok');
});

function runPlanner() {
  try {
    const result = buildRetrievalPlanFromJson(input.value);
    renderResult(result);
    setStatus('Output retrieval plan generated locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Format', result.format],
    ['Nodes', result.nodeCount],
    ['Retrieval nodes', result.retrievalNodes.length],
    ['Preview/temp nodes', result.previewOutputs.length],
    ['Duration fields', result.durationFields.length],
    ['Prompt fields', result.promptFields.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderNodeCards(result.retrievalNodes);
  renderList(checklist, result.apiChecklist, 'No API checklist could be generated.');
  renderList(risks, result.risks, 'No major retrieval risk detected from these simple checks.');
  brief.value = result.retrievalBrief;
}

function renderNodeCards(nodes) {
  retrievalNodes.innerHTML = '';
  if (!nodes.length) {
    retrievalNodes.innerHTML = '<p class="muted">No final retrieval node detected.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'node-cards';

  nodes.forEach((node) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    const links = node.inputLinks.length
      ? node.inputLinks.map((link) => `${link.key} <- ${link.sourceNodeId}:${link.sourceOutputIndex}`).join(', ')
      : 'No prompt API input links detected.';
    card.innerHTML = `
      <h3>${escapeHtml(node.id)} - ${escapeHtml(node.type)}</h3>
      <p><strong>Artifact:</strong> ${escapeHtml(node.artifactType)}</p>
      <p><strong>History path:</strong> <code>${escapeHtml(node.historyPath)}</code></p>
      <p><strong>Inputs:</strong> ${escapeHtml(links)}</p>
      <p>${escapeHtml(node.downloadHint)}</p>
    `;
    list.append(card);
  });

  retrievalNodes.append(list);
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

export { buildRetrievalPlan };
