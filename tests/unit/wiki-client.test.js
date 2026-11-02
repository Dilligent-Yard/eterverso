'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PAGE_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

function makeFrontend(options = {}) {
  const storage = new Map();
  const elements = Object.create(null);
  const listeners = Object.create(null);
  const location = { href: 'http://localhost/wiki', pathname: '/wiki' };
  const main = { innerHTML: '', contains: () => true, getAttribute: () => null, setAttribute: () => {}, addEventListener: () => {} };
  const window = {
    location,
    history: {
      pushState: (_state, _title, url) => { location.pathname = url; location.href = 'http://localhost' + url; },
      replaceState: (_state, _title, url) => { location.pathname = url; location.href = 'http://localhost' + url; },
    },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    crypto: { randomUUID: (() => { let next = 0; return () => `55555555-5555-4555-8555-${String(++next).padStart(12, '0')}`; })() },
    Aetherverse: {
      apiRequest: options.apiRequest || (() => Promise.resolve({ data: [] })),
      setSessionUser: (user) => Object.assign({}, user),
      clearSessionUser: () => {},
    },
    addEventListener: (name, listener) => { listeners[name] = listener; },
    scrollTo: () => {},
  };
  const document = {
    getElementById: (id) => elements[id] || (id === 'main' ? main : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = { window, document, URL, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(editorSource, context, { filename: 'editor.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  context.__storage = storage;
  context.__elements = elements;
  context.__listeners = listeners;
  context.__main = main;
  return context;
}

function article(overrides = {}) {
  return {
    id: PAGE_ID,
    title: 'Synthetic reference page',
    slug: 'synthetic-reference-page',
    aliases: [],
    type: 'concept',
    summary: 'A synthetic summary.',
    categories: ['Synthetic category'],
    accessLevel: 'public',
    audience: 'reader',
    publishedRevisionId: REVISION_ID,
    publicVersion: 1,
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{
        id: '66666666-6666-4666-8666-666666666666',
        heading: 'Synthetic section',
        html: '<p>Server-sanitized article content.</p>',
        blocks: [],
        authority: [],
        knowledgeLayer: 'unspecified',
      }],
    },
    ...overrides,
  };
}

test('wiki and character routes stay distinct and direct article/editor/proposal links resolve', () => {
  const context = makeFrontend();
  context.window.location.pathname = '/wiki';
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'wiki');
  assert.equal(context.routePath('personagens'), '/personagens');

  context.window.location.pathname = '/wiki/synthetic-reference-page';
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'wikiArticle');
  assert.equal(context.currentWikiSlug, 'synthetic-reference-page');

  context.window.location.pathname = `/wiki/editor/${PAGE_ID}`;
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'wikiEditor');
  assert.equal(context.currentWikiPageId, PAGE_ID);

  context.window.location.pathname = `/wiki/propostas/${PAGE_ID}`;
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'wikiProposal');
  assert.equal(context.currentWikiPageId, PAGE_ID);

  context.window.location.pathname = '/personagens';
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'personagens');

  context.window.location.pathname = `/personagens/${PAGE_ID}`;
  context.parseRouteFromLocation();
  assert.equal(context.currentPage, 'personagemView');
});

