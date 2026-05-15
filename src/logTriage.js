import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { scanDependencies } from './dependencyScanner.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const CHECKOUT_BASE = 'https://mv.786668.xyz/service-checkout.html';

const SIGNAL_RULES = [
  {
    id: 'missing-node',
    label: 'Missing custom node or Python module',
    severity: 'blocker',
    match: /(missing node|node class .*does not exist|cannot import|importerror|modulenotfounderror|no module named|custom_nodes|custom node)/i,
    action: 'Install or repair the custom node package, pin its commit, install requirements, restart ComfyUI, and rerun the queue.'
  },
  {
    id: 'missing-asset',
    label: 'Missing model, checkpoint, or media asset',
    severity: 'blocker',
    match: /(filenotfounderror|no such file|file not found|not found.*\.(safetensors|ckpt|pt|pth|onnx|gguf|bin|png|jpe?g|webp|mp4|wav|mp3)|checkpoint.*not found|model.*not found)/i,
    action: 'Place the missing asset in the expected models or input folder, then rerun with the same prompt id if the host supports retry.'
  },
  {
    id: 'prompt-validation',
    label: 'Prompt validation or bad node input',
    severity: 'blocker',
    match: /(prompt outputs failed validation|invalid prompt|required input is missing|bad linked input|value not in list|failed to validate prompt)/i,
    action: 'Open the affected node, verify required inputs and enum values, then export a fresh prompt API JSON from the corrected graph.'
  },
  {
    id: 'api-output',
    label: 'Hosted API output retrieval failure',
    severity: 'high',
    match: /(\/prompt|\/history|\/view|prompt_id|websocket|history.*empty|no outputs|output.*not found|download.*failed)/i,
    action: 'Record the prompt_id, inspect /history/{prompt_id}, pin the final output node id, and fetch the artifact through /view.'
  },
  {
    id: 'gpu-memory',
    label: 'GPU memory or device allocation failure',
    severity: 'high',
    match: /(cuda out of memory|out of memory|oom|vram|mps backend|memory allocation|allocation failed)/i,
    action: 'Reduce resolution, frames, batch size, or model precision first; then retest on the target GPU tier.'
  },
  {
    id: 'torch-cuda',
    label: 'Torch, CUDA, xFormers, or binary dependency mismatch',
    severity: 'high',
    match: /(cuda error|cudnn|torch|xformers|triton|onnxruntime|bitsandbytes|failed building wheel|undefined symbol)/i,
    action: 'Align Python, torch, CUDA, xFormers, and custom-node wheels with the host image before changing workflow logic.'
  },
  {
    id: 'shape-dtype',
    label: 'Tensor shape, dimension, or dtype mismatch',
    severity: 'medium',
    match: /(shape mismatch|size mismatch|dimension mismatch|expected .* got|mat1 and mat2|dtype|tensor.*shape|cannot reshape)/i,
    action: 'Trace the model, latent, image, or mask size entering the failing node and normalize dimensions before that node.'
  },
  {
    id: 'ffmpeg-video',
    label: 'Video encode, frame rate, or ffmpeg failure',
    severity: 'medium',
    match: /(ffmpeg|videohelper|vhs_|videocombine|codec|moviepy|frame_rate|fps)/i,
    action: 'Verify ffmpeg availability, frame rate fields, output prefix, and that the video combine node is the final downloadable node.'
  },
  {
    id: 'network-auth',
    label: 'Network, auth, timeout, or host access failure',
    severity: 'medium',
    match: /(401|403|unauthorized|forbidden|connection refused|timeout|timed out|ssl|dns|proxy|gateway)/i,
    action: 'Confirm API key, public route, tunnel, timeout budget, and host firewall before retesting workflow internals.'
  }
];

