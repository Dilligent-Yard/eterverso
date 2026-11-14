'use strict';

const sanitize = require('sanitize-html');
const fengari = require('fengari');
const { sanitizeUrl } = require('./content');

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

const MAX_WIKITEXT_BYTES = 250_000;
const MAX_CSS_BYTES = 100_000;
const MAX_EXPANDED_BYTES = 350_000;
const MAX_TEMPLATE_DEPTH = 15;
const MAX_LUA_INSTRUCTIONS = 200_000;
const MAX_LUA_INVOCATIONS = 50;
const MAX_LUA_REQUIRE_DEPTH = 10;

const RESOURCE_PREFIX_RE = /^(?:predefini[çc][aã]o|template|m[óo]dulo|module|estilo|style|templatestyles|mediawiki)\s*:\s*/i;

const WIKITEXT_ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li',
  'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul', 'var',
];

const WIKITEXT_NON_TEXT_TAGS = [
  'script', 'style', 'textarea', 'option', 'xmp', 'svg', 'math', 'iframe',
  'object', 'embed', 'form', 'template', 'noembed', 'noframes',
];

const ALLOWED_CSS_PROPERTIES = new Set([
  'accent-color', 'align-content', 'align-items', 'align-self',
  'animation', 'animation-delay', 'animation-direction', 'animation-duration',
  'animation-fill-mode', 'animation-iteration-count', 'animation-name', 'animation-timing-function',
  'aspect-ratio', 'backdrop-filter', 'background', 'background-clip',
  'background-color', 'background-image', 'background-position', 'background-repeat', 'background-size',
  'border', 'border-bottom', 'border-bottom-color', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'border-bottom-style', 'border-bottom-width', 'border-collapse', 'border-color',
  'border-left', 'border-left-color', 'border-left-style', 'border-left-width',
  'border-radius', 'border-right', 'border-right-color', 'border-right-style', 'border-right-width',
  'border-spacing', 'border-style', 'border-top', 'border-top-color', 'border-top-left-radius',
  'border-top-right-radius', 'border-top-style', 'border-top-width', 'border-width',
  'bottom', 'box-shadow', 'box-sizing', 'caption-side', 'clear', 'clip-path', 'color',
  'column-gap', 'columns', 'content', 'display', 'empty-cells', 'filter',
  'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap',
  'float', 'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
  'gap', 'grid', 'grid-area', 'grid-auto-columns', 'grid-auto-flow', 'grid-auto-rows',
  'grid-column', 'grid-column-end', 'grid-column-gap', 'grid-column-start',
  'grid-row', 'grid-row-end', 'grid-row-gap', 'grid-row-start',
  'grid-template', 'grid-template-areas', 'grid-template-columns', 'grid-template-rows',
  'height', 'justify-content', 'justify-items', 'justify-self',
  'left', 'letter-spacing', 'line-height', 'list-style', 'list-style-position', 'list-style-type',
  'margin', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top',
  'max-height', 'max-width', 'min-height', 'min-width', 'mix-blend-mode',
  'object-fit', 'object-position', 'opacity', 'order', 'outline', 'outline-color', 'outline-offset',
  'outline-style', 'outline-width', 'overflow', 'overflow-wrap', 'overflow-x', 'overflow-y',
  'padding', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top',
  'place-content', 'place-items', 'place-self', 'position', 'right', 'row-gap',
  'table-layout', 'text-align', 'text-decoration', 'text-decoration-color', 'text-decoration-line',
  'text-indent', 'text-overflow', 'text-shadow', 'text-transform', 'top',
  'transform', 'transform-origin', 'transition', 'transition-delay', 'transition-duration',
  'transition-property', 'transition-timing-function', 'vertical-align', 'visibility',
  'white-space', 'width', 'word-break', 'word-spacing', 'writing-mode', 'z-index',
]);

const UNSAFE_CSS_VALUE_RE = /(?:expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|-moz-binding|behavior\s*:|progid\s*:|@import)/i;
const SAFE_CUSTOM_PROP_RE = /^--[a-zA-Z0-9_-]{1,64}$/;
const SAFE_CLASS_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;

function normalizeResourceKey(rawName) {
  const stripped = String(rawName || '')
    .trim()
    .replace(RESOURCE_PREFIX_RE, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.toLocaleLowerCase('pt-BR');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addDiagnostic(diagnostics, level, source, message) {
  if (!Array.isArray(diagnostics) || diagnostics.length >= 40) return;
  diagnostics.push({
    level: level === 'error' ? 'error' : 'warning',
    source: String(source || 'mediawiki'),
    message: String(message || ''),
  });
}

// ---------- CSS Sanitizer & Scoper ----------

function validateCssValue(prop, rawValue, diagnostics, sourceLabel) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  if (/[<>\\{}]/.test(value)) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, `Valor CSS rejeitado em "${prop}" por conter caracteres não permitidos.`);
    return null;
  }
  if (UNSAFE_CSS_VALUE_RE.test(value)) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, `Valor CSS bloqueado por segurança em "${prop}".`);
    return null;
  }
  if (prop === 'position' && !/^(?:static|relative|absolute|sticky)$/i.test(value)) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, `Valor "${value}" não permitido para "position" (apenas static/relative/absolute/sticky).`);
    return null;
  }
  if (/url\s*\(/i.test(value)) {
    let valid = true;
    const rewritten = value.replace(/url\s*\(\s*([^)]*?)\s*\)/gi, (_full, inner) => {
      const cleaned = inner.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
      const safe = sanitizeUrl(cleaned, { image: true });
      if (!safe) {
        valid = false;
        return '';
      }
      return `url("${safe}")`;
    });
    if (!valid) {
      addDiagnostic(diagnostics, 'warning', sourceLabel, `URL em "${prop}" rejeitada (use apenas HTTPS ou caminho de mídia permitido).`);
      return null;
    }
    return rewritten;
  }
  return value;
}

function sanitizeDeclarations(body, diagnostics, sourceLabel) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  const safeDecls = [];
  for (const decl of parts) {
    const colon = decl.indexOf(':');
    if (colon < 1) continue;
    const rawProp = decl.slice(0, colon).trim();
    const prop = rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase();
    const rawVal = decl.slice(colon + 1).trim();
    const isCustomProp = SAFE_CUSTOM_PROP_RE.test(prop);
    if (!isCustomProp && !ALLOWED_CSS_PROPERTIES.has(prop)) {
      addDiagnostic(diagnostics, 'warning', sourceLabel, `Propriedade CSS não suportada ignorada: "${prop}".`);
      continue;
    }
    const safeVal = validateCssValue(prop, rawVal, diagnostics, sourceLabel);
    if (safeVal !== null) safeDecls.push(`${prop}:${safeVal}`);
  }
  return safeDecls.join(';');
}

