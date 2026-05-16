import { normalizeNodes, parseWorkflowJson } from './analyzer.js';
import { buildRetrievalPlan } from './retrievalPlanner.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const HISTORY_WRAPPER_KEYS = ['history', 'data', 'result', 'response', 'payload'];
const PREVIEW_HINTS = ['preview', 'temp', 'debug'];

export function extractHistoryArtifactsFromJson(rawHistory, options = {}) {
  const history = parseJson(rawHistory, 'Paste a ComfyUI /history response JSON document first.');
  const workflow = parseOptionalWorkflow(options.workflowJson, options.workflow);
  return extractHistoryArtifacts(history, { ...options, workflow });
}

export function extractHistoryArtifacts(history, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const entries = collectHistoryEntries(history);
  const workflowContext = buildWorkflowContext(options.workflow);
  const artifacts = collectArtifacts(entries, { baseUrl, workflowContext });
  const nodeSummaries = summarizeNodes(artifacts, workflowContext);
  const statuses = entries.map(describeStatus);
  const risks = buildRisks({ entries, artifacts, nodeSummaries, statuses, workflowContext });
  const downloadCommands = artifacts.map((artifact) => buildCurlCommand(artifact));
  const evidenceBrief = buildEvidenceBrief({
    entries,
    artifacts,
    nodeSummaries,
    statuses,
    risks,
    workflowContext
  });

  return {
    promptIds: entries.map((entry) => entry.promptId),
    historyCount: entries.length,
    completedCount: statuses.filter((status) => status.completed).length,
    artifactCount: artifacts.length,
    finalArtifactCount: artifacts.filter((artifact) => artifact.isPreferredFinal || artifact.type === 'output').length,
    tempArtifactCount: artifacts.filter((artifact) => artifact.isPreview || artifact.type === 'temp').length,
    artifacts,
    nodeSummaries,
    statuses,
    risks,
    downloadCommands,
    evidenceBrief
  };
}

function parseJson(raw, emptyMessage) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(emptyMessage);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

function parseOptionalWorkflow(rawWorkflow, workflow) {
  if (workflow && typeof workflow === 'object') return workflow;
  if (typeof rawWorkflow !== 'string' || rawWorkflow.trim() === '') return null;
  return parseWorkflowJson(rawWorkflow);
}

