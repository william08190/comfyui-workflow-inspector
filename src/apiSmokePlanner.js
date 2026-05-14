import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { mapParameters } from './parameterMapper.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const PREVIEW_HINTS = ['preview', 'temp', 'debug'];

export function buildApiSmokePlanFromJson(raw, options = {}) {
  return buildApiSmokePlan(parseWorkflowJson(raw), options);
}

export function buildApiSmokePlan(workflow, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const analysis = analyzeWorkflow(workflow);
  const parameterMap = mapParameters(workflow);
  const terminalOutputNodes = filterTerminalOutputNodes(analysis.outputNodes);
  const outputNodes = terminalOutputNodes.map(toOutputRef);
  const previewNodes = terminalOutputNodes
    .filter((node) => isPreviewNode(node))
    .map(toOutputRef);
  const preferredOutputNode = choosePreferredOutput(terminalOutputNodes);
  const endpoints = buildEndpoints(baseUrl);
  const curlCommands = buildCurlCommands(baseUrl);
  const checklist = buildChecklist({
    analysis,
    preferredOutputNode,
    endpoints,
    bindableCount: parameterMap.bindings.length
  });
  const risks = buildRisks({
    analysis,
    outputNodes,
    previewNodes,
    preferredOutputNode,
    bindableCount: parameterMap.bindings.length
  });
  const smokeBrief = buildSmokeBrief({
    analysis,
    baseUrl,
    outputNodes,
    previewNodes,
    preferredOutputNode,
    endpoints,
    parameterMap,
    checklist,
    risks
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    baseUrl,
    outputNodes,
    previewNodes,
    preferredOutputNode,
    bindableParameters: parameterMap.bindings,
    endpoints,
    curlCommands,
    checklist,
    risks,
    smokeBrief
  };
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, '');
}

function toOutputRef(node) {
  return {
    nodeId: node.id,
    nodeType: node.type,
    isPreview: PREVIEW_HINTS.some((hint) => node.searchText.includes(hint))
  };
}

function filterTerminalOutputNodes(nodes) {
  return nodes.filter((node) => {
    const type = node.type.toLowerCase();
    if (/^(emptylatentimage|loadimage|loadimagemask|imagescale|imagescaleby|vaeencode|vaedecode)$/.test(type)) {
      return false;
    }
    return /(save|preview|vhs_videocombine|videocombine|video.?combine|animatedwebp|gif|audio|download|export)/i.test(node.type)
      || /(filename|filename_prefix|save_path|output_path)/i.test(node.outputText);
  });
}

function isPreviewNode(node) {
  return PREVIEW_HINTS.some((hint) => node.searchText.includes(hint));
}

function choosePreferredOutput(nodes) {
  const finalNode = nodes.find((node) => !isPreviewNode(node));
  const selected = finalNode ?? nodes[0];
  return selected ? toOutputRef(selected) : null;
}

function buildEndpoints(baseUrl) {
  return [
    {
      label: 'Queue prompt',
      method: 'POST',
      url: `${baseUrl}/prompt`,
      purpose: 'Submit prompt API JSON and capture prompt_id.'
    },
    {
      label: 'Read history',
      method: 'GET',
      url: `${baseUrl}/history/{prompt_id}`,
      purpose: 'Poll or fetch completed outputs for the queued prompt.'
    },
    {
      label: 'Download artifact',
      method: 'GET',
      url: `${baseUrl}/view?filename={filename}&subfolder={subfolder}&type=output`,
      purpose: 'Download the final file returned under the selected output node.'
    },
    {
      label: 'Progress websocket',
      method: 'WS',
      url: websocketUrl(baseUrl),
      purpose: 'Optional progress stream keyed by client_id.'
    }
  ];
}

function websocketUrl(baseUrl) {
  const protocol = baseUrl.startsWith('https://') ? 'wss://' : 'ws://';
  return `${baseUrl.replace(/^https?:\/\//, protocol)}/ws?clientId=smoke-test-client`;
}

