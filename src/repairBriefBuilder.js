import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { buildApiSmokePlan } from './apiSmokePlanner.js';
import { scanDependencies } from './dependencyScanner.js';
import { mapParameters } from './parameterMapper.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const DEFAULT_PACKAGE = 'workflow-setup-starter';
const CHECKOUT_BASE = 'https://mv.786668.xyz/service-checkout.html';

const LOG_RULES = [
  {
    label: 'Missing custom node or Python package',
    match: /(missing node|cannot import|importerror|module not found|no module named|custom node)/i,
    action: 'Verify custom-node installation and Python dependencies on the host.'
  },
  {
    label: 'Missing model or media file',
    match: /(no such file|file not found|checkpoint|safetensors|\.ckpt|\.pt|\.pth|\.png|\.mp4|\.wav)/i,
    action: 'Map model and media references to host paths before running the workflow.'
  },
  {
    label: 'GPU memory or CUDA failure',
    match: /(cuda|out of memory|oom|mps|vram)/i,
    action: 'Check resolution, batch size, model size, precision, and GPU memory limits.'
  },
  {
    label: 'Hosted API or queue failure',
    match: /(\/prompt|\/history|prompt_id|websocket|http 4\d\d|http 5\d\d|timeout|connection refused)/i,
    action: 'Re-run the hosted API smoke test and capture status, prompt_id, history, and artifact evidence.'
  },
  {
    label: 'Runtime input mapping issue',
    match: /(duration|fps|frame_rate|seed|width|height|prompt|parameter|input)/i,
    action: 'Expose the affected workflow fields as hosted runtime inputs.'
  }
];

export function buildRepairBriefFromJson(raw, options = {}) {
  return buildRepairBrief(parseWorkflowJson(raw), options);
}

