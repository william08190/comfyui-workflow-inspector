import { extractHistoryArtifactsFromJson } from './historyResult.js';

const sampleWorkflow = {
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 987654,
      steps: 24
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'mv-final'
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
  'sample-prompt-id': {
    status: {
      completed: true,
      status_str: 'success'
    },
    outputs: {
      '12': {
        gifs: [
          {
            filename: 'mv-final_00001.mp4',
            subfolder: 'finals',
            type: 'output',
            format: 'video/h264-mp4'
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
const extractButton = document.querySelector('#extractButton');
const historyFile = document.querySelector('#historyFile');
const workflowFile = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const nodeSummaries = document.querySelector('#nodeSummaries');
const artifacts = document.querySelector('#artifacts');
const risks = document.querySelector('#risks');
const commands = document.querySelector('#commands');
const brief = document.querySelector('#historyBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  workflowInput.value = JSON.stringify(sampleWorkflow, null, 2);
  historyInput.value = JSON.stringify(sampleHistory, null, 2);
  runExtractor();
});

extractButton.addEventListener('click', runExtractor);

historyFile.addEventListener('change', async () => {
  const file = historyFile.files?.[0];
  if (!file) return;
  historyInput.value = await file.text();
  runExtractor();
});

workflowFile.addEventListener('change', async () => {
  const file = workflowFile.files?.[0];
  if (!file) return;
  workflowInput.value = await file.text();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('History evidence brief copied.', 'ok');
});

function runExtractor() {
  try {
    const result = extractHistoryArtifactsFromJson(historyInput.value, {
      workflowJson: workflowInput.value,
      baseUrl: baseUrlInput.value
    });
    renderResult(result);
    setStatus('History artifacts extracted locally. No data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  [
    ['Histories', result.historyCount],
    ['Completed', `${result.completedCount}/${result.historyCount}`],
    ['Artifacts', result.artifactCount],
    ['Output nodes', result.nodeSummaries.length],
    ['Final/output files', result.finalArtifactCount],
    ['Temp/preview files', result.tempArtifactCount],
    ['Prompt ids', result.promptIds.length],
    ['Risks', result.risks.length]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderNodeSummaries(result.nodeSummaries);
  renderArtifacts(result.artifacts);
  renderList(risks, result.risks, 'No major history artifact risk detected from these checks.');
  renderCommands(result.downloadCommands);
  brief.value = result.evidenceBrief;
}

function renderNodeSummaries(rows) {
  nodeSummaries.innerHTML = '';
  if (!rows.length) {
    nodeSummaries.innerHTML = '<p class="muted">No history output node produced downloadable artifacts.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((row) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    const flags = [
      row.isPreferredFinal ? 'preferred final' : '',
      row.isPreview ? 'preview/temp present' : ''
    ].filter(Boolean).join(', ') || 'history output';
    card.innerHTML = [
      `<h3>${escapeHtml(row.nodeId)} - ${escapeHtml(row.nodeType)}</h3>`,
      `<p><strong>Artifacts:</strong> ${escapeHtml(String(row.artifactCount))}</p>`,
      `<p><strong>Buckets:</strong> ${escapeHtml(row.buckets.join(', '))}</p>`,
      `<p><strong>Types:</strong> ${escapeHtml(row.artifactTypes.join(', '))}</p>`,
      `<p>${escapeHtml(flags)}</p>`
    ].join('');
    wrapper.append(card);
  });
  nodeSummaries.append(wrapper);
}

function renderArtifacts(rows) {
  artifacts.innerHTML = '';
  if (!rows.length) {
    artifacts.innerHTML = '<p class="muted">No artifact objects with filename or URL were detected.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((artifact) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = [
      `<h3>${escapeHtml(artifact.filename)}</h3>`,
      `<p><strong>Node:</strong> ${escapeHtml(artifact.nodeId)}:${escapeHtml(artifact.nodeType)}</p>`,
      `<p><strong>Path:</strong> <code>${escapeHtml(artifact.historyPath)}</code></p>`,
      `<p><strong>Kind:</strong> ${escapeHtml(artifact.artifactType)} / ${escapeHtml(artifact.type || 'unknown')}</p>`,
      `<p><strong>Download:</strong> <a href="${escapeHtml(artifact.viewUrl)}">${escapeHtml(artifact.viewUrl || 'direct path only')}</a></p>`
    ].join('');
    wrapper.append(card);
  });
  artifacts.append(wrapper);
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
