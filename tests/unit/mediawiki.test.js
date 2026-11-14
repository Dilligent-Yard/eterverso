'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateMathExpr,
  normalizeResourceKey,
  renderCharacterWikitext,
  sanitizeScopedCss,
} = require('../../server/mediawiki');

test('normalizeResourceKey normalizes prefixes, underscores, case, and whitespace', () => {
  assert.equal(normalizeResourceKey('Predefinição:Ficha_Básica  RPG'), 'ficha básica rpg');
  assert.equal(normalizeResourceKey('Module:Cartao_Lua'), 'cartao lua');
  assert.equal(normalizeResourceKey('TemplateStyles:Estilo_Principal'), 'estilo principal');
});

test('wikitext renders headings, formatting, lists, tables, links, images, and nowiki safely', () => {
  const result = renderCharacterWikitext({
    wikitext: [
      '== História ==',
      "Um texto com '''negrito''', ''itálico'' e <nowiki>'''literal''' {{nao_expande}}</nowiki>.",
      '* Item um',
      '* Item dois',
      '# Passo 1',
      '# Passo 2',
      '{| class="wikitable"',
      '! Atributo !! Valor',
      '|-',
      '| Força || 18',
      '|}',
      '[https://example.com/lore Arquivo externo]',
      '[[Imagem:https://example.com/avatar.png|Retrato oficial]]',
    ].join('\n'),
  });

  assert.match(result.html, /<h2[^>]*>História<\/h2>/);
  assert.match(result.html, /<strong>negrito<\/strong>/);
  assert.match(result.html, /<em>itálico<\/em>/);
  assert.match(result.html, /'''literal''' \{\{nao_expande\}\}/);
  assert.match(result.html, /<ul><li>Item um<\/li><li>Item dois<\/li><\/ul>/);
  assert.match(result.html, /<ol><li>Passo 1<\/li><li>Passo 2<\/li><\/ol>/);
  assert.match(result.html, /<table class="wikitable">/);
  assert.match(result.html, /<th>Atributo<\/th><th>Valor<\/th>/);
  assert.match(result.html, /<td>Força<\/td><td>18<\/td>/);
  assert.match(result.html, /<a href="https:\/\/example\.com\/lore"[^>]*>Arquivo externo<\/a>/);
  assert.match(result.html, /<img src="https:\/\/example\.com\/avatar\.png" alt="Retrato oficial"/);
});

test('templates support parameters, defaults, noinclude/includeonly, nesting, and recursion guard', () => {
  const resources = [
    {
      kind: 'template',
      name: 'Cabecalho',
      content: '<noinclude>Documentação ignorada</noinclude><includeonly><div class="mw-ficha-banner"><strong>{{{nome|Sem Nome}}}</strong> — {{{sub|{{Patente|grau={{{grau|Recruta}}}}}}}}</div></includeonly>',
    },
    {
      kind: 'template',
      name: 'Patente',
      content: '<span class="mw-ficha-tag">{{{grau|Civil}}}</span>',
    },
    {
      kind: 'template',
      name: 'CicloA',
      content: 'A {{CicloA}}',
    },
  ];

  const ok = renderCharacterWikitext({
    wikitext: '{{Cabecalho|nome=Lyra|grau=Arcanista}}',
    resources,
  });
  assert.doesNotMatch(ok.html, /Documentação ignorada/);
  assert.match(ok.html, /<div class="mw-ficha-banner"><strong>Lyra<\/strong> — <span class="mw-ficha-tag">Arcanista<\/span><\/div>/);

  const cycle = renderCharacterWikitext({
    wikitext: '{{CicloA}}',
    resources,
  });
  assert.ok(cycle.diagnostics.some((d) => d.level === 'error' && /Ciclo|Profundidade/i.test(d.message)));
});