function buildCurlCommands(baseUrl) {
  return [
    `COMFYUI_BASE="${baseUrl}"`,
    'CLIENT_ID="smoke-test-client"',
    'curl -s -X POST "$COMFYUI_BASE/prompt" -H "Content-Type: application/json" --data @prompt-request.json',
    'curl -s "$COMFYUI_BASE/history/{prompt_id}"',
    'curl -L -o final-output.bin "$COMFYUI_BASE/view?filename={filename}&subfolder={subfolder}&type=output"'
  ];
}

function buildChecklist({ analysis, preferredOutputNode, endpoints, bindableCount }) {
  const checklist = [
    'Save a prompt API JSON request as prompt-request.json with keys: prompt and client_id.',
    `POST the request to ${endpoints[0].url} and confirm the response includes prompt_id.`,
    `Fetch ${endpoints[1].url} after the prompt completes.`,
    'Read history.outputs and locate the intended output node id.',
    'Download the returned filename through the /view endpoint.',
    'Record response status, prompt_id, selected node id, filename, and downloaded file size.'
  ];

  if (preferredOutputNode) {
    checklist.splice(4, 0, `Prefer output node ${preferredOutputNode.nodeId}:${preferredOutputNode.nodeType} unless the hosted workflow contract says otherwise.`);
  }
  if (analysis.format === 'ComfyUI UI workflow export') {
    checklist.unshift('Export or convert this UI workflow into prompt API JSON before running the smoke test.');
  }
  if (bindableCount) {
    checklist.push(`Before queueing, replace mapped runtime inputs for ${bindableCount} bindable parameter(s).`);
  }

  return checklist;
}

function buildRisks({ analysis, outputNodes, previewNodes, preferredOutputNode, bindableCount }) {
  const risks = [...analysis.risks];

  if (analysis.format === 'ComfyUI UI workflow export') {
    risks.push('The /prompt endpoint needs prompt API JSON, not the UI workflow export shape.');
  }
  if (!outputNodes.length) {
    risks.push('No output node was detected, so the history lookup path must be confirmed manually.');
  }
  if (previewNodes.length) {
    risks.push('Preview or debug outputs are present; do not use them as the final artifact unless intended.');
  }
  if (preferredOutputNode) {
    risks.push(`Hosted retrieval should pin output node ${preferredOutputNode.nodeId} to avoid grabbing the wrong artifact.`);
  }
  if (!bindableCount) {
    risks.push('No bindable runtime parameters were detected; prompt overrides may require manual JSON editing.');
  }

  return Array.from(new Set(risks));
}

function buildSmokeBrief({
  analysis,
  baseUrl,
  outputNodes,
  previewNodes,
  preferredOutputNode,
  endpoints,
  parameterMap,
  checklist,
  risks
}) {
  const lines = [
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Base URL: ${baseUrl}`,
    `Output nodes: ${formatOutputs(outputNodes) || 'none detected'}`,
    `Preview/debug outputs: ${formatOutputs(previewNodes) || 'none detected'}`,
    `Preferred output node: ${preferredOutputNode ? `${preferredOutputNode.nodeId}:${preferredOutputNode.nodeType}` : 'manual selection required'}`,
    `Bindable parameters: ${parameterMap.bindings.length}`,
    'Endpoints:',
    ...endpoints.map((endpoint) => `- ${endpoint.method} ${endpoint.url} - ${endpoint.purpose}`),
    'Checklist:',
    ...checklist.map((item) => `- ${item}`)
  ];

  if (risks.length) {
    lines.push(`Risks: ${risks.join(' ')}`);
  }

  lines.push('Smoke test request: queue the prompt, verify prompt_id, fetch history, pin the final output node, download the artifact, and attach the evidence to the handoff.');
  return lines.join('\n');
}

function formatOutputs(nodes) {
  return nodes.map((node) => `${node.nodeId}:${node.nodeType}`).join(', ');
}