function splitTopLevelSelectors(selectorText) {
  const selectors = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote = '';
  for (let i = 0; i < selectorText.length; i += 1) {
    const ch = selectorText[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function scopeSelectorList(selectorText, scopeSelector, diagnostics, sourceLabel) {
  if (/[<>\\{};]/.test(selectorText)) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, 'Seletor CSS ignorado por conter caracteres não permitidos.');
    return null;
  }
  const list = splitTopLevelSelectors(selectorText);
  if (!list.length) return null;
  const scoped = [];
  for (const rawSel of list) {
    const sel = rawSel.replace(/\s+/g, ' ').trim();
    if (!sel) continue;
    if (/^(?:html|body|:root)$/i.test(sel)) {
      scoped.push(scopeSelector);
    } else if (/^\.char-mw-scope\b/.test(sel)) {
      scoped.push(sel.replace(/^\.char-mw-scope\b/, scopeSelector));
    } else if (/^(?:html|body|:root)\s+/i.test(sel)) {
      scoped.push(sel.replace(/^(?:html|body|:root)\s+/i, `${scopeSelector} `));
    } else {
      scoped.push(`${scopeSelector} ${sel}`);
    }
  }
  return scoped.length ? scoped.join(', ') : null;
}

function parseCssBlocks(input, scopeSelector, diagnostics, sourceLabel, depth = 0) {
  if (depth > 3) return '';
  const out = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /[\s;]/.test(input[i])) i += 1;
    if (i >= len) break;

    const braceIdx = input.indexOf('{', i);
    const semiIdx = input.indexOf(';', i);
    if (braceIdx === -1) break;
    if (semiIdx !== -1 && semiIdx < braceIdx) {
      const stmt = input.slice(i, semiIdx).trim();
      if (stmt.startsWith('@')) {
        addDiagnostic(diagnostics, 'warning', sourceLabel, `Regra CSS "${stmt.split(/\s+/)[0]}" ignorada por segurança.`);
      }
      i = semiIdx + 1;
      continue;
    }

    const header = input.slice(i, braceIdx).trim();
    let braceDepth = 1;
    let cursor = braceIdx + 1;
    let quote = '';
    while (cursor < len && braceDepth > 0) {
      const ch = input[cursor];
      if (quote) {
        if (ch === quote && input[cursor - 1] !== '\\') quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '{') {
        braceDepth += 1;
      } else if (ch === '}') {
        braceDepth -= 1;
      }
      cursor += 1;
    }
    if (braceDepth !== 0) {
      addDiagnostic(diagnostics, 'warning', sourceLabel, 'Bloco CSS sem fechamento "}" foi ignorado.');
      break;
    }

    const body = input.slice(braceIdx + 1, cursor - 1);
    i = cursor;

    if (header.startsWith('@')) {
      const lowerHeader = header.toLowerCase();
      if (lowerHeader.startsWith('@media')) {
        const cond = header.slice(6).trim();
        if (!cond || /[<>\\;{}]|url\s*\(/i.test(cond)) {
          addDiagnostic(diagnostics, 'warning', sourceLabel, 'Regra @media inválida ignorada.');
          continue;
        }
        const inner = parseCssBlocks(body, scopeSelector, diagnostics, sourceLabel, depth + 1);
        if (inner) out.push(`@media ${cond} {\n${inner}\n}`);
      } else if (lowerHeader.startsWith('@keyframes') || lowerHeader.startsWith('@-webkit-keyframes')) {
        const nameMatch = /^@(?:-webkit-)?keyframes\s+([a-zA-Z_-][a-zA-Z0-9_-]*)$/.exec(header);
        if (!nameMatch) {
          addDiagnostic(diagnostics, 'warning', sourceLabel, 'Nome de @keyframes inválido ignorado.');
          continue;
        }
        const frames = [];
        let fIdx = 0;
        while (fIdx < body.length) {
          const fb = body.indexOf('{', fIdx);
          if (fb === -1) break;
          const fe = body.indexOf('}', fb + 1);
          if (fe === -1) break;
          const stopSel = body.slice(fIdx, fb).trim();
          const stopBody = body.slice(fb + 1, fe);
          fIdx = fe + 1;
          if (/^(?:from|to|\d{1,3}%)(?:\s*,\s*(?:from|to|\d{1,3}%))*$/i.test(stopSel)) {
            const decls = sanitizeDeclarations(stopBody, diagnostics, sourceLabel);
            if (decls) frames.push(`${stopSel} { ${decls} }`);
          }
        }
        if (frames.length) out.push(`@keyframes ${nameMatch[1]} { ${frames.join(' ')} }`);
      } else {
        addDiagnostic(diagnostics, 'warning', sourceLabel, `Diretiva CSS "${header.split(/\s+/)[0]}" bloqueada por segurança.`);
      }
      continue;
    }

    const scopedSel = scopeSelectorList(header, scopeSelector, diagnostics, sourceLabel);
    if (!scopedSel) continue;
    const decls = sanitizeDeclarations(body, diagnostics, sourceLabel);
    if (decls) out.push(`${scopedSel} { ${decls}; }`);
  }

  return out.join('\n');
}

function sanitizeScopedCss(cssText, scopeSelector = '.char-mw-scope', options = {}) {
  const diagnostics = options.diagnostics || [];
  const sourceLabel = options.sourceLabel || 'css';
  if (typeof cssText !== 'string' || !cssText.trim()) return '';
  if (Buffer.byteLength(cssText, 'utf8') > MAX_CSS_BYTES) {
    addDiagnostic(diagnostics, 'error', sourceLabel, `O CSS excede o limite de ${MAX_CSS_BYTES} bytes.`);
    return '';
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cssText)) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, 'Caracteres de controle removidos do CSS.');
    cssText = cssText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  }
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  if (withoutComments.includes('\\')) {
    addDiagnostic(diagnostics, 'warning', sourceLabel, 'Sequências de escape "\\" no CSS não são permitidas.');
  }
  return parseCssBlocks(withoutComments, scopeSelector, diagnostics, sourceLabel, 0);
}

// ---------- Safe Expression Evaluator (#expr / #ifexpr) ----------

