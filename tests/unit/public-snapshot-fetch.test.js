'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const {
  CaptureUsageError,
  PRIVATE_CAPTURE_ROOT,
  normalizeCaptureOptions,
  normalizeOrigin,
  parseArgs,
  parseRetryAfter,
  runCapture,
  validateCaptureDirectory,
  validateDataset,
} = require('../../scripts/lib/public-snapshot');

const CLI = path.resolve(__dirname, '../../scripts/public-snapshot-fetch.js');
const ISO = '2026-11-08T12:00:00.000Z';

const ID = {
  character: '11111111-1111-4111-8111-111111111111',
  scene: '22222222-2222-4222-8222-222222222222',
  scene2: '22222222-2222-4222-8222-222222222223',
  page: '33333333-3333-4333-8333-333333333333',
  page2: '33333333-3333-4333-8333-333333333334',
  thread: '44444444-4444-4444-8444-444444444444',
  thread2: '44444444-4444-4444-8444-444444444445',
  category: '55555555-5555-4555-8555-555555555555',
  category2: '55555555-5555-4555-8555-555555555556',
  turn: '66666666-6666-4666-8666-666666666666',
  revision: '77777777-7777-4777-8777-777777777777',
  post: '88888888-8888-4888-8888-888888888888',
  post2: '88888888-8888-4888-8888-888888888889',
};

