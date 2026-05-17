import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { buildApiSmokePlan } from './apiSmokePlanner.js';
import { buildAssetManifest } from './assetManifest.js';
import { scanDependencies } from './dependencyScanner.js';
import { extractHistoryArtifacts } from './historyResult.js';
import { mapParameters } from './parameterMapper.js';
import { buildSetupQuote } from './quoteEstimator.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const CHECKOUT_BASE = 'https://mv.786668.xyz/service-checkout.html';
const DEFAULT_PACKAGE = 'workflow-setup-starter';

const LOG_SIGNALS = [
  {
    label: 'Missing custom node package',
    match: /(missing node|cannot import|importerror|module not found|no module named|custom node)/i,
    question: 'Which custom node repository or ComfyUI Manager install source should be used?'
  },
  {
    label: 'Missing model or media file',
    match: /(file not found|no such file|checkpoint|safetensors|\.ckpt|\.pt|\.pth|\.png|\.mp4|\.wav)/i,
    question: 'Can every model, LoRA, VAE, IP-Adapter, and input media file be attached or uploaded?'
  },
  {
    label: 'Hosted API or queue failure',
    match: /(\/prompt|\/history|prompt_id|websocket|http 4\d\d|http 5\d\d|timeout|connection refused)/i,
    question: 'What exact queue response, prompt_id, task id, and history payload did the host return?'
  },
  {
    label: 'GPU or runtime failure',
    match: /(cuda|out of memory|oom|vram|mps|torch|dtype|shape|ffmpeg)/i,
    question: 'What GPU tier, host image, CUDA or torch version, and video/audio node versions are in use?'
  }
];

export function buildSupportIntakePacketFromJson(raw, options = {}) {
  return buildSupportIntakePacket(parseWorkflowJson(raw), options);
}

