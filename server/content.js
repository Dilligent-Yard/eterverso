'use strict';

const sanitize = require('sanitize-html');

const MAX_HTML_BYTES = 500_000;
const MAX_URL_LENGTH = 2_048;
const MAX_BLOCKS = 40;
const MAX_BLOCK_ITEMS = 30;
const MAX_BLOCKS_HTML_BYTES = 500_000;
const BASE_URL = 'https://aetherverse.invalid/';

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'th', 'thead', 'tfoot', 'tr', 'u', 'ul', 'var'
];
const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);
const NON_TEXT_TAGS = [
  'script', 'style', 'textarea', 'option', 'xmp', 'svg', 'math', 'iframe',
  'object', 'embed', 'form', 'template', 'noembed', 'noframes'
];

const FONT_FAMILIES = new Map([
  ['inter', 'Inter, sans-serif'],
  ['inter, sans-serif', 'Inter, sans-serif'],
  ['lora', 'Lora, Georgia, serif'],
  ['lora, georgia, serif', 'Lora, Georgia, serif'],
  ['georgia', 'Georgia, serif'],
  ['georgia, serif', 'Georgia, serif'],
  ['jetbrains mono', 'JetBrains Mono, monospace'],
  ['jetbrains mono, monospace', 'JetBrains Mono, monospace']
]);
const FONT_SIZES = new Map([
  ['2', '0.875rem'],
  ['3', '1rem'],
  ['4', '1.25rem'],
  ['5', '1.5rem'],
  ['6', '1.75rem']
]);

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
const STYLE_RULES = {
  '*': {
    color: [HEX_COLOR],
    'background-color': [HEX_COLOR],
    'text-align': [/^(?:left|center|right|justify)$/i],
    'font-family': [/^(?:Inter(?:,\s*sans-serif)?|Lora(?:,\s*Georgia,\s*serif)?|Georgia(?:,\s*serif)?|JetBrains Mono(?:,\s*monospace)?)$/i],
    'font-size': [/^(?:0\.875rem|1rem|1\.25rem|1\.5rem|1\.75rem)$/i]
  },
  div: {
    'text-align': [/^(?:left|center|right|justify)$/i],
    'font-family': [/^(?:Inter(?:,\s*sans-serif)?|Lora(?:,\s*Georgia,\s*serif)?|Georgia(?:,\s*serif)?|JetBrains Mono(?:,\s*monospace)?)$/i],
    'font-size': [/^(?:0\.875rem|1rem|1\.25rem|1\.5rem|1\.75rem)$/i]
  },
  p: {
    'text-align': [/^(?:left|center|right|justify)$/i],
    'font-family': [/^(?:Inter(?:,\s*sans-serif)?|Lora(?:,\s*Georgia,\s*serif)?|Georgia(?:,\s*serif)?|JetBrains Mono(?:,\s*monospace)?)$/i],
    'font-size': [/^(?:0\.875rem|1rem|1.25rem|1.5rem|1.75rem)$/i]
  },
  h2: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  h3: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  h4: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  h5: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  h6: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  span: {
    'font-family': [/^(?:Inter(?:,\s*sans-serif)?|Lora(?:,\s*Georgia,\s*serif)?|Georgia(?:,\s*serif)?|JetBrains Mono(?:,\s*monospace)?)$/i],
    'font-size': [/^(?:0\.875rem|1rem|1.25rem|1.5rem|1.75rem)$/i]
  },
  td: { 'text-align': [/^(?:left|center|right|justify)$/i] },
  th: { 'text-align': [/^(?:left|center|right|justify)$/i] }
};