test('wiki listing escapes server metadata and keeps the empty state empty', () => {
  const context = makeFrontend();
  context.serverWikiPages = [{
    id: PAGE_ID,
    title: '<img src=x onerror=alert(1)>',
    slug: 'safe-slug',
    summary: '<script>private marker</script>',
    aliases: ['<b>alias</b>'],
    categories: ['<svg onload=alert(1)>'],
  }];
  const listing = context.renderWiki();
  assert.match(listing, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(listing, /&lt;script&gt;private marker&lt;\/script&gt;/);
  assert.doesNotMatch(listing, /<script>|<svg|<img src=x/);

  context.serverWikiPages = [];
  const empty = context.renderWiki();
  assert.match(empty, /Ainda não há artigos publicados/);
  assert.doesNotMatch(empty, /Synthetic reference page/);
});

test('article renders only supplied safe body HTML and varies proposal/edit controls by role', () => {
  const context = makeFrontend();
  context.currentWikiSlug = 'synthetic-reference-page';
  context.currentWikiArticle = article({
    title: '<svg onload=alert(1)>Synthetic</svg>',
    body: {
      format: 'richtext-v1', infobox: [], sections: [{
        id: '66666666-6666-4666-8666-666666666666',
        heading: '<script>heading marker</script>',
        html: '<p>Server-sanitized article content.</p>',
        blocks: [], authority: [], knowledgeLayer: 'unspecified',
      }],
    },
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Member', role: 'member' };
  let html = context.renderWikiArticle();
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;Synthetic&lt;\/svg&gt;/);
  assert.match(html, /&lt;script&gt;heading marker&lt;\/script&gt;/);
  assert.match(html, /<p>Server-sanitized article content\.<\/p>/);
  assert.match(html, /Propor uma edição/);
  assert.doesNotMatch(html, /<script>heading marker|<svg onload/);

  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Staff', role: 'moderador' };
  html = context.renderWikiArticle();
  assert.match(html, /Editar artigo/);
  assert.doesNotMatch(html, /Propor uma edição/);
});

test('wiki drafts and retry keys are account-scoped and change when the request changes', () => {
  const context = makeFrontend();
  context.DB.session = { id: USER_A, serverId: USER_A, role: 'member' };
  const snapshot = {
    schemaVersion: 1,
    title: 'Synthetic proposal',
    slug: 'synthetic-proposal',
    aliases: [],
    type: 'concept',
    summary: '',
    categories: [],
    accessLevel: 'public',
    audience: 'reader',
    body: { format: 'richtext-v1', infobox: [], sections: [] },
  };
  const payload = { snapshot, basePublishedRevisionId: REVISION_ID, summary: 'Synthetic edit.' };
  const first = context.wikiIdempotencyKeyForDraft('proposal', PAGE_ID, payload);
  const retry = context.wikiIdempotencyKeyForDraft('proposal', PAGE_ID, payload);
  assert.equal(first, retry);
  assert.equal(context.readWikiDraft('proposal', PAGE_ID).snapshot.title, 'Synthetic proposal');

  const changedPayload = { ...payload, summary: 'Changed synthetic edit.' };
  const changedKey = context.wikiIdempotencyKeyForDraft('proposal', PAGE_ID, changedPayload);
  assert.notEqual(changedKey, first);

  context.DB.session = { id: USER_B, serverId: USER_B, role: 'member' };
  assert.equal(context.readWikiDraft('proposal', PAGE_ID), null);
  assert.equal(context.writeWikiDraft('proposal', PAGE_ID, snapshot, { summary: 'Member B draft.' }), true);
  assert.equal([...context.__storage.keys()].filter((key) => key.includes(':proposal:')).length, 2);
});

test('proposal recovery waits for authenticated preview before inserting saved HTML', async () => {
  const rawMarker = '<img src=x onerror=alert(1)>local-only marker';
  const safeMarkup = '<p>Preview-checked synthetic content.</p>';
  const context = makeFrontend({ apiRequest: (method, url) => {
    if (method === 'GET' && /\/api\/wiki\/pages\/[^/]+\/backlinks/.test(url)) return Promise.resolve({ data: [] });
    assert.equal(method, 'POST');
    assert.equal(url, '/api/content/preview');
    return Promise.resolve({ html: safeMarkup });
  } });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Member', role: 'member' };
  context.currentPage = 'wikiArticle';
  context.currentWikiSlug = 'synthetic-reference-page';
  context.currentWikiArticle = article();
  context.__elements['wiki-proposal-body'] = {};
  const draft = article({
    body: {
      format: 'richtext-v1', infobox: [], sections: [{
        id: '66666666-6666-4666-8666-666666666666', heading: 'Synthetic section',
        html: rawMarker, blocks: [{ type: 'untrusted', value: rawMarker }], authority: [], knowledgeLayer: 'unspecified',
      }],
    },
  });
  context.writeWikiDraft('proposal', PAGE_ID, draft, { summary: 'Synthetic local draft.' });

  context.render();
  assert.doesNotMatch(context.__main.innerHTML, /onerror=alert|local-only marker/);
  assert.match(context.__main.innerHTML, /Validando o conteúdo do rascunho local/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(context.__main.innerHTML, /Preview-checked synthetic content/);
  assert.doesNotMatch(context.__main.innerHTML, /onerror=alert|local-only marker|untrusted/);
});

test('proposal preview failure keeps local HTML out of the page and leaves the draft recoverable', async () => {
  const rawMarker = '<svg onload=alert(1)>private saved text</svg>';
  const context = makeFrontend({ apiRequest: () => Promise.reject(new Error('preview unavailable')) });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Member', role: 'member' };
  context.currentPage = 'wikiArticle';
  context.currentWikiSlug = 'synthetic-reference-page';
  context.currentWikiArticle = article();
  context.__elements['wiki-proposal-body'] = {};
  const draft = article({ body: {
    format: 'richtext-v1', infobox: [], sections: [{
      id: '66666666-6666-4666-8666-666666666666', heading: 'Synthetic section',
      html: rawMarker, blocks: [], authority: [], knowledgeLayer: 'unspecified',
    }],
  } });
  context.writeWikiDraft('proposal', PAGE_ID, draft, { summary: 'Synthetic local draft.' });

  context.render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(context.__main.innerHTML, /Não foi possível validar o rascunho local/);
  assert.doesNotMatch(context.__main.innerHTML, /onload=alert|private saved text/);
  assert.equal(context.readWikiDraft('proposal', PAGE_ID).snapshot.body.sections[0].html, rawMarker);
});

test('staff editor applies recovered sections only when every preview succeeds', async () => {
  const rawOne = '<img src=x onerror=alert(1)>first private section';
  const rawTwo = '<script>second private section</script>';
  const context = makeFrontend({ apiRequest: (_method, url, payload) => {
    if (url === '/api/content/preview') {
      if (payload.html === rawTwo) return Promise.reject(new Error('preview unavailable'));
      return Promise.resolve({ html: '<p>Partially previewed synthetic text.</p>' });
    }
    return Promise.resolve({ data: [] });
  } });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Staff', role: 'moderador' };
  context.currentPage = 'wikiEditor';
  context.currentWikiPageId = PAGE_ID;
  context.wikiEditorLoadedId = PAGE_ID;
  context.wikiEditorPage = {
    id: PAGE_ID, workVersion: 1, headRevisionId: REVISION_ID, publishedRevisionId: REVISION_ID,
    archivedAt: null,
    head: { snapshot: article({ body: {
      format: 'richtext-v1', infobox: [], sections: [
        { id: '66666666-6666-4666-8666-666666666666', heading: 'Server section one', html: '<p>Server safe one.</p>', blocks: [], authority: [], knowledgeLayer: 'unspecified' },
        { id: '77777777-7777-4777-8777-777777777777', heading: 'Server section two', html: '<p>Server safe two.</p>', blocks: [], authority: [], knowledgeLayer: 'unspecified' },
      ],
    } }) },
  };
  const localDraft = article({ body: {
    format: 'richtext-v1', infobox: [], sections: [
      { id: '66666666-6666-4666-8666-666666666666', heading: 'Recovered one', html: rawOne, blocks: [], authority: [], knowledgeLayer: 'unspecified' },
      { id: '77777777-7777-4777-8777-777777777777', heading: 'Recovered two', html: rawTwo, blocks: [], authority: [], knowledgeLayer: 'unspecified' },
    ],
  } });
  context.writeWikiDraft('editor', PAGE_ID, localDraft, { summary: 'Synthetic local staff draft.', baseWorkVersion: 1 });

  context.render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(context.__main.innerHTML, /Server safe one\./);
  assert.match(context.__main.innerHTML, /Server safe two\./);
  assert.match(context.__main.innerHTML, /preview unavailable/);
  assert.doesNotMatch(context.__main.innerHTML, /onerror=alert|first private section|second private section/);
  assert.equal(context.wikiEditorDraftRestoreCompleteKey, null);
  assert.equal(context.readWikiDraft('editor', PAGE_ID).snapshot.body.sections[0].html, rawOne);
});

test('editorial list discards late responses after account changes and staff demotion', async () => {
  let resolve;
  const context = makeFrontend({ apiRequest: () => new Promise(done => { resolve = done; }) });
  context.DB.session = { id: USER_A, serverId: USER_A, role: 'admin' };
  context.loadWikiStaff(null);
  context.applyServerSession({ id: USER_B, role: 'member' });
  resolve({ data: [{ id: PAGE_ID, head: { snapshot: article() } }], page: { hasMore: false } });
  await new Promise(done => setImmediate(done));
  assert.equal(context.wikiStaffState.items, null);
  context.DB.session = { id: USER_A, serverId: USER_A, role: 'moderador' };
  context.wikiStaffState.article = { id: PAGE_ID, head: { snapshot: article() } };
  context.applyServerSession({ id: USER_A, role: 'member' });
  assert.equal(context.wikiStaffState.article, null);
  assert.match(context.renderWikiStaffArticle(), /restrita à staff/);
});


test('history navigation invalidates cached staff heads instead of displaying pre-save data', () => {
  const context = makeFrontend();
  context.DB.session = { id: USER_A, serverId: USER_A, role: 'admin' };
  context.wikiStaffState.article = { id: PAGE_ID, head: { snapshot: article() } };
  context.window.location.pathname = '/wiki/rascunhos/' + PAGE_ID;
  context.updateTopBar = () => {};
  context.render = () => {};
  context.__listeners.popstate();
  assert.equal(context.currentPage, 'wikiStaffArticle');
  assert.equal(context.wikiStaffState.article, null);
});


test('delayed public publication invalidates the reader before rendering and ignores another account', async () => {
  for (const switchAccount of [false, true]) {
    let resolve;
    const context = makeFrontend({ apiRequest: () => new Promise(done => { resolve = done; }) });
    context.DB.session = { id: USER_A, serverId: USER_A, role: 'admin' };
    context.wikiEditorPage = { id: PAGE_ID, headRevisionId: REVISION_ID, workVersion: 2, publishedRevisionId: null };
    context.currentWikiArticle = article();
    context.window.confirm = () => true;
    context.beginResourceFormSubmission = () => () => {};
    context.loadWikiEditorHistory = () => {};
    context.showAlert = () => {};
    const rendered = [];
    context.render = () => rendered.push(context.currentWikiArticle);
    context.publishWikiArticle();
    if (switchAccount) context.applyServerSession({ id: USER_B, role: 'member' });
    context.currentPage = 'wikiArticle';
    resolve({ data: { id: PAGE_ID } });
    await new Promise(done => setImmediate(done));
    if (switchAccount) {
      assert.equal(context.wikiEditorPage, null);
      assert.equal(rendered.length, 0);
    } else assert.deepEqual(rendered, [null]);
  }
});