function evaluateMathExpr(rawExpr) {
  const tokens = [];
  const src = String(rawExpr || '').trim();
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i += 1; continue; }
    if (/\d/.test(src[i]) || (src[i] === '.' && /\d/.test(src[i + 1] || ''))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i));
      tokens.push({ type: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(src[i])) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
      tokens.push({ type: 'id', value: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '<>', '=='].includes(two)) {
      tokens.push({ type: 'op', value: two === '<>' ? '!=' : (two === '==' ? '=' : two) });
      i += 2;
      continue;
    }
    if ('+-*/%^()<>='.includes(src[i])) {
      tokens.push({ type: 'op', value: src[i] });
      i += 1;
      continue;
    }
    if (src[i] === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i += 1;
      continue;
    }
    throw new Error(`Token inválido na expressão: "${src[i]}"`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => { const t = tokens[pos]; pos += 1; return t; };

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'id' && peek().value === 'or') {
      consume();
      const right = parseAnd();
      left = (left !== 0 || right !== 0) ? 1 : 0;
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (peek() && peek().type === 'id' && peek().value === 'and') {
      consume();
      const right = parseNot();
      left = (left !== 0 && right !== 0) ? 1 : 0;
    }
    return left;
  }

  function parseNot() {
    if (peek() && peek().type === 'id' && peek().value === 'not') {
      consume();
      return parseNot() === 0 ? 1 : 0;
    }
    return parseComparison();
  }

  function parseComparison() {
    let left = parseAddSub();
    while (peek() && peek().type === 'op' && ['<', '>', '<=', '>=', '=', '!='].includes(peek().value)) {
      const op = consume().value;
      const right = parseAddSub();
      if (op === '<') left = left < right ? 1 : 0;
      else if (op === '>') left = left > right ? 1 : 0;
      else if (op === '<=') left = left <= right ? 1 : 0;
      else if (op === '>=') left = left >= right ? 1 : 0;
      else if (op === '=') left = left === right ? 1 : 0;
      else left = left !== right ? 1 : 0;
    }
    return left;
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (peek() && peek().type === 'op' && ['+', '-'].includes(peek().value)) {
      const op = consume().value;
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv() {
    let left = parsePow();
    while (peek() && ((peek().type === 'op' && ['*', '/', '%'].includes(peek().value)) || (peek().type === 'id' && (peek().value === 'mod' || peek().value === 'div')))) {
      const op = consume().value;
      const right = parsePow();
      if (op === '*') left *= right;
      else if (op === '/' || op === 'div') {
        if (right === 0) throw new Error('Divisão por zero');
        left /= right;
      } else {
        if (right === 0) throw new Error('Módulo por zero');
        left %= right;
      }
    }
    return left;
  }

  function parsePow() {
    const base = parseUnary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      consume();
      const exp = parsePow();
      return base ** exp;
    }
    return base;
  }

  function parseUnary() {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() && peek().type === 'op' && peek().value === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Expressão incompleta');
    if (t.type === 'num') {
      consume();
      return t.value;
    }
    if (t.type === 'id') {
      consume();
      if (t.value === 'pi') return Math.PI;
      if (t.value === 'e') return Math.E;
      if (!peek() || peek().value !== '(') throw new Error(`Identificador desconhecido: ${t.value}`);
      consume(); // '('
      const args = [];
      if (!peek() || peek().value !== ')') {
        args.push(parseOr());
        while (peek() && peek().type === 'comma') {
          consume();
          args.push(parseOr());
        }
      }
      if (!peek() || peek().value !== ')') throw new Error('Parêntese não fechado');
      consume(); // ')'
      if (t.value === 'round') return args.length > 1 ? Number(args[0].toFixed(Math.max(0, Math.min(10, args[1])))) : Math.round(args[0] ?? 0);
      if (t.value === 'floor') return Math.floor(args[0] ?? 0);
      if (t.value === 'ceil') return Math.ceil(args[0] ?? 0);
      if (t.value === 'abs') return Math.abs(args[0] ?? 0);
      if (t.value === 'min') return Math.min(...args);
      if (t.value === 'max') return Math.max(...args);
      throw new Error(`Função não suportada: ${t.value}`);
    }
    if (t.type === 'op' && t.value === '(') {
      consume();
      const val = parseOr();
      if (!peek() || peek().value !== ')') throw new Error('Parêntese não fechado');
      consume();
      return val;
    }
    throw new Error('Expressão matemática inválida');
  }

  if (!tokens.length) return 0;
  const result = parseOr();
  if (pos !== tokens.length || !Number.isFinite(result)) throw new Error('Expressão inválida');
  return result;
}

// ---------- Sandboxed Lua VM (Fengari) ----------

const MW_HTML_LUA_PRELUDE = `
mw = mw or {}
mw.html = {}
local HtmlBuilder = {}
HtmlBuilder.__index = HtmlBuilder

local function escapeAttr(val)
  local s = tostring(val or '')
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;')
  return s
end

function mw.html.create(tagName, args)
  local obj = {
    _tag = (tagName and tagName ~= '') and tostring(tagName) or nil,
    _attrs = {},
    _attrOrder = {},
    _classes = {},
    _styles = {},
    _children = {},
    _parent = (args and args.parent) or nil,
    _selfClosing = false
  }
  setmetatable(obj, HtmlBuilder)
  return obj
end

function HtmlBuilder:tag(tagName, args)
  local child = mw.html.create(tagName, { parent = self })
  table.insert(self._children, child)
  return child
end

function HtmlBuilder:done()
  return self._parent or self
end

function HtmlBuilder:allDone()
  local cur = self
  while cur._parent do cur = cur._parent end
  return cur
end

function HtmlBuilder:attr(name, val)
  if type(name) == 'table' then
    for k, v in pairs(name) do self:attr(k, v) end
    return self
  end
  local k = tostring(name)
  if val == nil then
    self._attrs[k] = nil
  else
    if self._attrs[k] == nil then table.insert(self._attrOrder, k) end
    self._attrs[k] = tostring(val)
  end
  return self
end

function HtmlBuilder:addClass(className)
  if className and className ~= '' then
    table.insert(self._classes, tostring(className))
  end
  return self
end

function HtmlBuilder:css(name, val)
  if type(name) == 'table' then
    for k, v in pairs(name) do self:css(k, v) end
    return self
  end
  if name and val ~= nil then
    table.insert(self._styles, tostring(name) .. ':' .. tostring(val))
  end
  return self
end

function HtmlBuilder:cssText(css)
  if css and css ~= '' then
    table.insert(self._styles, tostring(css))
  end
  return self
end

function HtmlBuilder:wikitext(...)
  local n = select('#', ...)
  for i = 1, n do
    local v = select(i, ...)
    if v ~= nil then table.insert(self._children, tostring(v)) end
  end
  return self
end

function HtmlBuilder:node(builder)
  if builder ~= nil then table.insert(self._children, builder) end
  return self
end

function HtmlBuilder:newline()
  table.insert(self._children, '\\n')
  return self
end

local VOID_TAGS = { br = true, hr = true, img = true, col = true }

function HtmlBuilder:__tostring()
  local parts = {}
  if self._tag then
    table.insert(parts, '<' .. self._tag)
    if #self._classes > 0 then
      local existing = self._attrs['class']
      local combined = table.concat(self._classes, ' ')
      if existing and existing ~= '' then combined = existing .. ' ' .. combined end
      table.insert(parts, ' class="' .. escapeAttr(combined) .. '"')
    elseif self._attrs['class'] then
      table.insert(parts, ' class="' .. escapeAttr(self._attrs['class']) .. '"')
    end
    if #self._styles > 0 then
      local existing = self._attrs['style']
      local combined = table.concat(self._styles, ';')
      if existing and existing ~= '' then combined = existing .. ';' .. combined end
      table.insert(parts, ' style="' .. escapeAttr(combined) .. '"')
    elseif self._attrs['style'] then
      table.insert(parts, ' style="' .. escapeAttr(self._attrs['style']) .. '"')
    end
    for _, k in ipairs(self._attrOrder) do
      if k ~= 'class' and k ~= 'style' and self._attrs[k] ~= nil then
        table.insert(parts, ' ' .. k .. '="' .. escapeAttr(self._attrs[k]) .. '"')
      end
    end
    if VOID_TAGS[self._tag] then
      table.insert(parts, ' />')
      return table.concat(parts)
    end
    table.insert(parts, '>')
  end
  for _, child in ipairs(self._children) do
    table.insert(parts, tostring(child))
  end
  if self._tag then
    table.insert(parts, '</' .. self._tag .. '>')
  end
  return table.concat(parts)
end

mw.ustring = {
  len = utf8 and utf8.len or string.len,
  sub = string.sub,
  upper = string.upper,
  lower = string.lower,
  find = string.find,
  gsub = string.gsub,
  match = string.match,
  gmatch = string.gmatch,
  format = string.format,
  rep = string.rep
}
`;

function pushJsValueToLua(L, value) {
  if (value === null || value === undefined) {
    lua.lua_pushnil(L);
  } else if (typeof value === 'boolean') {
    lua.lua_pushboolean(L, value ? 1 : 0);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    lua.lua_pushnumber(L, value);
  } else if (typeof value === 'string') {
    lua.lua_pushstring(L, to_luastring(value));
  } else if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    for (let i = 0; i < value.length; i += 1) {
      pushJsValueToLua(L, value[i]);
      lua.lua_rawseti(L, -2, i + 1);
    }
  } else if (typeof value === 'object') {
    const entries = Object.entries(value);
    lua.lua_createtable(L, 0, entries.length);
    for (const [k, v] of entries) {
      lua.lua_pushstring(L, to_luastring(String(k)));
      pushJsValueToLua(L, v);
      lua.lua_settable(L, -3);
    }
  } else {
    lua.lua_pushstring(L, to_luastring(String(value)));
  }
}

function luaToJsValue(L, index, depth = 0) {
  if (depth > 16) return null;
  const absIdx = index < 0 ? lua.lua_gettop(L) + index + 1 : index;
  const type = lua.lua_type(L, absIdx);
  if (type === lua.LUA_TNIL || type === lua.LUA_TNONE) return null;
  if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, absIdx) !== 0;
  if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, absIdx);
  if (type === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, absIdx));
  if (type === lua.LUA_TTABLE) {
    const len = lua.lua_rawlen(L, absIdx);
    const keys = [];
    let isArray = true;
    lua.lua_pushnil(L);
    while (lua.lua_next(L, absIdx) !== 0) {
      const kType = lua.lua_type(L, -2);
      if (kType === lua.LUA_TNUMBER) {
        const kNum = lua.lua_tonumber(L, -2);
        if (!Number.isInteger(kNum) || kNum < 1 || kNum > len) isArray = false;
      } else {
        isArray = false;
      }
      keys.push({
        key: kType === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : to_jsstring(lua.lua_tostring(L, -2)),
        val: luaToJsValue(L, -1, depth + 1),
      });
      lua.lua_pop(L, 1);
    }
    if (isArray && len > 0 && keys.length === len) {
      const arr = new Array(len);
      for (const item of keys) arr[item.key - 1] = item.val;
      return arr;
    }
    const obj = {};
    for (const item of keys) obj[String(item.key)] = item.val;
    return obj;
  }
  return to_jsstring(lauxlib.luaL_tolstring(L, absIdx));
}

function pushArgsTable(L, argsObj) {
  const entries = Object.entries(argsObj || {});
  lua.lua_createtable(L, 0, entries.length);
  for (const [k, v] of entries) {
    const numKey = /^[1-9]\d*$/.test(k) ? Number(k) : null;
    if (numKey !== null) {
      lua.lua_pushinteger(L, numKey);
    } else {
      lua.lua_pushstring(L, to_luastring(k));
    }
    lua.lua_pushstring(L, to_luastring(String(v)));
    lua.lua_settable(L, -3);
  }
}

