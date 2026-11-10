'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyPlanWithRepository,
  buildImportPlan,
  inspectExistingTesters,
  readCapture,
  testerCredentialsContents,
} = require('../../scripts/public-sandbox-import');
const { main, statePaths } = require('../../scripts/public-sandbox');

const ORIGIN = 'https://eterverso.onrender.com';
const CAPTURE_ID = 'capture-synthetic-001';
const AUTHOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_AUTHOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const CHARACTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LEGACY_SCENE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const NORMALIZED_SCENE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const WIKI_PAGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const WIKI_REVISION_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const OTHER_WIKI_PAGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const OTHER_WIKI_REVISION_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
const FORUM_CATEGORY_ID = '99999999-9999-4999-8999-999999999990';
const FORUM_THREAD_ID = '99999999-9999-4999-8999-999999999991';
const FORUM_POST_ONE_ID = '99999999-9999-4999-8999-999999999992';
const FORUM_POST_TWO_ID = '99999999-9999-4999-8999-999999999993';
const SECTION_ONE_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const SECTION_TWO_ID = 'aaaaaaaa-2222-4222-8222-222222222222';

function author(id = AUTHOR_ID, username = 'autora-sintetica', role = 'admin') {
  return {
    id,
    username,
    avatar: `/api/users/${id}/avatar?v=2`,
    title: 'Autora sintética',
    role,
  };
}