function json(res, status, body, headers = {}) {
  if (res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      Promise.resolve(handler(req, res, url, requests)).catch((error) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(error && error.message ? error.message : 'handler error'));
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        origin: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

function baseRouter(overrides = {}) {
  return (req, res, url) => {
    if (overrides[url.pathname]) return overrides[url.pathname](req, res, url);
    switch (url.pathname) {
      case '/api/personagens':
        return json(res, 200, { personagens: [] });
      case '/api/wiki-posts':
        return json(res, 200, { wikiPosts: [] });
      case '/api/wiki/sections':
        return json(res, 200, { data: [] });
      case '/api/wiki/categories':
        return json(res, 200, {
          data: [],
          page: { limit: 100, offset: Number(url.searchParams.get('offset') || 0), hasMore: false },
        });
      case '/api/wiki/pages':
        return json(res, 200, {
          data: [],
          page: { limit: 100, offset: Number(url.searchParams.get('offset') || 0), hasMore: false },
        });
      case '/api/forum/categories':
        return json(res, 200, {
          data: [],
          page: { limit: 100, offset: Number(url.searchParams.get('offset') || 0), hasMore: false },
        });
      default:
        return json(res, 404, { error: 'not found' });
    }
  };
}

function makeCharacter(id = ID.character, overrides = {}) {
  return {
    id,
    version: 1,
    authorId: null,
    author: null,
    createdAt: ISO,
    updatedAt: ISO,
    nome: 'Ficha sintética',
    categoria: 'Exemplo',
    titulo: 'Título',
    raca: 'Raça',
    faccao: 'Facção',
    status: 'Ativo',
    imagem: '',
    descricao: '<p>Descrição</p>',
    stats: {},
    skills: [],
    mascaraTier: '',
    blocks: [],
    theme: {},
    ...overrides,
  };
}

function makeTurn(id = ID.turn, overrides = {}) {
  return {
    id,
    authorId: null,
    authorName: 'Autoria',
    authorRole: 'member',
    authorAvatar: '',
    characterName: 'Personagem',
    characterTitle: '',
    characterAvatar: '',
    turnTitle: 'Turno',
    location: '',
    banner: '',
    bannerStyle: 'panoramic',
    images: [],
    content: '<p>Turno sintético</p>',
    oocNotes: '',
    accentColor: '',
    fontFamily: 'serif',
    date: ISO,
    edited: false,
    version: 1,
    ...overrides,
  };
}

function makeScene(id = ID.scene, turns = [makeTurn()], overrides = {}) {
  return {
    id,
    version: 1,
    turnsReadOnly: false,
    authorId: null,
    author: null,
    titulo: 'Cena sintética',
    subtitulo: '',
    categoria: 'Cena de RPG',
    status: 'Em Andamento',
    resumo: 'Resumo',
    banner: '',
    descricao: '<p>Descrição</p>',
    theme: {},
    infobox: {},
    blocks: [],
    turns,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function makePage(id = ID.page, overrides = {}) {
  return {
    id,
    publishedRevisionId: ID.revision,
    title: 'Artigo sintético',
    slug: 'artigo-sintetico',
    aliases: [],
    type: 'concept',
    summary: 'Resumo',
    categories: ['Categoria'],
    accessLevel: 'public',
    discussionThreadId: null,
    audience: 'unspecified',
    author: null,
    body: { format: 'richtext-v1', infobox: [], sections: [] },
    publicVersion: 1,
    createdAt: ISO,
    publishedAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function makeCategory(id = ID.category, overrides = {}) {
  return {
    id,
    name: 'Categoria',
    description: '',
    archivedAt: null,
    version: 1,
    createdAt: ISO,
    updatedAt: ISO,
    topicsCount: 1,
    postsCount: 1,
    ...overrides,
  };
}

function makeThread(id = ID.thread, overrides = {}) {
  return {
    id,
    categoryId: ID.category,
    categoryName: 'Categoria',
    title: 'Conversa',
    tag: '',
    pinned: false,
    locked: false,
    archivedAt: null,
    version: 1,
    lastActivityAt: ISO,
    createdAt: ISO,
    updatedAt: ISO,
    postsCount: 1,
    author: null,
    ...overrides,
  };
}

function makePost(id = ID.post, overrides = {}) {
  return {
    id,
    threadId: ID.thread,
    postNo: 1,
    version: 1,
    edited: false,
    deleted: false,
    deletedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
    content: '<p>Publicação</p>',
    author: null,
    ...overrides,
  };
}

async function withServer(t, handler) {
  const server = await startServer(handler);
  t.after(() => server.close());
  return server;
}

async function withTemp(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'public-snapshot-test-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return directory;
}

function options(origin, outputDir, overrides = {}) {
  return {
    origin,
    outputDir,
    allowLoopbackHttp: true,
    sleep: async () => {},
    connectTimeoutMs: 1000,
    readTimeoutMs: 1000,
    maxRetries: 2,
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 5000,
    maxBodyBytes: 1024 * 1024,
    maxRequests: 100,
    skipRecheck: true,
    allowTestOutput: true,
    ...overrides,
  };
}

function requestPaths(server) {
  return server.requests.map((request) => request.url);
}

function runCliAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('captures multi-page wiki listings and full published bodies', async (t) => {
  const pageA = makePage(ID.page, {
    title: 'Primeiro',
    body: {
      format: 'richtext-v1',
      infobox: [{ label: 'Classe', value: 'Exemplo' }],
      sections: [{
        id: ID.revision,
        heading: 'Visão geral',
        html: '<p>Corpo completo A</p>',
        blocks: [],
        authority: ['C'],
        knowledgeLayer: 'mundane',
      }],
    },
  });
  const pageB = makePage(ID.page2, { title: 'Segundo', slug: 'segundo' });
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, { personagens: [makeCharacter()] }, { 'set-cookie': 'session=should-not-be-forwarded' }),
    '/api/wiki-posts': (req, res) => json(res, 200, { wikiPosts: [makeScene()] }),
    '/api/wiki/sections': (req, res) => json(res, 200, { data: [{ key: 'cosmologia', name: 'Cosmologia', description: '', parentKey: null, order: 0, pagesCount: 2 }] }),
    '/api/wiki/categories': (req, res, url) => json(res, 200, {
      data: [{ name: 'Categoria', key: 'categoria', pagesCount: 2 }],
      page: { limit: 100, offset: Number(url.searchParams.get('offset')), hasMore: false },
    }),
    '/api/wiki/pages': (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      if (offset === 0) {
        return json(res, 200, { data: [pageA], page: { limit: 100, offset: 0, hasMore: true } });
      }
      return json(res, 200, { data: [pageB], page: { limit: 100, offset: 1, hasMore: false } });
    },
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: pageA }),
    [`/api/wiki/pages/${ID.page2}`]: (req, res) => json(res, 200, { data: pageB }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.dataset.characters.map((item) => item.id), [ID.character]);
  assert.deepEqual(result.dataset.wikiPages.map((item) => item.id), [ID.page, ID.page2]);
  assert.equal(result.dataset.wikiPages[0].body.sections[0].html, '<p>Corpo completo A</p>');
  assert.equal(result.manifest.counts.wikiPages, 2);
  assert.deepEqual(result.manifest.entities.wikiPages, [ID.page, ID.page2]);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
  await validateCaptureDirectory(outputDir);

  const paths = requestPaths(server);
  assert(paths.includes('/api/wiki/pages?limit=100&offset=0'));
  assert(paths.includes('/api/wiki/pages?limit=100&offset=1'));
  assert(paths.includes(`/api/wiki/pages/${ID.page}`));
  assert(paths.includes(`/api/wiki/pages/${ID.page2}`));

  assert.equal(fs.statSync(outputDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(outputDir, 'raw')).mode & 0o777, 0o700);
  for (const name of ['manifest.json', 'dataset.json']) {
    assert.equal(fs.statSync(path.join(outputDir, name)).mode & 0o777, 0o600);
  }

  assert(server.requests.every((request) => request.method === 'GET'));
  assert(server.requests.every((request) => request.headers.cookie === undefined));
  assert(server.requests.every((request) => request.headers.authorization === undefined));
});

test('captures scenes with turns without requesting scene detail when the list is sufficient', async (t) => {
  const turns = [makeTurn(ID.turn), makeTurn(ID.turn.replace('6666', '6667'), { turnTitle: 'Segundo turno' })];
  const server = await withServer(t, baseRouter({
    '/api/wiki-posts': (req, res) => json(res, 200, { wikiPosts: [makeScene(ID.scene, turns)] }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, true);
  assert.equal(result.dataset.scenes.length, 1);
  assert.equal(result.dataset.scenes[0].turns.length, 2);
  assert.equal(result.manifest.counts.sceneTurns, 2);
  assert(!requestPaths(server).some((value) => value === `/api/wiki-posts/${ID.scene}`));
});

test('uses scene detail only when the listed scene has no usable turns', async (t) => {
  const listedWithoutTurns = makeScene(ID.scene, undefined, { titulo: 'Sem turnos na lista' });
  delete listedWithoutTurns.turns;
  const listedWithTurns = makeScene(ID.scene2, [makeTurn()]);
  const detailWithTurns = makeScene(ID.scene, [makeTurn()], { titulo: 'Detalhe completo' });
  const server = await withServer(t, baseRouter({
    '/api/wiki-posts': (req, res) => json(res, 200, { wikiPosts: [listedWithoutTurns, listedWithTurns] }),
    [`/api/wiki-posts/${ID.scene}`]: (req, res) => json(res, 200, { wikiPost: detailWithTurns }),
    [`/api/wiki-posts/${ID.scene2}`]: (req, res) => json(res, 200, { wikiPost: listedWithTurns }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, true);
  assert.equal(result.dataset.scenes[0].titulo, 'Detalhe completo');
  assert.equal(result.dataset.scenes[0].turns.length, 1);
  assert(requestPaths(server).includes(`/api/wiki-posts/${ID.scene}`));
  assert(!requestPaths(server).includes(`/api/wiki-posts/${ID.scene2}`));
});

test('paces a serial queue at the configured interval without concurrent requests', async (t) => {
  let active = 0;
  let maxActive = 0;
  const server = await withServer(t, (req, res, url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    setImmediate(() => {
      active -= 1;
      if (url.pathname === '/api/personagens') return json(res, 200, { personagens: [] });
      if (url.pathname === '/api/wiki-posts') return json(res, 200, { wikiPosts: [] });
      if (url.pathname === '/api/wiki/sections') return json(res, 200, { data: [] });
      if (url.pathname === '/api/wiki/categories' || url.pathname === '/api/wiki/pages') {
        return json(res, 200, { data: [], page: { limit: 100, offset: Number(url.searchParams.get('offset') || 0), hasMore: false } });
      }
      return json(res, 404, { error: 'not found' });
    });
  });
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');
  const sleeps = [];

  const result = await runCapture(options(server.origin, outputDir, {
    sleep: async (ms) => { sleeps.push(ms); },
  }));

  assert.equal(result.ok, true);
  assert.equal(maxActive, 1);
  assert(sleeps.filter((ms) => ms === 1000).length >= 4, `expected 1000 ms spacing, got ${sleeps.join(',')}`);
});

test('traverses every wiki category page', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/wiki/categories': (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      if (offset === 0) {
        return json(res, 200, {
          data: [{ name: 'A', key: 'a', pagesCount: 1 }],
          page: { limit: 100, offset: 0, hasMore: true },
        });
      }
      return json(res, 200, {
        data: [{ name: 'B', key: 'b', pagesCount: 1 }],
        page: { limit: 100, offset: 1, hasMore: false },
      });
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, true);
  assert.deepEqual(result.dataset.wikiCategories.map((item) => item.key), ['a', 'b']);
  assert(requestPaths(server).includes('/api/wiki/categories?limit=100&offset=0'));
  assert(requestPaths(server).includes('/api/wiki/categories?limit=100&offset=1'));
});

test('reports an empty page that still claims hasMore instead of completing', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res) => json(res, 200, {
      data: [],
      page: { limit: 100, offset: 0, hasMore: true },
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'EMPTY_PAGE_WITH_HAS_MORE'));
  assert.equal(server.requests.filter((request) => request.url.startsWith('/api/wiki/pages?')).length, 1);
});

test('reports unhandled pagination on a single-page family instead of dropping records', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, {
      personagens: [makeCharacter()],
      page: { hasMore: true },
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'UNEXPECTED_PAGINATION'));
  assert.equal(result.dataset.characters.length, 1);
});

test('captures only discussion-linked forum threads and their referenced categories', async (t) => {
  const page = makePage(ID.page, { discussionThreadId: ID.thread });
  const thread = makeThread(ID.thread, { postsCount: 2 });
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      if (offset === 0) return json(res, 200, { data: [page], page: { limit: 100, offset: 0, hasMore: false } });
      return json(res, 200, { data: [], page: { limit: 100, offset, hasMore: false } });
    },
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
    [`/api/forum/threads/${ID.thread}`]: (req, res) => json(res, 200, { data: thread }),
    [`/api/forum/threads/${ID.thread}/posts`]: (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      if (offset === 0) {
        return json(res, 200, { data: [makePost()], page: { limit: 100, offset: 0, hasMore: true } });
      }
      return json(res, 200, { data: [makePost(ID.post2, { postNo: 2 })], page: { limit: 100, offset: 1, hasMore: false } });
    },
    [`/api/forum/threads/${ID.thread2}`]: (req, res) => json(res, 200, { data: makeThread(ID.thread2) }),
    '/api/forum/categories': (req, res, url) => json(res, 200, {
      data: [makeCategory(), makeCategory(ID.category2, { name: 'Outra' })],
      page: { limit: 100, offset: Number(url.searchParams.get('offset')), hasMore: false },
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, true);
  assert.deepEqual(result.dataset.forum.threads.map((item) => item.id), [ID.thread]);
  assert.equal(result.dataset.forum.postsByThread[ID.thread].length, 2);
  assert.deepEqual(result.dataset.forum.categories.map((item) => item.id), [ID.category]);
  assert.equal(result.manifest.counts.forumThreads, 1);
  assert.equal(result.manifest.counts.forumPosts, 2);

  const paths = requestPaths(server);
  assert(!paths.some((value) => value.includes(ID.thread2)), 'unrelated thread must not be fetched');
  assert(!paths.some((value) => value.includes('/threads') && value.includes('/categories/')), 'category thread list must not be crawled');
  assert(paths.includes(`/api/forum/threads/${ID.thread}`));
  assert(paths.includes(`/api/forum/threads/${ID.thread}/posts?limit=100&offset=0`));
  assert(paths.includes(`/api/forum/threads/${ID.thread}/posts?limit=100&offset=1`));
});

test('filters a post that does not belong to the requested forum thread', async (t) => {
  const page = makePage(ID.page, { discussionThreadId: ID.thread });
  const thread = makeThread(ID.thread, { postsCount: 1 });
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res) => json(res, 200, {
      data: [page],
      page: { limit: 100, offset: 0, hasMore: false },
    }),
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
    [`/api/forum/threads/${ID.thread}`]: (req, res) => json(res, 200, { data: thread }),
    [`/api/forum/threads/${ID.thread}/posts`]: (req, res) => json(res, 200, {
      data: [
        makePost(),
        makePost(ID.post2, { threadId: ID.thread2, postNo: 2 }),
      ],
      page: { limit: 100, offset: 0, hasMore: false },
    }),
    '/api/forum/categories': (req, res) => json(res, 200, {
      data: [makeCategory()],
      page: { limit: 100, offset: 0, hasMore: false },
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'WRONG_THREAD_POST'));
  assert.deepEqual(result.dataset.forum.postsByThread[ID.thread].map((item) => item.id), [ID.post]);
  assert(!requestPaths(server).some((value) => value.includes(ID.thread2)), 'the foreign thread must not be fetched');
});

test('records 401/403 as visibility gaps and 404 as an explicit inventory gap', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 403, { error: 'forbidden' }),
    '/api/wiki-posts': (req, res) => json(res, 404, { error: 'not found' }),
    '/api/wiki/sections': (req, res) => json(res, 401, { error: 'unauthorized' }),
    '/api/wiki/pages': (req, res) => json(res, 403, { error: 'forbidden' }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.manifest.consistency.complete, false);
  const reasons = result.manifest.gaps.map((gap) => gap.reason);
  assert(reasons.includes('VISIBILITY_BOUNDARY'));
  assert(reasons.includes('NOT_FOUND'));
  assert.deepEqual(result.dataset.characters, []);
  assert.deepEqual(result.dataset.scenes, []);
  assert.deepEqual(result.dataset.wikiPages, []);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
});

