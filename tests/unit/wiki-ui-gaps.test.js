'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '33333333-3333-4333-8333-333333333333';
const BEFORE_ID = '44444444-4444-4444-8444-444444444444';
const AFTER_ID = '55555555-5555-4555-8555-555555555555';
const THREAD_ID = '66666666-6666-4666-8666-666666666666';
const SECTION_ID = '77777777-7777-4777-8777-777777777777';

function makeFrontend(apiRequest = () => Promise.resolve({ data: [] })) {
  const elements = Object.create(null);
  const storage = new Map();
  const location = { href: 'http://localhost/wiki', pathname: '/wiki', search: '' };
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
    crypto: { randomUUID: () => THREAD_ID },
    Aetherverse: { apiRequest, setSessionUser: (user) => Object.assign({}, user), clearSessionUser: () => {} },
    addEventListener: () => {},
    scrollTo: () => {},
  };
  const document = {
    getElementById: (id) => elements[id] || (id === 'main' ? main : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = { window, document, URL, URLSearchParams, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(editorSource, context, { filename: 'editor.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  context.__elements = elements;
  context.__main = main;
  context.__storage = storage;
  context.render = () => {};
  return context;
}

function snapshot(title, html) {
  return {
    schemaVersion: 1,
    title,
    slug: 'synthetic-page',
    aliases: [],
    type: 'concept',
    summary: '',
    categories: ['Cosmologia'],
    accessLevel: 'public',
    audience: 'reader',
    body: {
      format: 'richtext-v1', infobox: [],
      sections: [{ id: SECTION_ID, heading: 'Visão sintética', html, blocks: [], authority: [], knowledgeLayer: 'unspecified' }],
    },
  };
}

test('public wiki category filters and backlinks use published navigation data', async () => {
  const calls = [];
  let backlinkPage = 0;
  const context = makeFrontend((method, url) => {
    calls.push({ method, url });
    if (url === '/api/wiki/categories?limit=100&offset=0') {
      return Promise.resolve({ data: [{ name: 'Cosmologia', key: 'cosmologia', pagesCount: 1 }] });
    }
    if (/\/api\/wiki\/pages\/[^/]+\/backlinks/.test(url)) {
      backlinkPage += 1;
      return Promise.resolve({
        data: [{ id: `88888888-8888-4888-8888-${String(backlinkPage).padStart(12, '0')}`, slug: `another-article-${backlinkPage}`, title: `Outro artigo ${backlinkPage}`, summary: 'Resumo público.' }],
        page: { hasMore: backlinkPage === 1 },
      });
    }
    return Promise.resolve({ data: [] });
  });
  context.currentPage = 'wiki';
  context.serverWikiCategories = null;
  context.loadWikiCategories(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call.method === 'GET' && call.url.startsWith('/api/wiki/categories')));
  context.serverWikiPages = [
    { id: PAGE_ID, slug: 'synthetic-page', title: 'Artigo incluído', summary: '', categories: ['Cosmologia'] },
    { id: THREAD_ID, slug: 'other-page', title: 'Artigo fora da categoria', summary: '', categories: ['Sociedade'] },
  ];
  context.wikiFilterCategory = 'cosmologia';
  const listing = context.renderWiki();
  assert.doesNotMatch(listing, /id="wiki-category-select"/);
  assert.match(listing, /Cosmologia/);
  assert.match(listing, /Artigo incluído/);
  assert.doesNotMatch(listing, /Artigo fora da categoria/);
  context.selectWikiCategory('all');
  assert.match(context.renderWiki(), /Artigo fora da categoria/);

  context.currentPage = 'wikiArticle';
  context.currentWikiSlug = 'synthetic-page';
  context.currentWikiArticle = {
    id: PAGE_ID, title: 'Artigo incluído', slug: 'synthetic-page', categories: ['Cosmologia'], aliases: [],
    discussionThreadId: THREAD_ID, body: snapshot('Artigo incluído', '<p>Conteúdo publicado.</p>').body,
  };
  context.wikiBacklinksState = { pageId: PAGE_ID, items: [], loading: false, loaded: false, error: null };
  context.loadWikiBacklinks(PAGE_ID, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const articleHtml = context.renderWikiArticle();
  assert.match(articleHtml, /Artigos que fazem referência/);
  assert.match(articleHtml, /Discussão pública/);
  assert.match(articleHtml, /Outro artigo 1/);
  assert.match(articleHtml, /Carregar mais referências/);
  assert.ok(calls.some((call) => call.method === 'GET' && call.url.startsWith(`/api/wiki/pages/${PAGE_ID}/backlinks`)));
  context.loadMoreWikiBacklinks(PAGE_ID);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(context.renderWikiBacklinks(PAGE_ID), /Outro artigo 2/);
  assert.ok(calls.some((call) => call.url.endsWith('limit=50&offset=1')));
  context.wikiBacklinksState = { pageId: PAGE_ID, items: [], loading: false, loaded: true, error: null };
  assert.match(context.renderWikiBacklinks(PAGE_ID), /Nenhum artigo publicado faz referência/);
});

test('staff revision comparison shows field and section changes from the staff history API', async () => {
  const calls = [];
  const before = { id: BEFORE_ID, sequence: 1, editSummary: 'Primeira versão', snapshot: snapshot('Título anterior', '<p>Texto anterior.</p>') };
  const after = {
    id: AFTER_ID,
    sequence: 2,
    editSummary: 'Atualização sintética',
    snapshot: snapshot('Título atualizado', '<p>Texto atualizado.</p>'),
    diff: { changedFields: ['title', 'body'], addedSections: [], removedSections: [], changedSections: [SECTION_ID] },
  };
  const context = makeFrontend((method, url) => {
    calls.push({ method, url });
    return Promise.resolve({ data: url.includes(AFTER_ID) ? after : before });
  });
  context.DB.session = { id: USER_ID, serverId: USER_ID, role: 'moderador' };
  context.currentPage = 'wikiEditor';
  context.currentWikiPageId = PAGE_ID;
  context.wikiEditorPage = { id: PAGE_ID, workVersion: 2 };
  context.wikiEditorHistory = { items: [after, before], loading: false, loaded: true, error: null };
  context.__elements['wiki-diff-before'] = { value: BEFORE_ID };
  context.__elements['wiki-diff-after'] = { value: AFTER_ID };

  const controls = context.renderWikiRevisionDiffControls(PAGE_ID);
  assert.match(controls, /Comparar revisões/);
  assert.match(controls, /Versão anterior/);
  context.compareWikiRevisions(PAGE_ID);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call.url.endsWith(`/revisions/${AFTER_ID}?compareTo=${BEFORE_ID}`)));
  const diff = context.renderWikiRevisionDiff(context.wikiEditorDiffState.result);
  assert.match(diff, /Título, Conteúdo/);
  assert.match(diff, /Título anterior/);
  assert.match(diff, /Título atualizado/);
  assert.match(diff, /Visão sintética/);
  assert.match(diff, /Texto anterior\./);
  assert.match(diff, /Texto atualizado\./);
});

test('staff can link and remove a selected public forum discussion', async () => {
  const calls = [];
  const thread = { id: THREAD_ID, title: 'Discussão pública sintética', categoryId: '99999999-9999-4999-8999-999999999999', categoryName: 'Wiki' };
  const context = makeFrontend((method, url, payload) => {
    calls.push({ method, url, payload });
    if (method === 'PATCH') return Promise.resolve({ data: {
      id: PAGE_ID, workVersion: payload.threadId ? 2 : 3, discussionThreadId: payload.threadId,
    } });
    if (method === 'GET' && url === `/api/forum/threads/${THREAD_ID}`) return Promise.resolve({ data: thread });
    return Promise.resolve({ data: [] });
  });
  context.DB.session = { id: USER_ID, serverId: USER_ID, role: 'admin' };
  context.currentPage = 'wikiEditor';
  context.currentWikiPageId = PAGE_ID;
  context.wikiEditorPage = { id: PAGE_ID, workVersion: 1, discussionThreadId: null };
  context.wikiEditorDiscussionState = {
    pageId: PAGE_ID, categories: [{ id: thread.categoryId, name: 'Wiki' }], selectedCategoryId: thread.categoryId,
    threads: [thread], loadingCategories: false, loadingThreads: false, error: null,
    currentThread: null, currentThreadId: null, loadingCurrentThread: false, saving: false,
    generation: 1, categorySequence: 0, threadsSequence: 0, currentThreadSequence: 0,
  };
  context.__elements['wiki-discussion-thread'] = { value: THREAD_ID };
  context.showAlert = () => {};

  const widget = context.renderWikiDiscussionEditor(PAGE_ID);
  assert.match(widget, /Discussão pública do artigo/);
  assert.match(widget, /Discussão pública sintética/);
  context.saveWikiDiscussionLink(PAGE_ID);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.find((call) => call.method === 'PATCH').payload.threadId, THREAD_ID);
  assert.equal(context.wikiEditorPage.discussionThreadId, THREAD_ID);

  context.removeWikiDiscussionLink(PAGE_ID);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const patches = calls.filter((call) => call.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.equal(patches[1].payload.threadId, null);
  assert.equal(context.wikiEditorPage.discussionThreadId, null);
});

test('empty wiki sections survive publication loading errors and parent filters include descendants', () => {
  const context = makeFrontend();
  context.serverWikiSections = [
    { key: 'paranormalidade', name: 'Paranormalidade', parentKey: null, pagesCount: 1 },
    { key: 'percepcao', name: 'Percepção', parentKey: 'paranormalidade', pagesCount: 1 },
    { key: 'classes', name: 'Classes', parentKey: 'paranormalidade', pagesCount: 0 },
  ];
  context.serverWikiCategories = [];
  context.serverWikiPages = null;
  context.wikiPagesLoadError = 'Synthetic publication read failed';
  let html = context.renderWiki();
  assert.match(html, /Classes/);
  assert.match(html, /Ainda não há artigos nesta seção/);
  assert.match(html, /Synthetic publication read failed/);
  context.wikiPagesLoadError = null;
  context.serverWikiPages = [
    { title: 'Descendant article', slug: 'descendant', categories: ['Percepção'] },
    { title: 'Other article', slug: 'other', categories: ['Cosmologia'] },
  ];
  context.wikiFilterCategory = 'paranormalidade';
  html = context.renderWiki();
  assert.match(html, /Descendant article/);
  assert.doesNotMatch(html, /Other article/);
  context.window.location.href = 'http://localhost/wiki?categoria=classes';
  context.parseRouteFromLocation();
  assert.equal(context.wikiFilterCategory, 'classes');
});


test('Wiki navigation resets the category while article category links preserve their explicit URL', () => {
  const context = makeFrontend();
  context.updateTopBar = () => {};
  context.wikiFilterCategory = 'percepcao';
  context.currentPage = 'wikiArticle';
  context.navigate('wiki');
  assert.equal(context.wikiFilterCategory, 'all');
  assert.equal(context.window.location.href, 'http://localhost/wiki');
  context.currentPage = 'wikiArticle';
  context.selectWikiCategory('percepcao');
  assert.equal(context.wikiFilterCategory, 'percepcao');
  assert.equal(context.window.location.href, 'http://localhost/wiki?categoria=percepcao');
  context.window.location.pathname = '/wiki';
  context.window.location.search = '?categoria=percepcao';
  context.navigate('wiki');
  assert.equal(context.wikiFilterCategory, 'all');
  assert.equal(context.window.location.href, 'http://localhost/wiki');
});