function baseDataset() {
  return {
    schemaVersion: 'AetherversePublicCaptureV1',
    origin: ORIGIN,
    capturedAt: '2026-11-08T10:05:00.000Z',
    characters: [{
      id: CHARACTER_ID,
      version: 3,
      authorId: AUTHOR_ID,
      author: author(),
      createdAt: '2026-11-08T10:00:00.000Z',
      updatedAt: '2026-11-08T10:01:00.000Z',
      nome: 'Ficha Sintética',
      categoria: 'Herói',
      titulo: 'A Guardiã',
      raca: 'Humana',
      faccao: 'Ordem',
      status: 'Ativa',
      imagem: '/img/ficha.png',
      descricao: '<p>Descrição <strong>sintética</strong>.</p>',
      stats: { ataque: 42, defesa: 17 },
      skills: [{ nome: 'Escudo', descricao: 'Protege', tipo: 'skill' }],
      mascaraTier: 'Tier 2',
      blocks: [{ type: 'section', title: 'Bloco', content: '<p>Conteúdo do bloco</p>' }],
      theme: {
        accentColor: '#aabbcc', bannerStyle: 'cinematic', layout: 'sidebar-left',
        fontFamily: 'sans', bgEffect: 'none', bgm: '',
      },
    }],
    scenes: [
      {
        id: LEGACY_SCENE_ID,
        version: 1,
        turnsReadOnly: true,
        authorId: AUTHOR_ID,
        author: author(),
        titulo: 'Cena Legada',
        subtitulo: 'Subtítulo',
        categoria: 'Cena de RPG',
        status: 'Em Andamento',
        resumo: 'Resumo da cena',
        banner: '/img/cena.png',
        descricao: '<p>Cena legada</p>',
        theme: {
          accentColor: '#112233', bannerStyle: 'standard', layout: 'full',
          fontFamily: 'serif', bgEffect: 'aura', bgm: '',
        },
        infobox: {
          show: true,
          title: 'Informações',
          image: '/img/info.png',
          caption: 'Legenda',
          location: 'Local',
          timeline: 'Hoje',
          participants: ['Doe, Jane', 'Outra Pessoa'],
          fields: [{ label: 'Campo', value: 'Valor, com vírgula' }],
        },
        blocks: [{ type: 'section', title: 'Bloco da cena', content: '<p>Bloco da cena</p>' }],
        turns: [
          {
            id: 'turn-legacy-1',
            authorId: null,
            authorName: 'Doe, Jane',
            authorRole: 'member',
            authorAvatar: '',
            characterName: 'Fulana',
            characterTitle: '',
            characterAvatar: '/img/turn.png',
            turnTitle: 'Turno 1',
            location: 'Salão',
            banner: '',
            bannerStyle: 'panoramic',
            images: [{ url: '/img/anexo.png', caption: 'Anexo' }],
            content: '<p>Primeiro turno</p>',
            oocNotes: 'Nota',
            accentColor: '#112233',
            fontFamily: 'serif',
            date: '2026-01-01',
            edited: false,
            version: 1,
            legacyReadOnly: true,
          },
          {
            id: 'turn-legacy-2',
            authorId: AUTHOR_ID,
            authorName: 'autora-sintetica',
            authorRole: 'admin',
            authorAvatar: '',
            characterName: '',
            characterTitle: '',
            characterAvatar: '',
            turnTitle: '',
            location: '',
            banner: '',
            bannerStyle: 'panoramic',
            images: [],
            content: '<p>Segundo turno</p>',
            oocNotes: '',
            accentColor: '',
            fontFamily: 'serif',
            date: '2026-01-02',
            edited: true,
            version: 1,
            legacyReadOnly: true,
          },
        ],
        createdAt: '2026-11-08T09:00:00.000Z',
        updatedAt: '2026-11-08T09:30:00.000Z',
      },
      {
        id: NORMALIZED_SCENE_ID,
        version: 2,
        turnsReadOnly: false,
        authorId: AUTHOR_ID,
        author: author(),
        titulo: 'Cena Normalizada',
        subtitulo: '',
        categoria: 'Cena de RPG',
        status: 'Concluída',
        resumo: 'Resumo normalizado',
        banner: '',
        descricao: '<p>Cena normalizada</p>',
        theme: {
          accentColor: '#445566', bannerStyle: 'compact', layout: 'book',
          fontFamily: 'mono', bgEffect: 'grid', bgm: '',
        },
        infobox: { show: false, title: '', image: '', caption: '', location: '', timeline: '', participants: [], fields: [] },
        blocks: [],
        turns: [{
          id: 'turn-normalized-1',
          authorId: AUTHOR_ID,
          authorName: 'autora-sintetica',
          authorRole: 'admin',
          authorAvatar: '',
          characterName: 'Fulana',
          characterTitle: '',
          characterAvatar: '',
          turnTitle: '',
          location: '',
          banner: '',
          bannerStyle: 'side',
          images: [],
          content: '<p>Turno normalizado</p>',
          oocNotes: '',
          accentColor: '',
          fontFamily: 'sans',
          date: '2026-01-03',
          edited: false,
          version: 2,
        }],
        createdAt: '2026-11-08T09:40:00.000Z',
        updatedAt: '2026-11-08T09:50:00.000Z',
      },
    ],
    wikiPages: [
      {
        id: WIKI_PAGE_ID,
        publishedRevisionId: WIKI_REVISION_ID,
        title: 'Artigo Sintético',
        slug: 'artigo-sintetico',
        aliases: ['artigo-antigo'],
        type: 'concept',
        summary: 'Resumo do artigo sintético.',
        categories: ['Categoria Sintética'],
        accessLevel: 'public',
        discussionThreadId: FORUM_THREAD_ID,
        audience: 'reader',
        author: author(),
        body: {
          format: 'richtext-v1',
          infobox: [{ label: 'Tipo', value: 'Conceito' }],
          sections: [{
            id: SECTION_ONE_ID,
            heading: 'Seção',
            html: `<p>Texto com <a href="/wiki/outro-artigo#${SECTION_TWO_ID}">link</a>.</p>`,
            blocks: [{ type: 'section', title: 'Bloco wiki', content: '<p>Bloco wiki</p>' }],
            authority: ['C'],
            knowledgeLayer: 'mundane',
          }],
        },
        publicVersion: 4,
        createdAt: '2026-11-08T08:00:00.000Z',
        publishedAt: '2026-11-08T08:30:00.000Z',
        updatedAt: '2026-11-08T08:30:00.000Z',
      },
      {
        id: OTHER_WIKI_PAGE_ID,
        publishedRevisionId: OTHER_WIKI_REVISION_ID,
        title: 'Outro Artigo',
        slug: 'outro-artigo',
        aliases: [],
        type: 'place',
        summary: 'Outro resumo.',
        categories: ['Categoria Sintética'],
        accessLevel: 'public',
        discussionThreadId: null,
        audience: 'unspecified',
        author: author(OTHER_AUTHOR_ID, 'outra-autora', 'member'),
        body: {
          format: 'richtext-v1',
          infobox: [],
          sections: [{
            id: SECTION_TWO_ID,
            heading: 'Outra seção',
            html: '<p>Outro texto.</p>',
            blocks: [],
            authority: [],
            knowledgeLayer: 'unspecified',
          }],
        },
        publicVersion: 2,
        createdAt: '2026-11-08T08:10:00.000Z',
        publishedAt: '2026-11-08T08:20:00.000Z',
        updatedAt: '2026-11-08T08:20:00.000Z',
      },
    ],
    wikiSections: [
      { key: 'paranormalidade', name: 'Paranormalidade', description: '', parentKey: null, order: 0, pagesCount: 2 },
      { key: 'percepcao', name: 'Percepção', description: '', parentKey: 'paranormalidade', order: 0, pagesCount: 1 },
    ],
    wikiCategories: [
      { name: 'Categoria Sintética', key: 'categoria-sintetica', pagesCount: 2 },
    ],
    forum: {
      categories: [{
        id: FORUM_CATEGORY_ID,
        name: 'Geral',
        description: 'Categoria sintética',
        archivedAt: null,
        version: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        topicsCount: 1,
        postsCount: 2,
      }],
      threads: [{
        id: FORUM_THREAD_ID,
        categoryId: FORUM_CATEGORY_ID,
        categoryName: 'Geral',
        title: 'Discussão Sintética',
        tag: 'geral',
        pinned: false,
        locked: false,
        archivedAt: null,
        version: 1,
        lastActivityAt: '2026-11-02T12:00:00.000Z',
        createdAt: '2026-11-02T11:00:00.000Z',
        updatedAt: '2026-11-02T12:00:00.000Z',
        postsCount: 2,
        author: author(),
      }],
      postsByThread: {
        [FORUM_THREAD_ID]: [
          {
            id: FORUM_POST_ONE_ID,
            threadId: FORUM_THREAD_ID,
            postNo: 1,
            version: 1,
            edited: false,
            deleted: false,
            deletedAt: null,
            createdAt: '2026-11-02T11:00:00.000Z',
            updatedAt: '2026-11-02T11:00:00.000Z',
            content: '<p>Abertura</p>',
            author: author(),
          },
          {
            id: FORUM_POST_TWO_ID,
            threadId: FORUM_THREAD_ID,
            postNo: 2,
            version: 1,
            edited: false,
            deleted: false,
            deletedAt: null,
            createdAt: '2026-11-02T12:00:00.000Z',
            updatedAt: '2026-11-02T12:00:00.000Z',
            content: '<p>Resposta</p>',
            author: author(OTHER_AUTHOR_ID, 'outra-autora', 'member'),
          },
        ],
      },
    },
  };
}

