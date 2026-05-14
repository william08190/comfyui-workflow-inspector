import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { buildApiSmokePlan } from './apiSmokePlanner.js';
import { scanDependencies } from './dependencyScanner.js';
import { mapParameters } from './parameterMapper.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const CHECKOUT_BASE = 'https://mv.786668.xyz/service-checkout.html';
const DEFAULT_PACKAGE = 'workflow-setup-starter';

const LOG_SIGNALS = [
  {
    label: 'Missing node package',
    match: /(missing node|cannot import|importerror|module not found|no module named|custom node)/i,
    weight: 10
  },
  {
    label: 'Missing model or media file',
    match: /(file not found|no such file|checkpoint|safetensors|\.ckpt|\.pt|\.pth|\.png|\.mp4|\.wav)/i,
    weight: 8
  },
  {
    label: 'Hosted API failure',
    match: /(\/prompt|\/history|prompt_id|websocket|http 4\d\d|http 5\d\d|timeout|connection refused)/i,
    weight: 8
  },
  {
    label: 'GPU memory failure',
    match: /(cuda|out of memory|oom|vram|mps)/i,
    weight: 8
  }
];

export function buildSetupQuoteFromJson(raw, options = {}) {
  return buildSetupQuote(parseWorkflowJson(raw), options);
}