test('parser functions evaluate #if, #ifeq, #switch, #expr, #ifexpr, string helpers, and character variables', () => {
  assert.equal(evaluateMathExpr('((10 + 2) * 3) / 4'), 9);
  assert.equal(evaluateMathExpr('10 >= 5 and 2 < 3'), 1);

  const result = renderCharacterWikitext({
    wikitext: [
      'Nome: {{PAGENAME}} | Raça: {{FICHA_RACA}}',
      '{{#if:{{FICHA_FACCAO}}|Facção: {{FICHA_FACCAO}}|Independente}}',
      '{{#ifeq:{{{ok|sim}}}|sim|Confirmado|Negado}}',
      '{{#switch:ouro|bronze=Tier 1|prata=Tier 2|ouro=Tier 3|#default=Desconhecido}}',
      'Calc: {{#expr:(4 + 6) * 2}} / {{#ifexpr:15 > 10|Alto|Baixo}}',
      'Texto: {{uc:éther}} / {{lc:SOL}} / {{#len:abcd}} / {{#sub:Eterverso|0|4}} / {{#replace:A-B-C|-|:}}',
    ].join('\n'),
    character: {
      nome: 'Kael',
      raca: 'Elfo Solar',
      faccao: '',
    },
  });

  assert.match(result.html, /Nome: Kael \| Raça: Elfo Solar/);
  assert.match(result.html, /Independente/);
  assert.match(result.html, /Confirmado/);
  assert.match(result.html, /Tier 3/);
  assert.match(result.html, /Calc: 20 \/ Alto/);
  assert.match(result.html, /Texto: ÉTHER \/ sol \/ 4 \/ Eter \/ A:B:C/);
});

test('Lua modules run in sandbox with mw.html, frame args, parent frame, preprocess, and require', () => {
  const resources = [
    {
      kind: 'lua',
      name: 'Util',
      content: [
        'local U = {}',
        'function U.formatar(txt) return "[" .. mw.text.trim(txt or "") .. "]" end',
        'return U',
      ].join('\n'),
    },
    {
      kind: 'lua',
      name: 'Cartao',
      content: [
        'local Util = require("Módulo:Util")',
        'local p = {}',
        'function p.render(frame)',
        '  local box = mw.html.create("div"):addClass("mw-lua-box")',
        '  local parent = frame:getParent()',
        '  local titulo = (parent and parent.args.titulo) or frame.args.titulo or "Sem Título"',
        '  box:tag("strong"):wikitext(Util.formatar(titulo)):done()',
        '  box:tag("span"):wikitext(" · " .. frame:preprocess("{{#expr:2+3}}"))',
        '  return tostring(box)',
        'end',
        'return p',
      ].join('\n'),
    },
    {
      kind: 'template',
      name: 'UsarCartao',
      content: '{{#invoke:Cartao|render}}',
    },
  ];

  const direct = renderCharacterWikitext({
    wikitext: '{{#invoke:Cartao|render|titulo=Guardião}}',
    resources,
  });
  assert.equal(direct.diagnostics.length, 0);
  assert.match(direct.html, /<div class="mw-lua-box"><strong>\[Guardião\]<\/strong><span> · 5<\/span><\/div>/);

  const viaTemplate = renderCharacterWikitext({
    wikitext: '{{UsarCartao|titulo=Sentinela}}',
    resources,
  });
  assert.equal(viaTemplate.diagnostics.length, 0);
  assert.match(viaTemplate.html, /\[Sentinela\]/);
});

test('Lua sandbox blocks os/io/debug/load and aborts infinite loops via instruction hook', () => {
  const resources = [
    {
      kind: 'lua',
      name: 'Perigoso',
      content: [
        'local p = {}',
        'function p.probe()',
        '  return table.concat({ type(os), type(io), type(debug), type(load), type(dofile) }, ",")',
        'end',
        'function p.loop()',
        '  while true do end',
        'end',
        'return p',
      ].join('\n'),
    },
  ];

  const probe = renderCharacterWikitext({ wikitext: '{{#invoke:Perigoso|probe}}', resources });
  assert.match(probe.html, /nil,nil,nil,nil,nil/);

  const loop = renderCharacterWikitext({ wikitext: '{{#invoke:Perigoso|loop}}', resources });
  assert.match(loop.html, /mw-error/);
  assert.ok(loop.diagnostics.some((d) => d.level === 'error' && /limite de instruções/i.test(d.message)));
});