test('retries 429 honoring Retry-After and reports exhausted 5xx retries', async (t) => {
  let characterAttempts = 0;
  let sectionAttempts = 0;
  let categoryAttempts = 0;
  const sleeps = [];
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => {
      characterAttempts += 1;
      if (characterAttempts === 1) {
        return json(res, 429, { error: 'slow down' }, { 'retry-after': '2' });
      }
      return json(res, 200, { personagens: [makeCharacter()] });
    },
    '/api/wiki/sections': (req, res) => {
      sectionAttempts += 1;
      return json(res, 503, { error: 'unavailable' });
    },
    '/api/wiki/categories': (req, res) => {
      categoryAttempts += 1;
      return json(res, 429, { error: 'slow down' }, { 'retry-after': '1' });
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, {
    sleep: async (ms) => { sleeps.push(ms); },
  }));

  assert.equal(result.ok, false);
  assert.equal(characterAttempts, 2);
  assert.equal(sectionAttempts, 3);
  assert.equal(categoryAttempts, 3);
  assert(sleeps.includes(2000), `expected Retry-After wait, got ${sleeps.join(',')}`);
  assert(result.manifest.gaps.some((gap) => gap.family === 'wikiSections' && gap.reason === 'SERVER_ERROR' && gap.status === 503));
  assert(result.manifest.gaps.some((gap) => gap.family === 'wikiCategories' && gap.reason === 'RATE_LIMITED' && gap.status === 429));
  assert.deepEqual(result.dataset.characters.map((item) => item.id), [ID.character]);
});