const ALLOWED_ATTRIBUTES = {
  '*': ['title', 'style'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span']
};

const BLOCK_SCHEMAS = {
  section: {
    keys: ['type', 'title', 'content'],
    items: null
  },
  tabs: {
    keys: ['type', 'title', 'items'],
    itemKeys: ['label', 'content']
  },
  gallery: {
    keys: ['type', 'title', 'cols', 'items'],
    itemKeys: ['url', 'caption']
  },
  cards: {
    keys: ['type', 'title', 'items'],
    itemKeys: ['title', 'badge', 'color', 'image', 'desc']
  },
  quote: {
    keys: ['type', 'title', 'text', 'author', 'avatar'],
    items: null
  },
  stats: {
    keys: ['type', 'title', 'items'],
    itemKeys: ['label', 'value', 'color']
  },
  accordion: {
    keys: ['type', 'title', 'items'],
    itemKeys: ['title', 'content']
  },
  timeline: {
    keys: ['type', 'title', 'items'],
    itemKeys: ['date', 'title', 'desc']
  },
  datalist: {
    keys: ['type', 'title', 'items'],
    // The old builder stores label/value; its renderer reads key/val. Accept
    // either complete pair and normalize to key/val for renderer compatibility.
    itemKeys: ['label', 'value', 'key', 'val']
  }
};

const BLOCK_TEXT_LIMITS = {
  title: 200,
  label: 200,
  caption: 500,
  badge: 100,
  author: 200,
  date: 120,
  value: 1_000,
  text: 10_000,
  desc: 5_000
};

class ContentValidationError extends TypeError {
  constructor(message, path) {
    super(message);
    this.name = 'ContentValidationError';
    this.code = 'INVALID_CONTENT';
    this.status = 400;
    if (path) this.path = path;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addLoss(state, kind, name) {
  const key = `${kind}:${String(name || 'unknown').toLowerCase()}`;
  if (!state.lossSet.has(key)) {
    state.lossSet.add(key);
    state.lossItems.push({ kind, name: String(name || 'unknown').toLowerCase() });
  }
}

function normalizeColor(value) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) return null;
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  return value.toLowerCase();
}

function hasBadControlOrSpace(value) {
  return /[\u0000-\u0020\u007f\\<>"'`]/.test(value);
}

function decodeUrlForInspection(value) {
  let decoded = value;
  for (let i = 0; i < 3 && decoded.includes('%'); i += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch (_error) {
      if (i === 0) return null;
      break;
    }
    if (next === decoded) break;
    if (/%(?:2f|5c)/i.test(next)) return null;
    decoded = next;
  }
  if (decoded.includes('//') && !value.includes('//')) return null;
  return decoded;
}

function decodeHtmlAttributeReferences(value) {
  if (!value.includes('&')) return value;
  let decoded = value;
  const safeAttribute = value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sanitize(`<a href="${safeAttribute}"></a>`, {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
    onOpenTag(tagName, attribs) {
      if (tagName === 'a' && typeof attribs.href === 'string') decoded = attribs.href;
    }
  });
  return decoded;
}

function normalizeAllowedImagePaths(paths) {
  if (paths === undefined) return [];
  if (!Array.isArray(paths)) {
    throw new TypeError('allowedImagePaths must be an array of exact local paths');
  }
  return paths.map((path) => {
    if (typeof path !== 'string' || !path || hasBadControlOrSpace(path) || path.startsWith('//')) {
      throw new TypeError('allowedImagePaths entries must be exact local paths');
    }
    let parsed;
    try {
      parsed = new URL(path, BASE_URL);
    } catch (_error) {
      throw new TypeError('allowedImagePaths entries must be valid local paths');
    }
    if (parsed.origin !== new URL(BASE_URL).origin || parsed.search || parsed.hash) {
      throw new TypeError('allowedImagePaths entries must be exact local paths');
    }
    return parsed.pathname;
  });
}

/**
 * Return a safe HTTP(S) URL or local same-site path, or null when rejected.
 * Images require HTTPS or an exact path in `allowedImagePaths`; other local
 * links may be root-relative, relative, query-only, or fragment-only.
 */
function sanitizeUrl(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  if (value !== value.trim() || hasBadControlOrSpace(value)) return null;
  value = decodeHtmlAttributeReferences(value);
  if (value.length === 0 || value.length > MAX_URL_LENGTH || hasBadControlOrSpace(value)) return null;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null;

  const decoded = decodeUrlForInspection(value);
  if (decoded === null || hasBadControlOrSpace(decoded)) return null;
  if (/^\/\//.test(decoded) || /^\\\\/.test(decoded)) return null;
  if (/%(?:2f|5c)/i.test(value)) return null;

  const rawScheme = /^([a-z][a-z\d+.-]*):/i.exec(value);
  const decodedScheme = /^([a-z][a-z\d+.-]*):/i.exec(decoded);
  if (decodedScheme && (!rawScheme || rawScheme[1].toLowerCase() !== decodedScheme[1].toLowerCase())) return null;

  let parsed;
  try {
    parsed = new URL(value, BASE_URL);
  } catch (_error) {
    return null;
  }
  const localOrigin = new URL(BASE_URL).origin;
  const isLocal = parsed.origin === localOrigin;
  const isAbsolute = !!rawScheme;

  if (isAbsolute) {
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (options.image && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return value;
  }

  if (!isLocal || parsed.protocol !== 'https:') return null;
  if (options.image) {
    const allowedPaths = normalizeAllowedImagePaths(options.allowedImagePaths);
    if (!allowedPaths.includes(parsed.pathname) || parsed.hash) return null;
    return `${parsed.pathname}${parsed.search}`;
  }
  return value;
}

function normalizeFontFace(value) {
  if (typeof value !== 'string') return null;
  const unquoted = value.trim().replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase();
  return FONT_FAMILIES.get(unquoted) || null;
}

function normalizeFontAttributes(_tagName, attribs) {
  const next = {};
  const styles = [];
  const face = normalizeFontFace(attribs.face);
  const size = FONT_SIZES.get(String(attribs.size || ''));
  const color = normalizeColor(attribs.color);
  if (face) styles.push(`font-family:${face}`);
  if (size) styles.push(`font-size:${size}`);
  if (color) styles.push(`color:${color}`);
  if (styles.length) next.style = styles.join(';');
  if (typeof attribs.title === 'string') next.title = attribs.title;
  return { tagName: 'span', attribs: next };
}

function safeAnchorAttributes(_tagName, attribs) {
  const next = { ...attribs };
  if (next.href === undefined || sanitizeUrl(next.href) === null) {
    delete next.href;
    delete next.target;
    delete next.rel;
  } else if (next.target !== '_blank') {
    delete next.target;
    delete next.rel;
  } else {
    next.rel = 'noopener noreferrer';
  }
  return { tagName: 'a', attribs: next };
}

function safeImageAttributes(_tagName, attribs, options) {
  const next = { ...attribs };
  if (next.src !== undefined && sanitizeUrl(next.src, {
    image: true,
    allowedImagePaths: options.allowedImagePaths
  }) === null) delete next.src;
  for (const dimension of ['width', 'height']) {
    if (next[dimension] !== undefined) {
      const numeric = Number(next[dimension]);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 4096) delete next[dimension];
      else next[dimension] = String(numeric);
    }
  }
  return { tagName: 'img', attribs: next };
}

function safeCellAttributes(tagName, attribs) {
  const next = { ...attribs };
  for (const dimension of ['colspan', 'rowspan']) {
    if (next[dimension] !== undefined) {
      const numeric = Number(next[dimension]);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 50) delete next[dimension];
      else next[dimension] = String(numeric);
    }
  }
  if (tagName === 'th' && next.scope !== undefined && !['row', 'col', 'rowgroup', 'colgroup'].includes(next.scope)) {
    delete next.scope;
  }
  return { tagName, attribs: next };
}

function safeColumnAttributes(_tagName, attribs) {
  const next = { ...attribs };
  if (next.span !== undefined) {
    const numeric = Number(next.span);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 50) delete next.span;
    else next.span = String(numeric);
  }
  return { tagName: 'col', attribs: next };
}

function checkStyleForLoss(tagName, value, state) {
  const effectiveTag = tagName === 'font' ? 'span' : tagName;
  const availableRules = { ...(STYLE_RULES['*'] || {}), ...(STYLE_RULES[effectiveTag] || {}) };
  const declarations = String(value).split(';').filter((declaration) => declaration.trim());
  if (!declarations.length) {
    addLoss(state, 'style', 'empty');
    return;
  }
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 1) {
      addLoss(state, 'style', 'invalid');
      continue;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim();
    const rules = availableRules[property];
    if (!rules || !rules.some((rule) => rule.test(styleValue))) addLoss(state, 'style', property);
  }
}