function writePrivate(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function countCapture(dataset) {
  return {
    characters: dataset.characters.length,
    scenes: dataset.scenes.length,
    sceneTurns: dataset.scenes.reduce((total, scene) => total + scene.turns.length, 0),
    wikiPages: dataset.wikiPages.length,
    wikiSections: dataset.wikiSections.length,
    wikiCategories: dataset.wikiCategories.length,
    forumThreads: dataset.forum.threads.length,
    forumPosts: Object.values(dataset.forum.postsByThread).reduce((total, posts) => total + posts.length, 0),
  };
}

function makeCapture(t, mutateDataset = (dataset) => dataset, mutateManifest = (manifest) => manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eterverso-sandbox-capture-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, CAPTURE_ID);
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);

  const dataset = mutateDataset(baseDataset());
  const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
  writePrivate(path.join(directory, 'dataset.json'), datasetText);
  const datasetSha256 = crypto.createHash('sha256').update(Buffer.from(datasetText, 'utf8')).digest('hex');

  const rawText = '{"personagens":[]}\n';
  const rawBytes = Buffer.from(rawText, 'utf8');
  writePrivate(path.join(directory, 'raw', 'personagens.json'), rawText);
  const counts = countCapture(dataset);
  const manifest = mutateManifest({
    schemaVersion: 'AetherversePublicCaptureV1',
    captureId: CAPTURE_ID,
    origin: ORIGIN,
    startedAt: '2026-11-08T10:00:00.000Z',
    finishedAt: '2026-11-08T10:05:00.000Z',
    datasetSha256,
    requestPolicy: { anonymous: true, maxRequestsPerSecond: 1 },
    counts,
    entities: {
      characters: dataset.characters.map((record) => record.id),
      scenes: dataset.scenes.map((record) => record.id),
      wikiPages: dataset.wikiPages.map((record) => record.id),
      forumThreads: dataset.forum.threads.map((record) => record.id),
    },
    gaps: [],
    consistency: { complete: true, observedInterval: true, unresolvedChanges: [] },
    requests: [{
      family: 'characters',
      url: `${ORIGIN}/api/personagens`,
      status: 200,
      bytes: rawBytes.length,
      sha256: crypto.createHash('sha256').update(rawBytes).digest('hex'),
      storedAs: 'raw/personagens.json',
    }],
  });
  writePrivate(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, directory, dataset };
}

function testerPasswords() {
  return {
    admin: 'admin-password-synthetic-0001',
    moderador: 'moderador-password-synthetic-0001',
    member: 'member-password-synthetic-0001',
  };
}