export function triageComfyLog(logText, options = {}) {
  const text = String(logText || '').trim();
  const lines = splitLines(text);
  const signals = detectSignals(lines);
  const workflowContext = buildWorkflowContext(options.workflow ?? options.workflowJson);
  const priorityActions = buildPriorityActions({ signals, workflowContext });
  const blockers = buildBlockers({ signals, workflowContext });
  const evidenceChecklist = buildEvidenceChecklist({ signals, workflowContext });
  const checkoutUrl = buildCheckoutUrl(options);
  const handoffBrief = buildHandoffBrief({
    text,
    signals,
    workflowContext,
    priorityActions,
    blockers,
    evidenceChecklist,
    checkoutUrl,
    options
  });

  return {
    signalCount: signals.length,
    severity: chooseOverallSeverity(signals),
    signals,
    workflowContext,
    blockers,
    priorityActions,
    evidenceChecklist,
    checkoutUrl,
    metrics: buildMetrics({ signals, workflowContext, blockers }),
    handoffBrief
  };
}

function detectSignals(lines) {
  const signals = [];
  for (const rule of SIGNAL_RULES) {
    const evidence = lines.filter((line) => rule.match.test(line)).slice(0, 3);
    if (!evidence.length) continue;
    signals.push({
      id: rule.id,
      label: rule.label,
      severity: rule.severity,
      evidence,
      action: rule.action
    });
  }

  if (!signals.length && lines.length) {
    return [{
      id: 'unclassified',
      label: 'Unclassified runtime failure',
      severity: 'medium',
      evidence: lines.slice(0, 3),
      action: 'Capture more log context around the first traceback, the failing node id, and the host API response.'
    }];
  }
  return signals;
}

function buildWorkflowContext(input) {
  if (!input) return null;

  const workflow = typeof input === 'string' ? parseWorkflowJson(input) : input;
  const analysis = analyzeWorkflow(workflow);
  const dependencies = scanDependencies(workflow);
  const retrieval = buildRetrievalPlan(workflow);

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    customPackages: dependencies.packages.customPackages.map((pkg) => pkg.packageName),
    unknownNodes: dependencies.packages.unknownCustomNodes.map((node) => `${node.id}:${node.type}`),
    modelAssets: dependencies.assets.modelAssets.map((asset) => `${asset.value} (${asset.path})`),
    mediaAssets: dependencies.assets.mediaAssets.map((asset) => `${asset.value} (${asset.path})`),
    retrievalNodes: retrieval.retrievalNodes.map((node) => `${node.id}:${node.type}`),
    previewOutputs: retrieval.previewOutputs.map((node) => `${node.id}:${node.type}`),
    risks: [...dependencies.risks, ...retrieval.risks]
  };
}

function buildPriorityActions({ signals, workflowContext }) {
  const actions = signals.map((signal) => signal.action);

  if (workflowContext?.customPackages.length) {
    actions.push(`Install and verify custom packages: ${workflowContext.customPackages.slice(0, 6).join(', ')}.`);
  }
  if (workflowContext?.unknownNodes.length) {
    actions.push(`Identify unknown node classes before retesting: ${workflowContext.unknownNodes.slice(0, 6).join(', ')}.`);
  }
  if (workflowContext?.modelAssets.length) {
    actions.push(`Confirm model paths on the host: ${workflowContext.modelAssets.slice(0, 5).join('; ')}.`);
  }
  if (workflowContext && !workflowContext.retrievalNodes.length) {
    actions.push('Add or identify a final SaveImage, SaveAudio, or VideoCombine node before validating downloads.');
  }

  return unique(actions).slice(0, 10);
}

function buildBlockers({ signals, workflowContext }) {
  const blockers = signals
    .filter((signal) => signal.severity === 'blocker' || signal.severity === 'high')
    .map((signal) => signal.label);

  if (workflowContext?.unknownNodes.length) {
    blockers.push(`${workflowContext.unknownNodes.length} unknown custom node classes need package mapping.`);
  }
  if (workflowContext && !workflowContext.retrievalNodes.length) {
    blockers.push('No final downloadable output node was detected.');
  }

  return unique(blockers);
}