function createSanitizerOptions(options, state) {
  const allowedImagePaths = normalizeAllowedImagePaths(options.allowedImagePaths);
  const allowedAttributeNames = new Set(['title']);
  const allowedByTag = ALLOWED_ATTRIBUTES;
  const styleCapableTags = new Set(ALLOWED_TAGS);

  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: STYLE_RULES,
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: NON_TEXT_TAGS,
    enforceHtmlBoundary: true,
    nestingLimit: 64,
    transformTags: {
      font: normalizeFontAttributes,
      a: safeAnchorAttributes,
      img: (tagName, attribs) => safeImageAttributes(tagName, attribs, { ...options, allowedImagePaths }),
      td: safeCellAttributes,
      th: safeCellAttributes,
      col: safeColumnAttributes
    },
    onOpenTag(tagName, attribs) {
      const normalizedTag = String(tagName).toLowerCase();
      if (normalizedTag !== 'font' && !ALLOWED_TAG_SET.has(normalizedTag)) {
        addLoss(state, 'element', normalizedTag);
      }
      const allowed = new Set([
        ...allowedAttributeNames,
        ...(allowedByTag[normalizedTag] || [])
      ]);
      for (const name of Object.keys(attribs || {})) {
        if (name === 'style') {
          if (!styleCapableTags.has(normalizedTag)) addLoss(state, 'attribute', 'style');
          else checkStyleForLoss(normalizedTag, attribs[name], state);
        } else if (normalizedTag === 'font' && ['face', 'size', 'color'].includes(name)) {
          if (name === 'face' && !normalizeFontFace(attribs[name])) addLoss(state, 'style', 'font-family');
          if (name === 'size' && !FONT_SIZES.has(String(attribs[name]))) addLoss(state, 'style', 'font-size');
          if (name === 'color' && !normalizeColor(attribs[name])) addLoss(state, 'style', 'color');
        } else if (!allowed.has(name)) {
          addLoss(state, 'attribute', name);
        }
      }
      if (normalizedTag === 'a' && attribs.href !== undefined && sanitizeUrl(attribs.href) === null) {
        addLoss(state, 'url', 'href');
      }
      if (normalizedTag === 'img' && attribs.src !== undefined && sanitizeUrl(attribs.src, {
        image: true,
        allowedImagePaths
      }) === null) {
        addLoss(state, 'url', 'src');
      }
      for (const dimension of ['width', 'height']) {
        if (normalizedTag === 'img' && attribs[dimension] !== undefined) {
          const numeric = Number(attribs[dimension]);
          if (!Number.isInteger(numeric) || numeric < 1 || numeric > 4096) addLoss(state, 'attribute', dimension);
        }
      }
      for (const dimension of ['colspan', 'rowspan']) {
        if (['td', 'th'].includes(normalizedTag) && attribs[dimension] !== undefined) {
          const numeric = Number(attribs[dimension]);
          if (!Number.isInteger(numeric) || numeric < 1 || numeric > 50) addLoss(state, 'attribute', dimension);
        }
      }
      if (normalizedTag === 'th' && attribs.scope !== undefined && !['row', 'col', 'rowgroup', 'colgroup'].includes(attribs.scope)) {
        addLoss(state, 'attribute', 'scope');
      }
      if (normalizedTag === 'col' && attribs.span !== undefined) {
        const numeric = Number(attribs.span);
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > 50) addLoss(state, 'attribute', 'span');
      }
    }
  };
}

