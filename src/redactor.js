import { analyzeWorkflow, normalizeNodes, parseWorkflowJson } from './analyzer.js';

const CHECKOUT_BASE = 'https://mv.786668.xyz/service-checkout.html';
const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|passwd|pwd|credential|authorization|auth[_-]?header|bearer|cookie|private[_-]?key|access[_-]?key|webhook)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]{12,}/gi;
const NAMED_SECRET_RE = /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?([A-Za-z0-9._~+/\-=]{8,})["']?/gi;
const LONG_TOKEN_RE = /\b(?:sk|rk|ghp|github_pat|hf|xoxb|xoxp|ya29|pat)_[A-Za-z0-9_~.-]{12,}\b/g;
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^"'`\s<>]+/g;
const POSIX_PATH_RE = /(?:^|[\s"'(])((?:\/Users|\/home|\/Volumes|\/mnt|\/var\/folders)\/[^"'`\s<>)]*)/g;
const PRIVATE_HOST_RE = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s"'<>]*)?/g;
const FILE_KEYS = /(image|audio|video|file|filename|path|ckpt|model|vae|lora|control_net|checkpoint)/i;
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'client_secret',
  'code',
  'key',
  'password',
  'secret',
  'sig',
  'signature',
  'token'
]);

export function buildRedactionPack(rawWorkflow, options = {}) {
  const workflowText = String(rawWorkflow || '').trim();
  const logText = String(options.logText || '').trim();
  const exposures = [];
  let safeWorkflowJson = '';
  let workflowSummary = null;

  if (workflowText) {
    const workflow = parseWorkflowJson(workflowText);
    workflowSummary = summarizeWorkflow(workflow);
    const sanitized = sanitizeValue(workflow, {
      path: [],
      exposures,
      source: 'workflow'
    });
    safeWorkflowJson = JSON.stringify(sanitized, null, 2);
  }

  const safeLog = logText
    ? sanitizeText(logText, {
      path: ['log'],
      exposures,
      source: 'log',
      keyHint: 'log'
    })
    : '';

  const metrics = buildMetrics({ exposures, workflowSummary, safeLog });
  const checklist = buildChecklist({ exposures, workflowSummary, safeLog });
  const checkoutUrl = buildCheckoutUrl(options);
  const handoffBrief = buildHandoffBrief({
    exposures,
    workflowSummary,
    safeWorkflowJson,
    safeLog,
    checklist,
    checkoutUrl,
    options
  });

  return {
    metrics,
    exposures,
    workflowSummary,
    safeWorkflowJson,
    safeLog,
    checklist,
    checkoutUrl,
    handoffBrief
  };
}

function summarizeWorkflow(workflow) {
  const analysis = analyzeWorkflow(workflow);
  const nodes = normalizeNodes(workflow);
  return {
    format: analysis.format,
    nodeCount: analysis.nodeCount,
    nodeTypes: nodes.map((node) => node.type).filter(Boolean).slice(0, 12)
  };
}

function sanitizeValue(value, context) {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, {
      ...context,
      path: [...context.path, String(index)]
    }));
  }

  if (value && typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, child]) => {
      const childPath = [...context.path, key];
      if (SECRET_KEY_RE.test(key)) {
        result[key] = '[REDACTED_SECRET]';
        addExposure(context.exposures, {
          type: 'secret-field',
          severity: 'blocker',
          source: context.source,
          path: pathLabel(childPath),
          note: `Sensitive field "${key}" was removed.`
        });
        return;
      }
      result[key] = sanitizeValue(child, {
        ...context,
        keyHint: key,
        path: childPath
      });
    });
    return result;
  }

  if (typeof value === 'string') {
    return sanitizeText(value, context);
  }

  return value;
}

function sanitizeText(value, context) {
  let text = String(value);
  text = redactAuthHeaders(text, context);
  text = redactLongTokens(text, context);
  text = redactUrls(text, context);
  text = redactNamedSecrets(text, context);
  text = redactLocalPaths(text, context);
  text = redactEmails(text, context);
  text = redactPrivateHosts(text, context);
  return text;
}

function redactAuthHeaders(text, context) {
  return text.replace(AUTH_HEADER_RE, (match, scheme) => {
    addExposure(context.exposures, {
      type: 'auth-header',
      severity: 'blocker',
      source: context.source,
      path: pathLabel(context.path),
      note: `${scheme} authorization value was removed.`
    });
    return `${scheme} [REDACTED_SECRET]`;
  });
}

function redactNamedSecrets(text, context) {
  return text.replace(NAMED_SECRET_RE, (match, key) => {
    addExposure(context.exposures, {
      type: 'named-secret',
      severity: 'blocker',
      source: context.source,
      path: pathLabel(context.path),
      note: `${key} assignment was removed.`
    });
    return `${key}: [REDACTED_SECRET]`;
  });
}

function redactLongTokens(text, context) {
  return text.replace(LONG_TOKEN_RE, () => {
    addExposure(context.exposures, {
      type: 'token',
      severity: 'blocker',
      source: context.source,
      path: pathLabel(context.path),
      note: 'Provider or GitHub-style token was removed.'
    });
    return '[REDACTED_SECRET]';
  });
}

function redactUrls(text, context) {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (match) => {
    try {
      const url = new URL(match);
      let changed = false;
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.set(key, '[REDACTED_SECRET]');
          changed = true;
        }
      }
      if (changed) {
        addExposure(context.exposures, {
          type: 'url-secret',
          severity: 'blocker',
          source: context.source,
          path: pathLabel(context.path),
          note: 'Sensitive URL query parameter was removed.'
        });
      }
      return url.toString().replaceAll('%5BREDACTED_SECRET%5D', '[REDACTED_SECRET]');
    } catch {
      return match;
    }
  });
}

