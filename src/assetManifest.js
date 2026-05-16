import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const DEFAULT_CHECKOUT_URL = 'https://mv.786668.xyz/service-checkout.html?package=workflow-setup-starter&source=github-asset-manifest';

const MODEL_EXTENSIONS = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|engine)$/i;
const MEDIA_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|mov|webm|avi|mkv|wav|mp3|flac|m4a|aac)$/i;
const CONFIG_EXTENSIONS = /\.(json|yaml|yml|toml|txt)$/i;

const IGNORED_KEYS = new Set([
  'id',
  'type',
  'class_type',
  'seed',
  'noise_seed',
  'steps',
  'cfg',
  'sampler_name',
  'scheduler',
  'width',
  'height',
  'batch_size',
  'frame_rate',
  'fps',
  'duration',
  'filename_prefix',
  'text',
  'prompt',
  'positive',
  'negative'
]);

const MODEL_KEY_FOLDERS = [
  { folder: 'models/checkpoints', match: /(ckpt|checkpoint)/i },
  { folder: 'models/loras', match: /(lora|lycoris)/i },
  { folder: 'models/vae', match: /vae/i },
  { folder: 'models/controlnet', match: /(control_net|controlnet)/i },
  { folder: 'models/clip_vision', match: /(clip_vision|clipvision)/i },
  { folder: 'models/clip', match: /(^|_)clip($|_)/i },
  { folder: 'models/unet', match: /(unet|diffusion_model)/i },
  { folder: 'models/ipadapter', match: /(ipadapter|ip_adapter|adapter)/i },
  { folder: 'models/upscale_models', match: /(upscale|upscaler|esrgan|realesrgan)/i },
  { folder: 'models/animatediff', match: /(motion|animatediff|animate_diff)/i },
  { folder: 'models/video', match: /(ltx|ltxv|wan|hunyuan|video_model|t2v|i2v)/i },
  { folder: 'models/audio', match: /(audio_model|voice|tts|s2v|fish|whisper)/i },
  { folder: 'models', match: /(model|weight|file)/i }
];

const MEDIA_KEY_FOLDERS = [
  { folder: 'input/images', match: /(image|mask|reference|thumbnail)/i },
  { folder: 'input/videos', match: /(video|movie|clip)/i },
  { folder: 'input/audio', match: /(audio|sound|voice|music|wav|mp3)/i },
  { folder: 'input/files', match: /(file|path|filename|upload|asset)/i }
];

export function buildAssetManifestFromJson(raw, options = {}) {
  return buildAssetManifest(parseWorkflowJson(raw), options);
}