function runLuaModule({
  moduleName,
  funcName,
  args,
  parentArgs,
  context,
  renderState,
}) {
  renderState.luaInvocations += 1;
  if (renderState.luaInvocations > MAX_LUA_INVOCATIONS) {
    throw new Error(`Limite de ${MAX_LUA_INVOCATIONS} chamadas Lua (#invoke) por ficha atingido.`);
  }

  const modKey = normalizeResourceKey(moduleName);
  const modSource = renderState.resources.lua.get(modKey);
  if (modSource === undefined) {
    throw new Error(`Módulo Lua não encontrado: "${moduleName}"`);
  }

  const L = lauxlib.luaL_newstate();
  lauxlib.luaL_requiref(L, to_luastring('_G'), lualib.luaopen_base, 1);
  lua.lua_pop(L, 1);
  lauxlib.luaL_requiref(L, to_luastring('string'), lualib.luaopen_string, 1);
  lua.lua_pop(L, 1);
  lauxlib.luaL_requiref(L, to_luastring('table'), lualib.luaopen_table, 1);
  lua.lua_pop(L, 1);
  lauxlib.luaL_requiref(L, to_luastring('math'), lualib.luaopen_math, 1);
  lua.lua_pop(L, 1);
  lauxlib.luaL_requiref(L, to_luastring('utf8'), lualib.luaopen_utf8, 1);
  lua.lua_pop(L, 1);

  // Strip unsafe base functions
  for (const dangerous of ['dofile', 'loadfile', 'load', 'loadstring', 'collectgarbage']) {
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, to_luastring(dangerous));
  }

  // Instruction hook shared across the entire character render
  lua.lua_sethook(L, () => {
    renderState.luaInstructions += 500;
    if (renderState.luaInstructions > MAX_LUA_INSTRUCTIONS) {
      lauxlib.luaL_error(L, to_luastring('Limite de instruções Lua excedido (possível loop infinito).'));
    }
  }, lua.LUA_MASKCOUNT, 500);

  // Load mw.html & mw.ustring prelude
  if (lauxlib.luaL_dostring(L, to_luastring(MW_HTML_LUA_PRELUDE)) !== lua.LUA_OK) {
    throw new Error(`Erro interno Lua: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }

  // Register mw.text + mw.title
  lua.lua_getglobal(L, to_luastring('mw'));
  lua.lua_createtable(L, 0, 7);

  const registerMwTextFn = (name, fn) => {
    lua.lua_pushstring(L, to_luastring(name));
    lua.lua_pushcfunction(L, fn);
    lua.lua_settable(L, -3);
  };
  registerMwTextFn('trim', (state) => {
    const s = lua.lua_gettop(state) >= 1 ? to_jsstring(lauxlib.luaL_tolstring(state, 1)) : '';
    lua.lua_pushstring(state, to_luastring(s.trim()));
    return 1;
  });
  registerMwTextFn('encode', (state) => {
    const s = lua.lua_gettop(state) >= 1 ? to_jsstring(lauxlib.luaL_tolstring(state, 1)) : '';
    lua.lua_pushstring(state, to_luastring(escapeHtml(s)));
    return 1;
  });
  registerMwTextFn('nowiki', (state) => {
    const s = lua.lua_gettop(state) >= 1 ? to_jsstring(lauxlib.luaL_tolstring(state, 1)) : '';
    lua.lua_pushstring(state, to_luastring(`<nowiki>${s.replace(/<\/nowiki>/gi, '&lt;/nowiki&gt;')}</nowiki>`));
    return 1;
  });
  registerMwTextFn('split', (state) => {
    const s = to_jsstring(lauxlib.luaL_checkstring(state, 1));
    const sep = to_jsstring(lauxlib.luaL_checkstring(state, 2));
    const parts = sep === '' ? Array.from(s) : s.split(sep);
    pushJsValueToLua(state, parts);
    return 1;
  });
  registerMwTextFn('jsonEncode', (state) => {
    const val = luaToJsValue(state, 1);
    lua.lua_pushstring(state, to_luastring(JSON.stringify(val ?? null)));
    return 1;
  });
  registerMwTextFn('jsonDecode', (state) => {
    const raw = to_jsstring(lauxlib.luaL_checkstring(state, 1));
    try {
      pushJsValueToLua(state, JSON.parse(raw));
    } catch (_err) {
      lauxlib.luaL_error(state, to_luastring('JSON inválido em mw.text.jsonDecode'));
    }
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('text'));

  // mw.title.getCurrentTitle()
  lua.lua_createtable(L, 0, 1);
  lua.lua_pushcfunction(L, (state) => {
    pushJsValueToLua(state, {
      text: context.nome || 'Ficha',
      prefixedText: context.nome || 'Ficha',
      namespace: 0,
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('getCurrentTitle'));
  lua.lua_setfield(L, -2, to_luastring('title'));
  lua.lua_pop(L, 1); // pop mw

  // Sandboxed require() resolving only DB Lua modules
  const loadedModules = new Map();
  const loadingStack = new Set([modKey]);
  lua.lua_pushcfunction(L, (state) => {
    const reqName = to_jsstring(lauxlib.luaL_checkstring(state, 1));
    const reqKey = normalizeResourceKey(reqName);
    if (loadedModules.has(reqKey)) {
      const idx = loadedModules.get(reqKey);
      lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, idx);
      return 1;
    }
    if (loadingStack.has(reqKey)) {
      lauxlib.luaL_error(state, to_luastring(`Dependência circular em require("${reqName}")`));
    }
    if (loadingStack.size >= MAX_LUA_REQUIRE_DEPTH) {
      lauxlib.luaL_error(state, to_luastring('Profundidade máxima de require() excedida'));
    }
    const reqSrc = renderState.resources.lua.get(reqKey);
    if (reqSrc === undefined) {
      lauxlib.luaL_error(state, to_luastring(`Módulo não encontrado em require("${reqName}")`));
    }
    loadingStack.add(reqKey);
    try {
      const reqBytes = to_luastring(reqSrc);
      const loadStatus = lauxlib.luaL_loadbuffer(state, reqBytes, reqBytes.length, to_luastring(`@Module:${reqName}`));
      if (loadStatus !== lua.LUA_OK) {
        lua.lua_error(state);
      }
      if (lua.lua_pcall(state, 0, 1, 0) !== lua.LUA_OK) {
        lua.lua_error(state);
      }
      lua.lua_pushvalue(state, -1);
      const ref = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
      loadedModules.set(reqKey, ref);
      return 1;
    } finally {
      loadingStack.delete(reqKey);
    }
  });
  lua.lua_setglobal(L, to_luastring('require'));

  // Load target module
  const modBytes = to_luastring(modSource);
  const loadRc = lauxlib.luaL_loadbuffer(L, modBytes, modBytes.length, to_luastring(`@Module:${moduleName}`));
  if (loadRc !== lua.LUA_OK) {
    throw new Error(`Erro de sintaxe em Módulo:${moduleName}: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    throw new Error(`Erro ao carregar Módulo:${moduleName}: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  if (lua.lua_type(L, -1) !== lua.LUA_TTABLE) {
    throw new Error(`Módulo:${moduleName} deve retornar uma tabela Lua (ex.: return p).`);
  }

  lua.lua_getfield(L, -1, to_luastring(funcName));
  if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) {
    throw new Error(`Função "${funcName}" não encontrada em Módulo:${moduleName}.`);
  }

  // Build frame object
  lua.lua_createtable(L, 0, 5);
  pushArgsTable(L, args);
  lua.lua_setfield(L, -2, to_luastring('args'));

  lua.lua_pushcfunction(L, (state) => {
    lua.lua_pushstring(state, to_luastring(`Módulo:${moduleName}`));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('getTitle'));

  lua.lua_pushcfunction(L, (state) => {
    if (!parentArgs) {
      lua.lua_pushnil(state);
      return 1;
    }
    lua.lua_createtable(state, 0, 2);
    pushArgsTable(state, parentArgs);
    lua.lua_setfield(state, -2, to_luastring('args'));
    lua.lua_pushcfunction(state, (s2) => {
      lua.lua_pushstring(s2, to_luastring(context.nome || 'Ficha'));
      return 1;
    });
    lua.lua_setfield(state, -2, to_luastring('getTitle'));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('getParent'));

  lua.lua_pushcfunction(L, (state) => {
    const raw = lua.lua_gettop(state) >= 2 ? to_jsstring(lauxlib.luaL_tolstring(state, 2)) : '';
    const expanded = expandTemplates(raw, parentArgs, context, renderState, renderState.currentDepth + 1);
    lua.lua_pushstring(state, to_luastring(expanded));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('preprocess'));

  lua.lua_pushcfunction(L, (state) => {
    const opts = lua.lua_gettop(state) >= 2 ? luaToJsValue(state, 2) : null;
    if (!opts || typeof opts !== 'object' || !opts.title) {
      lua.lua_pushstring(state, to_luastring(''));
      return 1;
    }
    const tplArgs = opts.args && typeof opts.args === 'object' ? opts.args : {};
    const expanded = expandNamedTemplate(String(opts.title), tplArgs, context, renderState, renderState.currentDepth + 1);
    lua.lua_pushstring(state, to_luastring(expanded));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring('expandTemplate'));

  if (lua.lua_pcall(L, 1, 1, 0) !== lua.LUA_OK) {
    throw new Error(`Erro ao executar ${moduleName}.${funcName}: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  if (lua.lua_type(L, -1) === lua.LUA_TNIL) return '';
  return to_jsstring(lauxlib.luaL_tolstring(L, -1));
}

// ---------- MediaWiki Template & Parser Function Expander ----------

function findClosingBrace(src, startIdx, kind) {
  const stack = [kind];
  let i = startIdx + kind;
  while (i < src.length && stack.length > 0) {
    if (src[i] === '{' && src[i + 1] === '{') {
      if (src[i + 2] === '{') {
        stack.push(3);
        i += 3;
      } else {
        stack.push(2);
        i += 2;
      }
      continue;
    }
    const need = stack[stack.length - 1];
    if (need === 3 && src[i] === '}' && src[i + 1] === '}' && src[i + 2] === '}') {
      stack.pop();
      if (stack.length === 0) return i;
      i += 3;
      continue;
    }
    if (need === 2 && src[i] === '}' && src[i + 1] === '}') {
      stack.pop();
      if (stack.length === 0) return i;
      i += 2;
      continue;
    }
    i += 1;
  }
  return -1;
}

function splitTemplateParts(inner) {
  const parts = [];
  let current = '';
  const braceStack = [];
  let bracketDepth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '{' && inner[i + 1] === '{') {
      if (inner[i + 2] === '{') {
        braceStack.push(3);
        current += '{{{';
        i += 2;
      } else {
        braceStack.push(2);
        current += '{{';
        i += 1;
      }
      continue;
    }
    if (braceStack.length > 0) {
      const need = braceStack[braceStack.length - 1];
      if (need === 3 && inner[i] === '}' && inner[i + 1] === '}' && inner[i + 2] === '}') {
        braceStack.pop();
        current += '}}}';
        i += 2;
        continue;
      }
      if (need === 2 && inner[i] === '}' && inner[i + 1] === '}') {
        braceStack.pop();
        current += '}}';
        i += 1;
        continue;
      }
    }
    if (inner[i] === '[' && inner[i + 1] === '[') {
      bracketDepth += 1;
      current += '[[';
      i += 1;
      continue;
    }
    if (inner[i] === ']' && inner[i + 1] === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      current += ']]';
      i += 1;
      continue;
    }
    if (inner[i] === '|' && braceStack.length === 0 && bracketDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += inner[i];
  }
  parts.push(current);
  return parts;
}

function parseTemplateArgs(parts, templateArgs, context, renderState, depth) {
  const args = {};
  let posIndex = 1;
  for (const rawPart of parts) {
    const eqIdx = findTopLevelEquals(rawPart);
    if (eqIdx !== -1) {
      const key = expandTemplates(rawPart.slice(0, eqIdx), templateArgs, context, renderState, depth + 1).trim();
      const val = expandTemplates(rawPart.slice(eqIdx + 1), templateArgs, context, renderState, depth + 1).trim();
      if (key) args[key] = val;
    } else {
      const val = expandTemplates(rawPart, templateArgs, context, renderState, depth + 1);
      args[String(posIndex)] = val;
      posIndex += 1;
    }
  }
  return args;
}

function findTopLevelEquals(str) {
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < str.length; i += 1) {
    if (str[i] === '{' && str[i + 1] === '{') { braceDepth += 1; i += 1; continue; }
    if (str[i] === '}' && str[i + 1] === '}' && braceDepth > 0) { braceDepth -= 1; i += 1; continue; }
    if (str[i] === '[' && str[i + 1] === '[') { bracketDepth += 1; i += 1; continue; }
    if (str[i] === ']' && str[i + 1] === ']' && bracketDepth > 0) { bracketDepth -= 1; i += 1; continue; }
    if (str[i] === '=' && braceDepth === 0 && bracketDepth === 0) return i;
  }
  return -1;
}