function validateSanitizeOptions(options) {
  if (options === undefined) return {};
  if (!isPlainObject(options)) throw new TypeError('sanitize options must be an object');
  const supported = new Set(['maxBytes', 'allowedImagePaths', 'onFormattingLoss']);
  for (const key of Object.keys(options)) {
    if (!supported.has(key)) throw new TypeError(`unknown sanitize option: ${key}`);
  }
  if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 5_000_000)) {
    throw new TypeError('maxBytes must be a positive safe integer no greater than 5000000');
  }
  if (options.onFormattingLoss !== undefined && typeof options.onFormattingLoss !== 'function') {
    throw new TypeError('onFormattingLoss must be a function');
  }
  normalizeAllowedImagePaths(options.allowedImagePaths);
  return options;
}

function sanitizeHtmlWithReport(input, options) {
  const validatedOptions = validateSanitizeOptions(options);
  if (input === null || input === undefined) input = '';
  if (typeof input !== 'string') throw new ContentValidationError('HTML content must be a string');
  const maxBytes = validatedOptions.maxBytes || MAX_HTML_BYTES;
  if (Buffer.byteLength(input, 'utf8') > maxBytes) {
    throw new ContentValidationError('HTML content exceeds the allowed size');
  }

  const state = { lossSet: new Set(), lossItems: [] };
  const sanitizerOptions = createSanitizerOptions(validatedOptions, state);
  const html = sanitize(input, sanitizerOptions);
  const formattingLoss = {
    discarded: state.lossItems.length > 0,
    items: state.lossItems
  };
  if (formattingLoss.discarded && validatedOptions.onFormattingLoss) {
    validatedOptions.onFormattingLoss(formattingLoss);
  }
  return { html, formattingLoss };
}