function planFor(directory) {
  const capture = readCapture({ captureDirectory: directory });
  return buildImportPlan({
    capture,
    testerPasswords: testerPasswords(),
    passwordHasher: (value) => `hash:${value}`,
  });
}

function emptyState() {
  return {
    users: new Map(),
    characters: new Map(),
    categories: new Map(),
    threads: new Map(),
    posts: new Map(),
    sections: new Map(),
    wikiPages: new Map(),
    wikiRevisions: new Map(),
    wikiNames: new Map(),
    revisionCategories: new Map(),
    revisionLinks: new Map(),
    scenes: new Map(),
    sceneTurns: new Map(),
    sceneBackups: new Map(),
    sceneMarkers: new Map(),
  };
}

function createMemoryRepository({ failOn = null } = {}) {
  let state = emptyState();
  const failures = new Map();
  if (failOn) failures.set(failOn, 1);
  function maybeFail(name) {
    if (failures.get(name) > 0) {
      failures.set(name, failures.get(name) - 1);
      throw new Error(`synthetic repository failure at ${name}`);
    }
  }
  function categoryKey(revisionId, key) { return `${revisionId}\0${key}`; }
  function linkKey(revisionId, nameKey, anchor) { return `${revisionId}\0${nameKey}\0${anchor}`; }
  function turnKey(sceneId, ordinal) { return `${sceneId}\0${ordinal}`; }
  const repository = {
    get state() { return state; },
    transaction: async (callback) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(repository);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    getUser: async (id) => state.users.get(id) || null,
    getUserByUsername: async (username) => [...state.users.values()]
      .find((user) => user.username.toLowerCase() === username.toLowerCase()) || null,
    insertUser: async (row) => { maybeFail('insertUser'); state.users.set(row.id, { ...row }); },
    getCharacter: async (id) => state.characters.get(id) || null,
    insertCharacter: async (row) => { maybeFail('insertCharacter'); state.characters.set(row.id, structuredClone(row)); },
    getForumCategory: async (id) => state.categories.get(id) || null,
    insertForumCategory: async (row) => { maybeFail('insertForumCategory'); state.categories.set(row.id, { ...row }); },
    getThread: async (id) => state.threads.get(id) || null,
    insertThread: async (row) => { maybeFail('insertThread'); state.threads.set(row.id, { ...row }); },
    getPost: async (id) => state.posts.get(id) || null,
    insertPost: async (row) => { maybeFail('insertPost'); state.posts.set(row.id, { ...row }); },
    getWikiSection: async (key) => state.sections.get(key) || null,
    insertWikiSection: async (row) => { maybeFail('insertWikiSection'); state.sections.set(row.key, { ...row }); },
    getWikiPage: async (id) => state.wikiPages.get(id) || null,
    insertWikiPage: async (row) => { maybeFail('insertWikiPage'); state.wikiPages.set(row.id, { ...row }); },
    updateWikiPageRevisionPointers: async (pageId, revisionId) => {
      maybeFail('updateWikiPageRevisionPointers');
      const page = state.wikiPages.get(pageId);
      page.head_revision_id = revisionId;
      page.published_revision_id = revisionId;
    },
    getWikiRevision: async (id) => state.wikiRevisions.get(id) || null,
    insertWikiRevision: async (row) => { maybeFail('insertWikiRevision'); state.wikiRevisions.set(row.id, structuredClone(row)); },
    getWikiName: async (nameKey) => state.wikiNames.get(nameKey) || null,
    insertWikiName: async (row) => { maybeFail('insertWikiName'); state.wikiNames.set(row.name_key, { ...row }); },
    getWikiRevisionCategory: async (revisionId, key) => state.revisionCategories.get(categoryKey(revisionId, key)) || null,
    insertWikiRevisionCategory: async (row) => {
      maybeFail('insertWikiRevisionCategory');
      state.revisionCategories.set(categoryKey(row.revision_id, row.category_key), { ...row });
    },
    getWikiRevisionLink: async (revisionId, nameKey, anchor) => state.revisionLinks.get(linkKey(revisionId, nameKey, anchor)) || null,
    insertWikiRevisionLink: async (row) => {
      maybeFail('insertWikiRevisionLink');
      state.revisionLinks.set(linkKey(row.revision_id, row.target_name_key, row.target_anchor), { ...row });
    },
    getScene: async (id) => state.scenes.get(id) || null,
    insertScene: async (row) => { maybeFail('insertScene'); state.scenes.set(row.id, structuredClone(row)); },
    getSceneTurns: async (sceneId) => [...state.sceneTurns.values()]
      .filter((row) => row.scene_id === sceneId)
      .sort((left, right) => left.ordinal - right.ordinal),
    insertSceneTurn: async (row) => {
      maybeFail('insertSceneTurn');
      state.sceneTurns.set(turnKey(row.scene_id, row.ordinal), structuredClone(row));
    },
    getSceneTurnBackup: async (sceneId) => state.sceneBackups.get(sceneId) || null,
    insertSceneTurnBackup: async (row) => { maybeFail('insertSceneTurnBackup'); state.sceneBackups.set(row.scene_id, structuredClone(row)); },
    getSceneTurnMarker: async (sceneId) => state.sceneMarkers.get(sceneId) || null,
    insertSceneTurnMarker: async (row) => { maybeFail('insertSceneTurnMarker'); state.sceneMarkers.set(row.scene_id, { ...row }); },
  };
  return repository;
}

