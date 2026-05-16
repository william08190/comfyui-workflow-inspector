import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { buildApiSmokePlan } from './apiSmokePlanner.js';
import { scanDependencies } from './dependencyScanner.js';
import { mapParameters } from './parameterMapper.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

const PLATFORM_PROFILES = {
  comfyui: {
    id: 'comfyui',
    label: 'Self-hosted ComfyUI',
    runCommand: 'POST /prompt directly on the ComfyUI server.',
    resultIdName: 'prompt_id',
    retrievalNote: 'Use /history/{prompt_id} and /view with filename, subfolder, and type from the history response.'
  },
  runninghub: {
    id: 'runninghub',
    label: 'RunningHub or hosted workflow wrapper',
    runCommand: 'Queue through the hosted task API and save the returned task id or prompt id.',
    resultIdName: 'task_id or prompt_id',
    retrievalNote: 'Map hosted task results back to the ComfyUI node ids before choosing the final artifact.'
  },
  runpod: {
    id: 'runpod',
    label: 'RunPod ComfyUI endpoint',
    runCommand: 'Send prompt API JSON to the endpoint wrapper, then capture the ComfyUI prompt_id from logs or response data.',
    resultIdName: 'endpoint run id and prompt_id',
    retrievalNote: 'Expose /history and /view or persist final files to a durable output volume.'
  },
  cloud: {
    id: 'cloud',
    label: 'Generic hosted ComfyUI API',
    runCommand: 'Submit the prepared prompt payload through the provider queue endpoint.',
    resultIdName: 'provider task id and prompt_id',
    retrievalNote: 'Document the provider result payload and the underlying ComfyUI output node path.'
  }
};

export function buildDeploymentHandoffFromJson(raw, options = {}) {
  return buildDeploymentHandoff(parseWorkflowJson(raw), options);
}

export function buildDeploymentHandoff(workflow, options = {}) {
  const platform = normalizePlatform(options.platform);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const analysis = analyzeWorkflow(workflow);
  const dependencies = scanDependencies(workflow);
  const parameters = mapParameters(workflow);
  const retrieval = buildRetrievalPlan(workflow);
  const smoke = buildApiSmokePlan(workflow, { baseUrl });
  const setupItems = buildSetupItems({ platform, dependencies, analysis });
  const runtimeInputs = buildRuntimeInputs(parameters);
  const outputContract = buildOutputContract({ platform, retrieval, smoke });
  const evidenceChecklist = buildEvidenceChecklist({ platform, smoke, retrieval });
  const clientFiles = buildClientFiles({ analysis, dependencies, parameters });
  const risks = buildRisks({ analysis, dependencies, parameters, retrieval, smoke });
  const checkoutUrl = buildCheckoutUrl(platform);
  const handoffBrief = buildHandoffBrief({
    analysis,
    platform,
    baseUrl,
    dependencies,
    parameters,
    retrieval,
    smoke,
    setupItems,
    runtimeInputs,
    outputContract,
    evidenceChecklist,
    clientFiles,
    risks,
    checkoutUrl
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    platform,
    baseUrl,
    customPackageCount: dependencies.packages.customPackages.length,
    unknownCustomNodeCount: dependencies.packages.unknownCustomNodes.length,
    modelAssetCount: dependencies.assets.modelAssets.length,
    mediaAssetCount: dependencies.assets.mediaAssets.length,
    runtimeInputCount: runtimeInputs.length,
    outputNodeCount: outputContract.preferredNodes.length,
    setupItems,
    runtimeInputs,
    outputContract,
    evidenceChecklist,
    clientFiles,
    risks,
    checkoutUrl,
    handoffBrief
  };
}

function normalizePlatform(platform) {
  const key = String(platform || 'runninghub').trim().toLowerCase();
  return PLATFORM_PROFILES[key] || PLATFORM_PROFILES.runninghub;
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, '');
}

function buildSetupItems({ platform, dependencies, analysis }) {
  const items = [
    `Target platform: ${platform.label}.`,
    platform.runCommand,
    'Keep the original workflow JSON, prompt API JSON, and any edited hosted variant under versioned filenames.'
  ];

  if (analysis.format === 'ComfyUI UI workflow export') {
    items.push('Convert the UI workflow export into prompt API JSON before queueing it through /prompt.');
  }

  dependencies.packages.customPackages.forEach((pkg) => {
    items.push(`${pkg.packageName}: ${pkg.installHint}`);
  });

  if (dependencies.packages.unknownCustomNodes.length) {
    items.push(`Resolve ${dependencies.packages.unknownCustomNodes.length} unknown custom node class(es) with ComfyUI Manager or the source workflow author.`);
  }

  dependencies.assets.modelAssets.slice(0, 8).forEach((asset) => {
    items.push(`Place model asset ${asset.value} for node ${asset.nodeId}:${asset.nodeType}.`);
  });

  dependencies.assets.mediaAssets.slice(0, 6).forEach((asset) => {
    items.push(`Provide media input ${asset.value} for node ${asset.nodeId}:${asset.nodeType}.`);
  });

  if (!dependencies.packages.customPackages.length && !dependencies.packages.unknownCustomNodes.length) {
    items.push('No custom node packages were detected by the static scan.');
  }

  return dedupe(items);
}

function buildRuntimeInputs(parameters) {
  return parameters.bindings.slice(0, 16).map((binding) => ({
    name: binding.name,
    category: binding.category,
    sourcePath: binding.sourcePath,
    currentValue: binding.value,
    valueKind: binding.valueKind,
    nodeRef: `${binding.nodeId}:${binding.nodeType}`
  }));
}