export function buildRepairBrief(workflow, options = {}) {
  const analysis = analyzeWorkflow(workflow);
  const dependencies = scanDependencies(workflow);
  const parameters = mapParameters(workflow);
  const retrieval = buildRetrievalPlan(workflow);
  const api = buildApiSmokePlan(workflow, { baseUrl: options.baseUrl });
  const logSignals = detectLogSignals(options.failureLog);
  const checkoutUrl = buildCheckoutUrl(options);
  const priorityActions = buildPriorityActions({
    analysis,
    dependencies,
    parameters,
    retrieval,
    api,
    logSignals
  });
  const intakeBrief = buildIntakeBrief({
    analysis,
    dependencies,
    parameters,
    retrieval,
    api,
    logSignals,
    priorityActions,
    options,
    checkoutUrl
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    targetPlatform: normalizeOption(options.targetPlatform, 'Hosted ComfyUI or RunningHub'),
    packageCode: normalizeOption(options.packageCode, DEFAULT_PACKAGE),
    checkoutUrl,
    metrics: [
      { label: 'Nodes', value: analysis.nodeCount },
      { label: 'Custom packages', value: dependencies.packages.customPackages.length },
      { label: 'Unknown nodes', value: dependencies.packages.unknownCustomNodes.length },
      { label: 'Model refs', value: dependencies.assets.modelAssets.length },
      { label: 'Media refs', value: dependencies.assets.mediaAssets.length },
      { label: 'Bindable inputs', value: parameters.bindings.length },
      { label: 'Retrieval nodes', value: retrieval.retrievalNodes.length },
      { label: 'Log signals', value: logSignals.length }
    ],
    priorityActions,
    logSignals,
    blockers: buildBlockers({ dependencies, parameters, retrieval, api, logSignals }),
    scope: buildScope({ dependencies, parameters, retrieval, api, logSignals }),
    intakeBrief
  };
}

function detectLogSignals(logText) {
  const text = String(logText || '').trim();
  if (!text) return [];

  return LOG_RULES
    .filter((rule) => rule.match.test(text))
    .map((rule) => ({
      label: rule.label,
      action: rule.action
    }));
}

function buildCheckoutUrl(options) {
  const params = new URLSearchParams({
    package: normalizeOption(options.packageCode, DEFAULT_PACKAGE),
    source: 'github-repair-brief'
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

function buildPriorityActions({ analysis, dependencies, parameters, retrieval, api, logSignals }) {
  const actions = [];

  if (dependencies.packages.customPackages.length || dependencies.packages.unknownCustomNodes.length) {
    actions.push('Install and verify custom nodes before debugging graph logic.');
  }
  if (dependencies.assets.modelAssets.length || dependencies.assets.mediaAssets.length) {
    actions.push('Place or remap all model and media assets on the hosted ComfyUI machine.');
  }
  if (parameters.bindings.length) {
    actions.push(`Expose ${parameters.bindings.length} runtime input(s) for prompts, size, seed, timing, media, or model choices.`);
  } else {
    actions.push('Review workflow inputs manually because no scalar hosted parameters were detected.');
  }
  if (retrieval.retrievalNodes.length) {
    actions.push(`Pin final output retrieval to node ${retrieval.retrievalNodes[0].id}:${retrieval.retrievalNodes[0].type}.`);
  } else {
    actions.push('Add or identify a final Save/VideoCombine output node before API handoff.');
  }
  if (api.preferredOutputNode) {
    actions.push(`Run a /prompt -> /history -> /view smoke test against preferred node ${api.preferredOutputNode.nodeId}.`);
  }
  if (analysis.format === 'ComfyUI UI workflow export') {
    actions.push('Convert the UI workflow export to prompt API JSON for hosted execution.');
  }
  for (const signal of logSignals) {
    actions.push(signal.action);
  }

  return unique(actions);
}

function buildBlockers({ dependencies, parameters, retrieval, api, logSignals }) {
  return unique([
    ...dependencies.risks,
    ...parameters.risks,
    ...retrieval.risks,
    ...api.risks,
    ...logSignals.map((signal) => `${signal.label}: ${signal.action}`)
  ]);
}

function buildScope({ dependencies, parameters, retrieval, api, logSignals }) {
  const scope = [
    {
      title: 'Host setup',
      items: [
        ...dependencies.packages.customPackages.map((pkg) => `Install ${pkg.packageName}: ${pkg.installHint}`),
        ...dependencies.packages.unknownCustomNodes.slice(0, 8).map((node) => `Resolve unknown node ${node.id}:${node.type}`),
        ...dependencies.assets.modelAssets.slice(0, 8).map((asset) => `Place model asset ${asset.value} for ${asset.path}`),
        ...dependencies.assets.mediaAssets.slice(0, 8).map((asset) => `Upload or remap media asset ${asset.value} for ${asset.path}`)
      ]
    },
    {
      title: 'Runtime inputs',
      items: parameters.bindings.slice(0, 10).map((binding) => `${binding.name} -> ${binding.sourcePath}`)
    },
    {
      title: 'Output retrieval',
      items: retrieval.retrievalNodes.length
        ? retrieval.retrievalNodes.map((node) => `${node.id}:${node.type} via ${node.historyPath} (${node.artifactType})`)
        : ['Manual output node selection required.']
    },
    {
      title: 'API verification',
      items: api.checklist
    },
    {
      title: 'Log triage',
      items: logSignals.length ? logSignals.map((signal) => `${signal.label}: ${signal.action}`) : ['No failure log signal was provided.']
    }
  ];

  return scope.map((section) => ({
    title: section.title,
    items: section.items.length ? section.items : ['No immediate item detected from this workflow.']
  }));
}

function buildIntakeBrief({
  analysis,
  dependencies,
  parameters,
  retrieval,
  api,
  logSignals,
  priorityActions,
  options,
  checkoutUrl
}) {
  const lines = [
    'ComfyUI workflow repair brief',
    `Target platform: ${normalizeOption(options.targetPlatform, 'Hosted ComfyUI or RunningHub')}`,
    `Requested deliverable: ${normalizeOption(options.deliverable, 'Working hosted workflow plus retrieval evidence')}`,
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Custom package groups: ${formatPackageNames(dependencies.packages.customPackages) || 'none detected'}`,
    `Unknown custom nodes: ${formatNodeRefs(dependencies.packages.unknownCustomNodes) || 'none detected'}`,
    `Model references: ${dependencies.assets.modelAssets.length}`,
    `Media references: ${dependencies.assets.mediaAssets.length}`,
    `Bindable runtime inputs: ${parameters.bindings.length}`,
    `Preferred retrieval node: ${api.preferredOutputNode ? `${api.preferredOutputNode.nodeId}:${api.preferredOutputNode.nodeType}` : 'manual selection required'}`,
    `Checkout URL: ${checkoutUrl}`,
    'Priority actions:',
    ...priorityActions.map((action) => `- ${action}`),
    'Output retrieval:',
    ...(retrieval.retrievalNodes.length
      ? retrieval.retrievalNodes.map((node) => `- ${node.id}:${node.type} -> ${node.historyPath}; ${node.downloadHint}`)
      : ['- Manual output node selection required.']),
    'Hosted API checklist:',
    ...api.checklist.map((item) => `- ${item}`)
  ];

  if (logSignals.length) {
    lines.push('Failure log signals:', ...logSignals.map((signal) => `- ${signal.label}: ${signal.action}`));
  }

  lines.push('Repair request: make this workflow run on the target host, expose the runtime inputs, pin final output retrieval, and provide prompt_id/history/download evidence.');
  return lines.join('\n');
}

function normalizeOption(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatPackageNames(packages) {
  return packages.map((pkg) => pkg.packageName).join(', ');
}

function formatNodeRefs(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
