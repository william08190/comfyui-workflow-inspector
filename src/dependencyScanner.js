import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const CORE_NODE_TYPES = new Set([
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'CLIPSetLastLayer',
  'VAELoader',
  'VAEEncode',
  'VAEDecode',
  'EmptyLatentImage',
  'LatentUpscale',
  'LatentUpscaleBy',
  'KSampler',
  'KSamplerAdvanced',
  'SaveImage',
  'PreviewImage',
  'LoadImage',
  'LoadImageMask',
  'ControlNetLoader',
  'ControlNetApply',
  'ControlNetApplyAdvanced',
  'LoraLoader',
  'UNETLoader',
  'DualCLIPLoader',
  'CLIPLoader',
  'CLIPVisionLoader',
  'ImageScale',
  'ImageScaleBy',
  'ImageInvert',
  'ImageCompositeMasked',
  'SolidMask',
  'MaskToImage',
  'ImageToMask',
  'Reroute',
  'PrimitiveNode'
]);

const PACKAGE_RULES = [
  {
    packageName: 'ComfyUI-VideoHelperSuite',
    installHint: 'Install Video Helper Suite through ComfyUI Manager or the package repository, then verify ffmpeg is available.',
    match: /^(VHS_|VideoHelperSuite|VHS)/i
  },
  {
    packageName: 'ComfyUI-Impact-Pack',
    installHint: 'Install ComfyUI-Impact-Pack and its detector models before running segmentation or face-detailer nodes.',
    match: /(Impact|FaceDetailer|SEGS|SAMDetector|UltralyticsDetector|BBOXDetector|Detailer)/i
  },
  {
    packageName: 'ComfyUI_IPAdapter_plus',
    installHint: 'Install IPAdapter Plus and place the required IP-Adapter, CLIP Vision, and image encoder models in ComfyUI models folders.',
    match: /(IPAdapter|IPAdapterUnified|IPAdapterAdvanced)/i
  },
  {
    packageName: 'ComfyUI-Manager',
    installHint: 'Use ComfyUI Manager to resolve missing node packs and install custom-node dependencies.',
    match: /(Manager|InstallCustom|MissingNodes)/i
  },
  {
    packageName: 'ComfyUI-KJNodes',
    installHint: 'Install kijai/ComfyUI-KJNodes for KJ utility, masking, batching, and video helper nodes.',
    match: /^(KJ|KJNodes|ConditioningMultiCombine|CreateFadeMask|GrowMaskWithBlur)/i
  },
  {
    packageName: 'ComfyUI-Advanced-ControlNet',
    installHint: 'Install Advanced ControlNet when the workflow uses ControlNet scheduling, timestep, or apply-advanced nodes.',
    match: /(AdvancedControlNet|ControlNetAdvanced|TimestepKeyframe|ControlNetSchedule)/i
  },
  {
    packageName: 'ComfyUI-AnimateDiff-Evolved',
    installHint: 'Install AnimateDiff-Evolved and its motion models for AnimateDiff loader or sampler nodes.',
    match: /(AnimateDiff|ADE_|MotionModel|ContextOptions|AnimateLCM)/i
  },
  {
    packageName: 'ComfyUI-Frame-Interpolation',
    installHint: 'Install a frame interpolation node pack and the required RIFE/FILM model weights.',
    match: /(RIFE|FILM|FrameInterpolation|Interpolate)/i
  },
  {
    packageName: 'ComfyUI-Florence2',
    installHint: 'Install Florence2 nodes and download the referenced Florence model before caption or vision-language steps.',
    match: /(Florence|Florence2|DownloadAndLoadFlorence)/i
  },
  {
    packageName: 'ComfyUI-Video-Matting',
    installHint: 'Install the video matting node pack and confirm matting model checkpoints are present.',
    match: /(Matting|RVM|BiRefNet|BEN2|MODNet)/i
  },
  {
    packageName: 'ComfyUI-LTXVideo',
    installHint: 'Install LTXVideo custom nodes and download the LTXV model, VAE, and text encoder assets.',
    match: /(LTX|LTXV|LTXVideo)/i
  },
  {
    packageName: 'ComfyUI-WanVideoWrapper',
    installHint: 'Install WanVideo wrapper nodes and confirm Wan model, VAE, text encoder, and LoRA paths match the host.',
    match: /(WanVideo|WanImage|WanVace|WanT2V|WanI2V)/i
  },
  {
    packageName: 'ComfyUI-SeedVR2',
    installHint: 'Install SeedVR2 nodes and model weights before relying on restoration or upscale branches.',
    match: /(SeedVR|SeedVR2)/i
  },
  {
    packageName: 'ComfyUI-Crystools',
    installHint: 'Install Crystools only if monitoring, debug, or utility nodes are needed at runtime.',
    match: /(CRY_|Crystools|ResourceMonitor)/i
  },
  {
    packageName: 'Comfyroll Studio',
    installHint: 'Install Comfyroll Studio for CR utility, prompt, layout, and animation helper nodes.',
    match: /^(CR |CR_|Comfyroll)/i
  }
];