async function apply(plan, repository = createMemoryRepository()) {
  const result = await repository.transaction(async () => applyPlanWithRepository(plan, repository));
  return { result, repository };
}

test('synthetic capture validates and maps FK closure, placeholders, testers and content preservation', (t) => {
  const { directory } = makeCapture(t);
  const capture = readCapture({ captureDirectory: directory });
  const datasetBytes = fs.readFileSync(path.join(directory, 'dataset.json'));
  assert.equal(
    capture.datasetSha256,
    crypto.createHash('sha256').update(datasetBytes).digest('hex'),
  );
  const plan = buildImportPlan({
    capture,
    testerPasswords: testerPasswords(),
    passwordHasher: (value) => `hash:${value}`,
  });
  assert.equal(plan.capture.complete, true);

  assert.equal(plan.counts.characters, 1);
  assert.equal(plan.counts.scenes, 2);
  assert.equal(plan.counts.sceneTurns, 3);
  assert.equal(plan.counts.wikiPages, 2);
  assert.equal(plan.counts.forumThreads, 1);
  assert.equal(plan.counts.forumPosts, 2);
  assert.equal(plan.counts.citations, 0);

  const placeholder = plan.users.find((user) => user.id === AUTHOR_ID);
  assert.equal(placeholder.role, 'member');
  assert.equal(placeholder.is_staff, false);
  assert.equal(placeholder.password_hash, '');
  assert.equal(placeholder.username, 'autora-sintetica');
  const reconstruction = plan.users.find((user) => user.kind === 'reconstruction-actor');
  assert.equal(reconstruction.username, 'reconstrucao-local');
  assert.equal(reconstruction.password_hash, '');
  const testers = plan.users.filter((user) => user.kind === 'synthetic-tester');
  assert.deepEqual(testers.map((user) => user.role).sort(), ['admin', 'member', 'moderador']);
  assert.ok(testers.every((user) => user.password_hash.startsWith('hash:')));
  assert.ok(plan.normalizations.some((item) => item.kind === 'public_author_role_not_imported'));

  const character = plan.characters[0];
  assert.equal(character.descricao, '<p>Descrição <strong>sintética</strong>.</p>');
  assert.deepEqual(character.stats, { ataque: 42, defesa: 17 });
  assert.equal(character.blocks[0].content, '<p>Conteúdo do bloco</p>');
  assert.equal(character.theme.accentColor, '#aabbcc');
  assert.equal(character.imagem, `${ORIGIN}/img/ficha.png`);

  const legacy = plan.scenes.find((scene) => scene.row.id === LEGACY_SCENE_ID);
  assert.equal(legacy.sourceMode, 'legacy');
  assert.equal(legacy.row.turns.length, 2);
  assert.equal(legacy.turns.length, 2);
  assert.equal(legacy.legacySha256.length, 64);
  assert.deepEqual(legacy.row.infobox.participants, ['Doe, Jane', 'Outra Pessoa']);
  assert.equal(legacy.row.infobox.fields[0].value, 'Valor, com vírgula');
  assert.equal(legacy.row.blocks[0].content, '<p>Bloco da cena</p>');
  assert.equal(legacy.row.theme.accentColor, '#112233');
  assert.equal(legacy.row.descricao, '<p>Cena legada</p>');
  assert.equal(legacy.turns[0].content, '<p>Primeiro turno</p>');
  assert.equal(legacy.turns[0].presentation.images[0].url, `${ORIGIN}/img/anexo.png`);
  assert.equal(legacy.turns[0].legacy_author_label, 'Doe, Jane');
  assert.equal(legacy.turns[0].author_id, null);

  const normalized = plan.scenes.find((scene) => scene.row.id === NORMALIZED_SCENE_ID);
  assert.equal(normalized.sourceMode, 'normalized');
  assert.deepEqual(normalized.row.turns, []);
  assert.equal(normalized.turns.length, 1);
  assert.equal(normalized.turns[0].author_id, AUTHOR_ID);
});

