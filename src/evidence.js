import { buildAcceptanceEvidenceFromJson } from './acceptanceEvidence.js';

const sampleWorkflow = {
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 13579
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'client-final'
    }
  },
  '17': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['8', 0]
    }
  }
};

const sampleHistory = {
  'prompt-accept-001': {
    status: {
      completed: true,
      status_str: 'success'
    },
    outputs: {
      '12': {
        gifs: [
          {
            filename: 'client-final_00001.mp4',
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
};

const historyInput = document.querySelector('#historyInput');
const workflowInput = document.querySelector('#workflowInput');
const baseUrlInput = document.querySelector('#baseUrlInput');
const sampleButton = document.querySelector('#sampleButton');
const buildButton = document.querySelector('#buildButton');
const historyFile = document.querySelector('#historyFile');
const workflowFile = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const deliverables = document.querySelector('#deliverables');
const checklist = document.querySelector('#checklist');
const files = document.querySelector('#files');
const downloads = document.querySelector('#downloads');
const risks = document.querySelector('#risks');
const report = document.querySelector('#customerReport');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  historyInput.value = JSON.stringify(sampleHistory, null, 2);
  workflowInput.value = JSON.stringify(sampleWorkflow, null, 2);
  runBuilder();
});

buildButton.addEventListener('click', runBuilder);

historyFile.addEventListener('change', async () => {
  const file = historyFile.files?.[0];
  if (!file) return;
  historyInput.value = await file.text();
  runBuilder();
});

workflowFile.addEventListener('change', async () => {
  const file = workflowFile.files?.[0];
  if (!file) return;
  workflowInput.value = await file.text();
  runBuilder();
});

copyButton.addEventListener('click', async () => {
  const text = report.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Acceptance report copied.', 'ok');
});

function runBuilder() {
  try {
    const result = buildAcceptanceEvidenceFromJson(historyInput.value, {
      workflowJson: workflowInput.value,
      baseUrl: baseUrlInput.value
    });
    renderResult(result);
    setStatus('Acceptance evidence generated locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Outcome', result.outcome.label],
    ['History entries', result.historyCount],
    ['Completed', `${result.completedCount}/${result.historyCount}`],
    ['Artifacts', result.artifactCount],
    ['Deliverables', result.deliverableCount],
    ['Preview/temp', result.previewArtifactCount],
    ['Workflow nodes', result.workflowNodeCount || 'not provided'],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderDeliverables(result.deliverables);
  renderList(checklist, result.acceptanceChecklist, 'No acceptance checklist generated.');
  renderList(files, result.deliveryFiles, 'No delivery files generated.');
  renderList(downloads, result.downloadCommands, 'No download commands generated.');
  renderList(risks, result.risks, 'No major acceptance risk detected.');
  report.value = result.customerReport;
}

function renderDeliverables(rows) {
  deliverables.innerHTML = '';
  if (!rows.length) {
    deliverables.innerHTML = '<p class="muted">No final deliverables found.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((artifact) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(artifact.filename)}</h3>`,
      `<p><strong>Node:</strong> ${escapeHtml(`${artifact.nodeId}:${artifact.nodeType}`)}</p>`,
      `<p><strong>Prompt:</strong> ${escapeHtml(artifact.promptId)}</p>`,
      `<p><strong>Type:</strong> ${escapeHtml(`${artifact.type || 'unknown'} · ${artifact.artifactType}`)}</p>`,
      `<p><strong>History path:</strong> <code>${escapeHtml(artifact.historyPath)}</code></p>`,
      `<p><strong>Download:</strong> <code>${escapeHtml(artifact.viewUrl || 'direct path only')}</code></p>`
    ].join('');
    wrapper.append(card);
  });
  deliverables.append(wrapper);
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
