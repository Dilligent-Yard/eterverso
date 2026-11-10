'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const editorSource = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const bundleSource = fs.readFileSync(path.join(ROOT, 'generated/client/vault.js'), 'utf8');
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
  const listeners = {};
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
    addEventListener: (type, handler) => { listeners[type] = handler; },
    scrollTo: () => {},
    confirm: () => true,
  };
  const context = { window, document, URL, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(editorSource, context, { filename: 'editor.js' });
  vm.runInContext(bundleSource, context, { filename: 'vault.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  context.__elements = elements;
  context.__store = store;
  context.__main = main;
  context.__listeners = listeners;
  return context;
}

function field(value = '') {
  return { value, innerHTML: '', textContent: '', style: { display: 'block' }, disabled: false };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function replyRequestContext() {
  const requests = [];
  const context = makeFrontend({
    apiRequest: (method, route, body, callback, requestOptions) => {
      const request = deferred();
      requests.push(Object.assign({ method, route, body, requestOptions }, request));
      return request.promise;
    },
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'thread';
  context.currentThread = 'thread-a';
  context.__elements['reply-editor'] = field();
  context.__elements['reply-editor'].innerHTML = '<p>Resposta A.</p>';
  context.showAlert = () => {};
  context.render = () => {};
  return { context, requests };
}

function forumPost(postNo, extra = {}) {
  return Object.assign({
    id: `post-${postNo}`,
    threadId: 'thread-a',
    postNo,
    version: 1,
    content: `<p>Post ${postNo}</p>`,
    deleted: false,
    edited: false,
    author: { id: USER_A, username: 'Ana', role: 'member' },
  }, extra);
}

function forumThreadContext() {
  const requests = [];
  const context = makeFrontend({
    apiRequest: (method, route, body) => {
      const request = deferred();
      requests.push(Object.assign({ method, route, body }, request));
      return request.promise;
    },
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'member' };
  context.currentPage = 'thread';
  context.currentThread = 'thread-a';
  context.serverForumThread = { id: 'thread-a', title: 'Conversa A', locked: false };
  context.serverForumPosts = Array.from({ length: 20 }, (_, index) => forumPost(index + 1));
  context.serverForumPendingReply = forumPost(41, { content: '<p>Resposta 41</p>' });
  context.serverForumPendingReplyAccountId = USER_A;
  context.serverForumPostsPage = { limit: 20, offset: 0, hasMore: true };
  context.showAlert = () => {};
  context.render = () => {};
  context.closeModal = () => {};
  context.getEditorContent = () => '<p>Resposta 41 editada</p>';
  context.resourceFormDraftDescriptor = () => null;
  context.saveActiveResourceFormDraft = () => null;
  context.beginResourceFormSubmission = () => () => {};
  context.__elements['edit-post-summary'] = field('Resumo sintético');
  context.confirm = () => true;
  context.window.prompt = () => 'Motivo sintético';
  return { context, requests };
}

function resolveForumReads(requests, threadId, offset) {
  const threadRead = requests.find((request) => request.method === 'GET'
    && request.route === `/api/forum/threads/${threadId}`);
  const postsRead = requests.find((request) => request.method === 'GET'
    && request.route === `/api/forum/threads/${threadId}/posts?limit=20&offset=${offset}`);
  assert.ok(threadRead, `expected a thread read for ${threadId}`);
  assert.ok(postsRead, `expected a posts read for offset ${offset}`);
  threadRead.resolve({ data: { id: threadId, title: `Conversa ${threadId}`, locked: false } });
  return postsRead;
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
  assert.equal(safe(`/api/users/${USER_A}/avatar?v=4`, true), `/api/users/${USER_A}/avatar?v=4`);

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

test('reply completion clears only the submitting draft and leaves another thread cache intact', async () => {
  const { context, requests } = replyRequestContext();
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-a`;
  const keyB = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-b`;
  context.writeForumDraft('reply', 'thread-b', { content: '<p>Rascunho da conversa B.</p>' });

  context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');
  assert.ok(postRequest, 'submitReply must issue the POST');
  assert.equal(postRequest.route, '/api/forum/threads/thread-a/posts');

  // The user opens another conversation while A's POST is still pending.
  context.currentThread = 'thread-b';
  context.serverForumThread = { id: 'thread-b' };
  context.serverForumPosts = [{ id: 'post-b1', threadId: 'thread-b', postNo: 1 }];
  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();

  assert.equal(context.__store.has(keyA), false, 'the successfully submitted draft is cleared');
  const storedB = JSON.parse(context.__store.get(keyB));
  assert.equal(storedB.values.content, '<p>Rascunho da conversa B.</p>');
  assert.equal(context.serverForumThread.id, 'thread-b');
  assert.deepEqual(context.serverForumPosts.map((post) => post.id), ['post-b1']);
  assert.equal(context.serverForumPendingReply, null);
  assert.equal(context.pendingReplyKey, null);
  assert.equal(context.pendingReplyPayload, null);
});

test('reply completion checks ownership again after the follow-up read', async () => {
  const { context, requests } = replyRequestContext();
  const completion = context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');
  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();

  const threadRead = requests.find((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a');
  const postsRead = requests.find((request) => request.method === 'GET' && request.route.includes('/posts?'));
  assert.ok(threadRead && postsRead, 'the successful reply must trigger a fresh thread read');

  // Navigation happens after the POST completed but before its GETs resolve.
  context.currentThread = 'thread-b';
  context.serverForumThread = { id: 'thread-b' };
  context.serverForumPosts = [{ id: 'post-b1', threadId: 'thread-b', postNo: 1 }];
  threadRead.resolve({ data: { id: 'thread-a', title: 'Conversa A' } });
  postsRead.resolve({
    data: [{ id: 'post-a1', threadId: 'thread-a', postNo: 1 }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
  await completion;
  await flushMicrotasks();

  assert.equal(context.serverForumThread.id, 'thread-b');
  assert.deepEqual(context.serverForumPosts.map((post) => post.id), ['post-b1']);
  assert.equal(context.serverForumPendingReply, null);
  const html = context.renderThread();
  assert.equal(html.includes('post-a41'), false);
  assert.equal(html.includes('Resposta A.'), false);
});

test('reply completion does not reuse or clear another account pending submission', async () => {
  const { context, requests } = replyRequestContext();
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-a`;
  const keyB = `aetherverse:forum-draft:v1:${USER_B}:reply:thread-b`;
  context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');

  context.DB.session = { id: USER_B, serverId: USER_B, username: 'Bia' };
  context.currentThread = 'thread-b';
  context.serverForumThread = { id: 'thread-b' };
  context.serverForumPosts = [{ id: 'post-b1', threadId: 'thread-b', postNo: 1 }];
  context.pendingReplyKey = '22222222-2222-4222-8222-222222222222';
  context.pendingReplyPayload = '{"content":"<p>Pendente de B.</p>"}';
  context.pendingReplyThreadId = 'thread-b';
  context.pendingReplyAccountId = USER_B;
  context.writeForumDraft('reply', 'thread-b', { content: '<p>Pendente de B.</p>' });

  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();

  assert.equal(context.pendingReplyKey, '22222222-2222-4222-8222-222222222222');
  assert.equal(context.pendingReplyPayload, '{"content":"<p>Pendente de B.</p>"}');
  assert.equal(context.pendingReplyThreadId, 'thread-b');
  assert.equal(context.pendingReplyAccountId, USER_B);
  assert.equal(JSON.parse(context.__store.get(keyB)).values.content, '<p>Pendente de B.</p>');
  assert.equal(context.__store.has(keyA), false);
  assert.equal(context.serverForumThread.id, 'thread-b');
  assert.deepEqual(context.serverForumPosts.map((post) => post.id), ['post-b1']);
});

test('a late reply read failure does not throw and keeps the published reply recoverable', async () => {
  const { context, requests } = replyRequestContext();
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-a`;
  const completion = context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');
  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();

  const threadRead = requests.find((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a');
  const postsRead = requests.find((request) => request.method === 'GET' && request.route.includes('/posts?'));
  threadRead.reject(new Error('offline'));
  postsRead.reject(new Error('offline'));
  await completion;
  await flushMicrotasks();

  assert.equal(context.__store.has(keyA), false);
  assert.match(context.forumLoadError, /offline/);
  assert.equal(context.serverForumPosts, null);
  assert.equal(context.serverForumPendingReply.id, 'post-a41');

  context.loadForumThread('thread-a', { force: true, offset: 0, reset: true });
  const retriedThreadRead = requests.filter((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a').pop();
  const retriedPostsRead = requests.filter((request) => request.method === 'GET' && request.route.includes('/posts?')).pop();
  retriedThreadRead.resolve({ data: { id: 'thread-a', title: 'Conversa A' } });
  retriedPostsRead.resolve({
    data: [{ id: 'post-a1', threadId: 'thread-a', postNo: 1 }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
  await flushMicrotasks();
  assert.equal(context.serverForumPendingReply.id, 'post-a41');
  assert.deepEqual(context.serverForumPosts.map((post) => post.id), ['post-a1']);
});

test('a newer same-thread reply draft survives an older reply completing', async () => {
  const { context, requests } = replyRequestContext();
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-a`;
  const completion = context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');

  context.__elements['reply-editor'].innerHTML = '<p>Rascunho mais novo.</p>';
  context.saveActiveForumDraft();
  assert.equal(context.pendingReplyKey, null, 'editing after submit ends the old retry identity');

  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();
  const threadRead = requests.find((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a');
  const postsRead = requests.find((request) => request.method === 'GET' && request.route.includes('/posts?'));
  threadRead.resolve({ data: { id: 'thread-a', title: 'Conversa A' } });
  postsRead.resolve({
    data: [{ id: 'post-a1', threadId: 'thread-a', postNo: 1 }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
  await completion;
  await flushMicrotasks();

  const stored = JSON.parse(context.__store.get(keyA));
  assert.equal(stored.values.content, '<p>Rascunho mais novo.</p>');
  assert.equal(context.pendingReplyKey, null);
  assert.equal(context.serverForumPendingReply.id, 'post-a41');
});

test('an ordinary reply success clears its draft and renders the pending reply once', async () => {
  const { context, requests } = replyRequestContext();
  const keyA = `aetherverse:forum-draft:v1:${USER_A}:reply:thread-a`;
  const completion = context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');
  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41, content: '<p>Resposta A.</p>' } });
  await flushMicrotasks();

  const threadRead = requests.find((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a');
  const postsRead = requests.find((request) => request.method === 'GET' && request.route.includes('/posts?'));
  threadRead.resolve({ data: { id: 'thread-a', title: 'Conversa A' } });
  postsRead.resolve({
    data: [{ id: 'post-a1', threadId: 'thread-a', postNo: 1 }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
  await completion;
  await flushMicrotasks();

  assert.equal(context.__store.has(keyA), false);
  assert.equal(context.serverForumThread.id, 'thread-a');
  assert.deepEqual(context.serverForumPosts.map((post) => post.id), ['post-a1']);
  assert.equal(context.serverForumPendingReply.id, 'post-a41');
  const html = context.renderThread();
  assert.equal((html.match(/post-number">#41</g) || []).length, 1);
  assert.equal((html.match(/Resposta A\./g) || []).length, 1);
});

test('a reloaded page that already contains the reply does not render it twice', async () => {
  const { context, requests } = replyRequestContext();
  const completion = context.submitReply();
  const postRequest = requests.find((request) => request.method === 'POST');
  postRequest.resolve({ data: { id: 'post-a41', threadId: 'thread-a', postNo: 41 } });
  await flushMicrotasks();

  const threadRead = requests.find((request) => request.method === 'GET' && request.route === '/api/forum/threads/thread-a');
  const postsRead = requests.find((request) => request.method === 'GET' && request.route.includes('/posts?'));
  threadRead.resolve({ data: { id: 'thread-a', title: 'Conversa A' } });
  postsRead.resolve({
    data: [{ id: 'post-a1', threadId: 'thread-a', postNo: 1 }, { id: 'post-a41', threadId: 'thread-a', postNo: 41 }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
  await completion;
  await flushMicrotasks();

  assert.equal(context.serverForumPendingReply, null);
  const html = context.renderThread();
  assert.equal((html.match(/post-number">#41</g) || []).length, 1);
});

test('reply retries keep the idempotency key for the same account and thread but not across threads', async () => {
  const { context, requests } = replyRequestContext();
  const firstCompletion = context.submitReply();
  const firstPost = requests.find((request) => request.method === 'POST');
  const firstKey = firstPost.requestOptions.headers['Idempotency-Key'];
  assert.match(firstKey, /^[0-9a-f-]{36}$/i);
  firstPost.reject(new Error('offline'));
  await firstCompletion;
  assert.equal(context.readForumDraft('reply', 'thread-a').idempotencyKey, firstKey);

  const secondCompletion = context.submitReply();
  const secondPost = requests.filter((request) => request.method === 'POST').pop();
  assert.equal(secondPost.requestOptions.headers['Idempotency-Key'], firstKey);

  context.currentThread = 'thread-b';
  context.__elements['reply-editor'].innerHTML = '<p>Resposta A.</p>';
  context.submitReply();
  const thirdPost = requests.filter((request) => request.method === 'POST').pop();
  assert.notEqual(thirdPost.requestOptions.headers['Idempotency-Key'], firstKey);
  secondPost.resolve({});
  thirdPost.resolve({});
  await secondCompletion;
  await flushMicrotasks();
});

test('forum pagination derives the next offset from the fetched page range, not the pending reply', () => {
  const context = makeFrontend();
  context.serverForumThread = { id: 'thread-a' };
  context.serverForumPosts = Array.from({ length: 20 }, (_, index) => ({
    id: `post-${index + 1}`, threadId: 'thread-a', postNo: index + 1,
  }));
  context.serverForumPendingReply = { id: 'post-41', threadId: 'thread-a', postNo: 41 };
  context.serverForumPostsPage = { limit: 20, offset: 0, hasMore: true };
  let loaded = null;
  context.loadForumThread = (threadId, options) => { loaded = { threadId, options }; };
  context.loadMoreForumPosts();
  assert.equal(loaded.threadId, 'thread-a');
  assert.equal(loaded.options.force, true);
  assert.equal(loaded.options.offset, 20);
});

test('a stale pagination page cannot revert a just-edited pending reply', async () => {
  const { context, requests } = forumThreadContext();
  const loading = context.loadForumThread('thread-a', { force: true, offset: 40 });
  const postsRead = resolveForumReads(requests, 'thread-a', 40);

  context.saveEditPost('post-41');
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch, 'editing the pending reply must issue PATCH');
  assert.equal(patch.body.expectedVersion, 1);
  patch.resolve({ data: forumPost(41, { version: 2, edited: true, content: '<p>Resposta 41 editada</p>' }) });
  await flushMicrotasks();
  assert.equal(context.findForumThreadPost('post-41').version, 2);
  assert.equal(context.findForumThreadPost('post-41').edited, true);

  // The page was produced before the edit; it still carries version 1.
  postsRead.resolve({
    data: [forumPost(41, { content: '<p>Resposta 41</p>' })],
    page: { limit: 20, offset: 40, hasMore: false },
  });
  await loading;
  await flushMicrotasks();

  const replies = context.forumThreadPostRecords('thread-a').filter((item) => item.id === 'post-41');
  assert.equal(replies.length, 1, 'the record must appear exactly once');
  assert.equal(replies[0].version, 2);
  assert.equal(replies[0].edited, true);
  assert.equal(replies[0].content, '<p>Resposta 41 editada</p>');
  assert.equal(replies[0].deleted, false);
  assert.equal(context.serverForumPendingReply.version, 2);
  assert.equal(context.serverForumPendingReplyAccountId, USER_A);
  assert.equal(context.serverForumPostsPage.offset, 40);

  const html = context.renderThread();
  assert.equal((html.match(/post-number">#41</g) || []).length, 1);
  assert.match(html, /Resposta 41 editada/);
  assert.equal(html.includes('<p>Resposta 41</p>'), false, 'stale visible content must not return');
  assert.equal((html.match(/>editado</g) || []).length, 1);
});

test('a stale pagination page cannot revert a just-hidden pending reply', async () => {
  const { context, requests } = forumThreadContext();
  const loading = context.loadForumThread('thread-a', { force: true, offset: 40 });
  const postsRead = resolveForumReads(requests, 'thread-a', 40);

  context.deletePost('post-41');
  const hide = requests.find((request) => request.method === 'POST' && request.route.endsWith('/hide'));
  assert.ok(hide, 'hiding the pending reply must issue its POST');
  assert.equal(hide.body.expectedVersion, 1);
  hide.resolve({ data: forumPost(41, {
    version: 2, deleted: true, deletedAt: '2026-11-08T12:00:00Z', content: '<p>Resposta 41</p>',
  }) });
  await flushMicrotasks();
  assert.equal(context.findForumThreadPost('post-41').deleted, true);
  assert.equal(context.findForumThreadPost('post-41').version, 2);

  postsRead.resolve({
    data: [forumPost(41, { content: '<p>Resposta 41</p>' })],
    page: { limit: 20, offset: 40, hasMore: false },
  });
  await loading;
  await flushMicrotasks();

  const replies = context.forumThreadPostRecords('thread-a').filter((item) => item.id === 'post-41');
  assert.equal(replies.length, 1, 'the hidden record must appear exactly once');
  assert.equal(replies[0].version, 2);
  assert.equal(replies[0].deleted, true);
  assert.equal(replies[0].deletedAt, '2026-11-08T12:00:00Z');
  assert.equal(context.serverForumPendingReply.version, 2);

  const html = context.renderThread();
  assert.equal((html.match(/post-number">#41</g) || []).length, 1);
  assert.match(html, /Esta publicação foi ocultada\./);
  assert.equal(html.includes('Resposta 41</p>'), false, 'stale visible content must not return');
  assert.equal(html.includes('onclick="editPost(\'post-41\')"'), false);
});

test('post record updates keep the newest version and hidden state', () => {
  const context = makeFrontend();
  context.serverForumPosts = [forumPost(21, { version: 2, edited: true, content: '<p>Versão 2</p>' })];
  context.updateForumThreadPostRecord(forumPost(21, { version: 1, content: '<p>Versão 1</p>' }));
  assert.equal(context.serverForumPosts[0].version, 2);
  assert.equal(context.serverForumPosts[0].content, '<p>Versão 2</p>');

  context.updateForumThreadPostRecord(forumPost(21, { version: 3, deleted: true, content: '<p>Ocultada 3</p>' }));
  assert.equal(context.serverForumPosts[0].version, 3);
  assert.equal(context.serverForumPosts[0].deleted, true);

  // A same-version copy without the hidden state must not make it visible again.
  context.updateForumThreadPostRecord(forumPost(21, { version: 3, content: '<p>Visível 3</p>' }));
  assert.equal(context.serverForumPosts[0].version, 3);
  assert.equal(context.serverForumPosts[0].deleted, true);
  assert.equal(context.serverForumPosts[0].content, '<p>Ocultada 3</p>');
});

test('session end and account change clear the pending reply scope', () => {
  const { context } = forumThreadContext();
  context.applyServerSession({ id: USER_B, username: 'Bia', role: 'member' });
  assert.equal(context.serverForumPendingReply, null);
  assert.equal(context.serverForumPendingReplyAccountId, null);

  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'member' };
  context.setServerForumPendingReply(forumPost(41, { content: '<p>Resposta 41</p>' }));
  assert.equal(context.serverForumPendingReply.id, 'post-41');
  context.applyServerSession(null);
  assert.equal(context.serverForumPendingReply, null);
  assert.equal(context.serverForumPendingReplyAccountId, null);
});

test('a pending reply renders only for its own account and thread and survives navigation', async () => {
  const { context, requests } = forumThreadContext();

  context.currentThread = 'thread-b';
  const loadingB = context.loadForumThread('thread-b', { force: true, offset: 0, reset: true });
  const postsB = resolveForumReads(requests, 'thread-b', 0);
  postsB.resolve({
    data: Array.from({ length: 20 }, (_, index) => forumPost(index + 1, {
      id: `b-post-${index + 1}`, threadId: 'thread-b', postNo: index + 1,
    })),
    page: { limit: 20, offset: 0, hasMore: true },
  });
  await loadingB;
  await flushMicrotasks();

  assert.equal(context.serverForumPendingReply.id, 'post-41', 'the other thread must not erase the recoverable reply');
  const htmlB = context.renderThread();
  assert.equal(htmlB.includes('post-number">#41'), false);
  assert.equal(htmlB.includes('Resposta 41'), false);

  context.currentThread = 'thread-a';
  const loadingA = context.loadForumThread('thread-a', { force: true, offset: 0, reset: true });
  const postsA = resolveForumReads(requests, 'thread-a', 0);
  postsA.resolve({
    data: Array.from({ length: 20 }, (_, index) => forumPost(index + 1)),
    page: { limit: 20, offset: 0, hasMore: true },
  });
  await loadingA;
  await flushMicrotasks();

  const htmlA = context.renderThread();
  assert.equal((htmlA.match(/post-number">#41</g) || []).length, 1);
  assert.match(htmlA, /Resposta 41/);

  // Defense in depth: even if another account's record were still in memory,
  // the render/lookup path must not expose it under this session.
  context.DB.session = { id: USER_B, serverId: USER_B, username: 'Bia', role: 'member' };
  context.serverForumPendingReply = forumPost(41, { content: '<p>Resposta 41</p>' });
  context.serverForumPendingReplyAccountId = USER_A;
  assert.equal(context.findForumThreadPost('post-41'), null);
  assert.equal(context.renderThread().includes('post-number">#41'), false);
});

test('scene participant rows preserve commas, trim entries, and ignore empty rows', () => {
  const context = makeFrontend();
  const rows = [
    { querySelector: () => ({ value: 'Doe, Jane' }) },
    { querySelector: () => ({ value: ' Bob ' }) },
    { querySelector: () => ({ value: '   ' }) },
  ];
  context.__elements['c-ib-participants-list'] = {
    querySelectorAll: (selector) => selector === '.infobox-participant-row' ? rows : [],
  };
  assert.deepEqual(Array.from(context.readCenaParticipantRows()), ['Doe, Jane', 'Bob']);
  context.activeCenaParticipants = ['stale shadow value'];
  assert.deepEqual(Array.from(context.readCenaParticipantRows()), ['Doe, Jane', 'Bob']);
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
  context.__elements['modular-blocks-container'] = { innerHTML: '' };
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

test('renderSobre lists Equipe Atual without profile photos or initial placeholder boxes', () => {
  const context = makeFrontend();
  assert.equal(context.DB.equipe.length, 5);
  for (const member of context.DB.equipe) {
    assert.equal(Object.hasOwn(member, 'foto'), false);
  }
  const html = context.renderSobre();
  for (const expectedName of ['Rick', 'Mand Raiden', 'Ghostmaker', 'Scautz', 'Lucas Kabii']) {
    assert.equal(html.includes(expectedName), true, `Expected ${expectedName} in Sobre`);
  }
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('thumb-ph'), false);
  assert.equal(html.includes('class="thumb"'), false);
});

test('profile avatar upload, preserve, and remove flows update session, top bar, and cached author records', () => {
  const calls = [];
  let nextResponseUser = null;
  const context = makeFrontend({
    apiRequest: (method, route, body, cb) => {
      calls.push({ method, route, body });
      const result = { user: nextResponseUser };
      if (typeof cb === 'function') cb(null, result);
      return Promise.resolve(result);
    },
  });
  context.__elements['top-user-info'] = field();
  context.__elements['top-btn-area'] = field();
  context.__elements['nav-admin-btn'] = field();
  context.__elements['prof-title'] = field('Cronista');
  context.__elements['prof-avatar'] = field('');
  context.__elements['prof-bio'] = field('Bio');
  context.__elements['prof-current-password'] = field('');
  context.__elements['prof-password'] = field('');
  context.showAlert = () => {};
  context.render = () => {};

  context.DB.session = {
    id: USER_A,
    serverId: USER_A,
    username: 'Rick',
    role: 'admin',
    title: 'Cronista',
    avatar: '',
    bio: 'Bio',
    version: 1,
  };
  context.serverPersonagens = [{ id: 10, authorId: USER_A, author: { id: USER_A, username: 'Rick', avatar: '', title: 'Membro', role: 'admin' } }];
  context.serverWikiPosts = [{
    id: 20,
    authorId: USER_A,
    author: { id: USER_A, username: 'Rick', avatar: '', title: 'Membro', role: 'admin' },
    turns: [{ id: 30, authorId: USER_A, authorName: 'Rick', authorAvatar: '', authorRole: 'admin' }],
  }];

  const profileHtml = context.renderPerfil();
  assert.equal(profileHtml.includes('id="prof-avatar-file"'), true);
  assert.equal(profileHtml.includes('removerFotoPerfil()'), true);

  // 1) Staged device upload sends avatarUpload and updates cached avatars + top bar
  const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  context.pendingProfileAvatarUpload = sampleDataUrl;
  nextResponseUser = {
    id: USER_A,
    username: 'Rick',
    email: 'rick@example.invalid',
    avatar: `/api/users/${USER_A}/avatar?v=2`,
    title: 'Cronista',
    bio: 'Bio',
    role: 'admin',
    posts: 5,
    joinDate: '2026-01-01',
    version: 2,
  };
  context.salvarEdicaoPerfil();
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].route, '/api/auth/profile');
    assert.equal(calls[0].body.avatarUpload, sampleDataUrl);
    assert.equal(calls[0].body.avatar, '');
    assert.equal(context.DB.session.avatar, `/api/users/${USER_A}/avatar?v=2`);
    assert.equal(context.__elements['top-user-info'].innerHTML.includes(`/api/users/${USER_A}/avatar?v=2`), true);
    assert.equal(context.serverPersonagens[0].author.avatar, `/api/users/${USER_A}/avatar?v=2`);
    assert.equal(context.serverWikiPosts[0].author.avatar, `/api/users/${USER_A}/avatar?v=2`);
    assert.equal(context.serverWikiPosts[0].turns[0].authorAvatar, `/api/users/${USER_A}/avatar?v=2`);

    // 2) Editing bio/title without touching #prof-avatar preserves existing uploaded /api/users/:id/avatar
    context.__elements['prof-bio'].value = 'Nova bio';
    nextResponseUser = Object.assign({}, nextResponseUser, { bio: 'Nova bio', version: 3, avatar: `/api/users/${USER_A}/avatar?v=3` });
    context.salvarEdicaoPerfil();
    return new Promise((r2) => setImmediate(r2));
  }).then(() => {
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.avatar, `/api/users/${USER_A}/avatar?v=2`);
    assert.equal(Object.hasOwn(calls[1].body, 'avatarUpload'), false);

    // 3) Clicking removerFotoPerfil() clears the avatar on save
    context.removerFotoPerfil();
    nextResponseUser = Object.assign({}, nextResponseUser, { avatar: '', version: 4 });
    context.salvarEdicaoPerfil();
    return new Promise((r3) => setImmediate(r3));
  }).then(() => {
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.avatar, '');
    assert.equal(Object.hasOwn(calls[2].body, 'avatarUpload'), false);
    assert.equal(context.DB.session.avatar, '');
  });
});

test('user profile avatars render across RPG turns, character sheets, and wiki pages/scenes/proposals', () => {
  const context = makeFrontend();
  const avatarUrl = `/api/users/${USER_A}/avatar?v=5`;
  const author = { id: USER_A, username: 'Autora', avatar: avatarUrl, title: 'Cronista', role: 'moderador' };
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Autora', avatar: avatarUrl, role: 'moderador' };

  // Character sheets (card + full view)
  const charItem = {
    id: 1,
    nome: 'Akane',
    titulo: 'Lâmina',
    categoria: 'Personagem Principal',
    raca: 'Humana',
    faccao: 'Vanguarda',
    status: 'Ativa',
    imagem: 'https://example.test/akane.png',
    descricao: '<p>História de Akane.</p>',
    stats: {},
    skills: [],
    blocks: [],
    authorId: USER_A,
    author,
  };
  context.serverPersonagens = [charItem];
  context.currentPersonagem = 1;
  const charCardHtml = context.renderCharCard(charItem);
  assert.equal(charCardHtml.includes(avatarUrl), true);
  assert.equal(charCardHtml.includes('Autora'), true);
  const charViewHtml = context.renderPersonagemView();
  assert.equal(charViewHtml.includes(avatarUrl), true);
  assert.equal(charViewHtml.includes('Ficha publicada por'), true);

  // Scenes & RPG Turns (both fallback turn avatar and player attribution line)
  const sceneItem = {
    id: 7,
    titulo: 'Batalha no Convés',
    subtitulo: 'Ato I',
    categoria: 'Cena de RPG',
    status: 'Em Andamento',
    resumo: 'Resumo',
    banner: '',
    descricao: '<p>Abertura.</p>',
    theme: { accentColor: '#ffffff', bannerStyle: 'cinematic', layout: 'full' },
    infobox: { show: false },
    blocks: [],
    authorId: USER_A,
    author,
    turns: [
      {
        id: 101,
        authorId: USER_A,
        authorName: 'Autora',
        authorAvatar: avatarUrl,
        authorRole: 'moderador',
        characterName: '',
        characterAvatar: '',
        content: '<p>Meu primeiro turno usando foto de perfil.</p>',
      },
      {
        id: 102,
        authorId: USER_A,
        authorName: 'Autora',
        authorAvatar: avatarUrl,
        authorRole: 'moderador',
        characterName: 'Akane',
        characterAvatar: 'https://example.test/akane-turn.png',
        content: '<p>Turno com retrato de personagem.</p>',
      },
    ],
  };
  context.serverWikiPosts = [sceneItem];
  context.currentCena = 7;
  const cenasListHtml = context.renderCenas();
  assert.equal(cenasListHtml.includes(avatarUrl), true);
  const cenaViewHtml = context.renderCenaView();
  assert.equal(cenaViewHtml.includes(`class="turn-avatar" src="${avatarUrl}"`), true);
  assert.equal(cenaViewHtml.includes('https://example.test/akane-turn.png'), true);
  assert.equal(cenaViewHtml.includes(`class="inline-user-avatar" src="${avatarUrl}"`), true);

  // Reference Wiki (list, public article, staff draft, and proposal)
  context.serverWikiSections = [];
  context.serverWikiCategories = [];
  context.serverWikiPages = [{
    id: 'page-1',
    slug: 'eter',
    title: 'O Éter',
    summary: ' Conceito fundamental.',
    categories: [],
    aliases: [],
    author,
  }];
  const wikiListHtml = context.renderWiki();
  assert.equal(wikiListHtml.includes(avatarUrl), true);

  context.currentWikiSlug = 'eter';
  context.currentWikiArticle = {
    id: 'page-1',
    slug: 'eter',
    title: 'O Éter',
    summary: 'Conceito fundamental.',
    categories: [],
    aliases: [],
    publishedAt: '2026-04-01T12:00:00Z',
    author,
    body: { sections: [{ id: 'intro', title: 'Introdução', level: 2, html: '<p>Texto.</p>' }] },
    infobox: null,
  };
  context.wikiBacklinksState = { pageId: 'page-1', items: [], loading: false, loaded: true, hasMore: false, error: null };
  const wikiArticleHtml = context.renderWikiArticle();
  assert.equal(wikiArticleHtml.includes(avatarUrl), true);
  assert.equal(wikiArticleHtml.includes('Publicado por'), true);

  context.currentWikiPageId = 'prop-1';
  context.wikiProposalDetail = {
    id: 'prop-1',
    pageId: 'page-1',
    state: 'submitted',
    summary: 'Ajuste de lore',
    createdAt: '2026-04-02T12:00:00Z',
    proposer: author,
    page: { id: 'page-1', slug: 'eter', title: 'O Éter' },
    snapshot: {
      title: 'O Éter',
      summary: 'Conceito',
      body: { sections: [{ id: 'intro', title: 'Introdução', level: 2, html: '<p>Texto.</p>' }] },
    },
  };
  const proposalHtml = context.renderWikiProposal();
  assert.equal(proposalHtml.includes(avatarUrl), true);
});

test('scene accent swatches clear an imported empty accent and save the chosen color draft', () => {
  const context = makeFrontend();
  context.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'novaCena';
  context.showAlert = () => {};
  const accent = field('');
  context.__elements['c-accent'] = accent;
  context.__elements['c-titulo'] = field('Cena');
  context.__elements['c-subtitulo'] = field('');
  context.__elements['c-categoria'] = field('Cena de RPG');
  context.__elements['c-status'] = field('Em Andamento');
  context.__elements['c-resumo'] = field('');
  context.__elements['c-banner'] = field('');
  context.__elements['c-editor'] = field();
  context.__elements['c-banner-style'] = field('cinematic');
  context.__elements['c-layout'] = field('sidebar-left');
  context.__elements['c-font'] = field('serif');
  context.__elements['c-bg-effect'] = field('none');
  context.__elements['c-bgm'] = field('');
  context.__elements['c-ib-show'] = { checked: true };
  context.__elements['c-ib-title'] = field('');
  context.__elements['c-ib-image'] = field('');
  context.__elements['c-ib-caption'] = field('');
  context.activeCenaAccentEmpty = true;
  accent.value = '#ffffff';

  assert.equal(context.lerFormularioCena().theme.accentColor, '');

  context.aplicarCorDestaqueCena('#404040');
  assert.equal(context.activeCenaAccentEmpty, false);
  assert.equal(accent.value, '#404040');
  assert.equal(context.lerFormularioCena().theme.accentColor, '#404040');
  assert.equal(context.readResourceFormDraft(context.resourceFormDraftDescriptor()).theme.accentColor, '#404040');

  context.aplicarCorDestaqueCena('#ffffff');
  assert.equal(accent.value, '#ffffff');
  assert.equal(context.lerFormularioCena().theme.accentColor, '#ffffff');
  assert.equal(context.readResourceFormDraft(context.resourceFormDraftDescriptor()).theme.accentColor, '#ffffff');

  context.DB.session.role = 'admin';
  context.serverWikiPosts = [];
  context.serverPersonagens = [];
  const formHtml = context.renderNovaCena();
  assert.equal((formHtml.match(/onclick="aplicarCorDestaqueCena\('/g) || []).length, 6);
  assert.equal(formHtml.includes("document.getElementById('c-accent').value="), false);
});

test('a late character like response is ignored after the account changes', async () => {
  let complete;
  let alerts = 0;
  let toggles = 0;
  const context = makeFrontend({
    apiRequest: (method, route, body, callback) => new Promise((resolve) => {
      complete = () => { callback(null, { liked: true, likeCount: 3 }); resolve({}); };
    }),
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'personagemView';
  context.currentPersonagem = 'char-1';
  context.showAlert = () => { alerts += 1; };
  const button = {
    id: 'like-char-char-1',
    classList: { toggle: () => { toggles += 1; } },
    innerHTML: '',
  };
  context.__elements[button.id] = button;
  context.toggleLikePersonagem('char-1', button);
  context.DB.session = { id: USER_B, serverId: USER_B, username: 'Bia' };
  complete();
  await flushMicrotasks();
  assert.equal(toggles, 0);
  assert.equal(alerts, 0);
  assert.equal(button.innerHTML, '');
});

test('a late scene like response is ignored after leaving the scene', async () => {
  let complete;
  let alerts = 0;
  let toggles = 0;
  const context = makeFrontend({
    apiRequest: (method, route, body, callback) => new Promise((resolve) => {
      complete = () => { callback(null, { liked: true, likeCount: 4 }); resolve({}); };
    }),
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'cenaView';
  context.currentCena = 'scene-1';
  context.showAlert = () => { alerts += 1; };
  const button = {
    id: 'like-cena-scene-1',
    classList: { toggle: () => { toggles += 1; } },
    innerHTML: '',
  };
  context.__elements[button.id] = button;
  context.toggleLikeCena('scene-1', button);
  context.currentPage = 'forum';
  context.currentCena = null;
  complete();
  await flushMicrotasks();
  assert.equal(toggles, 0);
  assert.equal(alerts, 0);
  assert.equal(button.innerHTML, '');
});

test('a late turn like response is ignored when the turn leaves the scene', async () => {
  let complete;
  let alerts = 0;
  let toggles = 0;
  const context = makeFrontend({
    apiRequest: (method, route, body, callback) => new Promise((resolve) => {
      complete = () => { callback(null, { liked: true, likeCount: 2 }); resolve({}); };
    }),
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.currentPage = 'cenaView';
  context.currentCena = 'scene-1';
  context.serverWikiPosts = [{ id: 'scene-1', turns: [{ id: 'turn-1' }] }];
  context.showAlert = () => { alerts += 1; };
  const button = {
    id: 'like-turn-turn-1',
    classList: { toggle: () => { toggles += 1; } },
    innerHTML: '',
  };
  context.__elements[button.id] = button;
  context.toggleLikeTurno('scene-1', 'turn-1', button);
  context.serverWikiPosts = [{ id: 'scene-1', turns: [] }];
  complete();
  await flushMicrotasks();
  assert.equal(toggles, 0);
  assert.equal(alerts, 0);
  assert.equal(button.innerHTML, '');
});

test('a late notification read response is ignored after the account changes', async () => {
  let complete;
  const context = makeFrontend({
    apiRequest: (method, route, body, callback) => new Promise((resolve) => {
      complete = () => { callback(null, {}); resolve({}); };
    }),
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana' };
  context.DB.notifications = [{ id: 'notif-1', read: false }];
  context.DB.unreadCount = 1;
  context.updateTopBar = () => {};
  context.showAlert = () => {};
  context.marcarNotificacaoLida('notif-1');
  context.DB.session = { id: USER_B, serverId: USER_B, username: 'Bia' };
  complete();
  await flushMicrotasks();
  assert.equal(context.DB.notifications[0].read, false);
  assert.equal(context.DB.unreadCount, 1);
});

function timelineContext(apiRequest) {
  const requests = [];
  const alerts = [];
  const context = makeFrontend({
    apiRequest: (method, route, body, callback) => {
      requests.push({ method, route, body: Object.assign({}, body) });
      if (apiRequest) apiRequest(callback);
      return Promise.resolve({});
    },
  });
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'admin' };
  context.showAlert = (message, type) => alerts.push({ message, type });
  context.confirm = () => true;
  context.__elements['modal-container'] = field();
  context.timelineEditingId = null;
  context.timelineEditingUpdatedAt = null;
  context.serverTimelineEvents = [{
    id: 'event-1',
    title: 'Evento',
    startDate: 'Marco Zero',
    updatedAt: '2026-04-01T12:00:00.000Z',
  }];
  return { context, requests, alerts };
}

function timelineFormFields(context) {
  context.__elements['tm-title'] = field('Evento');
  context.__elements['tm-start-date'] = field('Marco Zero');
  context.__elements['tm-end-date'] = field('');
  context.__elements['tm-era'] = field('Marco Zero');
  context.__elements['tm-color'] = field('Green');
  context.__elements['tm-story-arc'] = field('');
  context.__elements['tm-characters'] = field('');
  context.__elements['tm-group'] = field('');
  context.__elements['tm-location'] = field('');
  context.__elements['tm-summary'] = field('');
}

test('timeline edit captures updatedAt, sends it on PUT, and surfaces stale errors', () => {
  const { context, requests, alerts } = timelineContext((callback) => {
    callback('O evento foi alterado por outra pessoa. Recarregue e tente novamente.', undefined);
  });
  timelineFormFields(context);
  context.openTimelineModal('event-1');
  assert.equal(context.timelineEditingUpdatedAt, '2026-04-01T12:00:00.000Z');

  context.salvarTimelineModal();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].route, '/api/timeline/event-1');
  assert.equal(requests[0].body.expectedUpdatedAt, '2026-04-01T12:00:00.000Z');
  assert.deepEqual(alerts, [{
    message: 'O evento foi alterado por outra pessoa. Recarregue e tente novamente.',
    type: 'error',
  }]);
  context.closeTimelineModal();
  assert.equal(context.timelineEditingUpdatedAt, null);
});

test('timeline creation does not send expectedUpdatedAt', () => {
  const { context, requests } = timelineContext();
  timelineFormFields(context);
  context.openTimelineModal();
  assert.equal(context.timelineEditingId, null);
  assert.equal(context.timelineEditingUpdatedAt, null);

  context.salvarTimelineModal();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].route, '/api/timeline');
  assert.equal(Object.hasOwn(requests[0].body, 'expectedUpdatedAt'), false);
});

test('timeline deletion sends captured updatedAt and surfaces stale errors', () => {
  const { context, requests, alerts } = timelineContext((callback) => {
    callback('O evento foi alterado por outra pessoa. Recarregue e tente novamente.', undefined);
  });
  context.excluirTimelineEvento('event-1', 'Evento');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'DELETE');
  assert.equal(requests[0].route, '/api/timeline/event-1');
  assert.deepEqual(requests[0].body, { expectedUpdatedAt: '2026-04-01T12:00:00.000Z' });
  assert.deepEqual(alerts, [{
    message: 'O evento foi alterado por outra pessoa. Recarregue e tente novamente.',
    type: 'error',
  }]);

  context.serverTimelineEvents = [{ id: 'event-2', title: 'Outro evento' }];
  context.excluirTimelineEvento('event-2', 'Outro evento');
  assert.equal(requests[1].method, 'DELETE');
  assert.equal(requests[1].route, '/api/timeline/event-2');
  assert.deepEqual(requests[1].body, {});
});

test('account switch and logout clear cached notifications before the next fetch', () => {
  const context = makeFrontend();
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'member' };
  context.DB.notifications = [{ id: 'notification-a', title: 'Da conta A' }];
  context.DB.unreadCount = 1;

  context.applyServerSession({ id: USER_B, username: 'Bia', role: 'member' });

  assert.deepEqual(Array.from(context.DB.notifications), []);
  assert.equal(context.DB.unreadCount, 0);
  assert.equal(context.DB.session.serverId, USER_B);

  context.DB.notifications = [{ id: 'notification-b', title: 'Da conta B' }];
  context.DB.unreadCount = 1;
  context.applyServerSession(null);

  assert.deepEqual(Array.from(context.DB.notifications), []);
  assert.equal(context.DB.unreadCount, 0);
  assert.equal(context.DB.session, null);
});


test('forum drafts accept the server-supported 20-character tag limit', () => {
  const context = makeFrontend();
  context.showAlert = () => {};
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'member' };

  assert.equal(context.writeForumDraft('topic-edit', 'thread-long', {
    title: 'Título não salvo', tag: 'discussion',
  }), true);
  const restored = context.readForumDraft('topic-edit', 'thread-long');
  assert.equal(restored.values.title, 'Título não salvo');
  assert.equal(restored.values.tag, 'discussion');
});

test('a stale admin identity error cannot clear a same-account relogin', async () => {
  let resolveMutation;
  let rejectIdentity;
  const context = makeFrontend({ apiRequest: (method) => {
    if (method === 'GET') return new Promise((resolve, reject) => { rejectIdentity = reject; });
    return new Promise((resolve) => { resolveMutation = resolve; });
  } });
  context.showAlert = () => {};
  context.updateTopBar = () => {};
  context.navigate = () => {};
  context.loadAdminData = () => {};
  const admin = { id: USER_A, username: 'Ana', role: 'admin' };

  context.applyServerSession(admin);
  context.adminMutation('PATCH', '/api/admin/users/example', {}, 'Alterado.');
  resolveMutation({});
  await flushMicrotasks();
  context.applyServerSession(null);
  context.applyServerSession(admin);
  rejectIdentity(new Error('Sua sessão expirou. Faça login novamente.'));
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(context.DB.session.id, USER_A, 'the new same-account session must survive');
});

test('a stale boot identity success cannot restore a session after logout', async () => {
  let bootCallback;
  const context = makeFrontend({ apiRequest: (method, route, body, callback) => {
    if (route === '/api/auth/me') bootCallback = callback;
    return Promise.resolve({});
  } });
  for (const name of ['parseRouteFromLocation', 'initializeResourceFormDraftPersistence',
    'initializeForumDraftPersistence', 'updateTopBar', 'render',
    'carregarPersonagensServidor', 'carregarWikiPostsServidor', 'carregarNotificacoesServidor']) {
    context[name] = () => {};
  }
  const admin = { id: USER_A, username: 'Ana', role: 'admin' };
  context.__listeners.DOMContentLoaded();
  context.applyServerSession(admin);
  context.applyServerSession(null);
  bootCallback(null, { user: admin });
  await flushMicrotasks();

  assert.equal(context.DB.session, null, 'the stale boot response must be ignored');
});

test('character category options preserve a server-valid custom value', () => {
  const context = makeFrontend();
  context.sessionStorage = { getItem: () => '22222222-2222-4222-8222-222222222222', setItem: () => {}, removeItem: () => {} };
  context.DB.session = { id: USER_A, serverId: USER_A, username: 'Ana', role: 'admin' };
  context.serverPersonagens = [{
    id: '22222222-2222-4222-8222-222222222222', nome: 'Registro legado', categoria: 'NPC',
    titulo: '', raca: '', faccao: '', status: '', imagem: '', descricao: '<p>Texto.</p>',
    stats: {}, skills: [],
  }];
  context.renderBlockBuilderSection = () => '';
  const html = context.renderNovoPersonagem();
  assert.match(html, /<option value="NPC" selected>NPC<\/option>/);
  assert.match(html, /<option value="Personagem Principal">Personagem Principal<\/option>/);
});

test('character JSON import accepts and appends a server-valid custom category', async () => {
  const context = makeFrontend({ apiRequest: () => Promise.resolve({ html: '<p>Seguro.</p>' }) });
  const source = field(JSON.stringify({
    nome: 'Registro importado', categoria: 'NPC', descricao: '<p>Texto.</p>',
  }));
  const select = {
    value: '', options: [], appendChild(option) { this.options.push(option); },
  };
  context.document.createElement = (tag) => ({ tagName: String(tag).toUpperCase(), value: '', textContent: '' });
  context.__elements['import-char-json'] = source;
  context.__elements['p-nome'] = field('Nome anterior');
  context.__elements['p-categoria'] = select;
  context.__elements['p-editor'] = field();
  context.__elements['p-editor'].innerHTML = '';
  context.closeModal = () => {};
  const alerts = [];
  context.showAlert = (message) => alerts.push(message);
  context.setEditorContent = (id, html) => { context.__elements[id].innerHTML = html; return true; };

  await context.confirmImportPersonagemJson();
  assert.equal(select.value, 'NPC');
  assert.equal(select.options.some((option) => option.value === 'NPC'), true);
  assert.equal(context.__elements['p-nome'].value, 'Registro importado');
  assert.equal(alerts.some((message) => /categoria deve ser/i.test(message)), false);
});

test('changing the JSON textarea during preview prevents stale apply', async () => {
  let resolvePreview;
  const context = makeFrontend({ apiRequest: () => new Promise((resolve) => { resolvePreview = resolve; }) });
  const source = field(JSON.stringify({ nome: 'Original', descricao: '<p>Original.</p>' }));
  context.__elements['import-char-json'] = source;
  context.__elements['p-nome'] = field('Nome anterior');
  context.__elements['p-editor'] = field();
  context.__elements['p-editor'].innerHTML = '';
  context.closeModal = () => {};
  const alerts = [];
  context.showAlert = (message) => alerts.push(message);
  context.setEditorContent = (id, html) => { context.__elements[id].innerHTML = html; return true; };

  const pending = context.confirmImportPersonagemJson();
  source.value = JSON.stringify({ nome: 'Alterado', descricao: '<p>Alterado.</p>' });
  resolvePreview({ html: '<p>Original seguro.</p>' });
  await pending;

  assert.equal(context.__elements['p-nome'].value, 'Nome anterior');
  assert.equal(alerts.some((message) => /alterado durante a validação/i.test(message)), true);
});

test('a stale profile success cannot restore the previous account after relogin', async () => {
  let profileCallback;
  const context = makeFrontend({ apiRequest: (method, route, body, callback) => {
    if (route === '/api/auth/profile') profileCallback = callback;
    return Promise.resolve({});
  } });
  for (const id of ['prof-title', 'prof-avatar', 'prof-bio', 'prof-current-password', 'prof-password']) {
    context.__elements[id] = field('');
  }
  context.__elements['prof-title'].value = 'Cronista';
  context.DB.session = {
    id: USER_A, serverId: USER_A, username: 'Ana', role: 'admin',
    title: 'Cronista', avatar: '', bio: '', version: 1,
  };
  let finished = 0;
  context.resourceFormDraftDescriptor = () => null;
  context.saveActiveResourceFormDraft = () => {};
  context.beginResourceFormSubmission = () => () => { finished += 1; };
  context.clearResourceFormDraft = () => {};
  context.syncCachedAuthorData = () => {};
  context.updateTopBar = () => {};
  context.render = () => {};
  const alerts = [];
  context.showAlert = (message) => alerts.push(message);

  context.salvarEdicaoPerfil();
  assert.equal(typeof profileCallback, 'function');
  context.applyServerSession(null);
  context.applyServerSession({ id: USER_B, username: 'Bia', role: 'member' });
  profileCallback(null, { user: { id: USER_A, username: 'Ana', role: 'admin' } });
  await flushMicrotasks();

  assert.equal(context.DB.session.id, USER_B, 'the stale profile response must be ignored');
  assert.equal(finished, 1);
  assert.equal(alerts.includes('Perfil atualizado com sucesso.'), false);
});

test('a successful logout still clears the UI after an earlier profile response applied', async () => {
  const callbacks = {};
  const context = makeFrontend({ apiRequest: (method, route, body, callback) => {
    callbacks[route] = callback;
    return Promise.resolve({});
  } });
  for (const id of ['prof-title', 'prof-avatar', 'prof-bio', 'prof-current-password', 'prof-password']) {
    context.__elements[id] = field('');
  }
  context.__elements['prof-title'].value = 'Cronista';
  context.DB.session = {
    id: USER_A, serverId: USER_A, username: 'Ana', role: 'admin',
    title: 'Cronista', avatar: '', bio: '', version: 1,
  };
  context.resourceFormDraftDescriptor = () => null;
  context.saveActiveResourceFormDraft = () => {};
  context.beginResourceFormSubmission = () => () => {};
  context.clearResourceFormDraft = () => {};
  context.syncCachedAuthorData = () => {};
  context.updateTopBar = () => {};
  context.render = () => {};
  context.navigate = () => {};
  context.showAlert = () => {};

  context.salvarEdicaoPerfil();
  context.doLogout();
  callbacks['/api/auth/profile'](null, { user: { id: USER_A, username: 'Ana', role: 'admin' } });
  callbacks['/api/auth/logout'](null, {});
  await flushMicrotasks();

  assert.equal(context.DB.session, null, 'logout must clear the current same-account session');
});