test('missing public author is mapped to a deterministic non-login placeholder', (t) => {
  const { directory } = makeCapture(t, (dataset) => {
    dataset.characters[0].author = null;
    dataset.characters[0].authorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd';
    return dataset;
  });
  const plan = planFor(directory);
  const placeholder = plan.users.find((user) => user.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd');
  assert.ok(placeholder);
  assert.match(placeholder.username, /^autor-publico-bbbbbbbb$/u);
  assert.equal(placeholder.password_hash, '');
  assert.equal(placeholder.role, 'member');
  assert.ok(plan.normalizations.some((item) => item.kind === 'missing_author_fallback'));
  assert.equal(plan.counts.missingAuthorFallbacks, 1);
});

test('wiki aliases, anchors, categories, search text and sections use existing validators', (t) => {
  const { directory } = makeCapture(t);
  const plan = planFor(directory);
  const page = plan.wikiPages.find((item) => item.page.id === WIKI_PAGE_ID);
  assert.deepEqual(page.names.map((name) => [name.name_key, name.kind]), [
    ['artigo-sintetico', 'canonical'],
    ['artigo-antigo', 'alias'],
  ]);
  assert.deepEqual(page.categories.map((category) => [category.category, category.category_key]), [
    ['Categoria Sintética', 'categoria-sintetica'],
  ]);
  assert.deepEqual(page.links.map((link) => [link.target_name_key, link.target_anchor]), [
    ['outro-artigo', SECTION_TWO_ID],
  ]);
  const targetPage = plan.wikiPages.find((item) => item.page.id === OTHER_WIKI_PAGE_ID);
  assert.deepEqual(targetPage.names.map((name) => name.name_key), ['outro-artigo']);
  assert.equal(targetPage.revision.snapshot.body.sections[0].id, SECTION_TWO_ID);
  assert.equal(page.revision.snapshot.body.sections[0].id, SECTION_ONE_ID);
  assert.match(page.revision.snapshot.body.sections[0].html, /\/wiki\/outro-artigo#/u);
  assert.equal(page.revision.snapshot.body.sections[0].blocks[0].content, '<p>Bloco wiki</p>');
  assert.match(page.searchText, /Artigo Sintético/u);
  assert.match(page.searchText, /Resumo do artigo sintético/u);
  assert.match(page.searchText, /Texto com/u);
  assert.match(page.revision.edit_summary, /Reconstrução local/u);
  assert.match(page.revision.edit_summary, /sem citações ou histórico originais/u);
  assert.equal(plan.sections[1].parent_key, 'paranormalidade');
});

test('first import inserts normalized turns exactly once and an exact repeat is a no-op', async (t) => {
  const { directory } = makeCapture(t);
  const plan = planFor(directory);
  const { result, repository } = await apply(plan);
  assert.ok(result.inserted > 0);
  assert.equal(result.noop, false);

  assert.equal(repository.state.characters.size, 1);
  assert.equal(repository.state.categories.size, 1);
  assert.equal(repository.state.threads.size, 1);
  assert.equal(repository.state.posts.size, 2);
  assert.equal(repository.state.sections.size, 2);
  assert.equal(repository.state.wikiPages.size, 2);
  assert.equal(repository.state.wikiRevisions.size, 2);
  assert.equal(repository.state.wikiNames.size, 3);
  assert.equal(repository.state.revisionCategories.size, 2);
  assert.equal(repository.state.revisionLinks.size, 1);
  assert.equal(repository.state.scenes.size, 2);
  assert.equal(repository.state.sceneTurns.size, 3);
  assert.equal(repository.state.sceneBackups.size, 2);
  assert.equal(repository.state.sceneMarkers.size, 2);

  const legacy = repository.state.scenes.get(LEGACY_SCENE_ID);
  assert.equal(legacy.turns.length, 2);
  assert.deepEqual(
    [...repository.state.sceneTurns.values()].filter((turn) => turn.scene_id === LEGACY_SCENE_ID).map((turn) => turn.ordinal),
    [0, 1],
  );
  const normalized = repository.state.scenes.get(NORMALIZED_SCENE_ID);
  assert.deepEqual(normalized.turns, []);
  const page = repository.state.wikiPages.get(WIKI_PAGE_ID);
  assert.equal(page.head_revision_id, WIKI_REVISION_ID);
  assert.equal(page.published_revision_id, WIKI_REVISION_ID);

  const before = structuredClone(repository.state);
  const second = await repository.transaction(async () => applyPlanWithRepository(plan, repository));
  assert.equal(second.noop, true);
  assert.equal(second.inserted, 0);
  assert.deepEqual(repository.state, before);
});

test('conflicting local edits fail without overwriting content', async (t) => {
  const { directory } = makeCapture(t);
  const plan = planFor(directory);
  const { repository } = await apply(plan);
  repository.state.characters.get(CHARACTER_ID).descricao = '<p>Editado localmente</p>';
  const before = structuredClone(repository.state);
  await assert.rejects(() => repository.transaction(async () => applyPlanWithRepository(plan, repository)), /different local content/u);
  assert.deepEqual(repository.state, before);
});

test('a locally edited scene turn is refused instead of duplicated or overwritten', async (t) => {
  const { directory } = makeCapture(t);
  const plan = planFor(directory);
  const { repository } = await apply(plan);
  const turn = [...repository.state.sceneTurns.values()]
    .find((item) => item.scene_id === LEGACY_SCENE_ID && item.ordinal === 0);
  turn.content = '<p>Turno editado localmente</p>';
  const before = structuredClone(repository.state);
  await assert.rejects(
    () => repository.transaction(async () => applyPlanWithRepository(plan, repository)),
    /scene turn|different local content/u,
  );
  assert.deepEqual(repository.state, before);
});

test('a failed import transaction leaves no partial related records', async (t) => {
  const { directory } = makeCapture(t);
  const plan = planFor(directory);
  const repository = createMemoryRepository({ failOn: 'insertWikiRevision' });
  await assert.rejects(() => repository.transaction(async () => applyPlanWithRepository(plan, repository)), /synthetic repository failure/u);
  for (const [name, map] of Object.entries(repository.state)) {
    assert.equal(map.size, 0, `${name} must be empty after rollback`);
  }
});

test('incomplete or inconsistent captures are rejected before any mutation', (t) => {
  {
    const { directory } = makeCapture(t, (dataset) => {
      dataset.characters.push({ ...dataset.characters[0] });
      return dataset;
    });
    assert.throws(() => readCapture({ captureDirectory: directory }), /count|inventory|duplicates/u);
  }
  {
    const { directory } = makeCapture(t, (dataset) => {
      dataset.wikiPages[0].discussionThreadId = '99999999-9999-4999-8999-999999999999';
      return dataset;
    }, (manifest) => manifest);
    const capture = readCapture({ captureDirectory: directory });
    assert.throws(() => buildImportPlan({ capture }), /discussion thread missing/u);
  }
  {
    const { directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
      manifest.requests[0].sha256 = '0'.repeat(64);
      return manifest;
    });
    assert.throws(() => readCapture({ captureDirectory: directory }), /hash or byte length/u);
  }
  {
    const { directory } = makeCapture(t, (dataset) => {
      dataset.wikiCategories = [];
      return dataset;
    });
    const capture = readCapture({ captureDirectory: directory });
    assert.throws(() => buildImportPlan({ capture }), /no wiki category inventory/u);
  }
});

test('unverified or incomplete captures cannot claim complete import evidence', (t) => {
  {
    const { directory } = makeCapture(t, (dataset) => {
      dataset.forum.threads[0].postsCount = 3;
      dataset.forum.postsByThread = {};
      return dataset;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /exactly one entry per captured thread/u,
    );
  }
  {
    const { directory } = makeCapture(t, (dataset) => {
      dataset.forum.threads[0].postsCount = 3;
      return dataset;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /postsCount 3 but 2 visible/u,
    );
  }
  {
    const { directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
      manifest.gaps = [{
        family: 'characters',
        endpoint: '/api/personagens',
        status: 401,
        reason: 'VISIBILITY_BOUNDARY',
      }];
      manifest.consistency.complete = true;
      return manifest;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /completeness claim/u,
    );
  }
  {
    const { directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
      manifest.consistency.unresolvedChanges = [{
        family: 'forumPosts',
        reason: 'Thread posts kept changing during the final recheck.',
        ids: [FORUM_THREAD_ID],
      }];
      manifest.consistency.complete = true;
      return manifest;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /completeness claim/u,
    );
  }
  {
    const { directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
      manifest.requests = [];
      return manifest;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /at least one observed response/u,
    );
  }
  {
    const { directory } = makeCapture(t);
    const datasetPath = path.join(directory, 'dataset.json');
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    dataset.characters[0].descricao = '<p>conteúdo arbitrário sem evidência bruta</p>';
    fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, { mode: 0o600 });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /datasetSha256/u,
    );
  }
  {
    const { directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
      delete manifest.datasetSha256;
      return manifest;
    });
    assert.throws(
      () => readCapture({ captureDirectory: directory }),
      /unsupported or missing fields/u,
    );
  }
});

