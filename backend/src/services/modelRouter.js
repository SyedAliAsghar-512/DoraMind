import { listModels, getBestModelForTask } from './ollamaService.js';

// ── Intent detection regexes ──────────────────────────────────
const CODE_RE = [
  /\b(code|function|class|debug|bug|fix|implement|algorithm|script|program|compile|refactor)\b/i,
  /\b(javascript|python|typescript|rust|golang|java|sql|html|css|react|node|api|bash|shell|cpp|c\+\+|ruby|php|swift|kotlin)\b/i,
  /\b(write (?:a |me )?(?:function|class|component|script|program|test|unit test))\b/i,
  /```[\s\S]*?```/,
  /def |const |let |var |import |from |require\(/,
];

const REASONING_RE = [
  /\b(analyze|analysis|compare|evaluate|critique|pros and cons|deep dive|explain why|reasoning)\b/i,
  /\b(strategy|architecture|design|system|research|philosophy|theory|decision)\b/i,
  /\b(step by step|walk me through|in detail|comprehensive|thorough|breakdown)\b/i,
  /\b(essay|report|thesis|argument|debate|discuss)\b/i,
];

const MATH_RE = [
  /\b(calculate|solve|equation|integral|derivative|matrix|probability|statistics)\b/i,
  /\b(math|algebra|calculus|geometry|theorem|proof)\b/i,
  /[0-9]+\s*[\+\-\*\/\^]\s*[0-9]/,
];

const VISION_RE = [
  /\b(image|photo|picture|screenshot|diagram|chart|graph)\b/i,
  /what(?:'s| is) (?:in|this|the) (?:image|photo|picture)/i,
];

const DOC_RE = [
  /\b(document|pdf|file|attachment|uploaded|this (?:doc|file|text))\b/i,
  /\b(summarize|summary|what does it say|find in|according to the)\b/i,
];

// Cache installed models for a short time to avoid listing on every message
let _cachedModels = null;
let _cacheTime    = 0;
const ROUTE_CACHE_TTL = 30_000;

async function getInstalledModels() {
  if (_cachedModels && Date.now() - _cacheTime < ROUTE_CACHE_TTL) return _cachedModels;
  _cachedModels = await listModels();
  _cacheTime    = Date.now();
  return _cachedModels;
}

/**
 * Intelligently route a message to the best available model.
 * Falls back gracefully when preferred models aren't installed.
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {boolean} [opts.hasDocuments]
 * @param {string|null} [opts.preferred] - User-specified model
 * @param {object|null} [opts.memory]    - User memory object
 * @param {boolean} [opts.hasImages]
 * @returns {Promise<{model: string, mode: string, task: string}>}
 */
export async function selectModel({ query, hasDocuments = false, preferred = null, memory = null, hasImages = false }) {
  const installed = await getInstalledModels();
  const installedNames = new Set(installed.map(m => m.name));

  // Helper: check if a model is installed (exact or base name)
  const isInstalled = (name) => {
    if (installedNames.has(name)) return true;
    const base = name.split(':')[0];
    return [...installedNames].some(n => n === base || n.startsWith(base + ':'));
  };

  const resolveInstalled = (name) => {
    if (installedNames.has(name)) return name;
    const base = name.split(':')[0];
    return [...installedNames].find(n => n === base || n.startsWith(base + ':')) || null;
  };

  // 1. Respect explicit user preference if installed
  if (preferred && isInstalled(preferred)) {
    const task = detectTask(query, hasDocuments, hasImages);
    return { model: preferred, mode: task, task };
  }

  // 2. Use memory preference if set and installed
  const memPreferred = memory?.aiPreferences?.preferredModel;
  if (memPreferred && memPreferred !== 'auto' && isInstalled(memPreferred)) {
    const task = detectTask(query, hasDocuments, hasImages);
    return { model: memPreferred, mode: task, task };
  }

  // 3. Task-based routing
  const task = detectTask(query, hasDocuments, hasImages);

  let targetModel;
  if (task === 'vision' && hasImages) {
    targetModel = await getBestModelForTask('vision', installed);
  } else if (task === 'rag' || hasDocuments) {
    // RAG: prefer reasoning models
    targetModel = await getBestModelForTask('reasoning', installed);
  } else if (task === 'code') {
    targetModel = await getBestModelForTask('code', installed);
  } else if (task === 'math') {
    targetModel = await getBestModelForTask('math', installed);
  } else if (task === 'reasoning') {
    targetModel = await getBestModelForTask('reasoning', installed);
  } else {
    // Chat — prefer user's memory default, then fast models
    const expertise = memory?.personality?.expertiseLevel;
    if (expertise === 'expert') {
      targetModel = await getBestModelForTask('reasoning', installed);
    } else {
      targetModel = await getBestModelForTask('chat', installed);
    }
  }

  // 4. Absolute fallback
  if (!targetModel || !isInstalled(targetModel)) {
    const resolved = resolveInstalled(targetModel);
    if (resolved) {
      targetModel = resolved;
    } else {
      // Pick any available non-embedding model
      const fallback = installed.find(m => !m.strength?.includes('embedding'));
      targetModel = fallback?.name || 'mistral';
    }
  }

  return { model: targetModel, mode: task, task };
}

/**
 * Detect the primary task/intent of a message.
 */
function detectTask(query, hasDocuments, hasImages) {
  if (hasImages && VISION_RE.some(r => r.test(query)))               return 'vision';
  if (hasDocuments && DOC_RE.some(r => r.test(query)))                return 'rag';
  if (CODE_RE.some(r => r.test(query)))                               return 'code';
  if (MATH_RE.some(r => r.test(query)))                               return 'math';
  if (REASONING_RE.some(r => r.test(query)))                          return 'reasoning';
  return 'chat';
}

// Legacy sync export for backward compatibility (uses hardcoded fallback)
export function selectModelSync(query, hasDocuments = false, preferred = null, memory = null) {
  const VALID = ['mistral', 'llama3', 'qwen:latest'];
  if (preferred && VALID.includes(preferred)) return { model: preferred, mode: 'chat' };

  if (hasDocuments && DOC_RE.some(r => r.test(query)))  return { model: 'llama3', mode: 'rag' };
  if (CODE_RE.some(r => r.test(query)))                 return { model: 'qwen:latest', mode: 'code' };
  if (REASONING_RE.some(r => r.test(query)))            return { model: 'llama3', mode: 'reasoning' };
  return { model: memory?.aiPreferences?.preferredModel || 'mistral', mode: 'chat' };
}