function prepareTemplateBodyForTransclusion(rawBody) {
  let body = String(rawBody || '');
  const onlyMatch = /<onlyinclude>([\s\S]*?)<\/onlyinclude>/gi;
  const onlyParts = [];
  let m;
  while ((m = onlyMatch.exec(body)) !== null) onlyParts.push(m[1]);
  if (onlyParts.length) body = onlyParts.join('');
  body = body.replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, '');
  body = body.replace(/<\/?includeonly>/gi, '');
  return body;
}

function expandNamedTemplate(name, args, context, renderState, depth) {
  if (depth > MAX_TEMPLATE_DEPTH) {
    addDiagnostic(renderState.diagnostics, 'error', name, 'Profundidade máxima de predefinições atingida.');
    return `<span class="mw-error">[Erro: recursão excessiva em ${escapeHtml(name)}]</span>`;
  }
  const key = normalizeResourceKey(name);
  const rawTemplate = renderState.resources.template.get(key);
  if (rawTemplate === undefined) {
    addDiagnostic(renderState.diagnostics, 'warning', name, `Predefinição não encontrada: "${name}".`);
    return `<span class="mw-error">[Predefinição não encontrada: ${escapeHtml(name)}]</span>`;
  }
  const body = prepareTemplateBodyForTransclusion(rawTemplate);
  return expandTemplates(body, args, context, renderState, depth);
}

function resolveMagicVariable(name, context) {
  const upper = name.trim().toUpperCase();
  if (upper === 'PAGENAME' || upper === 'NOME_DA_PAGINA' || upper === 'FICHA_NOME') return context.nome || '';
  if (upper === 'FICHA_TITULO') return context.titulo || '';
  if (upper === 'FICHA_RACA') return context.raca || '';
  if (upper === 'FICHA_FACCAO') return context.faccao || '';
  if (upper === 'FICHA_STATUS') return context.status || '';
  if (upper === 'FICHA_CATEGORIA') return context.categoria || '';
  if (upper === 'FICHA_MASCARA') return context.mascaraTier || '';
  return null;
}