/**
 * Serialize safe rich text. Unsupported markup and attributes are discarded.
 * Use `sanitizeHtmlWithReport` or `onFormattingLoss` to surface legacy loss.
 * Options: maxBytes, allowedImagePaths (exact local paths), onFormattingLoss.
 */
function sanitizeHtml(input, options) {
  return sanitizeHtmlWithReport(input, options).html;
}

function assertOnlyKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ContentValidationError(`Unknown field at ${path}`, path);
  }
}

function requireBlockObject(value, path) {
  if (!isPlainObject(value)) throw new ContentValidationError(`Expected an object at ${path}`, path);
}

function requireText(value, path, maxLength, options = {}) {
  if (typeof value !== 'string') throw new ContentValidationError(`Expected text at ${path}`, path);
  if (value.length > maxLength) throw new ContentValidationError(`Text exceeds the allowed length at ${path}`, path);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new ContentValidationError(`Control character is not allowed at ${path}`, path);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new ContentValidationError(`Text is required at ${path}`, path);
  }
  return value;
}

function optionalText(source, key, path, maxLength, output = source) {
  if (source[key] !== undefined) {
    output[key] = requireText(source[key], `${path}.${key}`, maxLength, { allowEmpty: true });
  }
}

function sanitizeBlockHtml(value, path, options, byteCounter) {
  const html = requireText(value, path, MAX_BLOCKS_HTML_BYTES, { allowEmpty: true });
  byteCounter.bytes += Buffer.byteLength(html, 'utf8');
  if (byteCounter.bytes > MAX_BLOCKS_HTML_BYTES) {
    throw new ContentValidationError('Combined block HTML exceeds the allowed size', path);
  }
  const onFormattingLoss = options.onFormattingLoss
    ? (report) => options.onFormattingLoss({ ...report, path })
    : undefined;
  return sanitizeHtml(html, {
    maxBytes: options.maxBytes === undefined ? MAX_HTML_BYTES : Math.min(options.maxBytes, MAX_HTML_BYTES),
    allowedImagePaths: options.allowedImagePaths,
    onFormattingLoss
  });
}