test('rejects invalid and oversized JSON without reporting empty success', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"personagens": [');
    },
    '/api/wiki-posts': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ wikiPosts: [{ id: ID.scene, padding: 'x'.repeat(500) }] }));
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, { maxBodyBytes: 256 }));

  assert.equal(result.ok, false);
  const reasons = result.manifest.gaps.map((gap) => gap.reason);
  assert(reasons.includes('INVALID_JSON'));
  assert(reasons.includes('BODY_TOO_LARGE'));
  assert.deepEqual(result.dataset.characters, []);
  assert.deepEqual(result.dataset.scenes, []);
});

test('rejects off-origin and unknown-family redirects without following them', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => {
      res.writeHead(302, { location: 'https://example.invalid/api/personagens' });
      res.end();
    },
    '/api/wiki-posts': (req, res) => {
      res.writeHead(302, { location: '/api/staff/wiki-posts/hidden' });
      res.end();
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.family === 'characters' && gap.reason === 'UNSAFE_REDIRECT'));
  assert(result.manifest.gaps.some((gap) => gap.family === 'scenes' && gap.reason === 'UNSAFE_REDIRECT'));
  assert(!requestPaths(server).some((value) => value.includes('/api/staff/')), 'unknown endpoint must not be requested');
});

test('handles timeouts and partial response interruption as explicit gaps', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/wiki/sections': (req, res) => {
      // Deliberately never respond; the client timeout must bound this.
    },
    '/api/wiki-posts': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"wikiPosts": [');
      setImmediate(() => res.destroy());
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, {
    connectTimeoutMs: 100,
    readTimeoutMs: 100,
    maxRetries: 0,
  }));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.family === 'wikiSections' && /TIMEOUT/.test(gap.reason)));
  assert(result.manifest.gaps.some((gap) => gap.family === 'scenes' && /PARTIAL_RESPONSE|READ_ERROR/.test(gap.reason)));
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), true);
});