function evaluateParserFunction(head, restParts, templateArgs, context, renderState, depth) {
  const colonIdx = head.indexOf(':');
  const fnRaw = (colonIdx === -1 ? head : head.slice(0, colonIdx)).trim().toLowerCase();
  const firstArgRaw = colonIdx === -1 ? '' : head.slice(colonIdx + 1);
  const exp = (text) => expandTemplates(text, templateArgs, context, renderState, depth + 1);

  if (fnRaw === '#invoke') {
    const moduleName = exp(firstArgRaw).trim();
    const funcName = restParts[0] !== undefined ? exp(restParts[0]).trim() : '';
    const invokeArgs = parseTemplateArgs(restParts.slice(1), templateArgs, context, renderState, depth);
    const prevDepth = renderState.currentDepth;
    renderState.currentDepth = depth;
    try {
      return runLuaModule({
        moduleName,
        funcName,
        args: invokeArgs,
        parentArgs: templateArgs,
        context,
        renderState,
      });
    } catch (err) {
      addDiagnostic(renderState.diagnostics, 'error', `Módulo:${moduleName}`, err.message);
      return `<span class="mw-error">[Erro Lua: ${escapeHtml(err.message)}]</span>`;
    } finally {
      renderState.currentDepth = prevDepth;
    }
  }

  if (fnRaw === '#if') {
    const cond = exp(firstArgRaw).trim();
    return cond ? exp(restParts[0] || '').trim() : exp(restParts[1] || '').trim();
  }
  if (fnRaw === '#ifeq') {
    const left = exp(firstArgRaw).trim();
    const right = exp(restParts[0] || '').trim();
    const same = left === right || (left !== '' && right !== '' && !Number.isNaN(Number(left)) && !Number.isNaN(Number(right)) && Number(left) === Number(right));
    return same ? exp(restParts[1] || '').trim() : exp(restParts[2] || '').trim();
  }
  if (fnRaw === '#switch') {
    const target = exp(firstArgRaw).trim();
    let defaultVal = '';
    let fallthrough = false;
    for (const rawCase of restParts) {
      const eqIdx = findTopLevelEquals(rawCase);
      if (eqIdx === -1) {
        const key = exp(rawCase).trim();
        if (key === target) fallthrough = true;
      } else {
        const key = exp(rawCase.slice(0, eqIdx)).trim();
        const val = rawCase.slice(eqIdx + 1);
        if (key === '#default') {
          defaultVal = exp(val).trim();
        } else if (fallthrough || key === target) {
          return exp(val).trim();
        }
      }
    }
    return defaultVal;
  }
  if (fnRaw === '#expr') {
    const exprText = exp(firstArgRaw).trim();
    try {
      return String(evaluateMathExpr(exprText));
    } catch (err) {
      addDiagnostic(renderState.diagnostics, 'warning', '#expr', err.message);
      return `<span class="mw-error">[Erro #expr: ${escapeHtml(err.message)}]</span>`;
    }
  }
  if (fnRaw === '#ifexpr') {
    const exprText = exp(firstArgRaw).trim();
    try {
      const val = evaluateMathExpr(exprText);
      return val !== 0 ? exp(restParts[0] || '').trim() : exp(restParts[1] || '').trim();
    } catch (err) {
      addDiagnostic(renderState.diagnostics, 'warning', '#ifexpr', err.message);
      return `<span class="mw-error">[Erro #ifexpr: ${escapeHtml(err.message)}]</span>`;
    }
  }
  if (fnRaw === '#len') {
    return String(Array.from(exp(firstArgRaw).trim()).length);
  }
  if (fnRaw === '#sub') {
    const chars = Array.from(exp(firstArgRaw));
    const start = Number.parseInt(exp(restParts[0] || '0').trim(), 10) || 0;
    const len = restParts[1] !== undefined ? Number.parseInt(exp(restParts[1]).trim(), 10) : undefined;
    const from = start < 0 ? Math.max(0, chars.length + start) : start;
    return (len !== undefined && Number.isFinite(len) ? chars.slice(from, from + Math.max(0, len)) : chars.slice(from)).join('');
  }
  if (fnRaw === '#replace') {
    const text = exp(firstArgRaw);
    const from = exp(restParts[0] || '');
    const to = exp(restParts[1] || '');
    return from ? text.split(from).join(to) : text;
  }
  if (fnRaw === 'lc') return exp(firstArgRaw).toLocaleLowerCase('pt-BR');
  if (fnRaw === 'uc') return exp(firstArgRaw).toLocaleUpperCase('pt-BR');
  if (fnRaw === 'lcfirst') {
    const s = exp(firstArgRaw);
    return s ? s[0].toLocaleLowerCase('pt-BR') + s.slice(1) : '';
  }
  if (fnRaw === 'ucfirst') {
    const s = exp(firstArgRaw);
    return s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : '';
  }
  return null;
}

function expandTemplates(input, templateArgs, context, renderState, depth = 0) {
  if (!input) return '';
  if (depth > MAX_TEMPLATE_DEPTH) {
    addDiagnostic(renderState.diagnostics, 'error', 'template', 'Profundidade máxima de expansão atingida.');
    return input;
  }

  // Mask <nowiki> and <!-- comments --> on top-level call
  let src = String(input).replace(/<!--[\s\S]*?-->/g, '');
  const nowikiStore = [];
  src = src.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, (_m, inner) => {
    const token = `\u0000NOWIKI_${nowikiStore.length}\u0000`;
    nowikiStore.push(inner);
    return token;
  });

  let out = '';
  let i = 0;
  while (i < src.length) {
    if (Buffer.byteLength(out, 'utf8') > MAX_EXPANDED_BYTES) {
      addDiagnostic(renderState.diagnostics, 'error', 'wikitext', 'Tamanho máximo de expansão de Wikitext excedido.');
      break;
    }
    if (src[i] === '{' && src[i + 1] === '{') {
      // Parameter {{{...}}}
      if (src[i + 2] === '{') {
        const end = findClosingBrace(src, i, 3);
        if (end !== -1) {
          const inner = src.slice(i + 3, end);
          const pipeIdx = inner.indexOf('|') === -1 ? -1 : (() => {
            const parts = splitTemplateParts(inner);
            return parts.length > 1 ? parts[0].length : -1;
          })();
          const paramName = expandTemplates(pipeIdx === -1 ? inner : inner.slice(0, pipeIdx), templateArgs, context, renderState, depth + 1).trim();
          const hasArg = templateArgs && Object.hasOwn(templateArgs, paramName) && templateArgs[paramName] !== undefined;
          if (hasArg) {
            out += String(templateArgs[paramName]);
          } else if (pipeIdx !== -1) {
            out += expandTemplates(inner.slice(pipeIdx + 1), templateArgs, context, renderState, depth + 1);
          } else {
            out += `{{{${paramName}}}}`;
          }
          i = end + 3;
          continue;
        }
      }

      // Template or parser function {{...}}
      const end = findClosingBrace(src, i, 2);
      if (end !== -1) {
        const inner = src.slice(i + 2, end);
        const parts = splitTemplateParts(inner);
        const head = parts[0] || '';
        const parserResult = evaluateParserFunction(head, parts.slice(1), templateArgs, context, renderState, depth);
        if (parserResult !== null) {
          out += parserResult;
        } else {
          const expandedHead = expandTemplates(head, templateArgs, context, renderState, depth + 1).trim();
          const magic = parts.length === 1 ? resolveMagicVariable(expandedHead, context) : null;
          if (magic !== null) {
            out += magic;
          } else {
            const tplArgs = parseTemplateArgs(parts.slice(1), templateArgs, context, renderState, depth);
            out += expandNamedTemplate(expandedHead, tplArgs, context, renderState, depth + 1);
          }
        }
        i = end + 2;
        continue;
      }
    }
    out += src[i];
    i += 1;
  }

  for (let idx = 0; idx < nowikiStore.length; idx += 1) {
    out = out.replace(`\u0000NOWIKI_${idx}\u0000`, `<nowiki>${nowikiStore[idx]}</nowiki>`);
  }
  return out;
}

// ---------- Wikitext -> HTML Parser ----------

function slugifyWikiTarget(title) {
  return String(title || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseTableAttrList(attrString) {
  const attrs = [];
  const classMatch = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z0-9_-]+))/i.exec(attrString);
  if (classMatch) {
    const classes = (classMatch[1] || classMatch[2] || classMatch[3] || '')
      .split(/\s+/)
      .filter((c) => SAFE_CLASS_RE.test(c));
    if (classes.length) attrs.push(`class="${escapeHtml(classes.join(' '))}"`);
  }
  const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrString);
  if (styleMatch) {
    attrs.push(`style="${escapeHtml(styleMatch[1] || styleMatch[2] || '')}"`);
  }
  const colspanMatch = /\bcolspan\s*=\s*(?:"?(\d{1,2})"?)/i.exec(attrString);
  if (colspanMatch) attrs.push(`colspan="${colspanMatch[1]}"`);
  const rowspanMatch = /\browspan\s*=\s*(?:"?(\d{1,2})"?)/i.exec(attrString);
  if (rowspanMatch) attrs.push(`rowspan="${rowspanMatch[1]}"`);
  return attrs.length ? ' ' + attrs.join(' ') : '';
}

