import { buildRedactionPack } from './redactor.js';

const sampleWorkflow = {
  '3': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: '/Users/artist/models/checkpoints/wan2.1_i2v_720p.safetensors'
    }
  },
  '7': {
    class_type: 'LoadImage',
    inputs: {
      image: '/Users/artist/private/references/label-contract.png'
    }
  },
  '12': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic music video shot',
      api_key: 'sk_test_private_1234567890abcdef'
    }
  },
  '18': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['12', 0],
      frame_rate: 24,
      upload_url: 'https://host.example.com/upload?token=abc123private&job=mv'
    }
  }
};

const sampleLog = [
  'Authorization: Bearer ghp_1234567890abcdefghijklmnop',
  'FileNotFoundError: /Users/artist/private/references/label-contract.png',
  'POST http://127.0.0.1:8188/prompt returned prompt_id=abc123',
  'Contact: producer@example.com'
].join('\n');

const workflowInput = document.querySelector('#workflowInput');
const logInput = document.querySelector('#logInput');
const recipientInput = document.querySelector('#recipientInput');
const sanitizeButton = document.querySelector('#sanitizeButton');
const sampleButton = document.querySelector('#sampleButton');
const workflowFile = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const findings = document.querySelector('#findings');
const checklist = document.querySelector('#checklist');
const safeWorkflow = document.querySelector('#safeWorkflow');
const safeLog = document.querySelector('#safeLog');
const checkoutLink = document.querySelector('#checkoutLink');
const brief = document.querySelector('#shareBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  workflowInput.value = JSON.stringify(sampleWorkflow, null, 2);
  logInput.value = sampleLog;
  recipientInput.value = 'private ComfyUI workflow repair provider';
  runSanitizer();
});

sanitizeButton.addEventListener('click', runSanitizer);

workflowFile.addEventListener('change', async () => {
  const file = workflowFile.files?.[0];
  if (!file) return;
  workflowInput.value = await file.text();
  runSanitizer();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Safe share package copied.', 'ok');
});

function runSanitizer() {
  try {
    const result = buildRedactionPack(workflowInput.value, {
      logText: logInput.value,
      targetRecipient: recipientInput.value
    });
    renderResult(result);
    setStatus('Safe share package generated locally. No workflow or log data was uploaded.', 'ok');
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

  renderFindings(result.exposures);
  renderList(checklist, result.checklist, 'No share checklist generated.');
  safeWorkflow.value = result.safeWorkflowJson || '';
  safeLog.value = result.safeLog || '';
  checkoutLink.href = result.checkoutUrl;
  brief.value = result.handoffBrief;
}

function renderFindings(items) {
  findings.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  const values = items.length ? items : [{
    severity: 'clean',
    type: 'no redaction',
    source: 'input',
    path: 'root',
    note: 'No obvious secrets, private hosts, local paths, or emails were detected.'
  }];

  values.slice(0, 16).forEach((finding) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    const title = document.createElement('h3');
    title.textContent = `${finding.severity}: ${finding.type}`;
    const body = document.createElement('p');
    body.textContent = `${finding.source}:${finding.path} ${finding.note}`;
    card.append(title, body);
    wrapper.append(card);
  });

  findings.append(wrapper);
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