test('enforces the request budget while preserving partial evidence', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, { personagens: [makeCharacter()] }),
    '/api/wiki-posts': (req, res) => json(res, 200, { wikiPosts: [makeScene()] }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, { maxRequests: 2 }));

  assert.equal(result.ok, false);
  assert.equal(result.manifest.requests.length, 2);
  assert(server.requests.length <= 2);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'REQUEST_BUDGET_EXHAUSTED'));
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), true);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
});

test('dry-run validates the plan with zero network traffic and no output directory', async (t) => {
  const server = await withServer(t, baseRouter());
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, { dryRun: true }));

  assert.equal(result.dryRun, true);
  assert.equal(result.ok, true);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(outputDir), false);
  assert.equal(result.plan.requestPolicy.anonymous, true);
  assert(result.plan.families.some((family) => family.includes('/api/wiki/pages')));
});

test('refuses to overwrite an existing output directory before making a request', async (t) => {
  const server = await withServer(t, baseRouter());
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');
  await fsp.mkdir(outputDir);

  await assert.rejects(
    () => runCapture(options(server.origin, outputDir)),
    (error) => error instanceof CaptureUsageError && /already exists/.test(error.message),
  );
  assert.equal(server.requests.length, 0);
});

test('detects repeated and duplicate pagination pages instead of looping or faking completion', async (t) => {
  const page = makePage(ID.page);
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      return json(res, 200, { data: [page], page: { limit: 100, offset, hasMore: true } });
    },
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'REPEATED_PAGE'));
  assert.equal(server.requests.filter((request) => request.url.startsWith('/api/wiki/pages?')).length, 2);
});

test('deduplicates an entity id while reporting the conflict', async (t) => {
  const page = makePage(ID.page);
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res) => json(res, 200, {
      data: [page, { ...page, title: 'Conflicting duplicate' }],
      page: { limit: 100, offset: 0, hasMore: false },
    }),
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'CONFLICTING_ID'));
  assert.equal(result.dataset.wikiPages.length, 1);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
});

