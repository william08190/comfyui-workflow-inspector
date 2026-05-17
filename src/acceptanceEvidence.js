import { analyzeWorkflow, parseWorkflowJson } from './analyzer.js';
import { extractHistoryArtifacts } from './historyResult.js';

const DEFAULT_CHECKOUT_URL = 'https://mv.786668.xyz/service-checkout.html?package=workflow-setup-starter&source=github-acceptance-evidence';

export function buildAcceptanceEvidenceFromJson(rawHistory, options = {}) {
  const history = parseJson(rawHistory, 'Paste a ComfyUI /history response JSON document first.');
  const workflow = parseOptionalWorkflow(options.workflowJson, options.workflow);
  return buildAcceptanceEvidence(history, { ...options, workflow });
}

export function buildAcceptanceEvidence(history, options = {}) {
  const workflow = options.workflow || null;
  const analysis = workflow ? analyzeWorkflow(workflow) : null;
  const historyResult = extractHistoryArtifacts(history, {
    baseUrl: options.baseUrl,
    workflow
  });
  const checkoutUrl = normalizeCheckoutUrl(options.checkoutUrl);
  const deliverables = selectDeliverables(historyResult);
  const previewArtifacts = historyResult.artifacts.filter((artifact) => artifact.isPreview);
  const missingEvidence = buildMissingEvidence({ analysis, historyResult, deliverables });
  const risks = buildRisks({ analysis, historyResult, deliverables, previewArtifacts, missingEvidence });
  const outcome = buildOutcome({ historyResult, deliverables, missingEvidence, risks });
  const acceptanceChecklist = buildAcceptanceChecklist({ historyResult, deliverables, previewArtifacts });
  const deliveryFiles = buildDeliveryFiles({ analysis, historyResult, deliverables });
  const customerReport = buildCustomerReport({
    analysis,
    historyResult,
    deliverables,
    previewArtifacts,
    missingEvidence,
    risks,
    outcome,
    acceptanceChecklist,
    deliveryFiles,
    checkoutUrl
  });

  return {
    outcome,
    workflowFormat: analysis?.format || 'No workflow JSON provided',
    workflowNodeCount: analysis?.nodeCount || 0,
    historyCount: historyResult.historyCount,
    completedCount: historyResult.completedCount,
    artifactCount: historyResult.artifactCount,
    deliverableCount: deliverables.length,
    previewArtifactCount: previewArtifacts.length,
    promptIds: historyResult.promptIds,
    deliverables,
    previewArtifacts,
    missingEvidence,
    risks,
    acceptanceChecklist,
    deliveryFiles,
    downloadCommands: deliverables.map((artifact) => buildCurlCommand(artifact)),
    checkoutUrl,
    customerReport
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

function selectDeliverables(historyResult) {
  return historyResult.artifacts
    .filter((artifact) => !artifact.isPreview)
    .filter((artifact) => artifact.isPreferredFinal || artifact.type === 'output')
    .sort(sortArtifacts);
}

function buildMissingEvidence({ analysis, historyResult, deliverables }) {
  const missing = [];

  if (!historyResult.historyCount) {
    missing.push('Completed /history response with outputs.');
  }
  if (historyResult.historyCount && !historyResult.completedCount) {
    missing.push('A completed status marker for the history entry.');
  }
  if (!historyResult.artifactCount) {
    missing.push('Downloadable artifact objects in the history output.');
  }
  if (!deliverables.length) {
    missing.push('A non-preview final deliverable artifact.');
  }
  if (analysis && !historyResult.artifacts.some((artifact) => artifact.isPreferredFinal)) {
    missing.push('History artifact from the preferred workflow output node.');
  }

  return unique(missing);
}

function buildRisks({ analysis, historyResult, deliverables, previewArtifacts, missingEvidence }) {
  const risks = [...historyResult.risks];

  if (!analysis) {
    risks.push('No workflow JSON was provided, so acceptance cannot prove the final node contract.');
  }
  if (previewArtifacts.length) {
    risks.push(`${previewArtifacts.length} preview/temp artifact(s) must be excluded from final delivery.`);
  }
  if (deliverables.length > 1) {
    risks.push('Multiple non-preview deliverables were detected; document which file is the client-facing final.');
  }
  if (missingEvidence.length) {
    risks.push(`Missing acceptance evidence: ${missingEvidence.join('; ')}.`);
  }

  return unique(risks);
}

function buildOutcome({ historyResult, deliverables, missingEvidence, risks }) {
  if (!historyResult.historyCount || !historyResult.artifactCount || !deliverables.length) {
    return {
      status: 'blocked',
      label: 'Blocked',
      summary: 'Acceptance is blocked until a completed history response and final downloadable artifact are available.'
    };
  }

  if (missingEvidence.length || risks.length) {
    return {
      status: 'ready_with_warnings',
      label: 'Ready with warnings',
      summary: 'A final deliverable was found, but the evidence package needs the listed risks reviewed before client signoff.'
    };
  }

  return {
    status: 'ready',
    label: 'Ready',
    summary: 'A completed history response and final deliverable evidence are present.'
  };
}

function buildAcceptanceChecklist({ historyResult, deliverables, previewArtifacts }) {
  const finalNodes = deliverables.map((artifact) => `${artifact.nodeId}:${artifact.nodeType}`).join(', ') || 'none';
  const checklist = [
    `Save prompt id(s): ${historyResult.promptIds.join(', ') || 'none detected'}.`,
    `Confirm completed history entries: ${historyResult.completedCount}/${historyResult.historyCount}.`,
    `Confirm final deliverable node(s): ${finalNodes}.`,
    'Download the final file and record filename, type, subfolder, file size, and MIME type.',
    'Attach the raw /history response or provider result payload to the delivery record.'
  ];

  if (previewArtifacts.length) {
    checklist.push(`Record that preview/temp artifact(s) were excluded: ${previewArtifacts.map((artifact) => artifact.filename).join(', ')}.`);
  }

  return checklist;
}

function buildDeliveryFiles({ analysis, historyResult, deliverables }) {
  const files = [
    'acceptance-report.md',
    'history-response.json',
    'final-output-evidence.txt'
  ];

  if (analysis) files.push('workflow-json-used-for-run.json');
  if (historyResult.promptIds.length) files.push('prompt-id.txt');
  if (deliverables.length) files.push(...deliverables.map((artifact) => artifact.filename.split('/').pop() || `node-${artifact.nodeId}-artifact`));

  return unique(files);
}

function buildCustomerReport({
  analysis,
  historyResult,
  deliverables,
  previewArtifacts,
  missingEvidence,
  risks,
  outcome,
  acceptanceChecklist,
  deliveryFiles,
  checkoutUrl
}) {
  const lines = [
    'ComfyUI hosted workflow acceptance evidence',
    `Outcome: ${outcome.label}`,
    `Summary: ${outcome.summary}`,
    `Workflow format: ${analysis?.format || 'not provided'}`,
    `Workflow nodes: ${analysis?.nodeCount || 'not provided'}`,
    `Prompt ids: ${historyResult.promptIds.join(', ') || 'none detected'}`,
    `Completed history entries: ${historyResult.completedCount}/${historyResult.historyCount}`,
    `Artifacts found: ${historyResult.artifactCount}`,
    `Final deliverables: ${deliverables.length}`,
    `Preview/temp artifacts excluded: ${previewArtifacts.length}`,
    '',
    'Final deliverables:',
    ...(deliverables.length ? deliverables.map(formatArtifactLine) : ['- none detected']),
    '',
    'Acceptance checklist:',
    ...acceptanceChecklist.map((item) => `- ${item}`),
    '',
    'Delivery files:',
    ...deliveryFiles.map((file) => `- ${file}`)
  ];

  if (missingEvidence.length) {
    lines.push('', 'Missing evidence:', ...missingEvidence.map((item) => `- ${item}`));
  }

  if (risks.length) {
    lines.push('', 'Risks:', ...risks.map((risk) => `- ${risk}`));
  }

  lines.push('', `Setup or repair deposit: ${checkoutUrl}`);
  return lines.join('\n');
}

function formatArtifactLine(artifact) {
  return `- ${artifact.nodeId}:${artifact.nodeType} ${artifact.filename} (${artifact.type || 'unknown type'}, ${artifact.artifactType}) -> ${artifact.viewUrl || 'direct path only'}`;
}

function buildCurlCommand(artifact) {
  if (!artifact.viewUrl) return `# ${artifact.filename}: no /view URL could be built`;
  const outputName = artifact.filename.split('/').pop() || `node-${artifact.nodeId}-${artifact.index}`;
  return `curl -L "${artifact.viewUrl}" -o "${outputName}"`;
}

function normalizeCheckoutUrl(url) {
  const value = String(url || '').trim();
  return value || DEFAULT_CHECKOUT_URL;
}

function sortArtifacts(a, b) {
  return Number(b.isPreferredFinal) - Number(a.isPreferredFinal)
    || a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true })
    || a.filename.localeCompare(b.filename);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