test('unexpected sensitive account fields are rejected at the capture boundary', (t) => {
  const { directory } = makeCapture(t, (dataset) => {
    dataset.characters[0].author.email = 'leak@example.invalid';
    return dataset;
  });
  assert.throws(() => readCapture({ captureDirectory: directory }), /sensitive account field/u);
});

test('unresolved wiki link targets are reported as local mapping gaps, not silently dropped', (t) => {
  const { directory } = makeCapture(t, (dataset) => {
    dataset.wikiPages[0].body.sections[0].html = '<p><a href="/wiki/nao-capturado">link</a></p>';
    return dataset;
  });
  const plan = planFor(directory);
  assert.equal(plan.capture.complete, false);
  assert.ok(plan.gaps.some((gap) => gap.family === 'wiki-links' && gap.endpoint === 'nao-capturado'));
  assert.equal(plan.wikiPages[0].links[0].target_name_key, 'nao-capturado');
});

test('deleted forum tombstones retain their hidden state without inventing content', (t) => {
  const deletedId = '99999999-9999-4999-8999-999999999994';
  const { directory } = makeCapture(t, (dataset) => {
    dataset.forum.postsByThread[FORUM_THREAD_ID].push({
      id: deletedId,
      threadId: FORUM_THREAD_ID,
      postNo: 3,
      version: 1,
      edited: false,
      deleted: true,
      deletedAt: '2026-11-02T13:00:00.000Z',
      createdAt: '2026-11-02T12:30:00.000Z',
      updatedAt: '2026-11-02T13:00:00.000Z',
      author: author(),
    });
    return dataset;
  });
  const plan = planFor(directory);
  const post = plan.forum.posts.find((item) => item.id === deletedId);
  assert.equal(post.content, '');
  assert.equal(post.deleted_at, '2026-11-02T13:00:00.000Z');
  assert.equal(plan.forum.threads[0].next_post_no, 4);
});

