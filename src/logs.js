import { triageComfyLog } from './logTriage.js';

const sampleWorkflow = {
  '3': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'wan2.1_i2v_720p.safetensors' }
  },
  '4': {
    class_type: 'LoadImage',
    inputs: { image: 'reference.png' }
  },
  '7': {
    class_type: 'WanVideoWrapper',
    inputs: {
      image: ['4', 0],
      model: ['3', 0],
      width: 1280,
      height: 720,
      frames: 97,
      fps: 24
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['7', 0],
      frame_rate: 24,
      filename_prefix: 'final-video'
    }
  }
};

const sampleLog = [
  'ImportError: No module named WanVideoWrapper',
  'FileNotFoundError: wan2.1_i2v_720p.safetensors',
  'POST /prompt returned prompt_id=abc123 but /history/abc123 did not include final mp4 output'
].join('\n');

const logInput = document.querySelector('#logInput');
const workflowInput = document.querySelector('#workflowInput');
const targetPlatformInput = document.querySelector('#targetPlatformInput');
const triageButton = document.querySelector('#triageButton');
const sampleButton = document.querySelector('#sampleButton');
const workflowFile = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const signals = document.querySelector('#signals');
const blockers = document.querySelector('#blockers');
const actions = document.querySelector('#actions');
const evidence = document.querySelector('#evidence');
const checkoutLink = document.querySelector('#checkoutLink');
const brief = document.querySelector('#triageBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  logInput.value = sampleLog;
  workflowInput.value = JSON.stringify(sampleWorkflow, null, 2);
  targetPlatformInput.value = 'RunningHub hosted ComfyUI';
  runTriage();
});

triageButton.addEventListener('click', runTriage);

workflowFile.addEventListener('change', async () => {
  const file = workflowFile.files?.[0];
  if (!file) return;
  workflowInput.value = await file.text();
  runTriage();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Triage brief copied.', 'ok');
});

function runTriage() {
  try {
    const workflowJson = workflowInput.value.trim() || undefined;
    const result = triageComfyLog(logInput.value, {
      workflowJson,
      targetPlatform: targetPlatformInput.value
    });
    renderResult(result);
    setStatus('Log triage generated locally. No workflow or log data was uploaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderResult(result) {
  metrics.innerHTML = '';
  result.metrics.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    metrics.append(item);
  });

  renderSignalCards(result.signals);
  renderList(blockers, result.blockers, 'No blocker was detected from the provided log.');
  renderList(actions, result.priorityActions, 'Add more traceback context before choosing a repair action.');
  renderList(evidence, result.evidenceChecklist, 'Run the workflow again and capture prompt_id, history, and artifact evidence.');
  checkoutLink.href = result.checkoutUrl;
  brief.value = result.handoffBrief;
}

function renderSignalCards(items) {
  signals.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  const values = items.length ? items : [{
    label: 'No signal detected',
    severity: 'none',
    evidence: ['Paste a traceback or hosted task log to classify the failure.'],
    action: 'Capture more runtime context.'
  }];

  values.forEach((signal) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    const title = document.createElement('h3');
    title.textContent = `${signal.label} (${signal.severity})`;
    const evidenceList = document.createElement('ul');
    signal.evidence.forEach((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      evidenceList.append(item);
    });
    const action = document.createElement('p');
    action.textContent = signal.action;
    card.append(title, evidenceList, action);
    wrapper.append(card);
  });
  signals.append(wrapper);
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