function redactLocalPaths(text, context) {
  const replaceWindows = text.replace(WINDOWS_PATH_RE, (match) => redactPath(match, context));
  return replaceWindows.replace(POSIX_PATH_RE, (match, path) => {
    const prefix = match.slice(0, match.length - path.length);
    return `${prefix}${redactPath(path, context)}`;
  });
}

function redactPath(path, context) {
  const basename = path.split(/[\\/]/).filter(Boolean).pop();
  const replacement = FILE_KEYS.test(String(context.keyHint || ''))
    ? `[LOCAL_PATH]/${basename || 'asset'}`
    : '[LOCAL_PATH]';
  addExposure(context.exposures, {
    type: 'local-path',
    severity: 'high',
    source: context.source,
    path: pathLabel(context.path),
    note: `Local filesystem path was replaced with ${replacement}.`
  });
  return replacement;
}

function redactEmails(text, context) {
  return text.replace(EMAIL_RE, () => {
    addExposure(context.exposures, {
      type: 'email',
      severity: 'medium',
      source: context.source,
      path: pathLabel(context.path),
      note: 'Email address was removed.'
    });
    return '[EMAIL]';
  });
}

function redactPrivateHosts(text, context) {
  return text.replace(PRIVATE_HOST_RE, (match) => {
    addExposure(context.exposures, {
      type: 'private-host',
      severity: 'medium',
      source: context.source,
      path: pathLabel(context.path),
      note: 'Local or private network endpoint was removed.'
    });
    return match.startsWith('http') ? 'http://[PRIVATE_HOST]' : '[PRIVATE_HOST]';
  });
}

function buildMetrics({ exposures, workflowSummary, safeLog }) {
  const byType = countBy(exposures, 'type');
  return [
    { label: 'Workflow nodes', value: workflowSummary?.nodeCount ?? 'not provided' },
    { label: 'Redactions', value: exposures.length },
    { label: 'Secrets removed', value: (byType['secret-field'] || 0) + (byType['auth-header'] || 0) + (byType['named-secret'] || 0) + (byType.token || 0) + (byType['url-secret'] || 0) },
    { label: 'Local paths', value: byType['local-path'] || 0 },
    { label: 'Private hosts', value: byType['private-host'] || 0 },
    { label: 'Emails removed', value: byType.email || 0 },
    { label: 'Log lines', value: safeLog ? safeLog.split(/\r?\n/).length : 'not provided' },
    { label: 'Share readiness', value: chooseReadiness(exposures) }
  ];
}

function buildChecklist({ exposures, workflowSummary, safeLog }) {
  const checklist = [
    'Attach the sanitized workflow JSON, not the original local export.',
    'Attach the sanitized log excerpt around the first failing node or hosted task id.',
    'Keep model filenames and node ids when they are not secrets; remove account paths and API keys.',
    'Verify every [REDACTED_SECRET] value can be re-entered privately on the target host.'
  ];

  if (!workflowSummary) {
    checklist.push('Add workflow JSON before asking for a fixed setup or repair quote.');
  }
  if (!safeLog) {
    checklist.push('Add the failing log or /history response before asking for runtime diagnosis.');
  }
  if (exposures.some((item) => item.type === 'private-host')) {
    checklist.push('Replace private localhost or LAN URLs with a public route only when it is intentionally shareable.');
  }
  if (exposures.some((item) => item.type === 'local-path')) {
    checklist.push('Upload required model/media assets separately or list their filenames in the repair request.');
  }

  return checklist;
}

function buildHandoffBrief({
  exposures,
  workflowSummary,
  safeWorkflowJson,
  safeLog,
  checklist,
  checkoutUrl,
  options
}) {
  const byType = countBy(exposures, 'type');
  const lines = [
    'ComfyUI safe share package',
    `Target recipient: ${normalizeOption(options.targetRecipient, 'workflow repair provider')}`,
    `Checkout URL: ${checkoutUrl}`,
    `Workflow format: ${workflowSummary?.format || 'not provided'}`,
    `Workflow nodes: ${workflowSummary?.nodeCount ?? 'not provided'}`,
    `Redactions: ${exposures.length}`,
    `Secret redactions: ${(byType['secret-field'] || 0) + (byType['auth-header'] || 0) + (byType['named-secret'] || 0) + (byType.token || 0) + (byType['url-secret'] || 0)}`,
    `Local path redactions: ${byType['local-path'] || 0}`,
    'Share checklist:',
    ...checklist.map((item) => `- ${item}`)
  ];

  if (workflowSummary?.nodeTypes.length) {
    lines.push('Detected node types:', `- ${workflowSummary.nodeTypes.join(', ')}`);
  }

  if (exposures.length) {
    lines.push(
      'Redaction findings:',
      ...exposures.slice(0, 12).map((item) => `- ${item.severity}: ${item.source}:${item.path} ${item.note}`)
    );
  }

  lines.push(
    'Sanitized workflow JSON:',
    safeWorkflowJson || 'not provided',
    'Sanitized log:',
    safeLog || 'not provided'
  );

  return lines.join('\n');
}

function chooseReadiness(exposures) {
  if (!exposures.length) return 'clean';
  if (exposures.some((item) => item.severity === 'blocker')) return 'redacted secrets';
  return 'redacted metadata';
}

function buildCheckoutUrl(options) {
  const url = new URL(CHECKOUT_BASE);
  url.searchParams.set('package', normalizeOption(options.packageName, 'workflow-setup-starter'));
  url.searchParams.set('source', normalizeOption(options.source, 'github-safe-share'));
  return url.toString();
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function addExposure(exposures, item) {
  exposures.push(item);
}

function pathLabel(path) {
  return path.length ? path.join('.') : 'root';
}

function normalizeOption(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}