test('tester credential file formatting carries all synthetic accounts without printing them in reports', () => {
  const contents = testerCredentialsContents(testerPasswords());
  assert.match(contents, /^SANDBOX_ADMIN_USERNAME=sandbox-admin$/mu);
  assert.match(contents, /^SANDBOX_MODERADOR_USERNAME=sandbox-moderador$/mu);
  assert.match(contents, /^SANDBOX_MEMBER_USERNAME=sandbox-member$/mu);
  assert.equal(contents.match(/PASSWORD=/gu).length, 3);
});

test('capture reader accepts D1 empty-body requests and an arbitrary private output directory name', (t) => {
  const emptyDigest = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  const { root, directory } = makeCapture(t, (dataset) => dataset, (manifest) => {
    manifest.requests[0].storedAs = null;
    manifest.requests[0].bytes = 0;
    manifest.requests[0].sha256 = emptyDigest;
    return manifest;
  });
  const renamed = path.join(root, 'arbitrary-private-run-directory');
  fs.renameSync(directory, renamed);
  const capture = readCapture({ captureDirectory: renamed });
  assert.equal(capture.manifest.captureId, CAPTURE_ID);
  assert.deepEqual(capture.requestFiles, [null]);
});

test('CLI import --dry-run validates the capture without a database or private state write', async (t) => {
  const { root, directory } = makeCapture(t);
  let sqlCalls = 0;
  const dependencies = {
    root,
    environment: {},
    sqlFactory: () => {
      sqlCalls += 1;
      throw new Error('SQL must not be opened during import --dry-run');
    },
  };
  const result = await main(['import', '--capture', directory, '--dry-run'], dependencies);
  assert.equal(result.dryRun, true);
  assert.equal(sqlCalls, 0);
  assert.equal(fs.existsSync(statePaths(root).testers), false);
  assert.equal(fs.existsSync(statePaths(root).directory), false);
});

test('tester lookup uses a uuid array for ids and a text array for usernames', async () => {
  const calls = [];
  function fakeSql(strings, ...args) {
    calls.push(args);
    return Promise.resolve([]);
  }
  fakeSql.array = (values, type) => ({ values, type });
  await inspectExistingTesters(fakeSql, {
    testers: [{ id: AUTHOR_ID, username: 'sandbox-admin' }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].type, 2950);
  assert.equal(calls[0][1].type, 25);
});