function buildEvidenceChecklist({ signals, workflowContext }) {
  const checklist = [
    'Full traceback or hosted task log with the first failing node id.',
    'ComfyUI commit, Python version, torch/CUDA version, and custom-node commit list.',
    'Exact prompt_id or hosted task id for the failed run.',
    'Corrected rerun evidence with status, elapsed time, and artifact size.'
  ];

  if (signals.some((signal) => signal.id === 'missing-node')) {
    checklist.push('Screenshot or log line showing the missing node is installed after restart.');
  }
  if (signals.some((signal) => signal.id === 'missing-asset')) {
    checklist.push('Host model/input folder paths for every missing checkpoint or media file.');
  }
  if (signals.some((signal) => signal.id === 'api-output')) {
    checklist.push('/history/{prompt_id} response snippet and selected final output node id.');
  }
  if (workflowContext?.retrievalNodes.length) {
    checklist.push(`Final output candidate to verify: ${workflowContext.retrievalNodes[0]}.`);
  }

  return unique(checklist);
}

function buildMetrics({ signals, workflowContext, blockers }) {
  return [
    { label: 'Log signals', value: signals.length },
    { label: 'Overall severity', value: chooseOverallSeverity(signals) },
    { label: 'Blockers', value: blockers.length },
    { label: 'Workflow nodes', value: workflowContext?.nodeCount ?? 'not provided' },
    { label: 'Custom packages', value: workflowContext?.customPackages.length ?? 'not provided' },
    { label: 'Model/media refs', value: workflowContext ? workflowContext.modelAssets.length + workflowContext.mediaAssets.length : 'not provided' },
    { label: 'Output candidates', value: workflowContext?.retrievalNodes.length ?? 'not provided' },
    { label: 'Preview outputs', value: workflowContext?.previewOutputs.length ?? 'not provided' }
  ];
}

function buildHandoffBrief({
  text,
  signals,
  workflowContext,
  priorityActions,
  blockers,
  evidenceChecklist,
  checkoutUrl,
  options
}) {
  const lines = [
    'ComfyUI failure log triage',
    `Target platform: ${normalizeOption(options.targetPlatform, 'Hosted ComfyUI or RunningHub')}`,
    `Overall severity: ${chooseOverallSeverity(signals)}`,
    `Checkout URL: ${checkoutUrl}`,
    `Log excerpt: ${firstTextLine(text) || 'not provided'}`,
    'Detected signals:',
    ...(signals.length ? signals.map((signal) => `- ${signal.label} (${signal.severity})`) : ['- none detected'])
  ];

  if (workflowContext) {
    lines.push(
      'Workflow context:',
      `- Format: ${workflowContext.format}`,
      `- Node count: ${workflowContext.nodeCount}`,
      `- Custom packages: ${workflowContext.customPackages.join(', ') || 'none detected'}`,
      `- Unknown nodes: ${workflowContext.unknownNodes.join(', ') || 'none detected'}`,
      `- Model refs: ${workflowContext.modelAssets.length}`,
      `- Media refs: ${workflowContext.mediaAssets.length}`,
      `- Output candidates: ${workflowContext.retrievalNodes.join(', ') || 'manual selection required'}`
    );
  }

  if (blockers.length) {
    lines.push('Blockers:', ...blockers.map((item) => `- ${item}`));
  }

  lines.push(
    'Priority repair actions:',
    ...priorityActions.map((action) => `- ${action}`),
    'Acceptance evidence:',
    ...evidenceChecklist.map((item) => `- ${item}`),
    'Repair request: reproduce the failure, fix the first blocker, rerun the workflow, and provide final output retrieval evidence.'
  );

  return lines.join('\n');
}

function chooseOverallSeverity(signals) {
  if (signals.some((signal) => signal.severity === 'blocker')) return 'blocker';
  if (signals.some((signal) => signal.severity === 'high')) return 'high';
  if (signals.length) return 'medium';
  return 'none';
}

function buildCheckoutUrl(options) {
  const params = new URLSearchParams({
    package: normalizeOption(options.packageCode, 'workflow-setup-starter'),
    source: 'github-log-triage'
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstTextLine(text) {
  return splitLines(text)[0] || '';
}

function normalizeOption(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
