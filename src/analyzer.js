const OUTPUT_HINTS = [
  'save',
  'preview',
  'vhs_videocombine',
  'videocombine',
  'combine',
  'video',
  'audio',
  'image',
  'animatedwebp',
  'gif'
];

const PREVIEW_HINTS = ['preview', 'temp', 'debug'];
const PROMPT_HINTS = ['prompt', 'text', 'caption', 'positive', 'negative'];
const DURATION_HINTS = ['duration', 'seconds', 'length', 'frame', 'frames', 'fps'];
const SEED_HINTS = ['seed', 'noise_seed'];
const MODEL_HINTS = ['model', 'checkpoint', 'ckpt', 'lora', 'vae', 'sampler', 'scheduler'];

export function parseWorkflowJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Paste a ComfyUI workflow JSON document first.');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

export function analyzeWorkflow(workflow) {
  const nodes = normalizeNodes(workflow);
  if (!nodes.length) {
    throw new Error('No ComfyUI nodes were found. Use a UI workflow export or prompt API JSON.');
  }

  const outputNodes = nodes.filter((node) => hasAny(node.outputText, OUTPUT_HINTS));
  const previewNodes = outputNodes.filter((node) => hasAny(node.searchText, PREVIEW_HINTS));
  const promptFields = collectFieldMatches(nodes, PROMPT_HINTS);
  const durationFields = collectFieldMatches(nodes, DURATION_HINTS);
  const seedFields = collectFieldMatches(nodes, SEED_HINTS);
  const modelFields = collectFieldMatches(nodes, MODEL_HINTS);

  const risks = [];
  if (!outputNodes.length) {
    risks.push('No obvious final output node was detected.');
  }
  if (previewNodes.length && previewNodes.length === outputNodes.length) {
    risks.push('All detected output-like nodes look preview or debug oriented.');
  } else if (previewNodes.length) {
    risks.push('Preview output nodes are present; make sure the API reads the final node.');
  }
  if (!durationFields.length) {
    risks.push('No duration, frame, or FPS field was detected.');
  }
  if (outputNodes.length > 1) {
    risks.push('Multiple output-like nodes were detected; hosted retrieval should pin the intended node id.');
  }

  const repairBrief = buildRepairBrief({
    format: detectFormat(workflow),
    nodes,
    outputNodes,
    previewNodes,
    durationFields,
    seedFields,
    promptFields,
    modelFields,
    risks
  });

  return {
    format: detectFormat(workflow),
    nodeCount: nodes.length,
    outputNodes,
    previewNodes,
    promptFields,
    durationFields,
    seedFields,
    modelFields,
    risks,
    repairBrief
  };
}

export function normalizeNodes(workflow) {
  if (Array.isArray(workflow?.nodes)) {
    return workflow.nodes.map((node, index) => normalizeUiNode(node, index));
  }

  if (workflow && typeof workflow === 'object') {
    return Object.entries(workflow)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([id, node], index) => normalizePromptNode(id, node, index));
  }

  return [];
}

function normalizeUiNode(node, index) {
  const id = String(node.id ?? index);
  const type = String(node.type ?? node.class_type ?? 'Unknown');
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const inputs = Array.isArray(node.inputs) ? node.inputs : [];
  const outputs = Array.isArray(node.outputs) ? node.outputs : [];
  const fields = [
    ...Object.entries(node).map(([key, value]) => ({ key, value })),
    ...widgets.map((value, widgetIndex) => ({ key: `widget_${widgetIndex}`, value })),
    ...inputs.map((input) => ({ key: input.name ?? input.type ?? 'input', value: input.type ?? input.name ?? '' })),
    ...outputs.map((output) => ({ key: output.name ?? output.type ?? 'output', value: output.type ?? output.name ?? '' }))
  ];

  return withSearchText({ id, type, fields, raw: node });
}

function normalizePromptNode(id, node, index) {
  const type = String(node.class_type ?? node.type ?? 'Unknown');
  const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
  const fields = [
    { key: 'id', value: id },
    { key: 'class_type', value: type },
    ...Object.entries(inputs).map(([key, value]) => ({ key, value }))
  ];

  return withSearchText({ id: String(id ?? index), type, fields, raw: node });
}

function withSearchText(node) {
  const fieldText = node.fields
    .map((field) => `${field.key} ${stringifyValue(field.value)}`)
    .join(' ');
  const outputText = node.fields
    .filter((field) => /^(filename|filename_prefix|save|save_path|output|output_path)$/i.test(field.key))
    .map((field) => `${field.key} ${stringifyValue(field.value)}`)
    .join(' ');
  return {
    ...node,
    searchText: `${node.id} ${node.type} ${fieldText}`.toLowerCase(),
    outputText: `${node.id} ${node.type} ${outputText}`.toLowerCase()
  };
}

function collectFieldMatches(nodes, hints) {
  const matches = [];

  for (const node of nodes) {
    for (const field of node.fields) {
      const haystack = `${field.key} ${stringifyValue(field.value)}`.toLowerCase();
      if (hasAny(haystack, hints)) {
        matches.push({
          nodeId: node.id,
          nodeType: node.type,
          key: field.key,
          value: compactValue(field.value)
        });
      }
    }
  }

  return dedupeMatches(matches);
}

function buildRepairBrief(result) {
  const lines = [
    `Format: ${result.format}`,
    `Node count: ${result.nodes.length}`,
    `Output-like nodes: ${formatNodes(result.outputNodes) || 'none detected'}`,
    `Preview-like outputs: ${formatNodes(result.previewNodes) || 'none detected'}`,
    `Duration/frame/FPS fields: ${formatMatches(result.durationFields) || 'none detected'}`,
    `Seed fields: ${formatMatches(result.seedFields) || 'none detected'}`,
    `Prompt fields: ${formatMatches(result.promptFields.slice(0, 8)) || 'none detected'}`,
    `Model fields: ${formatMatches(result.modelFields.slice(0, 8)) || 'none detected'}`
  ];

  if (result.risks.length) {
    lines.push(`Risks: ${result.risks.join(' ')}`);
  }

  lines.push('Repair request: identify the production output node, bind runtime inputs, and document artifact retrieval.');
  return lines.join('\n');
}

function detectFormat(workflow) {
  if (Array.isArray(workflow?.nodes)) return 'ComfyUI UI workflow export';
  if (workflow && typeof workflow === 'object') return 'ComfyUI prompt API JSON';
  return 'Unknown';
}

function formatNodes(nodes) {
  return nodes.map((node) => `${node.id}:${node.type}`).join(', ');
}

function formatMatches(matches) {
  return matches.map((match) => `${match.nodeId}:${match.key}=${match.value}`).join(', ');
}

function dedupeMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = `${match.nodeId}:${match.key}:${match.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

function stringifyValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactValue(value) {
  const text = stringifyValue(value).replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}
