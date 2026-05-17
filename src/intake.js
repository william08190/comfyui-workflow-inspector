import { parseWorkflowJson } from './analyzer.js';
import { buildSupportIntakePacket } from './intakePacket.js';

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
      text: 'premium product launch video, controlled studio light, slow push-in',
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
      frames: 121,
      fps: 24,
      seed: 245891
    }
  },
  '9': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: ['6', 0],
      frame_rate: 24,
      filename_prefix: 'client-final'
    }
  }
};

const sampleHistory = {
  'prompt-20260517': {
    status: { completed: true },
    outputs: {
      '9': {
        videos: [
          {
            filename: 'client-final_00001.mp4',
            subfolder: '2026-05-17',
            type: 'output',
            format: 'video/mp4'
          }
        ]
      }
    }
  }
};

const sampleLog = [
  'ImportError: No module named WanVideoWrapper',
  'FileNotFoundError: wan2.1_i2v_720p.safetensors',
  'POST /prompt returned prompt_id but the wrapper did not expose final mp4 download'
].join('\n');

const input = document.querySelector('#workflowInput');
const historyInput = document.querySelector('#historyInput');
const logInput = document.querySelector('#failureLogInput');
const targetInput = document.querySelector('#targetPlatformInput');
const goalInput = document.querySelector('#deliveryGoalInput');
const issueInput = document.querySelector('#issueSummaryInput');
const buildButton = document.querySelector('#buildButton');
const sampleButton = document.querySelector('#sampleButton');
const fileInput = document.querySelector('#workflowFile');
const statusBox = document.querySelector('#statusBox');
const metrics = document.querySelector('#metrics');
const attachments = document.querySelector('#attachments');
const questions = document.querySelector('#questions');
const blockers = document.querySelector('#blockers');
const evidence = document.querySelector('#evidence');
const checkoutLink = document.querySelector('#checkoutLink');
const brief = document.querySelector('#intakeBrief');
const copyButton = document.querySelector('#copyButton');

sampleButton.addEventListener('click', () => {
  input.value = JSON.stringify(sampleWorkflow, null, 2);
  historyInput.value = JSON.stringify(sampleHistory, null, 2);
  logInput.value = sampleLog;
  targetInput.value = 'RunningHub hosted ComfyUI';
  goalInput.value = 'Working image-to-video hosted workflow with runtime prompt, seed, duration, and final mp4 evidence';
  issueInput.value = 'The workflow runs locally, but hosted setup is missing the video node package, checkpoint file, and final artifact mapping.';
  runIntake();
});

buildButton.addEventListener('click', runIntake);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  input.value = await file.text();
  runIntake();
});

copyButton.addEventListener('click', async () => {
  const text = brief.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus('Support intake packet copied.', 'ok');
});

function runIntake() {
  try {
    const workflow = parseWorkflowJson(input.value);
    const result = buildSupportIntakePacket(workflow, {
      targetPlatform: targetInput.value,
      deliveryGoal: goalInput.value,
      issueSummary: issueInput.value,
      failureLog: logInput.value,
      historyJson: historyInput.value
    });
    renderResult(result);
    setStatus('Support intake packet generated locally. No workflow data was uploaded.', 'ok');
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

  renderCards(attachments, result.attachments, (item) => ({
    title: `${item.name} (${item.status})`,
    lines: [item.note]
  }));
  renderList(questions, result.questions, 'No open intake question generated.');
  renderList(blockers, result.blockers, 'No blocker detected from this packet.');
  renderList(evidence, result.evidenceChecklist, 'No evidence checklist generated.');
  checkoutLink.href = result.checkoutUrl;
  brief.value = result.packetBrief;
}

function renderCards(target, rows, mapper) {
  target.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'node-cards';
  rows.forEach((row) => {
    const mapped = mapper(row);
    const card = document.createElement('section');
    card.className = 'node-card';
    const title = document.createElement('h3');
    title.textContent = mapped.title;
    card.append(title);
    mapped.lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      card.append(p);
    });
    wrapper.append(card);
  });
  target.append(wrapper);
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
