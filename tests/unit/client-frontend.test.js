'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const editorSource = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function makeFrontend(options = {}) {
  const store = new Map();
  const elements = Object.create(null);
  const main = {
    contains: () => true,
    getAttribute: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
  };
  const document = {
    getElementById: (id) => elements[id] || (id === 'main' ? main : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window = {
    location: { href: 'http://localhost:3000/forum' },
    localStorage: {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    Aetherverse: Object.assign({
      allowedImagePaths: ['/assets/logo.png'],
      apiRequest: options.apiRequest || (() => Promise.resolve({})),
      setSessionUser: (user) => Object.assign({}, user),
      clearSessionUser: () => {},
    }, options.api || {}),
    addEventListener: () => {},
    scrollTo: () => {},
  };
  const context = { window, document, URL, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(editorSource, context, { filename: 'editor.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  context.__elements = elements;
  context.__store = store;
  context.__main = main;
  return context;
}

function field(value = '') {
  return { value, innerHTML: '', textContent: '', style: { display: 'block' }, disabled: false };
}

test('rich-text editor URLs allow intended HTTP(S)/local links and HTTPS/allowlisted images only', () => {
  const context = makeFrontend();
  const safe = (url, image) => context.editorSafeContentUrl(url, image ? { image: true } : undefined);

  assert.equal(safe('https://example.test/wiki?a=1'), 'https://example.test/wiki?a=1');
  assert.equal(safe('http://example.test/wiki'), 'http://example.test/wiki');
  assert.equal(safe('/wiki/entrada'), '/wiki/entrada');
  assert.equal(safe('#referencias'), '#referencias');
  assert.equal(safe('https://example.test/image.png', true), 'https://example.test/image.png');
  assert.equal(safe('/assets/logo.png', true), '/assets/logo.png');

  for (const value of [
    'javascript:alert(1)', 'java%73cript:alert(1)', 'jav&#x61;script:alert(1)',
    'data:text/html,boom', 'file:///etc/passwd', '//evil.test/image.png',
    '%2f%2fevil.test/path', 'https://user:pass@example.test/path', 'https://example.test/a b',
  ]) assert.equal(safe(value), null, value);
  assert.equal(safe('http://example.test/image.png', true), null);
  assert.equal(safe('/not-allowlisted.png', true), null);
});

test('forum drafts are versioned and scoped to the current server account', () => {
  const context = makeFrontend();
  context.DB.session = { id: USER_A, serverId: USER_A };
  assert.equal(context.writeForumDraft('topic', 'new', {
    categoryId: 'category-1', title: 'Rascunho', tag: 'wiki', content: '<p>Texto.</p>', password: 'never-save',
  }, '33333333-3333-4333-8333-333333333333'), true);
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:topic:new`;
  const stored = JSON.parse(context.__store.get(keyA));
  assert.equal(stored.version, 1);
  assert.equal(stored.accountId, USER_A);
  assert.equal(stored.values.content, '<p>Texto.</p>');
  assert.equal(Object.hasOwn(stored.values, 'password'), false);
  assert.equal(context.readForumDraft('topic', 'new').values.title, 'Rascunho');

  context.DB.session = { id: USER_B, serverId: USER_B };
  assert.equal(context.readForumDraft('topic', 'new'), null);
  assert.equal(context.writeForumDraft('reply', 'thread-1', { content: '<p>Resposta B.</p>' }), true);
  assert.notEqual([...context.__store.keys()].find((key) => key.includes('reply')), keyA);

  context.clearForumDraft('topic', 'new', USER_A);
  assert.equal(context.__store.has(keyA), false);
});

test('changing or ending a forum session clears visible in-memory drafts', () => {
  const context = makeFrontend();
  context.DB.session = { id: USER_A, serverId: USER_A };
  context.__elements['thread-title'] = field('Draft from A');
  context.__elements['thread-editor'] = field();
  context.__elements['thread-editor'].innerHTML = '<p>Draft from A</p>';
  context.pendingTopicKey = '33333333-3333-4333-8333-333333333333';
  context.pendingTopicPayload = '{"title":"Draft from A"}';
  context.writeForumDraft('topic', 'new', { categoryId: 'cat', title: 'Draft from A', tag: 'ooc', content: '<p>Draft from A</p>' });

  context.applyServerSession({ id: USER_B, username: 'Bia', role: 'member' });
  assert.equal(context.__elements['thread-title'].value, '');
  assert.equal(context.__elements['thread-editor'].innerHTML, '');
  assert.equal(context.pendingTopicKey, null);
  assert.equal(context.readForumDraft('topic', 'new'), null);

  context.applyServerSession(null);
  assert.equal(context.DB.session, null);
});

test('scene-turn writes leave timestamps and edited state to the server', () => {
  const calls = [];
  const context = makeFrontend({ apiRequest: (...args) => { calls.push(args); } });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Teste' };
  context.currentCena = 'scene-1';
  context.listaWikiPosts = () => [{ id: 'scene-1', turns: [{ id: 'turn-1', version: 7 }] }];
  context.getEditorContent = () => '<p>Turno.</p>';
  context.lerImagensExtrasTurno = () => [];
  for (const id of ['turn-char-name', 'turn-char-title', 'turn-char-avatar', 'turn-title', 'turn-location',
    'turn-font', 'turn-accent', 'turn-banner-url', 'turn-banner-style', 'turn-ooc', 'edit-turn-char-name',
    'edit-turn-char-title', 'edit-turn-char-avatar', 'edit-turn-title', 'edit-turn-location', 'edit-turn-accent',
    'edit-turn-banner', 'edit-turn-banner-style', 'edit-turn-ooc']) context.__elements[id] = field('');
  context.__elements['turn-font'].value = 'serif';
  context.__elements['turn-accent'].value = '#ffffff';
  context.__elements['turn-banner-style'].value = 'panoramic';
  context.__elements['edit-turn-accent'].value = '#ffffff';
  context.__elements['edit-turn-banner-style'].value = 'panoramic';

  context.publicarTurnoCena();
  context.salvarEdicaoTurno('turn-1');
  assert.deepEqual(calls.map(([method]) => method), ['POST', 'PUT']);
  assert.equal(Object.hasOwn(calls[0][2], 'date'), false);
  assert.equal(Object.hasOwn(calls[1][2], 'edited'), false);
  assert.equal(calls[1][2].expectedVersion, 7);
});

test('reply drafts survive failed requests and clear after a successful post', async () => {
  const context = makeFrontend({ apiRequest: () => Promise.reject(new Error('offline')) });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'thread';
  context.currentThread = 'thread-1';
  context.__elements['reply-editor'] = field();
  context.__elements['reply-editor'].innerHTML = '<p>Resposta pendente.</p>';
  context.showAlert = () => {};
  context.loadForumThread = () => {};

  context.submitReply();
  await new Promise((resolve) => setImmediate(resolve));
  const failedDraft = context.readForumDraft('reply', 'thread-1');
  assert.equal(failedDraft.values.content, '<p>Resposta pendente.</p>');
  assert.ok(failedDraft.idempotencyKey);

  context.window.Aetherverse.apiRequest = () => Promise.resolve({});
  context.submitReply();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.readForumDraft('reply', 'thread-1'), null);
});

test('character JSON import waits for safe server HTML before changing form fields', async () => {
  let resolvePreview;
  const requestBodies = [];
  const context = makeFrontend({ apiRequest: (method, route, body) => {
    requestBodies.push({ method, route, body });
    return new Promise((resolve) => { resolvePreview = resolve; });
  } });
  const source = field(JSON.stringify({ nome: 'Novo nome', descricao: '<img src=x onerror=alert(1)>' }));
  context.__elements['import-char-json'] = source;
  context.__elements['p-nome'] = field('Nome anterior');
  context.__elements['p-editor'] = field('HTML anterior');
  context.__elements['p-editor'].innerHTML = 'HTML anterior';
  context.closeModal = () => {};
  context.showAlert = () => {};
  const setValues = [];
  context.setEditorContent = (id, html) => { setValues.push([id, html]); context.__elements[id].innerHTML = html; return true; };

  const pending = context.confirmImportPersonagemJson();
  assert.equal(context.__elements['p-nome'].value, 'Nome anterior');
  assert.equal(context.__elements['p-editor'].innerHTML, 'HTML anterior');
  assert.deepEqual(JSON.parse(JSON.stringify(requestBodies)), [{
    method: 'POST', route: '/api/content/preview', body: { html: '<img src=x onerror=alert(1)>' },
  }]);
  resolvePreview({ html: '<p>Conteúdo seguro</p>', formattingLoss: { discarded: true } });
  await pending;
  assert.equal(context.__elements['p-nome'].value, 'Novo nome');
  assert.deepEqual(setValues, [['p-editor', '<p>Conteúdo seguro</p>']]);
  assert.equal(context.__elements['p-editor'].innerHTML, '<p>Conteúdo seguro</p>');
});

test('scene JSON import waits for safe HTML and blocks before changing the builder', async () => {
  let resolvePreview;
  const requestBodies = [];
  const context = makeFrontend({ apiRequest: (method, route, body) => {
    requestBodies.push({ method, route, body });
    return new Promise((resolve) => { resolvePreview = resolve; });
  } });
  const source = field(JSON.stringify({
    titulo: 'Cena nova', descricao: '<script>alert(1)</script>',
    blocks: [{ type: 'section', content: '<img src=x onerror=alert(1)>' }],
  }));
  context.__elements['import-cena-json'] = source;
  context.__elements['c-titulo'] = field('Cena anterior');
  context.__elements['c-editor'] = field();
  context.__elements['c-editor'].innerHTML = 'HTML anterior';
  context.activeBuilderBlocks = [{ type: 'section', content: 'Bloco anterior' }];
  context.closeModal = () => {};
  context.showAlert = () => {};
  context.refreshBuilderDOM = () => {};
  context.setEditorContent = (id, html) => { context.__elements[id].innerHTML = html; return true; };

  const pending = context.confirmImportCenaJson();
  assert.equal(context.__elements['c-titulo'].value, 'Cena anterior');
  assert.equal(context.__elements['c-editor'].innerHTML, 'HTML anterior');
  assert.equal(context.activeBuilderBlocks[0].content, 'Bloco anterior');
  assert.deepEqual(JSON.parse(JSON.stringify(requestBodies)), [{
    method: 'POST', route: '/api/content/preview', body: {
      html: '<script>alert(1)</script>',
      blocks: [{ type: 'section', content: '<img src=x onerror=alert(1)>' }],
    },
  }]);
  resolvePreview({ html: '<p>Conteúdo seguro</p>', blocks: [{ type: 'section', content: '<p>Bloco seguro</p>' }] });
  await pending;
  assert.equal(context.__elements['c-titulo'].value, 'Cena nova');
  assert.equal(context.__elements['c-editor'].innerHTML, '<p>Conteúdo seguro</p>');
  assert.equal(context.activeBuilderBlocks[0].content, '<p>Bloco seguro</p>');
});