test('CSS sanitizer scopes selectors, integrates TemplateStyles, and strips dangerous CSS and HTML XSS', () => {
  const diagnostics = [];
  const css = sanitizeScopedCss([
    '@import url("https://evil.test/x.css");',
    '@font-face { font-family: Evil; src: url("x"); }',
    '.mw-card, h2 { color: #ffcc88; background: url(javascript:alert(1)); border: 1px solid #445; width: expression(alert(1)); }',
    '@media (max-width: 700px) { .mw-card { padding: 8px; } }',
    'body { behavior: url(evil.htc); }',
  ].join('\n'), '.char-mw-scope-abc', { diagnostics, sourceLabel: 'Teste' });

  assert.doesNotMatch(css, /@import|@font-face|javascript:|expression|behavior/);
  assert.match(css, /\.char-mw-scope-abc \.mw-card, \.char-mw-scope-abc h2 \{ color:#ffcc88;border:1px solid #445; \}/);
  assert.match(css, /@media \(max-width: 700px\) \{\s*\.char-mw-scope-abc \.mw-card \{ padding:8px; \}\s*\}/);
  assert.ok(diagnostics.length >= 3);

  const rendered = renderCharacterWikitext({
    wikitext: [
      '<templatestyles src="Estilo:Ficha" />',
      '<div class="mw-card" onclick="alert(1)" style="background-image:url(javascript:alert(1));color:#eee">Seguro</div>',
      '<script>alert(1)</script><svg onload="alert(1)"></svg><iframe src="https://evil.test"></iframe>',
      '[javascript:alert(1) Clique malicioso]',
    ].join('\n'),
    customCss: '.mw-card { border-radius: 10px; }',
    scopeSelector: '.char-mw-scope-123',
    resources: [
      { kind: 'css', name: 'Ficha', content: '.mw-card { color: #cde; }' },
    ],
  });

  assert.match(rendered.css, /\.char-mw-scope-123 \.mw-card \{ color:#cde; \}/);
  assert.match(rendered.css, /\.char-mw-scope-123 \.mw-card \{ border-radius:10px; \}/);
  assert.doesNotMatch(rendered.html, /<a\b|<script|<svg|<iframe|onclick|onerror|onload|href\s*=/i);
  assert.match(rendered.html, /<div class="mw-card"[^>]*style="color:#eee"[^>]*>Seguro<\/div>/);
});

test('Lua loader handles multi-byte UTF-8 Portuguese strings across modules and require()', () => {
  const resources = [
    {
      kind: 'lua',
      name: 'AcentosBase',
      content: [
        'local b = {}',
        'function b.saudacao()',
        '  return "Saída gerada por Lua — ação e coração"',
        'end',
        'return b',
      ].join('\n'),
    },
    {
      kind: 'lua',
      name: 'AcentosPrincipal',
      content: [
        'local base = require("AcentosBase")',
        'local p = {}',
        'function p.render(frame)',
        '  local titulo = mw.text.trim(frame.args.titulo or "Descrição Padrão")',
        '  return tostring(mw.html.create("div"):addClass("mw-lua-box"):wikitext(titulo .. ": " .. base.saudacao()))',
        'end',
        'return p',
      ].join('\n'),
    },
  ];

  const rendered = renderCharacterWikitext({
    wikitext: '{{#invoke:AcentosPrincipal|render|titulo=Crônica Épica}}',
    resources,
  });
  assert.equal(rendered.diagnostics.length, 0);
  assert.match(rendered.html, /Crônica Épica: Saída gerada por Lua — ação e coração/);
});

