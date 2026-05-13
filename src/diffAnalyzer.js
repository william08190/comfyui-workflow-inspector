import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const NOISE_KEYS = new Set([
  'id',
  'class_type',
  'type',
  'pos',
  'size',
  'flags',
  'order',
  'mode',
  'properties',
  'inputs',
  'outputs',
  'widgets_values'
]);

export function diffWorkflowJson(sourceRaw, targetRaw) {
  const source = parseWorkflowJson(sourceRaw);
  const target = parseWorkflowJson(targetRaw);
  return diffWorkflows(source, target);
}

export function diffWorkflows(source, target) {
  const sourceNodes = normalizeNodes(source);
  const targetNodes = normalizeNodes(target);

  if (!sourceNodes.length || !targetNodes.length) {
    throw new Error('Both workflow JSON documents must contain ComfyUI nodes.');
  }

  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const targetById = new Map(targetNodes.map((node) => [node.id, node]));
  const addedNodes = [];
  const removedNodes = [];
  const typeChanges = [];
  const fieldChanges = [];

  for (const targetNode of targetNodes) {
    const sourceNode = sourceById.get(targetNode.id);
    if (!sourceNode) {
      addedNodes.push(summarizeNode(targetNode));
      continue;
    }

    if (sourceNode.type !== targetNode.type) {
      typeChanges.push({
        id: targetNode.id,
        from: sourceNode.type,
        to: targetNode.type
      });
    }

    fieldChanges.push(...compareFields(sourceNode, targetNode));
  }

  for (const sourceNode of sourceNodes) {
    if (!targetById.has(sourceNode.id)) {
      removedNodes.push(summarizeNode(sourceNode));
    }
  }

  const sourceAnalysis = analyzeWorkflow(source);
  const targetAnalysis = analyzeWorkflow(target);
  const migrationBrief = buildMigrationBrief({
    sourceAnalysis,
    targetAnalysis,
    addedNodes,
    removedNodes,
    typeChanges,
    fieldChanges
  });

  return {
    sourceFormat: sourceAnalysis.format,
    targetFormat: targetAnalysis.format,
    sourceNodeCount: sourceNodes.length,
    targetNodeCount: targetNodes.length,
    addedNodes,
    removedNodes,
    typeChanges,
    fieldChanges,
    sourceOutputs: sourceAnalysis.outputNodes.map(summarizeNode),
    targetOutputs: targetAnalysis.outputNodes.map(summarizeNode),
    migrationBrief
  };
}

function compareFields(sourceNode, targetNode) {
  const sourceFields = buildFieldMap(sourceNode);
  const targetFields = buildFieldMap(targetNode);
  const keys = Array.from(new Set([...sourceFields.keys(), ...targetFields.keys()])).sort();
  const changes = [];

  for (const key of keys) {
    const from = sourceFields.get(key);
    const to = targetFields.get(key);
    if (from === to) continue;
    changes.push({
      nodeId: targetNode.id,
      nodeType: targetNode.type,
      key,
      from: from ?? '',
      to: to ?? ''
    });
  }

  return changes;
}

function buildFieldMap(node) {
  const fields = new Map();

  for (const field of node.fields) {
    if (NOISE_KEYS.has(String(field.key))) continue;
    const value = stableValue(field.value);
    if (value === '') continue;
    fields.set(String(field.key), value);
  }

  return fields;
}

function summarizeNode(node) {
  return {
    id: node.id,
    type: node.type
  };
}

function stableValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return compact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return compact(stableStringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compact(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

function buildMigrationBrief(result) {
  const lines = [
    `Source: ${result.sourceAnalysis.format}, ${result.sourceAnalysis.nodeCount} nodes`,
    `Target: ${result.targetAnalysis.format}, ${result.targetAnalysis.nodeCount} nodes`,
    `Added nodes: ${formatNodes(result.addedNodes) || 'none'}`,
    `Removed nodes: ${formatNodes(result.removedNodes) || 'none'}`,
    `Type changes: ${formatTypeChanges(result.typeChanges) || 'none'}`,
    `Changed fields: ${formatFieldChanges(result.fieldChanges.slice(0, 16)) || 'none'}`,
    `Source outputs: ${formatNodes(result.sourceAnalysis.outputNodes) || 'none detected'}`,
    `Target outputs: ${formatNodes(result.targetAnalysis.outputNodes) || 'none detected'}`
  ];

  if (result.fieldChanges.length > 16) {
    lines.push(`Additional changed fields: ${result.fieldChanges.length - 16}`);
  }

  lines.push('Migration request: identify which nodes/parameters should be copied from source to target and preserve the target final output path.');
  return lines.join('\n');
}

function formatNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function formatTypeChanges(changes) {
  return changes.map((change) => `${change.id}:${change.from}->${change.to}`).join(', ');
}

function formatFieldChanges(changes) {
  return changes.map((change) => `${change.nodeId}:${change.key}=${change.from}->${change.to}`).join(', ');
}
