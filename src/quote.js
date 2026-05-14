import { parseWorkflowJson } from './analyzer.js';
import { buildSetupQuote } from './quoteEstimator.js';

const sampleWorkflow = {
  '3': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'wan2.1_i2v_720p.safetensors'
    }
  },
  '4': {
    class_type: 'LoadImage',
    inputs: {
      image: 'product-reference.png'
    }
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic product video, crisp lighting, smooth camera motion',
      clip: ['3', 1]
    }
  },
  '6': {
    class_type: 'WanVideoWrapper',
    inputs: {
      image: ['4', 0],
      positive: ['5', 0],
      width: 1280,
      height: 720,
      frames: 97,
      fps: 24,
      seed: 912345
    }
  },
  '9': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['6', 0],
      frame_rate: 24,
      filename_prefix: 'hosted-final'
    }
  }
};

const sampleLog = [
  'ImportError: No module named WanVideoWrapper',
  'FileNotFoundError: wan2.1_i2v_720p.safetensors',
  'POST /prompt succeeded but /history did not include the expected final mp4'
].join('\n');

const input = document.querySelector('#workflowInput');
const logInput = document.querySelector('#failureLogInput');
const targetInput = document.querySelector('#targetPlatformInput');
const goalInput = document.querySelector('#deliveryGoalInput');
const urgencyInput = document.querySelector('#urgencyInput');
const quoteButton = document.querySelector('#quoteButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const breakdown = document.querySelector('#breakdown');
const scope = document.querySelector('#scope');
const risks = document.querySelector('#risks');
const checkoutLink = document.querySelector('#checkoutLink');
const brief = document.querySelector('#quoteBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  logInput.value = sampleLog;
  targetInput.value = 'RunningHub hosted ComfyUI';
  goalInput.value = 'Working image-to-video workflow with runtime prompt, seed, duration, and final mp4 retrieval evidence';
  urgencyInput.value = 'Standard';
  runQuote();
});

quoteButton.addEventListener('click', runQuote);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runQuote();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Quote brief copied.', 'ok');
});

function runQuote() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = buildSetupQuote(workflow, {
      failureLog: logInput.value,
      targetPlatform: targetInput.value,
      deliveryGoal: goalInput.value,
      urgency: urgencyInput.value
    });
    renderResult(result);
    setStatus('Setup quote generated locally. No workflow data was uploaded.', 'ok');
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

  renderList(breakdown, result.scoreBreakdown.map((item) => `${item.label}: +${item.points}`), 'No score item generated.');
  renderScope(result.scope);
  renderList(risks, result.risks, 'No major quote risk detected from these checks.');
  checkoutLink.href = result.checkoutUrl;
  brief.value = result.quoteBrief;
}

function renderScope(sections) {
  scope.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  sections.forEach((section) => {
    const card = document.createElement('section');
    card.className = 'node-card';
    const list = document.createElement('ul');
    section.items.forEach((value) => {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    });
    const title = document.createElement('h3');
    title.textContent = section.title;
    card.append(title, list);
    wrapper.append(card);
  });
  scope.append(wrapper);
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
