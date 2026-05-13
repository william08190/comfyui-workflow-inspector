import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const FINAL_OUTPUT_HINTS = [
  'saveimage',
  'save_image',
  'saveaudio',
  'save_audio',
  'vhs_videocombine',
  'videocombine',
  'video combine',
  'animatedwebp',
  'saveanimatedwebp',
  'savevideo'
];

const PREVIEW_HINTS = ['preview', 'temp', 'debug'];

export function buildRetrievalPlanFromJson(raw) {
  return buildRetrievalPlan(parseWorkflowJson(raw));
}

export function buildRetrievalPlan(workflow) {
  const analysis = analyzeWorkflow(workflow);
  const nodes = normalizeNodes(workflow);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const finalOutputs = analysis.outputNodes.filter((node) => isFinalOutput(node));
  const previewOutputs = analysis.previewNodes;
  const preferredOutputs = finalOutputs.length ? finalOutputs : analysis.outputNodes;
  const retrievalNodes = preferredOutputs.map((node) => describeRetrievalNode(node, byId.get(node.id)));
  const risks = buildRisks({ analysis, finalOutputs, preferredOutputs, previewOutputs });
  const apiChecklist = buildApiChecklist({ analysis, retrievalNodes });
  const retrievalBrief = buildRetrievalBrief({
    analysis,
    retrievalNodes,
    previewOutputs,
    risks,
    apiChecklist
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    retrievalNodes,
    previewOutputs: previewOutputs.map((node) => ({ id: node.id, type: node.type })),
    durationFields: analysis.durationFields,
    promptFields: analysis.promptFields,
    risks,
    apiChecklist,
    retrievalBrief
  };
}

function isFinalOutput(node) {
  const text = `${node.type} ${node.searchText}`.toLowerCase();
  if (PREVIEW_HINTS.some((hint) => text.includes(hint))) return false;
  return FINAL_OUTPUT_HINTS.some((hint) => text.includes(hint));
}

function describeRetrievalNode(summaryNode, normalizedNode) {
  const type = summaryNode.type;
  const artifactType = inferArtifactType(type);
  const inputLinks = collectInputLinks(normalizedNode);

  return {
    id: summaryNode.id,
    type,
    artifactType,
    historyPath: `outputs["${summaryNode.id}"]`,
    downloadHint: buildDownloadHint(artifactType),
    inputLinks
  };
}

function collectInputLinks(node) {
  const inputs = node?.raw?.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return [];

  return Object.entries(inputs)
    .filter(([, value]) => Array.isArray(value) && value.length >= 2)
    .map(([key, value]) => ({
      key,
      sourceNodeId: String(value[0]),
      sourceOutputIndex: String(value[1])
    }));
}

function inferArtifactType(type) {
  const lower = String(type).toLowerCase();
  if (lower.includes('audio')) return 'audio';
  if (lower.includes('video') || lower.includes('vhs')) return 'video';
  if (lower.includes('gif') || lower.includes('webp')) return 'animation';
  return 'image';
}

function buildDownloadHint(artifactType) {
  if (artifactType === 'audio') return 'Read audio entries, then download each filename via /view.';
  if (artifactType === 'video') return 'Read video entries, then download each filename via /view.';
  if (artifactType === 'animation') return 'Read gif or webp entries, then download each filename via /view.';
  return 'Read image entries, then download each filename via /view.';
}

function buildApiChecklist({ analysis, retrievalNodes }) {
  const nodeIds = retrievalNodes.map((node) => node.id).join(', ') || 'none detected';
  const checklist = [
    'Submit the prompt API JSON to POST /prompt and save prompt_id.',
    'Wait for execution through websocket updates or by polling GET /history/{prompt_id}.',
    `Read these preferred output node ids from the history response: ${nodeIds}.`,
    'For each artifact object, keep filename, subfolder, and type exactly as returned.',
    'Download files with /view?filename=<filename>&subfolder=<subfolder>&type=<type>.',
    'On RunningHub or another hosted ComfyUI wrapper, map its task result payload back to these node ids before choosing a file.'
  ];

  if (analysis.format === 'ComfyUI UI workflow export') {
    checklist.unshift('Convert the UI workflow export to prompt API JSON before API execution.');
  }

  return checklist;
}

function buildRisks({ analysis, finalOutputs, preferredOutputs, previewOutputs }) {
  const risks = [...analysis.risks];

  if (!preferredOutputs.length) {
    risks.push('No retrieval node id can be recommended until a final save/combine node is added.');
  }
  if (!finalOutputs.length && previewOutputs.length) {
    risks.push('Only preview-like outputs were found; hosted APIs may return temp files instead of final assets.');
  }
  if (preferredOutputs.length > 1) {
    risks.push('Multiple retrievable nodes were found; the caller should pin the exact final node id.');
  }
  if (analysis.format === 'ComfyUI UI workflow export') {
    risks.push('UI exports do not execute directly through the ComfyUI prompt endpoint.');
  }

  return Array.from(new Set(risks));
}

function buildRetrievalBrief({ analysis, retrievalNodes, previewOutputs, risks, apiChecklist }) {
  const lines = [
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Preferred retrieval nodes: ${formatRetrievalNodes(retrievalNodes) || 'none detected'}`,
    `Preview/temp nodes to avoid: ${formatNodes(previewOutputs) || 'none detected'}`,
    `Duration/frame/FPS fields: ${formatMatches(analysis.durationFields) || 'none detected'}`,
    `Prompt fields: ${formatMatches(analysis.promptFields.slice(0, 8)) || 'none detected'}`,
    'Retrieval checklist:',
    ...apiChecklist.map((step, index) => `${index + 1}. ${step}`)
  ];

  if (risks.length) {
    lines.push(`Risks: ${risks.join(' ')}`);
  }

  lines.push('Implementation request: wire task completion to the preferred node ids and download final artifacts only.');
  return lines.join('\n');
}

function formatRetrievalNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}(${node.artifactType})`).join(', ');
}

function formatNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function formatMatches(matches) {
  return matches.map((match) => `${match.nodeId}:${match.key}=${match.value}`).join(', ');
}