test('adopts a stable later observation while reporting records that keep changing', async (t) => {
  let characterVersion = 1;
  let sceneVersion = 1;
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => {
      const body = { personagens: [makeCharacter(ID.character, { version: characterVersion })] };
      if (characterVersion === 1) characterVersion = 2;
      return json(res, 200, body);
    },
    '/api/wiki-posts': (req, res) => {
      const body = { wikiPosts: [makeScene(ID.scene, [makeTurn()], { version: sceneVersion })] };
      sceneVersion += 1;
      return json(res, 200, body);
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, {
    skipRecheck: false,
    recheckAttempts: 2,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.dataset.characters[0].version, 2);
  assert(result.manifest.consistency.unresolvedChanges.some((change) => change.family === 'scenes'));
  assert.equal(result.manifest.consistency.complete, false);
});

test('records sensitive account fields as a fatal gap and never stores the body', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, {
      personagens: [makeCharacter(ID.character, { email: 'private@example.invalid' })],
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'SENSITIVE_FIELD_REJECTED'));
  const rawFiles = fs.existsSync(path.join(outputDir, 'raw'))
    ? fs.readdirSync(path.join(outputDir, 'raw'))
    : [];
  for (const file of rawFiles) {
    const contents = fs.readFileSync(path.join(outputDir, 'raw', file), 'utf8');
    assert.doesNotMatch(contents, /private@example\.invalid/);
  }
});

test('rejects sensitive-looking fields in unparsable JSON before storing bytes', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"personagens": [{"email": "private@example.invalid"}');
    },
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));

  assert.equal(result.ok, false);
  assert(result.manifest.gaps.some((gap) => gap.reason === 'SENSITIVE_FIELD_REJECTED'));
  const rawDir = path.join(outputDir, 'raw');
  const rawFiles = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];
  for (const file of rawFiles) {
    assert.doesNotMatch(fs.readFileSync(path.join(rawDir, file), 'utf8'), /private@example\.invalid/);
  }
});

test('manifest, dataset, and stored hashes agree exactly', async (t) => {
  const page = makePage(ID.page, {
    body: {
      format: 'richtext-v1',
      infobox: [],
      sections: [{ id: ID.revision, heading: 'Seção', html: '<p>Corpo</p>', blocks: [], authority: ['C'], knowledgeLayer: 'mundane' }],
    },
  });
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res) => json(res, 200, { data: [page], page: { limit: 100, offset: 0, hasMore: false } }),
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir, { skipRecheck: false }));
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
  const captured = await validateCaptureDirectory(outputDir);

  for (const request of captured.manifest.requests) {
    if (!request.storedAs) continue;
    const bytes = fs.readFileSync(path.join(outputDir, request.storedAs));
    assert.equal(bytes.length, request.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), request.sha256);
  }
  const entityIds = [
    ...result.manifest.entities.characters,
    ...result.manifest.entities.scenes,
    ...result.manifest.entities.wikiPages,
    ...result.manifest.entities.forumThreads,
  ];
  assert.equal(new Set(entityIds).size, entityIds.length);
});

test('manifest integrity requires dataset evidence, derived completeness, and matching dataset bytes', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, { personagens: [makeCharacter()] }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));
  assert.equal(result.ok, true);
  assert.match(result.manifest.datasetSha256, /^[0-9a-f]{64}$/u);
  const datasetBytes = fs.readFileSync(path.join(outputDir, 'dataset.json'));
  assert.equal(
    result.manifest.datasetSha256,
    crypto.createHash('sha256').update(datasetBytes).digest('hex'),
  );
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));
  await validateCaptureDirectory(outputDir);

  const noRequests = structuredClone(result.manifest);
  noRequests.requests = [];
  assert.throws(
    () => validateDataset(result.dataset, noRequests),
    /at least one observed response/u,
  );

  const gappedButComplete = structuredClone(result.manifest);
  gappedButComplete.gaps = [{
    family: 'characters',
    endpoint: '/api/personagens',
    status: 401,
    reason: 'VISIBILITY_BOUNDARY',
  }];
  gappedButComplete.consistency.complete = true;
  assert.throws(
    () => validateDataset(result.dataset, gappedButComplete),
    /complete must match/u,
  );

  const churnedButComplete = structuredClone(result.manifest);
  churnedButComplete.consistency.unresolvedChanges = [{
    family: 'forumPosts',
    reason: 'Thread posts kept changing during the final recheck.',
    ids: [ID.thread],
  }];
  churnedButComplete.consistency.complete = true;
  assert.throws(
    () => validateDataset(result.dataset, churnedButComplete),
    /complete must match/u,
  );

  const cleanButIncomplete = structuredClone(result.manifest);
  cleanButIncomplete.consistency.complete = false;
  assert.throws(
    () => validateDataset(result.dataset, cleanButIncomplete),
    /complete must match/u,
  );

  const missingDigest = structuredClone(result.manifest);
  delete missingDigest.datasetSha256;
  assert.throws(
    () => validateDataset(result.dataset, missingDigest),
    /datasetSha256/u,
  );
});