export function buildSetupQuote(workflow, options = {}) {
  const analysis = analyzeWorkflow(workflow);
  const dependencies = scanDependencies(workflow);
  const parameters = mapParameters(workflow);
  const retrieval = buildRetrievalPlan(workflow);
  const api = buildApiSmokePlan(workflow, { baseUrl: options.baseUrl });
  const logSignals = detectLogSignals(options.failureLog);
  const scoreBreakdown = buildScoreBreakdown({
    analysis,
    dependencies,
    parameters,
    retrieval,
    api,
    logSignals,
    options
  });
  const score = Math.min(100, scoreBreakdown.reduce((sum, item) => sum + item.points, 0));
  const tier = chooseTier(score);
  const checkoutUrl = buildCheckoutUrl(options);
  const scope = buildScope({
    analysis,
    dependencies,
    parameters,
    retrieval,
    api,
    logSignals
  });
  const risks = buildRisks({ dependencies, parameters, retrieval, api, logSignals });
  const quoteBrief = buildQuoteBrief({
    analysis,
    dependencies,
    parameters,
    retrieval,
    api,
    logSignals,
    score,
    tier,
    scope,
    risks,
    options,
    checkoutUrl
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    targetPlatform: normalizeOption(options.targetPlatform, 'Hosted ComfyUI or RunningHub'),
    deliveryGoal: normalizeOption(options.deliveryGoal, 'Working hosted workflow with final output evidence'),
    score,
    tier,
    scoreBreakdown,
    metrics: [
      { label: 'Complexity score', value: `${score}/100` },
      { label: 'Quote tier', value: tier.name },
      { label: 'Node count', value: analysis.nodeCount },
      { label: 'Custom packages', value: dependencies.packages.customPackages.length },
      { label: 'Unknown nodes', value: dependencies.packages.unknownCustomNodes.length },
      { label: 'Model/media refs', value: dependencies.assets.modelAssets.length + dependencies.assets.mediaAssets.length },
      { label: 'Runtime inputs', value: parameters.bindings.length },
      { label: 'Retrieval nodes', value: retrieval.retrievalNodes.length }
    ],
    scope,
    risks,
    logSignals,
    checkoutUrl,
    quoteBrief
  };
}

function detectLogSignals(logText) {
  const text = String(logText || '').trim();
  if (!text) return [];

  return LOG_SIGNALS
    .filter((rule) => rule.match.test(text))
    .map((rule) => ({
      label: rule.label,
      weight: rule.weight
    }));
}

function buildScoreBreakdown({ analysis, dependencies, parameters, retrieval, api, logSignals, options }) {
  const items = [
    { label: 'Workflow size', points: scoreNodeCount(analysis.nodeCount) },
    { label: 'Custom node packages', points: Math.min(24, dependencies.packages.customPackages.length * 8) },
    { label: 'Unknown node classes', points: Math.min(20, dependencies.packages.unknownCustomNodes.length * 5) },
    { label: 'Model and media assets', points: Math.min(18, (dependencies.assets.modelAssets.length + dependencies.assets.mediaAssets.length) * 2) },
    { label: 'Runtime input mapping', points: scoreBindings(parameters.bindings.length) },
    { label: 'Output retrieval uncertainty', points: scoreRetrieval(retrieval) },
    { label: 'API verification risk', points: Math.min(12, api.risks.length * 3) },
    { label: 'Failure log signals', points: Math.min(20, logSignals.reduce((sum, signal) => sum + signal.weight, 0)) }
  ];

  if (analysis.format === 'ComfyUI UI workflow export') {
    items.push({ label: 'UI export conversion', points: 10 });
  }
  if (/rush|urgent|same day|asap/i.test(String(options.urgency || ''))) {
    items.push({ label: 'Rush delivery coordination', points: 8 });
  }

  return items.filter((item) => item.points > 0);
}

function scoreNodeCount(count) {
  if (count > 120) return 30;
  if (count > 80) return 24;
  if (count > 40) return 16;
  if (count > 20) return 8;
  return 4;
}

function scoreBindings(count) {
  if (count > 14) return 14;
  if (count > 8) return 10;
  if (count > 4) return 6;
  if (count > 0) return 3;
  return 8;
}

function scoreRetrieval(retrieval) {
  if (!retrieval.retrievalNodes.length) return 16;
  if (retrieval.retrievalNodes.length > 2) return 10;
  if (retrieval.previewOutputs.length) return 6;
  return 2;
}

function chooseTier(score) {
  if (score <= 25) {
    return {
      name: 'Starter setup',
      effort: '2-4 hours',
      confidence: 'High',
      recommendation: 'Use the setup deposit link and attach the generated scope.'
    };
  }
  if (score <= 55) {
    return {
      name: 'Standard repair',
      effort: '4-8 hours',
      confidence: 'Medium',
      recommendation: 'Start with the setup deposit, then confirm asset access and host details.'
    };
  }
  if (score <= 75) {
    return {
      name: 'Complex migration',
      effort: '1-2 days',
      confidence: 'Medium',
      recommendation: 'Start with a paid triage deposit before committing to a fixed delivery scope.'
    };
  }
  return {
    name: 'Custom rebuild',
    effort: 'Custom assessment',
    confidence: 'Low until dependencies are verified',
    recommendation: 'Use paid triage first; final pricing depends on missing nodes, models, and host limits.'
  };
}

function buildScope({ analysis, dependencies, parameters, retrieval, api, logSignals }) {
  const setupItems = [
    ...dependencies.packages.customPackages.map((pkg) => `Install ${pkg.packageName}`),
    ...dependencies.packages.unknownCustomNodes.slice(0, 8).map((node) => `Identify custom node ${node.id}:${node.type}`),
    ...dependencies.assets.modelAssets.slice(0, 8).map((asset) => `Place model ${asset.value}`),
    ...dependencies.assets.mediaAssets.slice(0, 8).map((asset) => `Upload or remap media ${asset.value}`)
  ];
  if (analysis.format === 'ComfyUI UI workflow export') {
    setupItems.unshift('Convert UI workflow export to prompt API JSON');
  }

  const runtimeItems = parameters.bindings.length
    ? parameters.bindings.slice(0, 12).map((binding) => `${binding.name} -> ${binding.sourcePath}`)
    : ['Manually inspect runtime fields because no scalar bindings were detected.'];

  const outputItems = retrieval.retrievalNodes.length
    ? retrieval.retrievalNodes.map((node) => `Pin ${node.id}:${node.type} and download via ${node.historyPath}`)
    : ['Add or identify a final Save/VideoCombine output node.'];

  return [
    {
      title: 'Host setup scope',
      items: setupItems.length ? setupItems : ['No custom host setup item detected from node names.']
    },
    {
      title: 'Runtime API scope',
      items: runtimeItems
    },
    {
      title: 'Final output scope',
      items: outputItems
    },
    {
      title: 'Acceptance evidence',
      items: [
        ...api.checklist.slice(0, 6),
        'Deliver prompt_id, selected node id, history payload snippet, download URL, and artifact size.'
      ]
    },
    {
      title: 'Failure log triage',
      items: logSignals.length ? logSignals.map((signal) => signal.label) : ['No failure log signal was provided.']
    }
  ];
}

function buildRisks({ dependencies, parameters, retrieval, api, logSignals }) {
  return unique([
    ...dependencies.risks,
    ...parameters.risks,
    ...retrieval.risks,
    ...api.risks,
    ...logSignals.map((signal) => `${signal.label} mentioned in failure log.`)
  ]);
}

function buildQuoteBrief({
  analysis,
  dependencies,
  parameters,
  retrieval,
  api,
  logSignals,
  score,
  tier,
  scope,
  risks,
  options,
  checkoutUrl
}) {
  const lines = [
    'ComfyUI hosted workflow setup quote',
    `Target platform: ${normalizeOption(options.targetPlatform, 'Hosted ComfyUI or RunningHub')}`,
    `Delivery goal: ${normalizeOption(options.deliveryGoal, 'Working hosted workflow with final output evidence')}`,
    `Urgency: ${normalizeOption(options.urgency, 'Standard')}`,
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Complexity score: ${score}/100`,
    `Recommended tier: ${tier.name}`,
    `Estimated effort: ${tier.effort}`,
    `Confidence: ${tier.confidence}`,
    `Recommendation: ${tier.recommendation}`,
    `Checkout URL: ${checkoutUrl}`,
    `Custom packages: ${formatPackages(dependencies.packages.customPackages) || 'none detected'}`,
    `Unknown nodes: ${formatNodeRefs(dependencies.packages.unknownCustomNodes) || 'none detected'}`,
    `Model refs: ${dependencies.assets.modelAssets.length}`,
    `Media refs: ${dependencies.assets.mediaAssets.length}`,
    `Runtime inputs: ${parameters.bindings.length}`,
    `Preferred output node: ${api.preferredOutputNode ? `${api.preferredOutputNode.nodeId}:${api.preferredOutputNode.nodeType}` : 'manual selection required'}`,
    'Scope:',
    ...scope.flatMap((section) => [`- ${section.title}`, ...section.items.map((item) => `  - ${item}`)])
  ];

  if (logSignals.length) {
    lines.push('Failure log signals:', ...logSignals.map((signal) => `- ${signal.label}`));
  }
  if (risks.length) {
    lines.push('Risks:', ...risks.slice(0, 10).map((risk) => `- ${risk}`));
  }

  lines.push(
    'Quote request: verify host dependencies, expose runtime inputs, pin the final output node, and provide API smoke-test evidence before final delivery.'
  );
  return lines.join('\n');
}

function buildCheckoutUrl(options) {
  const params = new URLSearchParams({
    package: normalizeOption(options.packageCode, DEFAULT_PACKAGE),
    source: 'github-quote'
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

function normalizeOption(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatPackages(packages) {
  return packages.map((pkg) => pkg.packageName).join(', ');
}

function formatNodeRefs(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