function parseMediaWikiTable(lines, startIndex) {
  const openLine = lines[startIndex].trim();
  const tableAttrStr = openLine.slice(2).trim();
  const rows = [];
  let caption = '';
  let currentRow = { attrs: '', cells: [] };
  let idx = startIndex + 1;
  let nested = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.startsWith('{|')) {
      nested += 1;
      if (currentRow.cells.length) {
        currentRow.cells[currentRow.cells.length - 1].raw += `\n${line}`;
      }
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('|}')) {
      if (nested > 0) {
        nested -= 1;
        if (currentRow.cells.length) {
          currentRow.cells[currentRow.cells.length - 1].raw += `\n${line}`;
        }
        idx += 1;
        continue;
      }
      if (currentRow.cells.length) rows.push(currentRow);
      idx += 1;
      break;
    }
    if (nested > 0) {
      if (currentRow.cells.length) {
        currentRow.cells[currentRow.cells.length - 1].raw += `\n${line}`;
      }
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('|+')) {
      caption = trimmed.slice(2).trim();
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('|-')) {
      if (currentRow.cells.length) rows.push(currentRow);
      currentRow = { attrs: parseTableAttrList(trimmed.slice(2)), cells: [] };
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('!') || trimmed.startsWith('|')) {
      const tag = trimmed.startsWith('!') ? 'th' : 'td';
      const sep = tag === 'th' ? '!!' : '||';
      const chunks = trimmed.slice(1).split(sep);
      for (const chunk of chunks) {
        const singlePipe = chunk.indexOf('|');
        let cellAttrs = '';
        let content = chunk;
        if (singlePipe !== -1 && !chunk.slice(0, singlePipe).includes('[[') && !chunk.slice(0, singlePipe).includes('{{')) {
          cellAttrs = parseTableAttrList(chunk.slice(0, singlePipe));
          content = chunk.slice(singlePipe + 1);
        }
        currentRow.cells.push({ tag, attrs: cellAttrs, raw: content.trim() });
      }
      idx += 1;
      continue;
    }
    if (currentRow.cells.length) {
      currentRow.cells[currentRow.cells.length - 1].raw += `\n${line}`;
    }
    idx += 1;
  }

  let html = `<table${parseTableAttrList(tableAttrStr) || ' class="mw-table"'}>`;
  if (caption) html += `<caption>${parseInlineWikitext(caption)}</caption>`;
  html += '<tbody>';
  for (const row of rows) {
    html += `<tr${row.attrs}>`;
    for (const cell of row.cells) {
      const renderedCell = cell.raw.includes('\n') ? wikitextToHtml(cell.raw) : parseInlineWikitext(cell.raw);
      html += `<${cell.tag}${cell.attrs}>${renderedCell}</${cell.tag}>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return { html, nextIndex: idx };
}

function parseMediaWikiImage(target, optionsText) {
  const safeSrc = sanitizeUrl(target.trim(), { image: true });
  if (!safeSrc) return escapeHtml(`[[${target}]]`);
  const opts = (optionsText || '').split('|').map((s) => s.trim()).filter(Boolean);
  let widthAttr = '';
  let caption = '';
  let isThumb = false;
  for (const opt of opts) {
    const px = /^(\d{1,4})\s*px$/i.exec(opt);
    if (px) {
      const w = Math.max(16, Math.min(2048, Number(px[1])));
      widthAttr = ` width="${w}"`;
    } else if (/^(?:thumb|thumbnail|frame|frameless|left|right|center|none)$/i.test(opt)) {
      if (/^thumb/i.test(opt)) isThumb = true;
    } else if (!/^alt=/i.test(opt)) {
      caption = opt;
    }
  }
  const img = `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(caption || 'Imagem')}"${widthAttr} />`;
  if (isThumb || caption) {
    return `<figure class="mw-thumb">${img}${caption ? `<figcaption>${parseInlineWikitext(caption)}</figcaption>` : ''}</figure>`;
  }
  return img;
}