function requireItems(block, path) {
  if (!Array.isArray(block.items)) throw new ContentValidationError(`Expected an item list at ${path}.items`, `${path}.items`);
  if (block.items.length > MAX_BLOCK_ITEMS) {
    throw new ContentValidationError(`A block may contain at most ${MAX_BLOCK_ITEMS} items`, `${path}.items`);
  }
  for (let index = 0; index < block.items.length; index += 1) {
    requireBlockObject(block.items[index], `${path}.items[${index}]`);
  }
  return block.items;
}

function sanitizeBlock(block, index, options, byteCounter) {
  const path = `blocks[${index}]`;
  requireBlockObject(block, path);
  if (typeof block.type !== 'string' || !Object.prototype.hasOwnProperty.call(BLOCK_SCHEMAS, block.type)) {
    throw new ContentValidationError(`Unknown block type at ${path}`, `${path}.type`);
  }
  const schema = BLOCK_SCHEMAS[block.type];
  assertOnlyKeys(block, schema.keys, path);
  const out = { type: block.type };
  optionalText(block, 'title', path, BLOCK_TEXT_LIMITS.title, out);

  if (block.type === 'section') {
    if (block.content !== undefined) {
      out.content = sanitizeBlockHtml(block.content, `${path}.content`, options, byteCounter);
    }
    return out;
  }

  if (block.type === 'quote') {
    optionalText(block, 'text', path, BLOCK_TEXT_LIMITS.text, out);
    optionalText(block, 'author', path, BLOCK_TEXT_LIMITS.author, out);
    if (block.avatar !== undefined) {
      out.avatar = requireText(block.avatar, `${path}.avatar`, MAX_URL_LENGTH, { allowEmpty: true });
      if (out.avatar) {
        const safeUrl = sanitizeUrl(out.avatar, { image: true, allowedImagePaths: options.allowedImagePaths });
        if (!safeUrl) throw new ContentValidationError(`Invalid image URL at ${path}.avatar`, `${path}.avatar`);
        out.avatar = safeUrl;
      }
    }
    return out;
  }

  if (block.type === 'gallery') {
    const cols = block.cols === undefined ? '2' : block.cols;
    if (![1, 2, 3, '1', '2', '3'].includes(cols)) {
      throw new ContentValidationError(`Gallery columns must be 1, 2 or 3 at ${path}.cols`, `${path}.cols`);
    }
    out.cols = String(cols);
  }

  const items = requireItems(block, path);
  out.items = items.map((item, itemIndex) => {
    const itemPath = `${path}.items[${itemIndex}]`;
    assertOnlyKeys(item, schema.itemKeys, itemPath);
    const result = {};
    if (block.type === 'tabs') {
      optionalText(item, 'label', itemPath, BLOCK_TEXT_LIMITS.label, result);
      if (item.content !== undefined) result.content = sanitizeBlockHtml(item.content, `${itemPath}.content`, options, byteCounter);
    } else if (block.type === 'gallery') {
      const url = requireText(item.url, `${itemPath}.url`, MAX_URL_LENGTH);
      const safeUrl = sanitizeUrl(url, { image: true, allowedImagePaths: options.allowedImagePaths });
      if (!safeUrl) throw new ContentValidationError(`Invalid image URL at ${itemPath}.url`, `${itemPath}.url`);
      result.url = safeUrl;
      optionalText(item, 'caption', itemPath, BLOCK_TEXT_LIMITS.caption, result);
    } else if (block.type === 'cards') {
      optionalText(item, 'title', itemPath, BLOCK_TEXT_LIMITS.title, result);
      optionalText(item, 'badge', itemPath, BLOCK_TEXT_LIMITS.badge, result);
      if (item.color !== undefined && item.color !== '') {
        const color = normalizeColor(item.color);
        if (!color) throw new ContentValidationError(`Invalid color at ${itemPath}.color`, `${itemPath}.color`);
        result.color = color;
      } else if (item.color !== undefined) {
        result.color = '';
      }
      if (item.image !== undefined) {
        const image = requireText(item.image, `${itemPath}.image`, MAX_URL_LENGTH, { allowEmpty: true });
        if (image) {
          const safeUrl = sanitizeUrl(image, { image: true, allowedImagePaths: options.allowedImagePaths });
          if (!safeUrl) throw new ContentValidationError(`Invalid image URL at ${itemPath}.image`, `${itemPath}.image`);
          result.image = safeUrl;
        } else {
          result.image = '';
        }
      }
      optionalText(item, 'desc', itemPath, BLOCK_TEXT_LIMITS.desc, result);
    } else if (block.type === 'stats') {
      optionalText(item, 'label', itemPath, BLOCK_TEXT_LIMITS.label, result);
      if (item.value !== undefined) {
        if (typeof item.value !== 'number' || !Number.isFinite(item.value) || !Number.isInteger(item.value) || item.value < 0 || item.value > 100) {
          throw new ContentValidationError(`Stats value must be an integer from 0 to 100 at ${itemPath}.value`, `${itemPath}.value`);
        }
        result.value = item.value;
      }
      if (item.color !== undefined && item.color !== '') {
        const color = normalizeColor(item.color);
        if (!color) throw new ContentValidationError(`Invalid color at ${itemPath}.color`, `${itemPath}.color`);
        result.color = color;
      } else if (item.color !== undefined) {
        result.color = '';
      }
    } else if (block.type === 'accordion') {
      optionalText(item, 'title', itemPath, BLOCK_TEXT_LIMITS.title, result);
      if (item.content !== undefined) result.content = sanitizeBlockHtml(item.content, `${itemPath}.content`, options, byteCounter);
    } else if (block.type === 'timeline') {
      optionalText(item, 'date', itemPath, BLOCK_TEXT_LIMITS.date, result);
      optionalText(item, 'title', itemPath, BLOCK_TEXT_LIMITS.title, result);
      optionalText(item, 'desc', itemPath, BLOCK_TEXT_LIMITS.desc, result);
    } else if (block.type === 'datalist') {
      const keys = Object.keys(item);
      const editorShape = keys.length === 2 && keys.includes('label') && keys.includes('value');
      const rendererShape = keys.length === 2 && keys.includes('key') && keys.includes('val');
      if (!editorShape && !rendererShape) {
        throw new ContentValidationError(`Expected label/value or key/val at ${itemPath}`, itemPath);
      }
      const key = editorShape ? item.label : item.key;
      const val = editorShape ? item.value : item.val;
      result.key = requireText(key, `${itemPath}.key`, BLOCK_TEXT_LIMITS.label, { allowEmpty: true });
      result.val = requireText(val, `${itemPath}.val`, BLOCK_TEXT_LIMITS.value, { allowEmpty: true });
    }
    return result;
  });

  return out;
}