export function buildSupportIntakePacket(workflow, options = {}) {
  const targetPlatform = normalizeOption(options.targetPlatform, 'RunningHub or hosted ComfyUI');
  const deliveryGoal = normalizeOption(options.deliveryGoal, 'Working hosted workflow with final output evidence');
  const issueSummary = normalizeOption(options.issueSummary, 'No issue summary provided');
  const baseUrl = normalizeOption(options.baseUrl, 'http://127.0.0.1:8188');
  const checkoutUrl = buildCheckoutUrl(options);

  const analysis = analyzeWorkflow(workflow);
  const dependencies = scanDependencies(workflow);
  const parameters = mapParameters(workflow);
  const retrieval = buildRetrievalPlan(workflow);
  const smoke = buildApiSmokePlan(workflow, { baseUrl });
  const assets = buildAssetManifest(workflow, { checkoutUrl });
  const quote = buildSetupQuote(workflow, {
    failureLog: options.failureLog,
    targetPlatform,
    deliveryGoal,
    urgency: options.urgency,
    packageCode: options.packageCode
  });
  const logSignals = detectLogSignals(options.failureLog);
  const historyEvidence = buildHistoryEvidence(options.historyJson, workflow, baseUrl);
  const attachments = buildAttachments({
    analysis,
    dependencies,
    parameters,
    assets,
    historyEvidence,
    failureLog: options.failureLog,
    issueSummary,
    targetPlatform,
    deliveryGoal
  });
  const questions = buildQuestions({
    analysis,
    dependencies,
    parameters,
    retrieval,
    logSignals,
    historyEvidence,
    targetPlatform,
    deliveryGoal
  });
  const blockers = buildBlockers({
    analysis,
    dependencies,
    retrieval,
    historyEvidence,
    logSignals,
    failureLog: options.failureLog
  });
  const evidenceChecklist = buildEvidenceChecklist({
    retrieval,
    smoke,
    assets,
    historyEvidence
  });
  const readiness = scoreReadiness({
    analysis,
    dependencies,
    parameters,
    retrieval,
    assets,
    historyEvidence,
    logSignals,
    failureLog: options.failureLog,
    targetPlatform,
    deliveryGoal
  });
  const packetBrief = buildPacketBrief({
    analysis,
    dependencies,
    parameters,
    retrieval,
    assets,
    quote,
    logSignals,
    historyEvidence,
    attachments,
    questions,
    blockers,
    evidenceChecklist,
    readiness,
    targetPlatform,
    deliveryGoal,
    issueSummary,
    checkoutUrl
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    targetPlatform,
    deliveryGoal,
    issueSummary,
    checkoutUrl,
    readiness,
    setupTier: quote.tier,
    quoteScore: quote.score,
    metrics: [
      { label: 'Readiness', value: readiness.status },
      { label: 'Packet score', value: `${readiness.score}/100` },
      { label: 'Setup tier', value: quote.tier.name },
      { label: 'Workflow nodes', value: analysis.nodeCount },
      { label: 'Required attachments', value: attachments.length },
      { label: 'Missing items', value: attachments.filter((item) => item.status === 'missing').length },
      { label: 'Runtime inputs', value: parameters.bindings.length },
      { label: 'Final artifacts', value: historyEvidence.finalArtifactCount }
    ],
    attachments,
    questions,
    blockers,
    evidenceChecklist,
    logSignals,
    historyEvidence,
    packetBrief
  };
}

function detectLogSignals(logText) {
  const text = String(logText || '').trim();
  if (!text) return [];
  return LOG_SIGNALS
    .filter((rule) => rule.match.test(text))
    .map((rule) => ({
      label: rule.label,
      question: rule.question
    }));
}

function buildHistoryEvidence(rawHistory, workflow, baseUrl) {
  const raw = String(rawHistory || '').trim();
  if (!raw) {
    return {
      provided: false,
      promptIds: [],
      artifactCount: 0,
      finalArtifactCount: 0,
      tempArtifactCount: 0,
      risks: ['No /history or hosted task result was provided yet.'],
      downloadCommands: [],
      error: ''
    };
  }

  try {
    const history = JSON.parse(raw);
    const evidence = extractHistoryArtifacts(history, { workflow, baseUrl });
    return {
      provided: true,
      promptIds: evidence.promptIds,
      artifactCount: evidence.artifactCount,
      finalArtifactCount: evidence.finalArtifactCount,
      tempArtifactCount: evidence.tempArtifactCount,
      risks: evidence.risks,
      downloadCommands: evidence.downloadCommands,
      error: '',
      evidenceBrief: evidence.evidenceBrief
    };
  } catch (error) {
    return {
      provided: true,
      promptIds: [],
      artifactCount: 0,
      finalArtifactCount: 0,
      tempArtifactCount: 0,
      risks: ['History/result evidence could not be parsed.'],
      downloadCommands: [],
      error: error.message
    };
  }
}

function buildAttachments({
  analysis,
  dependencies,
  parameters,
  assets,
  historyEvidence,
  failureLog,
  issueSummary,
  targetPlatform,
  deliveryGoal
}) {
  const items = [
    attachment('workflow-original.json', 'included', `${analysis.format}, ${analysis.nodeCount} node(s).`),
    attachment('support-intake-summary.md', 'included', `${targetPlatform}; ${deliveryGoal}; ${issueSummary}`),
    attachment('setup-deposit-url.txt', 'included', 'Payment path is generated with source=github-intake.')
  ];

  if (String(failureLog || '').trim()) {
    items.push(attachment('failure-log.txt', 'included', 'Latest failure log or hosted API error is included.'));
  } else {
    items.push(attachment('failure-log.txt', 'missing', 'Attach the latest ComfyUI, RunningHub, or hosted API error log if this is a repair request.'));
  }

  if (dependencies.packages.customPackages.length || dependencies.packages.unknownCustomNodes.length) {
    items.push(attachment('custom-node-install-list.md', 'needed', `${dependencies.packages.customPackages.length} package group(s), ${dependencies.packages.unknownCustomNodes.length} unknown node(s).`));
  }

  if (assets.modelCount) {
    items.push(attachment('model-asset-manifest.md', 'needed', `${assets.modelCount} model/checkpoint asset(s) to collect.`));
  }

  if (assets.mediaCount) {
    items.push(attachment('sample-input-media/', 'needed', `${assets.mediaCount} image, video, or audio input(s) to upload.`));
  }

  if (parameters.bindings.length) {
    items.push(attachment('runtime-parameter-map.md', 'included', `${parameters.bindings.length} prompt, seed, size, timing, media, or model field(s).`));
  }

  if (historyEvidence.provided && !historyEvidence.error) {
    items.push(attachment('history-response.json', 'included', `${historyEvidence.artifactCount} artifact(s), ${historyEvidence.finalArtifactCount} final candidate(s).`));
  } else {
    items.push(attachment('history-response.json', 'missing', 'Attach /history/{prompt_id} or hosted task result after one acceptance run.'));
  }

  if (historyEvidence.finalArtifactCount) {
    items.push(attachment('final-output-evidence.txt', 'included', 'Final artifact evidence can be generated from the provided history/result JSON.'));
  } else {
    items.push(attachment('final-output-evidence.txt', 'missing', 'Need selected output node id, filename, download URL, and artifact size.'));
  }

  return items;
}

function buildQuestions({
  analysis,
  dependencies,
  parameters,
  retrieval,
  logSignals,
  historyEvidence,
  targetPlatform,
  deliveryGoal
}) {
  const questions = [
    `Confirm target platform and account context: ${targetPlatform}.`,
    `Confirm accepted deliverable: ${deliveryGoal}.`
  ];

  if (analysis.format === 'ComfyUI UI workflow export') {
    questions.push('Can a prompt API JSON export be provided, or should conversion be part of the paid scope?');
  }

  if (retrieval.retrievalNodes.length) {
    questions.push(`Should final delivery use ${formatRetrievalNodes(retrieval.retrievalNodes)} as the output contract?`);
  } else {
    questions.push('Which node should be treated as the final downloadable output?');
  }

  if (parameters.bindings.length) {
    questions.push(`Which of the ${parameters.bindings.length} detected runtime input(s) should be exposed to the hosted API?`);
  } else {
    questions.push('Which prompt, seed, size, duration, or media inputs must be editable at runtime?');
  }

  if (dependencies.assets.modelAssets.length) {
    questions.push('Can the exact model/checkpoint files be uploaded to the target host with their licenses or source links?');
  }

  if (dependencies.assets.mediaAssets.length) {
    questions.push('Can sample input media be shared for the first acceptance run?');
  }

  if (!historyEvidence.provided || historyEvidence.error) {
    questions.push('Can one failed or successful hosted task result be attached, including prompt_id or task id?');
  }

  logSignals.forEach((signal) => questions.push(signal.question));

  return dedupe(questions);
}

function buildBlockers({ analysis, dependencies, retrieval, historyEvidence, logSignals, failureLog }) {
  const blockers = [
    ...analysis.risks,
    ...dependencies.risks,
    ...retrieval.risks
  ];

  if (analysis.format === 'ComfyUI UI workflow export') {
    blockers.push('UI workflow exports still need prompt API JSON conversion before hosted queue tests.');
  }
  if (!String(failureLog || '').trim()) {
    blockers.push('No failure log was provided; repair triage may need one reproduction run first.');
  }
  if (!historyEvidence.provided) {
    blockers.push('No /history or hosted task result was provided; final output evidence remains unverified.');
  } else if (historyEvidence.error) {
    blockers.push(`History/result JSON parse error: ${historyEvidence.error}`);
  } else if (!historyEvidence.finalArtifactCount) {
    blockers.push('History/result JSON did not expose a clear final downloadable artifact.');
  }
  logSignals.forEach((signal) => blockers.push(`${signal.label} must be resolved or scoped before delivery.`));

  return dedupe(blockers);
}

function buildEvidenceChecklist({ retrieval, smoke, assets, historyEvidence }) {
  const outputNode = retrieval.retrievalNodes[0]
    ? `${retrieval.retrievalNodes[0].id}:${retrieval.retrievalNodes[0].type}`
    : 'manual final output node';

  return dedupe([
    'Attach the exact workflow JSON and any hosted-edited variant.',
    `Confirm final output node: ${outputNode}.`,
    'Run one /prompt or hosted queue request and save the prompt_id or task id.',
    'Save the completed /history response or hosted task result payload.',
    'Record final filename, subfolder/type, download URL, file size, and MIME type.',
    'State which preview/temp/debug artifacts were excluded from delivery.',
    ...assets.verificationChecklist.slice(0, 4),
    ...smoke.checklist.slice(0, 4),
    ...(historyEvidence.downloadCommands.length ? historyEvidence.downloadCommands.slice(0, 2) : [])
  ]);
}

function scoreReadiness({
  analysis,
  dependencies,
  parameters,
  retrieval,
  assets,
  historyEvidence,
  logSignals,
  failureLog,
  targetPlatform,
  deliveryGoal
}) {
  let score = 20;
  const drivers = ['Workflow JSON parsed'];

  if (targetPlatform) {
    score += 8;
    drivers.push('Target platform stated');
  }
  if (deliveryGoal) {
    score += 8;
    drivers.push('Delivery goal stated');
  }
  if (retrieval.retrievalNodes.length) {
    score += 14;
    drivers.push('Final output node candidate found');
  }
  if (parameters.bindings.length) {
    score += 10;
    drivers.push('Runtime inputs detected');
  }
  if (assets.itemCount) {
    score += 8;
    drivers.push('Asset manifest can be generated');
  } else {
    score += 4;
    drivers.push('No static asset references detected');
  }
  if (String(failureLog || '').trim()) {
    score += 10;
    drivers.push('Failure log included');
  }
  if (historyEvidence.finalArtifactCount) {
    score += 16;
    drivers.push('Final artifact evidence included');
  } else if (historyEvidence.provided && !historyEvidence.error) {
    score += 6;
    drivers.push('History/result payload included');
  }
  if (!dependencies.packages.unknownCustomNodes.length) {
    score += 6;
    drivers.push('No unknown custom node classes detected');
  }

  score -= Math.min(20, logSignals.length * 4);
  if (analysis.format === 'ComfyUI UI workflow export') score -= 8;
  if (!retrieval.retrievalNodes.length) score -= 12;
  if (historyEvidence.error) score -= 12;

  const normalized = Math.max(0, Math.min(100, score));
  let status = 'Needs triage details';
  if (normalized >= 82) status = 'Ready for paid setup packet';
  else if (normalized >= 62) status = 'Ready for triage deposit';
  else if (normalized >= 45) status = 'Collect missing evidence';

  return {
    score: normalized,
    status,
    drivers
  };
}

function buildPacketBrief({
  analysis,
  dependencies,
  parameters,
  retrieval,
  assets,
  quote,
  logSignals,
  historyEvidence,
  attachments,
  questions,
  blockers,
  evidenceChecklist,
  readiness,
  targetPlatform,
  deliveryGoal,
  issueSummary,
  checkoutUrl
}) {
  const lines = [
    'ComfyUI workflow support intake packet',
    `Readiness: ${readiness.status} (${readiness.score}/100)`,
    `Target platform: ${targetPlatform}`,
    `Delivery goal: ${deliveryGoal}`,
    `Issue summary: ${issueSummary}`,
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Recommended setup tier: ${quote.tier.name}`,
    `Quote complexity score: ${quote.score}/100`,
    `Custom packages: ${dependencies.packages.customPackages.length}`,
    `Unknown custom nodes: ${dependencies.packages.unknownCustomNodes.length}`,
    `Model assets: ${assets.modelCount}`,
    `Media assets: ${assets.mediaCount}`,
    `Runtime inputs: ${parameters.bindings.length}`,
    `Preferred output nodes: ${formatRetrievalNodes(retrieval.retrievalNodes) || 'manual selection required'}`,
    `History prompt ids: ${historyEvidence.promptIds.join(', ') || 'not provided'}`,
    `Final artifacts: ${historyEvidence.finalArtifactCount}`,
    `Checkout URL: ${checkoutUrl}`,
    '',
    'Attachments:',
    ...attachments.map((item) => `- [${item.status}] ${item.name}: ${item.note}`),
    '',
    'Open questions:',
    ...questions.map((question) => `- ${question}`),
    '',
    'Acceptance evidence checklist:',
    ...evidenceChecklist.map((item) => `- ${item}`)
  ];

  if (logSignals.length) {
    lines.push('', 'Failure log signals:', ...logSignals.map((signal) => `- ${signal.label}`));
  }
  if (blockers.length) {
    lines.push('', 'Blockers:', ...blockers.slice(0, 12).map((blocker) => `- ${blocker}`));
  }

  lines.push('', 'Request: use this packet to quote, repair, host, and verify the workflow before final delivery.');
  return lines.join('\n');
}

function attachment(name, status, note) {
  return { name, status, note };
}

function buildCheckoutUrl(options) {
  const params = new URLSearchParams({
    package: normalizeOption(options.packageCode, DEFAULT_PACKAGE),
    source: 'github-intake'
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

function normalizeOption(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatRetrievalNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
