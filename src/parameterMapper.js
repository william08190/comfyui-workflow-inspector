import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const CATEGORY_RULES = [
  {
    category: 'prompt',
    hints: ['prompt', 'positive', 'negative', 'text', 'caption', 'description'],
    description: 'Text prompt or caption field'
  },
  {
    category: 'timing',
    hints: ['duration', 'seconds', 'length', 'frame', 'frames', 'frame_rate', 'framerate', 'fps'],
    description: 'Duration, frame, or FPS field'
  },
  {
    category: 'dimensions',
    hints: ['width', 'height', 'size', 'resolution', 'aspect'],
    description: 'Image or video dimension field'
  },
  {
    category: 'seed',
    hints: ['seed', 'noise_seed'],
    description: 'Seed field'
  },
  {
    category: 'media',
    hints: ['image', 'images', 'mask', 'audio', 'video', 'file', 'filename', 'upload', 'reference'],
    description: 'Media file or upload field'
  },
  {
    category: 'model',
    hints: ['model', 'checkpoint', 'ckpt', 'lora', 'vae', 'sampler', 'scheduler'],
    description: 'Model, LoRA, VAE, sampler, or scheduler field'
  }
];

const CATEGORY_ORDER = CATEGORY_RULES.map((rule) => rule.category);

export function mapParametersFromJson(raw) {
  return mapParameters(parseWorkflowJson(raw));
}

export function mapParameters(workflow) {
  const analysis = analyzeWorkflow(workflow);
  const nodes = normalizeNodes(workflow);
  const fields = collectParameterFields(nodes);
  const bindings = buildBindings(fields);
  const groups = groupByCategory(fields);
  const risks = buildRisks({ analysis, fields, bindings });
  const integrationBrief = buildIntegrationBrief({
    analysis,
    groups,
    bindings,
    risks
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    fields,
    bindings,
    groups,
    risks,
    integrationBrief
  };
}

function collectParameterFields(nodes) {
  const fields = [];

  for (const node of nodes) {
    for (const field of node.fields) {
      if (isMetadataKey(field.key)) continue;
      const match = matchCategory(field.key, field.value);
      if (!match) continue;

      const valueKind = classifyValue(field.value);
      fields.push({
        nodeId: node.id,
        nodeType: node.type,
        key: field.key,
        value: compactValue(field.value),
        rawValue: field.value,
        category: match.category,
        description: match.description,
        valueKind,
        path: `prompt["${node.id}"].inputs.${field.key}`,
        bindable: isBindableValue(field.value, valueKind)
      });
    }
  }

  return dedupeFields(fields).sort(sortFields);
}

function isMetadataKey(key) {
  return /^(id|type|class_type)$/i.test(String(key));
}

function matchCategory(key, value) {
  const haystack = `${key} ${stringifyValue(value)}`.toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.hints.some((hint) => haystack.includes(hint)));
}

function classifyValue(value) {
  if (Array.isArray(value) && value.length >= 2) return 'linked';
  if (typeof value === 'string') {
    if (value.trim() === '') return 'empty';
    return 'string';
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value == null) return 'empty';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function isBindableValue(value, valueKind) {
  if (valueKind === 'linked' || valueKind === 'object' || valueKind === 'array') return false;
  if (valueKind === 'empty') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function buildBindings(fields) {
  return fields
    .filter((field) => field.bindable)
    .map((field) => ({
      name: buildParameterName(field),
      category: field.category,
      nodeId: field.nodeId,
      nodeType: field.nodeType,
      key: field.key,
      value: field.value,
      valueKind: field.valueKind,
      sourcePath: field.path
    }));
}

function buildParameterName(field) {
  const base = `${field.category}_${field.nodeId}_${field.key}`;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function groupByCategory(fields) {
  return CATEGORY_ORDER.map((category) => ({
    category,
    fields: fields.filter((field) => field.category === category)
  })).filter((group) => group.fields.length);
}

function buildRisks({ analysis, fields, bindings }) {
  const risks = [...analysis.risks];
  const categories = new Set(fields.map((field) => field.category));

  if (analysis.format === 'ComfyUI UI workflow export') {
    risks.push('UI workflow exports must be converted to prompt API JSON before these paths can be wired directly.');
  }
  if (!categories.has('prompt')) {
    risks.push('No prompt text field was detected, so prompt binding may require manual node review.');
  }
  if (!categories.has('seed')) {
    risks.push('No seed field was detected; repeatability controls may be hidden in a custom node.');
  }
  if (!categories.has('dimensions')) {
    risks.push('No width or height field was detected; output size may be fixed or controlled by an upstream latent node.');
  }
  if (!categories.has('timing')) {
    risks.push('No duration, frame, or FPS field was detected; video length may not be exposed for hosted callers.');
  }
  if (!bindings.length) {
    risks.push('No directly bindable scalar fields were found.');
  }

  return Array.from(new Set(risks));
}

function buildIntegrationBrief({ analysis, groups, bindings, risks }) {
  const lines = [
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Bindable parameters: ${bindings.length}`,
    'Recommended hosted API parameters:',
    ...formatBindings(bindings),
    'Detected parameter groups:',
    ...groups.map((group) => `${group.category}: ${formatFields(group.fields)}`)
  ];

  if (risks.length) {
    lines.push(`Risks: ${risks.join(' ')}`);
  }

  lines.push('Implementation request: expose the bindable parameters as hosted workflow inputs and preserve linked node dependencies.');
  return lines.join('\n');
}

function formatBindings(bindings) {
  if (!bindings.length) return ['none detected'];
  return bindings.map((binding) => `- ${binding.name} -> ${binding.sourcePath} (${binding.valueKind}, current ${binding.value})`);
}

function formatFields(fields) {
  return fields
    .map((field) => `${field.nodeId}:${field.key}=${field.value}`)
    .join(', ');
}

function dedupeFields(fields) {
  const seen = new Set();
  return fields.filter((field) => {
    const key = `${field.nodeId}:${field.key}:${field.category}:${field.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortFields(a, b) {
  const categoryDelta = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (categoryDelta !== 0) return categoryDelta;
  return Number(a.nodeId) - Number(b.nodeId) || a.nodeId.localeCompare(b.nodeId) || a.key.localeCompare(b.key);
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