function buildOutputContract({ platform, retrieval, smoke }) {
  const preferredNodes = retrieval.retrievalNodes.map((node) => ({
    nodeId: node.id,
    nodeType: node.type,
    artifactType: node.artifactType,
    historyPath: node.historyPath,
    downloadHint: node.downloadHint
  }));

  const previewNodes = retrieval.previewOutputs.map((node) => `${node.id}:${node.type}`);
  const fallbackNode = smoke.preferredOutputNode
    ? `${smoke.preferredOutputNode.nodeId}:${smoke.preferredOutputNode.nodeType}`
    : 'manual selection required';

  return {
    resultIdName: platform.resultIdName,
    retrievalNote: platform.retrievalNote,
    preferredNodes,
    previewNodes,
    fallbackNode,
    downloadPattern: `${smoke.baseUrl}/view?filename={filename}&subfolder={subfolder}&type=output`
  };
}

function buildEvidenceChecklist({ platform, smoke, retrieval }) {
  const preferred = retrieval.retrievalNodes.map((node) => `${node.id}:${node.type}`).join(', ') || 'manual output node';
  return dedupe([
    `Save the provider ${platform.resultIdName} returned by the queue call.`,
    'Save the exact prompt request payload used for the acceptance run.',
    `Confirm the selected output node is ${preferred}.`,
    'Attach the completed /history response or the provider result payload.',
    'Record filename, subfolder, type, file size, and MIME type for the downloaded final artifact.',
    'Record one negative check: preview/temp/debug nodes were not used as the final delivery artifact.',
    ...smoke.checklist.slice(0, 4)
  ]);
}

function buildClientFiles({ analysis, dependencies, parameters }) {
  const files = [
    'workflow-original.json',
    'prompt-request.json',
    'hosted-workflow-notes.md',
    'acceptance-history-response.json',
    'final-output-evidence.txt'
  ];

  if (analysis.format === 'ComfyUI UI workflow export') files.push('workflow-converted-prompt-api.json');
  if (dependencies.packages.customPackages.length || dependencies.packages.unknownCustomNodes.length) {
    files.push('custom-node-install-list.md');
  }
  if (dependencies.assets.modelAssets.length) files.push('model-asset-manifest.md');
  if (dependencies.assets.mediaAssets.length) files.push('sample-input-media/');
  if (parameters.bindings.length) files.push('runtime-parameter-map.md');

  return files;
}

function buildRisks({ analysis, dependencies, parameters, retrieval, smoke }) {
  const risks = [
    ...analysis.risks,
    ...dependencies.risks,
    ...parameters.risks,
    ...retrieval.risks,
    ...smoke.risks
  ];

  if (!retrieval.retrievalNodes.length) {
    risks.push('No preferred final artifact node was found, so the output contract must be completed manually.');
  }
  if (parameters.bindings.length > 16) {
    risks.push('More than 16 bindable fields were detected; only the most important runtime inputs should be exposed in the hosted API.');
  }
  if (dependencies.assets.modelAssets.length > 8) {
    risks.push('The model manifest is long; verify exact filenames and folder placement before collecting payment.');
  }

  return dedupe(risks);
}

function buildCheckoutUrl(platform) {
  return `https://mv.786668.xyz/service-checkout.html?package=workflow-setup-starter&source=github-handoff-${platform.id}`;
}

function buildHandoffBrief({
  analysis,
  platform,
  baseUrl,
  dependencies,
  parameters,
  retrieval,
  setupItems,
  runtimeInputs,
  outputContract,
  evidenceChecklist,
  clientFiles,
  risks,
  checkoutUrl
}) {
  const lines = [
    `Workflow deployment handoff`,
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Target platform: ${platform.label}`,
    `Base URL: ${baseUrl}`,
    `Custom package groups: ${dependencies.packages.customPackages.length}`,
    `Unknown custom nodes: ${dependencies.packages.unknownCustomNodes.length}`,
    `Model assets: ${dependencies.assets.modelAssets.length}`,
    `Media assets: ${dependencies.assets.mediaAssets.length}`,
    `Runtime inputs: ${parameters.bindings.length}`,
    `Preferred output nodes: ${formatRetrievalNodes(retrieval.retrievalNodes) || outputContract.fallbackNode}`,
    '',
    'Host setup:',
    ...setupItems.map((item) => `- ${item}`),
    '',
    'Runtime inputs:',
    ...(runtimeInputs.length ? runtimeInputs.map((input) => `- ${input.name} -> ${input.sourcePath} (${input.valueKind}, current ${input.currentValue})`) : ['- No directly bindable scalar inputs detected.']),
    '',
    'Output contract:',
    `- Result id: ${outputContract.resultIdName}`,
    `- Retrieval: ${outputContract.retrievalNote}`,
    `- Download pattern: ${outputContract.downloadPattern}`,
    `- Preview/temp nodes to avoid: ${outputContract.previewNodes.join(', ') || 'none detected'}`,
    '',
    'Acceptance evidence:',
    ...evidenceChecklist.map((item) => `- ${item}`),
    '',
    'Client handoff files:',
    ...clientFiles.map((file) => `- ${file}`)
  ];

  if (risks.length) {
    lines.push('', `Risks: ${risks.join(' ')}`);
  }

  lines.push('', `Setup deposit: ${checkoutUrl}`);
  return lines.join('\n');
}

function formatRetrievalNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}(${node.artifactType})`).join(', ');
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