const MODEL_KEY_HINTS = [
  'ckpt',
  'model',
  'unet',
  'vae',
  'clip',
  'lora',
  'control_net',
  'controlnet',
  'adapter',
  'motion'
];

const MEDIA_KEY_HINTS = [
  'image',
  'mask',
  'audio',
  'video',
  'file',
  'filename',
  'path',
  'reference'
];

const MEDIA_EXTENSION = /\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3|flac|m4a)$/i;

export function scanDependenciesFromJson(raw) {
  return scanDependencies(parseWorkflowJson(raw));
}

export function scanDependencies(workflow) {
  const analysis = analyzeWorkflow(workflow);
  const nodes = normalizeNodes(workflow);
  const packages = collectPackages(nodes);
  const assets = collectAssets(nodes);
  const risks = buildRisks({ analysis, nodes, packages, assets });
  const installBrief = buildInstallBrief({
    analysis,
    packages,
    assets,
    risks
  });

  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    packages,
    assets,
    risks,
    installBrief
  };
}

function collectPackages(nodes) {
  const packageMap = new Map();
  const coreNodes = [];
  const unknownCustomNodes = [];

  for (const node of nodes) {
    const type = node.type;
    if (CORE_NODE_TYPES.has(type)) {
      coreNodes.push(toNodeRef(node));
      continue;
    }

    const rule = PACKAGE_RULES.find((candidate) => candidate.match.test(type));
    if (rule) {
      const current = packageMap.get(rule.packageName) ?? {
        packageName: rule.packageName,
        installHint: rule.installHint,
        nodes: []
      };
      current.nodes.push(toNodeRef(node));
      packageMap.set(rule.packageName, current);
    } else {
      unknownCustomNodes.push(toNodeRef(node));
    }
  }

  return {
    coreNodes,
    customPackages: [...packageMap.values()].sort(sortPackages),
    unknownCustomNodes: unknownCustomNodes.sort(sortNodeRefs)
  };
}

function collectAssets(nodes) {
  const modelAssets = [];
  const mediaAssets = [];

  for (const node of nodes) {
    for (const field of node.fields) {
      if (isMetadataKey(field.key) || !isAssetValue(field.value)) continue;
      const keyText = String(field.key).toLowerCase();
      const asset = {
        nodeId: node.id,
        nodeType: node.type,
        key: field.key,
        value: compactValue(field.value),
        path: `prompt["${node.id}"].inputs.${field.key}`
      };

      if (hasAny(keyText, MODEL_KEY_HINTS)) {
        modelAssets.push(asset);
      } else if (isMediaAsset(field.key, field.value)) {
        mediaAssets.push(asset);
      }
    }
  }

  return {
    modelAssets: dedupeAssets(modelAssets).sort(sortAssets),
    mediaAssets: dedupeAssets(mediaAssets).sort(sortAssets)
  };
}