function collectHistoryEntries(history) {
  const entries = [];
  const seen = new Set();

  function visit(value, promptId, depth) {
    if (depth > 5 || !value) return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, promptId || `item-${index + 1}`, depth + 1));
      return;
    }

    if (!isPlainObject(value)) return;

    if (isPlainObject(value.outputs)) {
      const resolvedPromptId = String(value.prompt_id ?? value.promptId ?? promptId ?? `history-${entries.length + 1}`);
      const dedupeKey = `${resolvedPromptId}:${Object.keys(value.outputs).join(',')}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        entries.push({ promptId: resolvedPromptId, entry: value });
      }
      return;
    }

    for (const key of HISTORY_WRAPPER_KEYS) {
      if (key in value) {
        visit(value[key], promptId, depth + 1);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (HISTORY_WRAPPER_KEYS.includes(key)) continue;
      if (isPlainObject(child) && isPlainObject(child.outputs)) {
        visit(child, key, depth + 1);
      }
    }
  }

  visit(history, '', 0);
  return entries;
}

function buildWorkflowContext(workflow) {
  if (!workflow) {
    return {
      provided: false,
      nodesById: new Map(),
      preferredIds: [],
      preferredNodes: []
    };
  }

  const nodes = normalizeNodes(workflow);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let retrievalNodes = [];
  try {
    retrievalNodes = buildRetrievalPlan(workflow).retrievalNodes;
  } catch {
    retrievalNodes = [];
  }

  return {
    provided: true,
    nodesById,
    preferredIds: retrievalNodes.map((node) => node.id),
    preferredNodes: retrievalNodes
  };
}

function collectArtifacts(entries, { baseUrl, workflowContext }) {
  const artifacts = [];

  for (const historyEntry of entries) {
    const outputs = historyEntry.entry.outputs || {};
    for (const [nodeId, output] of Object.entries(outputs)) {
      if (!isPlainObject(output)) continue;
      const node = workflowContext.nodesById.get(String(nodeId));
      for (const [bucket, value] of Object.entries(output)) {
        if (!Array.isArray(value)) continue;
        value.forEach((item, index) => {
          const artifact = normalizeArtifact({
            promptId: historyEntry.promptId,
            nodeId: String(nodeId),
            nodeType: node?.type || 'Unknown',
            bucket,
            item,
            index,
            baseUrl,
            workflowContext
          });
          if (artifact) artifacts.push(artifact);
        });
      }
    }
  }

  return artifacts;
}

function normalizeArtifact({ promptId, nodeId, nodeType, bucket, item, index, baseUrl, workflowContext }) {
  const source = typeof item === 'string' ? { filename: item } : item;
  if (!isPlainObject(source)) return null;

  const filename = stringOrEmpty(source.filename ?? source.name ?? source.file);
  const directUrl = stringOrEmpty(source.url ?? source.download_url ?? source.downloadUrl);
  const fullPath = stringOrEmpty(source.fullpath ?? source.full_path ?? source.path);
  if (!filename && !directUrl && !fullPath) return null;

  const subfolder = stringOrEmpty(source.subfolder);
  const type = stringOrEmpty(source.type || inferComfyType(bucket, nodeType, filename));
  const format = stringOrEmpty(source.format || source.mime || source.content_type);
  const artifactType = inferArtifactType({ bucket, filename, format, nodeType });
  const viewUrl = directUrl || buildViewUrl({ baseUrl, filename, subfolder, type });
  const isPreview = isPreviewArtifact({ bucket, type, nodeType, filename });
  const isPreferredFinal = workflowContext.preferredIds.includes(nodeId);

  return {
    promptId,
    nodeId,
    nodeType,
    bucket,
    index,
    filename: filename || fullPath || directUrl,
    subfolder,
    type,
    format,
    artifactType,
    viewUrl,
    isPreview,
    isPreferredFinal,
    historyPath: `outputs["${nodeId}"].${bucket}[${index}]`
  };
}

function inferComfyType(bucket, nodeType, filename) {
  const text = `${bucket} ${nodeType} ${filename}`.toLowerCase();
  if (PREVIEW_HINTS.some((hint) => text.includes(hint))) return 'temp';
  return 'output';
}

function inferArtifactType({ bucket, filename, format, nodeType }) {
  const text = `${bucket} ${filename} ${format} ${nodeType}`.toLowerCase();
  if (/\.(mp4|webm|mov|mkv)$/i.test(filename) || text.includes('video')) return 'video';
  if (/\.(wav|mp3|flac|ogg|m4a)$/i.test(filename) || text.includes('audio')) return 'audio';
  if (/\.(gif|webp)$/i.test(filename) || text.includes('gif') || text.includes('webp')) return 'animation';
  if (/\.(png|jpg|jpeg|bmp|tiff)$/i.test(filename) || text.includes('image')) return 'image';
  return 'file';
}

function isPreviewArtifact({ bucket, type, nodeType, filename }) {
  const text = `${bucket} ${type} ${nodeType} ${filename}`.toLowerCase();
  return PREVIEW_HINTS.some((hint) => text.includes(hint));
}

function buildViewUrl({ baseUrl, filename, subfolder, type }) {
  if (!filename) return '';
  const params = new URLSearchParams({ filename });
  if (subfolder) params.set('subfolder', subfolder);
  if (type) params.set('type', type);
  return `${baseUrl}/view?${params.toString()}`;
}

function summarizeNodes(artifacts, workflowContext) {
  const grouped = new Map();

  for (const artifact of artifacts) {
    const existing = grouped.get(artifact.nodeId) || {
      nodeId: artifact.nodeId,
      nodeType: artifact.nodeType,
      artifactCount: 0,
      buckets: new Set(),
      artifactTypes: new Set(),
      isPreview: false,
      isPreferredFinal: workflowContext.preferredIds.includes(artifact.nodeId)
    };
    existing.artifactCount += 1;
    existing.buckets.add(artifact.bucket);
    existing.artifactTypes.add(artifact.artifactType);
    existing.isPreview = existing.isPreview || artifact.isPreview;
    grouped.set(artifact.nodeId, existing);
  }

  return Array.from(grouped.values()).map((summary) => ({
    ...summary,
    buckets: Array.from(summary.buckets),
    artifactTypes: Array.from(summary.artifactTypes)
  }));
}

function describeStatus(historyEntry) {
  const status = historyEntry.entry.status || historyEntry.entry.execution_status || {};
  const statusText = stringOrEmpty(status.status_str ?? status.status ?? historyEntry.entry.status_str);
  const completed = status.completed === true || /success|completed/i.test(statusText);
  const messages = Array.isArray(status.messages) ? status.messages : [];
  const errors = messages
    .map((message) => Array.isArray(message) ? message.join(' ') : String(message))
    .filter((message) => /error|exception|failed/i.test(message));

  return {
    promptId: historyEntry.promptId,
    completed,
    statusText: statusText || (completed ? 'completed' : 'unknown'),
    errors
  };
}

function buildRisks({ entries, artifacts, nodeSummaries, statuses, workflowContext }) {
  const risks = [];

  if (!entries.length) {
    risks.push('No ComfyUI history entries with outputs were found.');
  }
  if (entries.length && !artifacts.length) {
    risks.push('History entries were found, but no downloadable artifact objects were detected.');
  }
  if (!workflowContext.provided) {
    risks.push('No workflow JSON was provided, so final-vs-preview node classification is based only on history metadata.');
  }
  if (artifacts.length && artifacts.every((artifact) => artifact.isPreview)) {
    risks.push('All detected artifacts look temporary or preview-oriented; verify the final save/combine node.');
  } else if (artifacts.some((artifact) => artifact.isPreview)) {
    risks.push('Temporary or preview artifacts are present; do not choose them as final deliverables unless intentional.');
  }
  if (nodeSummaries.length > 1) {
    risks.push('Multiple history output nodes produced files; pin the exact final node id before downloading.');
  }
  if (workflowContext.preferredIds.length) {
    const artifactNodeIds = new Set(artifacts.map((artifact) => artifact.nodeId));
    const missingPreferred = workflowContext.preferredIds.filter((id) => !artifactNodeIds.has(id));
    if (missingPreferred.length) {
      risks.push(`Preferred workflow output node(s) missing from history artifacts: ${missingPreferred.join(', ')}.`);
    }
  }
  const incomplete = statuses.filter((status) => !status.completed);
  if (incomplete.length) {
    risks.push(`Some history entries are not marked completed: ${incomplete.map((status) => status.promptId).join(', ')}.`);
  }
  for (const status of statuses) {
    if (status.errors.length) {
      risks.push(`History ${status.promptId} reports error messages; check status.messages before trusting outputs.`);
    }
  }

  return unique(risks);
}

function buildEvidenceBrief({ entries, artifacts, nodeSummaries, statuses, risks, workflowContext }) {
  const lines = [
    'ComfyUI history artifact evidence',
    `History entries: ${entries.length}`,
    `Prompt ids: ${entries.map((entry) => entry.promptId).join(', ') || 'none detected'}`,
    `Completed entries: ${statuses.filter((status) => status.completed).length}/${statuses.length}`,
    `Artifact count: ${artifacts.length}`,
    `Output nodes with artifacts: ${formatNodeSummaries(nodeSummaries) || 'none detected'}`
  ];

  if (workflowContext.preferredNodes.length) {
    lines.push(`Preferred workflow output nodes: ${workflowContext.preferredNodes.map((node) => `${node.id}:${node.type}`).join(', ')}`);
  }

  lines.push('Artifacts:');
  if (artifacts.length) {
    artifacts.forEach((artifact) => {
      lines.push(`- ${artifact.nodeId}:${artifact.nodeType} ${artifact.bucket}[${artifact.index}] ${artifact.filename} (${artifact.type || 'unknown type'}, ${artifact.artifactType}) -> ${artifact.viewUrl || 'direct path only'}`);
    });
  } else {
    lines.push('- none detected');
  }

  if (risks.length) {
    lines.push('Risks:');
    risks.forEach((risk) => lines.push(`- ${risk}`));
  }

  lines.push('Handoff request: download only final output artifacts, preserve filename/subfolder/type, and attach the history JSON plus selected node id as delivery evidence.');
  return lines.join('\n');
}

function formatNodeSummaries(summaries) {
  return summaries
    .map((summary) => `${summary.nodeId}:${summary.nodeType}(${summary.artifactCount} ${summary.artifactTypes.join('/')})`)
    .join(', ');
}

function buildCurlCommand(artifact) {
  if (!artifact.viewUrl) {
    return `# ${artifact.filename}: no /view URL could be built`;
  }
  const outputName = artifact.filename.split('/').pop() || `node-${artifact.nodeId}-${artifact.index}`;
  return `curl -L "${artifact.viewUrl}" -o "${outputName}"`;
}

function normalizeBaseUrl(baseUrl) {
  const value = stringOrEmpty(baseUrl) || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, '');
}

function stringOrEmpty(value) {
  return value == null ? '' : String(value).trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