export function buildAssetManifest(workflow, options = {}) {
  const analysis = analyzeWorkflow(workflow);
  const nodes = normalizeNodes(workflow);
  const checkoutUrl = normalizeCheckoutUrl(options.checkoutUrl);
  const items = collectManifestItems(nodes);
  const modelItems = items.filter((item) => item.kind === 'model');
  const mediaItems = items.filter((item) => item.kind === 'media');
  const configItems = items.filter((item) => item.kind === 'config');
  const folderGroups = groupByFolder(items);
  const placementChecklist = buildPlacementChecklist({ analysis, folderGroups, modelItems, mediaItems, configItems });
  const uploadChecklist = buildUploadChecklist(mediaItems);
  const verificationChecklist = buildVerificationChecklist({ analysis, items });
  const risks = buildRisks({ analysis, items, modelItems, mediaItems });
  const manifestJson = buildManifestJson({ analysis, items, folderGroups, risks, checkoutUrl });
  const manifestBrief = buildManifestBrief({
    analysis,
    items,
    modelItems,
    mediaItems,
    configItems,
    folderGroups,
    placementChecklist,
    uploadChecklist,
    verificationChecklist,
    risks,
    checkoutUrl
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    itemCount: items.length,
    modelCount: modelItems.length,
    mediaCount: mediaItems.length,
    configCount: configItems.length,
    folderCount: folderGroups.length,
    items,
    modelItems,
    mediaItems,
    configItems,
    folderGroups,
    placementChecklist,
    uploadChecklist,
    verificationChecklist,
    risks,
    checkoutUrl,
    manifestJson,
    manifestBrief
  };
}

function collectManifestItems(nodes) {
  const items = [];

  for (const node of nodes) {
    for (const field of node.fields) {
      const item = buildManifestItem(node, field);
      if (item) items.push(item);
    }
  }

  return dedupeItems(items).sort(sortItems).map((item, index) => ({
    id: `asset-${String(index + 1).padStart(2, '0')}`,
    ...item
  }));
}

function buildManifestItem(node, field) {
  const key = String(field.key ?? '');
  const value = compactValue(field.value);
  if (!value || IGNORED_KEYS.has(key.toLowerCase()) || isConnection(field.value)) return null;

  const keyText = key.toLowerCase();
  const nodeText = String(node.type).toLowerCase();
  const folder = classifyFolder({ keyText, nodeText, value });
  if (!folder) return null;

  const kind = classifyKind(folder, value);
  const sourcePath = buildSourcePath(node, key);

  return {
    kind,
    folder,
    value,
    nodeId: node.id,
    nodeType: node.type,
    key,
    sourcePath,
    action: buildAction({ kind, folder, value }),
    verify: buildVerify({ kind, folder, value })
  };
}

function classifyFolder({ keyText, nodeText, value }) {
  const combined = `${keyText} ${nodeText}`;
  const modelFolder = MODEL_KEY_FOLDERS.find((rule) => rule.match.test(combined));
  if (modelFolder && (MODEL_EXTENSIONS.test(value) || !MEDIA_EXTENSIONS.test(value))) {
    return modelFolder.folder;
  }

  const mediaFolder = MEDIA_KEY_FOLDERS.find((rule) => rule.match.test(combined));
  if (mediaFolder && (MEDIA_EXTENSIONS.test(value) || isPathLike(value))) {
    return mediaFolder.folder;
  }

  if (MODEL_EXTENSIONS.test(value)) return 'models';
  if (MEDIA_EXTENSIONS.test(value)) return inferMediaFolder(value);
  if (CONFIG_EXTENSIONS.test(value) && /(file|path|config|style|preset|json|yaml|toml)/i.test(combined)) {
    return 'config-or-input-files';
  }

  return null;
}

function classifyKind(folder, value) {
  if (folder.startsWith('models/')) return 'model';
  if (folder.startsWith('input/')) return 'media';
  if (MODEL_EXTENSIONS.test(value)) return 'model';
  if (MEDIA_EXTENSIONS.test(value)) return 'media';
  return 'config';
}

function inferMediaFolder(value) {
  if (/\.(mp4|mov|webm|avi|mkv)$/i.test(value)) return 'input/videos';
  if (/\.(wav|mp3|flac|m4a|aac)$/i.test(value)) return 'input/audio';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(value)) return 'input/images';
  return 'input/files';
}

function buildAction({ kind, folder, value }) {
  if (kind === 'model') return `Place ${value} under ComfyUI ${folder} on the host.`;
  if (kind === 'media') return `Upload or remap ${value} to the hosted ${folder} location.`;
  return `Ship ${value} with the workflow package and document the expected host path.`;
}

function buildVerify({ kind, folder, value }) {
  if (kind === 'model') return `Confirm ${folder}/${value} is visible to ComfyUI after restart.`;
  if (kind === 'media') return `Run one prompt with ${value} uploaded and confirm the node reads it from the hosted input path.`;
  return `Confirm ${value} is available before queueing the hosted workflow.`;
}

function buildPlacementChecklist({ analysis, folderGroups, modelItems, mediaItems, configItems }) {
  const items = [];
  if (analysis.format === 'ComfyUI UI workflow export') {
    items.push('Export prompt API JSON before final placement so every asset path can be tied to prompt["node"].inputs fields.');
  }

  folderGroups.forEach((group) => {
    items.push(`${group.folder}: collect ${group.items.length} file(s): ${group.items.map((item) => item.value).join(', ')}.`);
  });

  if (!modelItems.length) items.push('No model/checkpoint assets were detected; confirm the workflow does not rely on default server-side model selections.');
  if (mediaItems.length) items.push('Upload media inputs before the acceptance run and save the final hosted filenames.');
  if (configItems.length) items.push('Include config or style files beside the workflow package and document their final host paths.');
  if (!folderGroups.length) items.push('No portable asset references were detected from static workflow fields.');

  return dedupe(items);
}

function buildUploadChecklist(mediaItems) {
  if (!mediaItems.length) {
    return ['No media upload inputs were detected.'];
  }

  return mediaItems.map((item) => `${item.value}: upload for node ${item.nodeId}:${item.nodeType}, then update ${item.sourcePath} if the hosted path changes.`);
}

