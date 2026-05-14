import { parseWorkflowJson } from './analyzer.js';
import { buildRepairBrief } from './repairBriefBuilder.js';

const sampleWorkflow = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'sd_xl_base_1.0.safetensors'
    }
  },
  '5': {
    class_type: 'LoadImage',
    inputs: {
      image: 'artist-reference.png'
    }
  },
  '6': {
    class_type: 'IPAdapterAdvanced',
    inputs: {
      image: ['5', 0],
      model: ['4', 0],
      weight: 0.72
    }
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'cinematic neon music video frame, clean composition',
      clip: ['4', 1]
    }
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 112233,
      steps: 24,
      cfg: 6,
      sampler_name: 'euler',
      scheduler: 'normal',
      positive: ['7', 0],
      model: ['6', 0]
    }
  },
  '12': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['8', 0],
      frame_rate: 24,
      filename_prefix: 'repair-final'
    }
  }
};

const sampleLog = [
  'ImportError: No module named IPAdapterAdvanced',
  'FileNotFoundError: sd_xl_base_1.0.safetensors',
  'POST /prompt returned prompt_id but /history did not include the expected final video'
].join('\n');

const input = document.querySelector('#workflowInput');
const logInput = document.querySelector('#failureLogInput');
const targetInput = document.querySelector('#targetPlatformInput');
const deliverableInput = document.querySelector('#deliverableInput');
const buildButton = document.querySelector('#buildButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const priority = document.querySelector('#priority');
const blockers = document.querySelector('#blockers');
const scope = document.querySelector('#scope');
const checkoutLink = document.querySelector('#checkoutLink');
const brief = document.querySelector('#repairBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  logInput.value = sampleLog;
  targetInput.value = 'RunningHub hosted ComfyUI';
  deliverableInput.value = 'Working hosted workflow, runtime parameter map, final video download evidence';
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
  setStatus('Repair brief copied.', 'ok');
});

function runBuilder() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = buildRepairBrief(workflow, {
      failureLog: logInput.value,
      targetPlatform: targetInput.value,
      deliverable: deliverableInput.value
    });
    renderResult(result);
    setStatus('Repair brief generated locally. No data was uploaded.', 'ok');
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

  renderList(priority, result.priorityActions, 'No priority action generated.');
  renderList(blockers, result.blockers, 'No major repair blocker detected from these checks.');
  renderScope(result.scope);
  checkoutLink.href = result.checkoutUrl;
  brief.value = result.intakeBrief;
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