/**
 * Validate and normalize the nine existing flat builder blocks. No nested
 * blocks are accepted. HTML fields are sanitized and URL/color fields checked.
 */
function sanitizeBlocks(blocks, options = {}) {
  const validatedOptions = validateSanitizeOptions(options);
  if (!Array.isArray(blocks)) throw new ContentValidationError('Blocks must be an array', 'blocks');
  if (blocks.length > MAX_BLOCKS) throw new ContentValidationError(`A page may contain at most ${MAX_BLOCKS} blocks`, 'blocks');
  const byteCounter = { bytes: 0 };
  return blocks.map((block, index) => sanitizeBlock(block, index, validatedOptions, byteCounter));
}

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â',
  atilde: 'ã', Atilde: 'Ã', auml: 'ä', Auml: 'Ä', eacute: 'é', Eacute: 'É',
  ecirc: 'ê', Ecirc: 'Ê', egrave: 'è', Egrave: 'È', iacute: 'í', Iacute: 'Í',
  oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ',
  uacute: 'ú', Uacute: 'Ú', ccedil: 'ç', Ccedil: 'Ç', ordm: 'º', ordf: 'ª'
};

function decodeTextEntities(value) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, token) => {
    if (token[0] === '#') {
      const isHex = token[1] === 'x' || token[1] === 'X';
      const codePoint = Number.parseInt(token.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(codePoint);
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, token) ? ENTITY_MAP[token] : entity;
  });
}