function parseInlineWikitext(text) {
  if (!text) return '';
  const protectedTokens = [];
  let s = String(text);

  // Protect <nowiki>
  s = s.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, (_m, inner) => {
    const token = `\u0001P${protectedTokens.length}\u0001`;
    protectedTokens.push(escapeHtml(inner));
    return token;
  });

  // Protect inline HTML tags so URLs/quotes inside attributes aren't touched by link/quote rules
  s = s.replace(/<[^>]+>/g, (tag) => {
    const token = `\u0001P${protectedTokens.length}\u0001`;
    protectedTokens.push(tag);
    return token;
  });

  // Images & internal wiki links [[...]]
  s = s.replace(/\[\[([^[\]]+)\]\]/g, (_m, body) => {
    const pipe = body.indexOf('|');
    const target = (pipe === -1 ? body : body.slice(0, pipe)).trim();
    const rest = pipe === -1 ? '' : body.slice(pipe + 1);
    const fileMatch = /^(?:File|Image|Imagem|Arquivo)\s*:\s*(.+)$/i.exec(target);
    if (fileMatch) {
      const token = `\u0001P${protectedTokens.length}\u0001`;
      protectedTokens.push(parseMediaWikiImage(fileMatch[1], rest));
      return token;
    }
    const label = (pipe === -1 ? target : rest).trim() || target;
    const [pagePart, anchorPart] = target.split('#');
    const slug = slugifyWikiTarget(pagePart);
    const href = slug ? `/wiki/${slug}${anchorPart ? `#${slugifyWikiTarget(anchorPart)}` : ''}` : '#';
    const token = `\u0001P${protectedTokens.length}\u0001`;
    protectedTokens.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
    return token;
  });

  // External links [https://... label]
  s = s.replace(/\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/gi, (_m, rawUrl, label) => {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return escapeHtml(label || rawUrl);
    const token = `\u0001P${protectedTokens.length}\u0001`;
    protectedTokens.push(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml((label || safeUrl).trim())}</a>`);
    return token;
  });

  // Bold + italic ''''', bold ''', italic ''
  s = s.replace(/'''''([\s\S]+?)'''''/g, '<strong><em>$1</em></strong>');
  s = s.replace(/'''([\s\S]+?)'''/g, '<strong>$1</strong>');
  s = s.replace(/''([\s\S]+?)''/g, '<em>$1</em>');

  for (let idx = 0; idx < protectedTokens.length; idx += 1) {
    s = s.replace(`\u0001P${idx}\u0001`, protectedTokens[idx]);
  }
  return s;
}

function renderListBlock(lines, startIndex) {
  const stack = [];
  const out = [];
  let idx = startIndex;

  const listTag = (ch) => (ch === '#' ? 'ol' : (ch === ';' || ch === ':' ? 'dl' : 'ul'));
  const closeToDepth = (targetDepth) => {
    while (stack.length > targetDepth) {
      const popped = stack.pop();
      if (popped.itemOpen) out.push(`</${popped.itemTag}>`);
      out.push(`</${popped.tag}>`);
    }
  };

  while (idx < lines.length) {
    const match = /^([*#;:]+)\s*(.*)$/.exec(lines[idx]);
    if (!match) break;
    const markers = match[1];
    const text = match[2];
    const depth = markers.length;

    let common = 0;
    while (common < stack.length && common < depth && stack[common].marker === markers[common]) {
      common += 1;
    }
    closeToDepth(common);

    for (let d = common; d < depth; d += 1) {
      const m = markers[d];
      const tag = listTag(m);
      out.push(`<${tag}>`);
      stack.push({ marker: m, tag, itemOpen: false, itemTag: m === ';' ? 'dt' : (m === ':' ? 'dd' : 'li') });
    }

    const top = stack[stack.length - 1];
    if (top.itemOpen) out.push(`</${top.itemTag}>`);
    if (markers[depth - 1] === ';') {
      const colonPos = text.indexOf(':');
      if (colonPos !== -1) {
        out.push(`<dt>${parseInlineWikitext(text.slice(0, colonPos).trim())}</dt><dd>${parseInlineWikitext(text.slice(colonPos + 1).trim())}</dd>`);
        top.itemOpen = false;
      } else {
        top.itemTag = 'dt';
        out.push(`<dt>${parseInlineWikitext(text)}</dt>`);
        top.itemOpen = false;
      }
    } else {
      top.itemTag = markers[depth - 1] === ':' ? 'dd' : 'li';
      out.push(`<${top.itemTag}>${parseInlineWikitext(text)}`);
      top.itemOpen = true;
    }
    idx += 1;
  }

  closeToDepth(0);
  return { html: out.join(''), nextIndex: idx };
}

function wikitextToHtml(wikitext) {
  const blockProtected = [];
  let source = String(wikitext || '').replace(/\r\n/g, '\n');

  source = source.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
    const idx = blockProtected.length;
    blockProtected.push(`<pre>${escapeHtml(inner)}</pre>`);
    return `\n\u0002BLOCK_${idx}\u0002\n`;
  });

  const lines = source.split('\n');
  const out = [];
  let paragraphLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const joined = paragraphLines.map((l) => parseInlineWikitext(l)).join('<br>');
    if (joined.trim()) out.push(`<p>${joined}</p>`);
    paragraphLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    const blockTokenMatch = /^\u0002BLOCK_(\d+)\u0002$/.exec(trimmed);
    if (blockTokenMatch) {
      flushParagraph();
      out.push(blockProtected[Number(blockTokenMatch[1])] || '');
      i += 1;
      continue;
    }

    if (trimmed.startsWith('{|')) {
      flushParagraph();
      const tbl = parseMediaWikiTable(lines, i);
      out.push(tbl.html);
      i = tbl.nextIndex;
      continue;
    }

    const headingMatch = /^(={1,6})\s*(.+?)\s*\1\s*$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(6, Math.max(2, headingMatch[1].length));
      out.push(`<h${level}>${parseInlineWikitext(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^-{4,}$/.test(trimmed)) {
      flushParagraph();
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (/^[*#;:]/.test(trimmed)) {
      flushParagraph();
      const list = renderListBlock(lines, i);
      out.push(list.html);
      i = list.nextIndex;
      continue;
    }

    if (/^<\/?(?:div|table|tbody|thead|tfoot|tr|td|th|caption|blockquote|figure|figcaption|details|summary|ul|ol|dl|dt|dd|li|h[2-6]|hr|p|center)\b/i.test(trimmed)) {
      flushParagraph();
      out.push(parseInlineWikitext(line));
      i += 1;
      continue;
    }

    paragraphLines.push(line);
    i += 1;
  }
  flushParagraph();
  return out.join('\n').replace(/\u0002BLOCK_(\d+)\u0002/g, (_m, n) => blockProtected[Number(n)] || '');
}

// ---------- Wikitext HTML Sanitizer ----------

function sanitizeWikitextHtml(rawHtml, options = {}) {
  const allowedImagePaths = options.allowedImagePaths || [];
  return sanitize(String(rawHtml || ''), {
    allowedTags: WIKITEXT_ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['title', 'class', 'id', 'style'],
      a: ['href', 'target', 'rel', 'title', 'class', 'id', 'style'],
      img: ['src', 'alt', 'title', 'width', 'height', 'class', 'id', 'style'],
      td: ['colspan', 'rowspan', 'class', 'id', 'style'],
      th: ['colspan', 'rowspan', 'scope', 'class', 'id', 'style'],
      col: ['span'],
      details: ['open', 'class', 'id', 'style'],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: WIKITEXT_NON_TEXT_TAGS,
    enforceHtmlBoundary: true,
    nestingLimit: 64,
    transformTags: {
      center: 'div',
      a: (_tagName, attribs) => {
        const next = { ...attribs };
        const safeHref = next.href !== undefined ? sanitizeUrl(next.href) : null;
        if (!safeHref) {
          delete next.href;
          delete next.target;
          delete next.rel;
        } else {
          next.href = safeHref;
          if (next.target === '_blank') next.rel = 'noopener noreferrer';
          else { delete next.target; delete next.rel; }
        }
        return { tagName: 'a', attribs: sanitizeCommonAttrs(next) };
      },
      img: (_tagName, attribs) => {
        const next = sanitizeCommonAttrs({ ...attribs });
        if (next.src === undefined || sanitizeUrl(next.src, { image: true, allowedImagePaths }) === null) {
          delete next.src;
        }
        for (const dim of ['width', 'height']) {
          if (next[dim] !== undefined) {
            const num = Number(next[dim]);
            if (!Number.isInteger(num) || num < 1 || num > 4096) delete next[dim];
            else next[dim] = String(num);
          }
        }
        return { tagName: 'img', attribs: next };
      },
      '*': (tagName, attribs) => ({ tagName, attribs: sanitizeCommonAttrs(attribs) }),
    },
  });
}

function sanitizeCommonAttrs(attribs) {
  const next = { ...attribs };
  if (typeof next.class === 'string') {
    const cleanClasses = next.class.split(/\s+/).filter((c) => SAFE_CLASS_RE.test(c));
    if (cleanClasses.length) next.class = cleanClasses.join(' ');
    else delete next.class;
  }
  if (typeof next.id === 'string') {
    const cleanId = next.id.trim();
    if (SAFE_ID_RE.test(cleanId)) next.id = cleanId.startsWith('mw-') ? cleanId : `mw-${cleanId}`;
    else delete next.id;
  }
  if (typeof next.style === 'string') {
    const cleanStyle = sanitizeDeclarations(next.style, [], 'inline-style');
    if (cleanStyle) next.style = cleanStyle;
    else delete next.style;
  }
  return next;
}

// ---------- Main Character Wikitext Compiler ----------

function buildResourceMaps(resourceList) {
  const maps = {
    template: new Map(),
    lua: new Map(),
    css: new Map(),
  };
  for (const item of resourceList || []) {
    if (!item || !maps[item.kind]) continue;
    const key = normalizeResourceKey(item.nameKey || item.name);
    if (key) maps[item.kind].set(key, String(item.content || ''));
  }
  return maps;
}

function renderCharacterWikitext({
  wikitext = '',
  customCss = '',
  scopeSelector = '.char-mw-scope',
  resources = [],
  character = {},
  allowedImagePaths = [],
} = {}) {
  if (typeof wikitext !== 'string') throw new TypeError('wikitext must be a string.');
  if (typeof customCss !== 'string') throw new TypeError('customCss must be a string.');
  if (Buffer.byteLength(wikitext, 'utf8') > MAX_WIKITEXT_BYTES) {
    throw new RangeError(`Wikitext excede o limite de ${MAX_WIKITEXT_BYTES} bytes.`);
  }
  if (Buffer.byteLength(customCss, 'utf8') > MAX_CSS_BYTES) {
    throw new RangeError(`CSS excede o limite de ${MAX_CSS_BYTES} bytes.`);
  }

  const diagnostics = [];
  const resourceMaps = buildResourceMaps(resources);
  const renderState = {
    resources: resourceMaps,
    diagnostics,
    luaInvocations: 0,
    luaInstructions: 0,
    currentDepth: 0,
  };

  let expanded = expandTemplates(wikitext, null, character, renderState, 0);

  // Extract <templatestyles src="..." />
  const referencedStyles = new Set();
  const cssParts = [];
  expanded = expanded.replace(/<templatestyles\s+[^>]*src\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*\/?>(?:\s*<\/templatestyles>)?/gi, (_m, q1, q2) => {
    const srcName = (q1 || q2 || '').trim();
    const key = normalizeResourceKey(srcName);
    if (!key) return '';
    if (!referencedStyles.has(key)) {
      referencedStyles.add(key);
      const rawCss = resourceMaps.css.get(key);
      if (rawCss === undefined) {
        addDiagnostic(diagnostics, 'warning', `Estilo:${srcName}`, `Folha de estilo não encontrada: "${srcName}".`);
      } else {
        const compiled = sanitizeScopedCss(rawCss, scopeSelector, { diagnostics, sourceLabel: `Estilo:${srcName}` });
        if (compiled) cssParts.push(compiled);
      }
    }
    return '';
  });

  if (customCss.trim()) {
    const compiledCustom = sanitizeScopedCss(customCss, scopeSelector, { diagnostics, sourceLabel: 'CSS da Ficha' });
    if (compiledCustom) cssParts.push(compiledCustom);
  }

  const rawHtml = wikitextToHtml(expanded);
  const html = sanitizeWikitextHtml(rawHtml, { allowedImagePaths });

  return {
    html,
    css: cssParts.join('\n'),
    diagnostics,
  };
}

module.exports = {
  MAX_CSS_BYTES,
  MAX_WIKITEXT_BYTES,
  evaluateMathExpr,
  normalizeResourceKey,
  renderCharacterWikitext,
  sanitizeScopedCss,
  sanitizeWikitextHtml,
  wikitextToHtml,
};