function buildVerificationChecklist({ analysis, items }) {
  const checks = [
    `Open the workflow on the host and confirm ComfyUI reports ${analysis.nodeCount} node(s) without missing-node errors.`,
    'Restart ComfyUI after installing model files or custom nodes.',
    'Queue one acceptance prompt and save the prompt_id or hosted task id.',
    'Save the /history response or hosted task result for the final artifact.',
    'Record the selected final output node id and downloaded file name.'
  ];

  if (items.some((item) => item.kind === 'model')) {
    checks.unshift('Run a preflight scan on the host to confirm every model file exists before collecting the setup deposit.');
  }

  if (items.some((item) => item.kind === 'media')) {
    checks.push('Run one negative check with the old local media path removed so the hosted workflow proves it uses uploaded media.');
  }

  return dedupe(checks);
}

function buildRisks({ analysis, items, modelItems, mediaItems }) {
  const risks = [...analysis.risks];

  if (analysis.format === 'ComfyUI UI workflow export') {
    risks.push('UI workflow exports can hide exact prompt API paths; convert to prompt API JSON before final hosted setup.');
  }
  if (!items.length) {
    risks.push('No asset manifest entries were found; static parsing may miss server defaults or custom node internals.');
  }
  if (modelItems.length > 8) {
    risks.push('Large model manifests increase setup time, disk usage, and transfer failure risk.');
  }
  if (mediaItems.length) {
    risks.push('Input media paths must be remapped for hosted APIs; local desktop paths will not work on the server.');
  }
  if (items.some((item) => isLocalPath(item.value))) {
    risks.push('At least one asset appears to use a local filesystem path and needs host-safe remapping.');
  }
  if (items.some((item) => isRemoteUrl(item.value))) {
    risks.push('Remote or signed URLs should be copied to durable storage before using them as acceptance evidence.');
  }

  return dedupe(risks);
}

function buildManifestJson({ analysis, items, folderGroups, risks, checkoutUrl }) {
  return JSON.stringify({
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    generatedBy: 'comfyui-workflow-inspector asset manifest builder',
    folders: folderGroups.map((group) => ({
      folder: group.folder,
      files: group.items.map((item) => item.value)
    })),
    assets: items,
    risks,
    setupDeposit: checkoutUrl
  }, null, 2);
}

function buildManifestBrief({
  analysis,
  items,
  modelItems,
  mediaItems,
  configItems,
  folderGroups,
  placementChecklist,
  uploadChecklist,
  verificationChecklist,
  risks,
  checkoutUrl
}) {
  const lines = [
    'ComfyUI workflow asset manifest',
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Total assets: ${items.length}`,
    `Model assets: ${modelItems.length}`,
    `Media assets: ${mediaItems.length}`,
    `Config/input files: ${configItems.length}`,
    `Host folders: ${folderGroups.map((group) => group.folder).join(', ') || 'none detected'}`,
    '',
    'Placement checklist:',
    ...placementChecklist.map((item) => `- ${item}`),
    '',
    'Upload checklist:',
    ...uploadChecklist.map((item) => `- ${item}`),
    '',
    'Verification checklist:',
    ...verificationChecklist.map((item) => `- ${item}`)
  ];

  if (risks.length) {
    lines.push('', `Risks: ${risks.join(' ')}`);
  }

  lines.push('', `Setup deposit: ${checkoutUrl}`);
  return lines.join('\n');
}

function groupByFolder(items) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.folder) ?? [];
    current.push(item);
    groups.set(item.folder, current);
  }

  return [...groups.entries()]
    .map(([folder, groupItems]) => ({ folder, items: groupItems.sort(sortItems) }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function normalizeCheckoutUrl(url) {
  const value = String(url || '').trim();
  return value || DEFAULT_CHECKOUT_URL;
}

function buildSourcePath(node, key) {
  if (node.raw?.inputs && typeof node.raw.inputs === 'object' && !Array.isArray(node.raw.inputs)) {
    return `prompt["${node.id}"].inputs.${key}`;
  }
  return `${node.id}.${key}`;
}

function compactValue(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function isConnection(value) {
  return Array.isArray(value) && value.length >= 2 && (typeof value[0] === 'string' || typeof value[0] === 'number');
}

function isPathLike(value) {
  return /[\\/]/.test(value) || isRemoteUrl(value);
}

function isLocalPath(value) {
  return /(^\/Users\/|^\/home\/|^[A-Za-z]:\\|^~\/)/.test(value);
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${item.folder}:${item.value}:${item.nodeId}:${item.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sortItems(a, b) {
  return a.folder.localeCompare(b.folder)
    || Number(a.nodeId) - Number(b.nodeId)
    || String(a.nodeId).localeCompare(String(b.nodeId))
    || a.key.localeCompare(b.key)
    || a.value.localeCompare(b.value);
}