test('a dataset modified after the manifest was written is rejected by its digest', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, { personagens: [makeCharacter()] }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));
  assert.equal(result.ok, true);
  const datasetPath = path.join(outputDir, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  dataset.characters[0].descricao = '<p>conteúdo arbitrário não respaldado</p>';
  fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, { mode: 0o600 });

  assert.doesNotThrow(() => validateDataset(dataset, result.manifest));
  await assert.rejects(
    () => validateCaptureDirectory(outputDir),
    /datasetSha256/u,
  );
});

test('dataset forum closure requires one posts entry and visible postsCount, with tombstones retained', async (t) => {
  const page = makePage(ID.page, { discussionThreadId: ID.thread });
  const thread = makeThread(ID.thread, { postsCount: 3 });
  const posts = [
    makePost(ID.post, { postNo: 1 }),
    makePost(ID.post2, { postNo: 2 }),
    makePost('88888888-8888-4888-8888-888888888890', { postNo: 3 }),
  ];
  const server = await withServer(t, baseRouter({
    '/api/wiki/pages': (req, res, url) => json(res, 200, {
      data: [page],
      page: { limit: 100, offset: Number(url.searchParams.get('offset')), hasMore: false },
    }),
    [`/api/wiki/pages/${ID.page}`]: (req, res) => json(res, 200, { data: page }),
    [`/api/forum/threads/${ID.thread}`]: (req, res) => json(res, 200, { data: thread }),
    [`/api/forum/threads/${ID.thread}/posts`]: (req, res, url) => json(res, 200, {
      data: posts,
      page: { limit: 100, offset: Number(url.searchParams.get('offset')), hasMore: false },
    }),
    '/api/forum/categories': (req, res, url) => json(res, 200, {
      data: [makeCategory()],
      page: { limit: 100, offset: Number(url.searchParams.get('offset')), hasMore: false },
    }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCapture(options(server.origin, outputDir));
  assert.equal(result.ok, true);
  assert.equal(result.dataset.forum.postsByThread[ID.thread].length, 3);
  assert.doesNotThrow(() => validateDataset(result.dataset, result.manifest));

  const missingEntry = structuredClone(result.dataset);
  delete missingEntry.forum.postsByThread[ID.thread];
  const missingEntryManifest = structuredClone(result.manifest);
  missingEntryManifest.counts.forumPosts = 0;
  assert.throws(
    () => validateDataset(missingEntry, missingEntryManifest),
    /exactly one entry per captured thread/u,
  );

  const wrongCount = structuredClone(result.dataset);
  wrongCount.forum.threads[0].postsCount = 4;
  assert.throws(
    () => validateDataset(wrongCount, result.manifest),
    /postsCount 4 but 3 visible/u,
  );

  const tombstone = structuredClone(result.dataset);
  tombstone.forum.postsByThread[ID.thread].push(makePost(
    '88888888-8888-4888-8888-888888888891',
    {
      postNo: 4,
      deleted: true,
      deletedAt: '2026-11-08T12:00:00.000Z',
      content: undefined,
    },
  ));
  const tombstoneManifest = structuredClone(result.manifest);
  tombstoneManifest.counts.forumPosts = 4;
  assert.doesNotThrow(() => validateDataset(tombstone, tombstoneManifest));

  tombstone.forum.threads[0].postsCount = 4;
  assert.throws(
    () => validateDataset(tombstone, tombstoneManifest),
    /postsCount 4 but 3 visible/u,
  );
});

test('normal capture output is confined to the private Git-ignored root', async (t) => {
  const repoRelative = path.resolve('captures-outside-private-root');
  assert.throws(
    () => normalizeCaptureOptions({ origin: 'https://eterverso.onrender.com', outputDir: repoRelative }),
    (error) => error instanceof CaptureUsageError && /public-snapshots/u.test(error.message),
  );
  assert.throws(
    () => normalizeCaptureOptions({
      origin: 'https://eterverso.onrender.com',
      outputDir: path.join(PRIVATE_CAPTURE_ROOT, '..', 'escaped-capture'),
    }),
    (error) => error instanceof CaptureUsageError && /public-snapshots/u.test(error.message),
  );
  assert.doesNotThrow(() => normalizeCaptureOptions({
    origin: 'https://eterverso.onrender.com',
    outputDir: path.join(PRIVATE_CAPTURE_ROOT, 'capture-synthetic-path-check'),
  }));
  assert.throws(
    () => normalizeCaptureOptions({
      origin: 'https://eterverso.onrender.com',
      outputDir: path.join(os.tmpdir(), 'capture-test-override'),
      allowTestOutput: true,
    }),
    (error) => error instanceof CaptureUsageError && /loopback/u.test(error.message),
  );
  assert.doesNotThrow(() => normalizeCaptureOptions({
    origin: 'http://127.0.0.1:43210',
    outputDir: path.join(os.tmpdir(), 'capture-test-override'),
    allowLoopbackHttp: true,
    allowTestOutput: true,
  }));

  const server = await withServer(t, baseRouter());
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');
  await assert.rejects(
    () => runCapture({
      ...options(server.origin, outputDir),
      allowTestOutput: false,
    }),
    (error) => error instanceof CaptureUsageError && /public-snapshots/u.test(error.message),
  );
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(outputDir), false);

  const cli = spawnSync(process.execPath, [
    CLI,
    '--origin', server.origin,
    '--allow-loopback-http',
    '--output', outputDir,
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /public-snapshots/u);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(outputDir), false);
});

test('sends no cookies or authorization and uses GET only across requests', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 200, { personagens: [makeCharacter()] }, { 'set-cookie': 'sid=abc; Path=/' }),
    '/api/wiki-posts': (req, res) => json(res, 200, { wikiPosts: [] }, { 'set-cookie': 'other=def; Path=/' }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  await runCapture(options(server.origin, outputDir));

  assert(server.requests.length > 0);
  assert(server.requests.every((request) => request.method === 'GET'));
  assert(server.requests.every((request) => request.headers.cookie === undefined));
  assert(server.requests.every((request) => request.headers.authorization === undefined));
});

test('origin validation requires HTTPS except explicit loopback test mode', () => {
  assert.equal(normalizeOrigin('https://eterverso.onrender.com'), 'https://eterverso.onrender.com');
  assert.equal(normalizeOrigin('http://127.0.0.1:3000', { allowLoopbackHttp: true }), 'http://127.0.0.1:3000');
  assert.throws(() => normalizeOrigin('http://127.0.0.1:3000'), CaptureUsageError);
  assert.throws(() => normalizeOrigin('http://example.com', { allowLoopbackHttp: true }), CaptureUsageError);
  assert.throws(() => normalizeOrigin('https://example.com/path'), CaptureUsageError);
  assert.throws(() => normalizeOrigin('https://user:pass@example.com'), CaptureUsageError);
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('not-a-date'), null);
});

test('CLI help, dry-run, invalid origin, and overwrite refusal are bounded', async (t) => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/public-snapshot-fetch\.js/);

  const server = await withServer(t, baseRouter());
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const dryRun = spawnSync(process.execPath, [
    CLI,
    '--origin', server.origin,
    '--allow-loopback-http',
    '--allow-test-output',
    '--output', outputDir,
    '--dry-run',
  ], { encoding: 'utf8' });
  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /No network request was made/);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(outputDir), false);

  const badOrigin = spawnSync(process.execPath, [
    CLI,
    '--origin', 'http://example.com',
    '--output', path.join(temp, 'bad'),
  ], { encoding: 'utf8' });
  assert.equal(badOrigin.status, 2);
  assert.match(badOrigin.stderr, /HTTPS/);

  await fsp.mkdir(outputDir);
  const overwrite = spawnSync(process.execPath, [
    CLI,
    '--origin', server.origin,
    '--allow-loopback-http',
    '--allow-test-output',
    '--output', outputDir,
  ], { encoding: 'utf8' });
  assert.equal(overwrite.status, 2);
  assert.match(overwrite.stderr, /already exists/);
  assert.equal(server.requests.length, 0);
});

test('CLI exits nonzero when the capture has explicit gaps', async (t) => {
  const server = await withServer(t, baseRouter({
    '/api/personagens': (req, res) => json(res, 403, { error: 'forbidden' }),
  }));
  const temp = await withTemp(t);
  const outputDir = path.join(temp, 'capture');

  const result = await runCliAsync([
    '--origin', server.origin,
    '--allow-loopback-http',
    '--allow-test-output',
    '--output', outputDir,
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /incomplete/);
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), true);
});

test('parseArgs rejects unknown, duplicate, and missing-value options', () => {
  assert.throws(() => parseArgs(['--unknown']), CaptureUsageError);
  assert.throws(() => parseArgs(['--output', 'a', '--output', 'b']), CaptureUsageError);
  assert.throws(() => parseArgs(['--origin']), CaptureUsageError);
  assert.deepEqual(parseArgs(['--output', 'out', '--max-requests', '12']).maxRequests, '12');
  assert.equal(parseArgs(['--output', 'out', '--allow-test-output']).allowTestOutput, true);
});