function buildRisks({ analysis, nodes, packages, assets }) {
  const risks = [];

  if (analysis.format === 'ComfyUI UI workflow export') {
    risks.push('UI workflow exports can omit exact prompt API input paths; export prompt API JSON before final host setup.');
  }
  if (packages.customPackages.length) {
    risks.push(`${packages.customPackages.length} custom node package group(s) were detected and must be installed on the host.`);
  }
  if (packages.unknownCustomNodes.length) {
    risks.push(`${packages.unknownCustomNodes.length} non-core node type(s) could not be matched to a known package rule.`);
  }
  if (assets.modelAssets.length) {
    risks.push(`${assets.modelAssets.length} model or checkpoint reference(s) must exist under the host ComfyUI models directory.`);
  }
  if (assets.mediaAssets.length) {
    risks.push(`${assets.mediaAssets.length} media file reference(s) may need upload or hosted path remapping.`);
  }
  if (nodes.some((node) => /VHS_|VideoCombine|ffmpeg/i.test(node.type))) {
    risks.push('Video combine nodes usually require ffmpeg and write access to the ComfyUI output directory.');
  }
  if (!packages.customPackages.length && !packages.unknownCustomNodes.length) {
    risks.push('No obvious custom node dependencies were detected from node class names.');
  }

  return Array.from(new Set(risks));
}

function buildInstallBrief({ analysis, packages, assets, risks }) {
  const lines = [
    `Format: ${analysis.format}`,
    `Node count: ${analysis.nodeCount}`,
    `Core nodes: ${packages.coreNodes.length}`,
    `Detected custom packages: ${packages.customPackages.length}`,
    ...formatPackages(packages.customPackages),
    `Unknown non-core node types: ${formatNodeRefs(packages.unknownCustomNodes) || 'none'}`,
    `Model/checkpoint references: ${formatAssets(assets.modelAssets) || 'none detected'}`,
    `Media references: ${formatAssets(assets.mediaAssets) || 'none detected'}`
  ];

  if (risks.length) {
    lines.push(`Risks: ${risks.join(' ')}`);
  }

  lines.push('Setup request: install the detected custom node packages, place model/media assets in matching host paths, restart ComfyUI, then run a prompt API smoke test.');
  return lines.join('\n');
}

function formatPackages(packages) {
  if (!packages.length) return ['Custom package install hints: none detected'];
  return [
    'Custom package install hints:',
    ...packages.map((dependency) => `- ${dependency.packageName}: ${dependency.installHint} Nodes: ${formatNodeRefs(dependency.nodes)}`)
  ];
}

function formatNodeRefs(nodes) {
  return nodes.map((node) => `${node.nodeId}:${node.nodeType}`).join(', ');
}

function formatAssets(assets) {
  return assets
    .map((asset) => `${asset.nodeId}:${asset.key}=${asset.value}`)
    .join(', ');
}

function toNodeRef(node) {
  return {
    nodeId: node.id,
    nodeType: node.type
  };
}

function isMetadataKey(key) {
  return /^(id|type|class_type)$/i.test(String(key));
}

function isAssetValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isMediaAsset(key, value) {
  if (/^filename_prefix$/i.test(String(key))) return false;
  return hasAny(String(key).toLowerCase(), MEDIA_KEY_HINTS) || MEDIA_EXTENSION.test(String(value));
}

function hasAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

function compactValue(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function dedupeAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = `${asset.nodeId}:${asset.key}:${asset.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortPackages(a, b) {
  return a.packageName.localeCompare(b.packageName);
}

function sortNodeRefs(a, b) {
  return Number(a.nodeId) - Number(b.nodeId) || a.nodeId.localeCompare(b.nodeId) || a.nodeType.localeCompare(b.nodeType);
}

function sortAssets(a, b) {
  return Number(a.nodeId) - Number(b.nodeId) || a.nodeId.localeCompare(b.nodeId) || a.key.localeCompare(b.key);
}