function plainTextFromAcceptedHtml(accepted, options) {
  const chunks = [];
  const blockTags = new Set([
    'address', 'article', 'blockquote', 'caption', 'dd', 'div', 'dl', 'dt',
    'figcaption', 'figure', 'footer', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
    'hr', 'li', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'tfoot',
    'thead', 'tr', 'ul'
  ]);
  const htmlParseOptions = createSanitizerOptions(validateSanitizeOptions(options), { lossSet: new Set(), lossItems: [] });
  htmlParseOptions.textFilter = (text) => {
    chunks.push(decodeTextEntities(text));
    return text;
  };
  htmlParseOptions.onOpenTag = (tagName, attribs) => {
    const tag = tagName.toLowerCase();
    if (tag === 'br' || tag === 'hr' || blockTags.has(tag)) chunks.push('\n');
    if (tag === 'td' || tag === 'th') chunks.push('\t');
    if (tag === 'img' && typeof attribs.alt === 'string' && attribs.alt) chunks.push(`${attribs.alt} `);
  };
  htmlParseOptions.onCloseTag = (tagName) => {
    const tag = tagName.toLowerCase();
    if (tag === 'br' || tag === 'hr' || blockTags.has(tag)) chunks.push('\n');
    if (tag === 'td' || tag === 'th') chunks.push('\t');
  };
  sanitize(accepted, htmlParseOptions);
  return chunks.join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse sanitized HTML and return readable text with block boundaries. */
function plainTextFromHtml(html, options = {}) {
  const accepted = sanitizeHtml(html, options);
  return plainTextFromAcceptedHtml(accepted, validateSanitizeOptions(options));
}

/** Return unique safe local hrefs from the sanitized rich text. */
function extractInternalLinks(html, options = {}) {
  const accepted = sanitizeHtml(html, options);
  const links = [];
  const seen = new Set();
  const parserOptions = createSanitizerOptions(validateSanitizeOptions(options), { lossSet: new Set(), lossItems: [] });
  parserOptions.onOpenTag = (tagName, attribs) => {
    if (tagName.toLowerCase() !== 'a' || typeof attribs.href !== 'string') return;
    const href = sanitizeUrl(attribs.href);
    if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return;
    if (!seen.has(href)) {
      seen.add(href);
      links.push(href);
    }
  };
  sanitize(accepted, parserOptions);
  return links;
}

/** True when sanitized text or an allowed image has meaningful content. */
function hasMeaningfulContent(html, options = {}) {
  const accepted = sanitizeHtml(html, options);
  const validatedOptions = validateSanitizeOptions(options);
  if (/[^\s\u200b-\u200f\ufeff]/u.test(plainTextFromAcceptedHtml(accepted, validatedOptions))) return true;
  let hasImage = false;
  const parserOptions = createSanitizerOptions(validatedOptions, { lossSet: new Set(), lossItems: [] });
  parserOptions.onOpenTag = (tagName, attribs) => {
    if (tagName.toLowerCase() === 'img' && typeof attribs.src === 'string' && sanitizeUrl(attribs.src, {
      image: true,
      allowedImagePaths: options.allowedImagePaths
    })) hasImage = true;
  };
  sanitize(accepted, parserOptions);
  return hasImage;
}

module.exports = {
  ContentValidationError,
  extractInternalLinks,
  hasMeaningfulContent,
  plainTextFromHtml,
  sanitizeBlocks,
  sanitizeHtml,
  sanitizeHtmlWithReport,
  sanitizeUrl
};
