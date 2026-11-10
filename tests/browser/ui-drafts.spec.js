'use strict';

const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const postgres = require('postgres');
const { createApp } = require('../../server/app');

const ROOT = path.resolve(__dirname, '../..');
const REQUIRED_MIGRATION = '0017_timeline_events';
const PASSWORD = 'Synthetic-ui-drafts-browser-password-42';
let sql;
let server;
let origin;
let serverRecord;
let fixture;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  assert.equal(process.env.DATABASE_URL, undefined, 'Use npm run test:browser; do not pass a development connection.');
  assert.equal(process.env.DEV_DATABASE_URL, undefined, 'Use the isolated browser-test runner.');
  const dsn = process.env.ETERVERSO_TEST_DATABASE_URL;
  assert.ok(dsn, 'The guarded runner must supply ETERVERSO_TEST_DATABASE_URL.');
  const targetRecord = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-env.js'), 'assert'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const target = new URL(dsn);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/eterverso_test');
  assert.equal(decodeURIComponent(target.username), 'eterverso_test');
  assert.equal(Number(target.port), targetRecord.port);
  sql = postgres(dsn, { prepare: false, max: 5, connect_timeout: 5, idle_timeout: 2 });
  const current = await sql`SELECT current_database() AS database, current_user AS username`;
  assert.equal(current[0].database, 'eterverso_test');
  assert.equal(current[0].username, 'eterverso_test');
  await assertRequiredSchema();

  server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({
    sql,
    config: {
      sessionSecret: `ui-drafts-browser-${randomUUID()}`, secureCookies: false,
      production: false, publicOrigin: origin, staticRoot: ROOT,
    },
  }));
  const privateDirectory = path.join(ROOT, '.local/test');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  serverRecord = path.join(privateDirectory, `ui-drafts-browser-${process.pid}-${randomUUID()}.json`);
  fs.writeFileSync(serverRecord, JSON.stringify({ pid: process.pid, origin, schema: REQUIRED_MIGRATION }), { mode: 0o600, flag: 'wx' });
});

test.beforeEach(async () => { fixture = await makeFixture(); });
test.afterEach(async () => { if (fixture) await cleanFixture(fixture); fixture = null; });
test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sql) await sql.end({ timeout: 5 });
  if (serverRecord) fs.rmSync(serverRecord, { force: true });
});

test('UI-02 profile, character, and scene drafts restore after reload and stay account-scoped', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    await page.locator('#top-btn-area').getByText('Perfil', { exact: true }).click();
    const profileTitle = `Perfil em rascunho ${fixture.suffix}`;
    const profileBio = `Biografia em rascunho ${fixture.suffix}`;
    const currentPassword = `current-secret-${fixture.suffix}`;
    const newPassword = `new-secret-${fixture.suffix}`;
    await page.locator('#prof-title').fill(profileTitle);
    await page.locator('#prof-avatar').fill(`https://example.test/${fixture.suffix}.png`);
    await page.locator('#prof-bio').fill(profileBio);
    await page.locator('#prof-current-password').fill(currentPassword);
    await page.locator('#prof-password').fill(newPassword);
    const profileKey = resourceDraftKey(fixture.users[0].id, 'profile', 'profile');
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), profileKey)).not.toBeNull();
    const savedProfile = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), profileKey);
    expect(savedProfile.values).toEqual({
      title: profileTitle,
      avatar: `https://example.test/${fixture.suffix}.png`,
      bio: profileBio,
    });
    const storageValues = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, i) => {
      return localStorage.getItem(localStorage.key(i)) || '';
    }).join('\n'));
    expect(storageValues).not.toContain(currentPassword);
    expect(storageValues).not.toContain(newPassword);

    await page.reload();
    await expect(page.locator('#top-user-info')).toContainText(fixture.users[0].username);
    await page.locator('#top-btn-area').getByText('Perfil', { exact: true }).click();
    await expect(page.locator('#prof-title')).toHaveValue(profileTitle);
    await expect(page.locator('#prof-avatar')).toHaveValue(`https://example.test/${fixture.suffix}.png`);
    await expect(page.locator('#prof-bio')).toHaveValue(profileBio);
    await expect(page.locator('#prof-current-password')).toHaveValue('');
    await expect(page.locator('#prof-password')).toHaveValue('');

    await page.goto(`${origin}/personagens`);
    await page.getByRole('link', { name: '+ Novo Personagem', exact: true }).click();
    const characterName = `Personagem em rascunho ${fixture.suffix}`;
    await page.locator('#p-nome').fill(characterName);
    await page.locator('#p-editor').fill(`Descrição em rascunho ${fixture.suffix}`);
    const characterKey = resourceDraftKey(fixture.users[0].id, 'character', 'new');
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), characterKey)).not.toBeNull();
    await page.reload();
    await expect(page.locator('#p-nome')).toHaveValue(characterName);
    await expect(page.locator('#p-editor')).toContainText(`Descrição em rascunho ${fixture.suffix}`);

    await page.goto(`${origin}/cenas`);
    await page.getByRole('link', { name: '+ Nova Cena / Post Customizável', exact: true }).click();
    const sceneTitle = `Cena em rascunho ${fixture.suffix}`;
    await page.locator('#c-titulo').fill(sceneTitle);
    await page.locator('#c-editor').fill(`Abertura em rascunho ${fixture.suffix}`);
    const sceneKey = resourceDraftKey(fixture.users[0].id, 'scene', 'new');
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), sceneKey)).not.toBeNull();
    await page.reload();
    await expect(page.locator('#c-titulo')).toHaveValue(sceneTitle);
    await expect(page.locator('#c-editor')).toContainText(`Abertura em rascunho ${fixture.suffix}`);

    await page.locator('#top-btn-area').getByText('Sair', { exact: true }).click();
    await expect(page.locator('#top-user-info')).toContainText('Visitante');
    await login(page, fixture.users[1]);
    await page.locator('#top-btn-area').getByText('Perfil', { exact: true }).click();
    await expect(page.locator('#prof-title')).toHaveValue('');
    await expect(page.locator('#prof-bio')).toHaveValue('');
    await page.goto(`${origin}/personagens`);
    await page.getByRole('link', { name: '+ Novo Personagem', exact: true }).click();
    await expect(page.locator('#p-nome')).toHaveValue('');
    await page.goto(`${origin}/cenas`);
    await page.getByRole('link', { name: '+ Nova Cena / Post Customizável', exact: true }).click();
    await expect(page.locator('#c-titulo')).toHaveValue('');
  } finally {
    await context.close();
  }
});

test('character JSON import and export preserve blocks, stats, skills, and theme', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    await expect(page.locator('#p-nome')).toHaveValue(fixture.characterName);

    const imported = {
      nome: `Imported character ${fixture.suffix}`,
      categoria: 'Personagem Principal',
      titulo: 'Título importado',
      raca: 'Humana',
      faccao: 'Facção importada',
      status: 'Viva',
      imagem: '',
      descricao: '<p>Descrição importada</p>',
      stats: { alma: 77 },
      skills: [{ nome: 'Skill importada', descricao: 'Efeito importado', tipo: 'skill' }],
      mascaraTier: 'Grã-Mestra',
      theme: { accentColor: '#cc0000', bannerStyle: 'cinematic', layout: 'sidebar-left', fontFamily: 'serif', bgEffect: 'aura', bgm: '' },
      blocks: [
        { type: 'quote', title: '', text: 'Frase importada', author: 'Autora importada', avatar: '' },
        { type: 'datalist', title: 'Dados importados', items: [{ label: 'Nome', value: 'Valor' }] }
      ]
    };

    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-char-json').fill(JSON.stringify(imported));
    await page.getByRole('button', { name: 'Carregar Dados' }).click();
    await expect(page.locator('#import-char-json')).toHaveCount(0);
    await expect(page.locator('#p-nome')).toHaveValue(imported.nome);
    await expect(page.locator('#p-stat-alma')).toHaveValue('77');
    await expect(page.locator('#p-mascara-tier')).toHaveValue('Grã-Mestra');
    await expect(page.locator('#p-accent-color')).toHaveValue('#cc0000');
    await expect(page.locator('#p-skills-list .skill-form-item')).toHaveCount(1);
    await expect(page.locator('#modular-blocks-container .block-builder-card')).toHaveCount(2);
    await expect(page.locator('#modular-blocks-container .bb-dl-label')).toHaveValue('Nome');
    await expect(page.locator('#modular-blocks-container .bb-dl-val')).toHaveValue('Valor');

    await page.getByRole('button', { name: 'Salvar Alterações' }).click();
    await page.waitForURL(`**/personagens/${fixture.characterId}`);
    await expect(page.locator('.mod-quote-box')).toContainText('Frase importada');
    await expect(page.locator('.mod-datalist-item')).toContainText('Nome');
    await expect(page.locator('.skill-grid .skill-item')).toContainText('Skill importada');

    const rows = await sql`SELECT nome, stats, skills, blocks, theme, mascara_tier
      FROM personagens WHERE id = ${fixture.characterId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].nome).toBe(imported.nome);
    expect(rows[0].stats).toEqual({ alma: 77 });
    expect(rows[0].skills).toEqual([{ nome: 'Skill importada', descricao: 'Efeito importado', tipo: 'skill' }]);
    expect(rows[0].blocks).toHaveLength(2);
    expect(rows[0].theme).toEqual(imported.theme);
    expect(rows[0].mascara_tier).toBe('Grã-Mestra');

    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar JSON' }).click()
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.nome).toBe(imported.nome);
    expect(exported.stats).toEqual({ alma: 77 });
    expect(exported.skills).toHaveLength(1);
    expect(exported.blocks).toHaveLength(2);
    expect(exported.theme).toEqual(imported.theme);
  } finally {
    await context.close();
  }
});

test('character JSON legacy and expanded artifacts round-trip, preserve rich sheets, and preview blocks', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    const legacy = {
      schemaVersion: 1,
      nome: 'Ficha Legada Sintética',
      categoria: 'Personagem Principal',
      titulo: 'Guardiã de Teste',
      raca: 'Humana Sintética',
      faccao: 'Facção Legada',
      status: 'Ativa',
      imagem: '',
      descricao: '<p>Marcador legado sintetico LGC-8842.</p>',
      stats: { ataque: 37, defesa: 52, alma: 64, inteligencia: 45 },
      skills: [
        { nome: 'Habilidade Sintética Um', descricao: 'Efeito sintético um.', tipo: 'skill' },
        { nome: 'Habilidade Sintética Dois', descricao: 'Efeito sintético dois.', tipo: 'skill' },
        { nome: 'Equipamento Sintético Três', descricao: 'Efeito sintético três.', tipo: 'equipamento' },
        { nome: 'Habilidade Sintética Quatro', descricao: 'Efeito sintético quatro.', tipo: 'skill' }
      ],
      mascaraTier: 'Camada Sintética',
      theme: {
        accentColor: '#1a2b3c',
        bannerStyle: 'standard',
        layout: 'full',
        fontFamily: 'mono',
        bgEffect: 'grid',
        bgm: ''
      },
      blocks: []
    };
    const expanded = {
      schemaVersion: 1,
      nome: 'Ficha Expandida Sintética',
      categoria: 'Sub-Personagem',
      titulo: 'Exploradora de Teste',
      raca: 'Constructo Sintético',
      faccao: 'Facção Expandida',
      status: 'Em Observação',
      imagem: '',
      descricao: '<p>Marcador expandido sintetico EXP-7319.</p>',
      stats: { destreza: 26, reserva: 48, controle: 59, refino: 31, emissao: 22, habilidade: 40 },
      skills: [],
      mascaraTier: 'Camada Expandida',
      theme: {
        accentColor: '#204060',
        bannerStyle: 'compact',
        layout: 'book',
        fontFamily: 'sans',
        bgEffect: 'dots',
        bgm: 'Synthetic theme cue'
      },
      blocks: [
        { type: 'section', title: 'Seção Sintética Um', content: '<p>Conteúdo sintético da primeira seção.</p>' },
        { type: 'tabs', title: 'Abas Sintéticas', items: [{ label: 'Aba Um', content: '<p>Conteúdo sintético da aba.</p>' }] },
        { type: 'gallery', title: 'Galeria Sintética', cols: '2', items: [{ url: 'https://example.test/synthetic-gallery.png', caption: 'Legenda sintética' }] },
        {
          type: 'cards', title: 'Cartões Sintéticos', items: [{
            title: 'Cartão Um', badge: 'Sintético', color: '#abcdef',
            image: 'https://example.test/synthetic-card.png', desc: 'Descrição sintética do cartão.'
          }]
        },
        { type: 'quote', title: 'Citação Sintética', text: 'Texto de citação sintética EXP-QUOTE-7319.', author: 'Autoria Sintética', avatar: '' },
        { type: 'stats', title: 'Estatísticas Sintéticas', items: [{ label: 'Indicador Sintético', value: 42, color: '#123456' }] },
        { type: 'accordion', title: 'Acordeão Sintético', items: [{ title: 'Item Sintético', content: '<p>Conteúdo sintético do acordeão.</p>' }] },
        { type: 'timeline', title: 'Cronologia Sintética', items: [{ date: 'Marco Sintético', title: 'Evento Sintético', desc: 'Descrição sintética do evento.' }] },
        {
          type: 'datalist', title: 'Dados Sintéticos', items: [
            { label: 'Chave Um', value: 'Valor Um' },
            { label: 'Chave Dois', value: 'Valor Dois' },
            { label: 'Chave Três', value: 'Valor Três' },
            { label: 'Chave Quatro', value: 'Valor Quatro' },
            { label: 'Chave Cinco', value: 'Valor Cinco' },
            { label: 'Chave Seis', value: 'Valor Seis' },
            { label: 'Chave Sete', value: 'Valor Sete' },
            { label: 'Chave Oito', value: 'Valor Oito' }
          ]
        },
        { type: 'section', title: 'Seção Sintética Dois', content: '<p>Conteúdo sintético da segunda seção.</p>' },
        { type: 'accordion', title: 'Acordeão Sintético Dois', items: [{ title: 'Item Sintético Dois', content: '<p>Conteúdo sintético do segundo acordeão.</p>' }] }
      ]
    };

    async function openImport(payload) {
      await page.getByRole('button', { name: 'Importar JSON' }).click();
      await page.locator('#import-char-json').fill(JSON.stringify(payload));
      await page.getByRole('button', { name: 'Carregar Dados' }).click();
      await expect(page.locator('#import-char-json')).toHaveCount(0);
    }

    async function saveCharacter() {
      const responsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/personagens/${fixture.characterId}`);
      await page.getByRole('button', { name: 'Salvar Alterações' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      await expect(page.locator('#p-nome')).toHaveCount(0);
    }

    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    await openImport(legacy);
    await expect(page.locator('#p-nome')).toHaveValue(legacy.nome);
    await expect(page.locator('#p-skills-list .skill-form-item')).toHaveCount(4);
    await expect(page.locator('#modular-blocks-container .block-builder-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).first().click();
    await expect(page.locator('#modal-container .char-sheet-body')).toContainText('LGC-8842');
    await page.locator('#modal-container .modal-header button').click();
    await saveCharacter();

    const legacyRow = (await sql`SELECT nome, descricao, stats, skills, blocks, theme, mascara_tier
      FROM personagens WHERE id = ${fixture.characterId}`)[0];
    expect(legacyRow.nome).toBe(legacy.nome);
    expect(legacyRow.descricao).toBe(legacy.descricao);
    expect(legacyRow.stats).toEqual(legacy.stats);
    expect(legacyRow.skills).toEqual(legacy.skills);
    expect(legacyRow.blocks).toEqual([]);
    expect(legacyRow.theme).toEqual(legacy.theme);
    expect(legacyRow.mascara_tier).toBe(legacy.mascaraTier);

    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    await openImport(expanded);
    await expect(page.locator('#modular-blocks-container .block-builder-card')).toHaveCount(11);
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).first().click();
    await expect(page.locator('#modal-container .mod-quote-box')).toContainText('EXP-QUOTE-7319');
    await expect(page.locator('#modal-container .mod-datalist-item')).toHaveCount(8);
    await page.locator('#modal-container .modal-header button').click();
    await saveCharacter();

    await expect(page.locator('.mod-quote-box')).toContainText('EXP-QUOTE-7319');
    const expandedRow = (await sql`SELECT nome, descricao, stats, skills, blocks, theme, mascara_tier
      FROM personagens WHERE id = ${fixture.characterId}`)[0];
    expect(expandedRow.blocks).toHaveLength(11);
    expect(expandedRow.skills).toEqual([]);
    expect(expandedRow.stats).toEqual(expanded.stats);
    expect(expandedRow.theme).toEqual(expanded.theme);
    expect(expandedRow.descricao).toBe(expanded.descricao);

    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    await saveCharacter();
    const noOpRow = (await sql`SELECT descricao, blocks, theme FROM personagens WHERE id = ${fixture.characterId}`)[0];
    expect(noOpRow.descricao).toBe(expandedRow.descricao);
    expect(noOpRow.blocks).toEqual(expandedRow.blocks);
    expect(noOpRow.theme).toEqual(expandedRow.theme);

    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar JSON' }).click()
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.schemaVersion).toBe(1);
    expect(exported.blocks).toHaveLength(11);
    expect(exported.stats).toEqual(expanded.stats);
    expect(exported.skills).toEqual([]);
    expect(exported.theme).toEqual(expanded.theme);
    expect(exported.descricao).toContain('EXP-7319');
  } finally {
    await context.close();
  }
});

test('character JSON import preserves supported builder items with empty display labels', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    const payload = {
      schemaVersion: 1,
      nome: `Builder fidelity ${fixture.suffix}`,
      descricao: '<p>Builder fidelity</p>',
      blocks: [
        { type: 'cards', title: 'Cards', items: [{ title: '', badge: 'Relic', color: '#ffffff', image: 'https://example.test/relic.png', desc: '' }] },
        { type: 'stats', title: 'Stats', items: [{ label: '', value: 25, color: '#ffffff' }] },
        { type: 'tabs', title: 'Tabs', items: [{ label: '', content: '<p>Unlabelled tab</p>' }] }
      ]
    };
    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-char-json').fill(JSON.stringify(payload));
    await page.getByRole('button', { name: 'Carregar Dados' }).click();
    await expect(page.locator('#import-char-json')).toHaveCount(0);
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/personagens/${fixture.characterId}`);
    await page.getByRole('button', { name: 'Salvar Alterações' }).click();
    expect((await responsePromise).status()).toBe(200);
    const row = (await sql`SELECT blocks FROM personagens WHERE id = ${fixture.characterId}`)[0];
    expect(row.blocks).toHaveLength(3);
    expect(row.blocks[0].items[0]).toEqual({ title: '', badge: 'Relic', color: '#ffffff', image: 'https://example.test/relic.png', desc: '' });
    expect(row.blocks[1].items[0]).toEqual({ label: '', value: 25, color: '#ffffff' });
    expect(row.blocks[2].items[0]).toEqual({ label: '', content: '<p>Unlabelled tab</p>' });
  } finally {
    await context.close();
  }
});

test('character JSON rejects unsupported or unsafe payloads without changing the form', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha' }).click();
    const before = {
      nome: await page.inputValue('#p-nome'),
      tier: await page.inputValue('#p-mascara-tier'),
      stats: await page.inputValue('#p-stat-alma'),
      skills: await page.locator('#p-skills-list .skill-form-item').count(),
      blocks: await page.locator('#modular-blocks-container .block-builder-card').count(),
      editor: await page.locator('#p-editor').innerText()
    };

    const invalidPayloads = [
      { schemaVersion: 2, nome: 'Unsupported' },
      { nome: 'Unknown field', campoInexistente: true },
      { nome: 'Bad stat', stats: { alma: 101 } },
      { nome: 'Bad image', imagem: 'https://example.test/a%20b.png' },
      { nome: 'Zero width', descricao: '<p>\u200b</p>' },
      { nome: 'Bad skill', skills: [{ nome: 'a', descricao: 'b', tipo: 'skill', lost: true }] },
      { nome: 'Bad block', blocks: [{ type: 'not-a-block' }] }
    ];
    for (const payload of invalidPayloads) {
      await page.getByRole('button', { name: 'Importar JSON' }).click();
      await page.locator('#import-char-json').fill(JSON.stringify(payload));
      await page.getByRole('button', { name: 'Carregar Dados' }).click();
      await expect(page.locator('#toast-container .toast-error').last()).toBeVisible();
      await expect(page.locator('#import-char-json')).toHaveCount(1);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      expect(await page.inputValue('#p-nome')).toBe(before.nome);
      expect(await page.inputValue('#p-mascara-tier')).toBe(before.tier);
      expect(await page.inputValue('#p-stat-alma')).toBe(before.stats);
      await expect(page.locator('#p-skills-list .skill-form-item')).toHaveCount(before.skills);
      await expect(page.locator('#modular-blocks-container .block-builder-card')).toHaveCount(before.blocks);
      await expect(page.locator('#p-editor')).toContainText(before.editor.slice(0, 40));
    }
    const row = (await sql`SELECT nome, descricao, stats, skills, blocks FROM personagens WHERE id = ${fixture.characterId}`)[0];
    expect(row.nome).toBe(fixture.characterName);
    expect(row.descricao).toBe(fixture.characterDescription);
    expect(row.stats).toEqual({});
    expect(row.skills).toEqual([]);
    expect(row.blocks).toEqual([]);
  } finally {
    await context.close();
  }
});

test('scene JSON import and export preserve theme, infobox hidden fields, participants, and blocks', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    const sceneId = fixture.sceneIds[0];
    const payload = {
      schemaVersion: 1,
      titulo: `Scene roundtrip ${fixture.suffix}`,
      subtitulo: 'Subtitle',
      categoria: 'Evento / Arco',
      status: 'Hiato',
      resumo: 'Summary',
      banner: '',
      descricao: '<p>Opening scene</p>',
      theme: { accentColor: '#cc0000', bannerStyle: 'standard', layout: 'full', fontFamily: 'serif', bgEffect: 'dots', bgm: 'Theme' },
      infobox: {
        show: true, title: 'Info', image: '', caption: 'Caption', location: 'Hidden location', timeline: 'Hidden timeline',
        participants: ['Doe, Jane'], fields: [{ label: 'Local', value: 'Rio' }]
      },
      blocks: [{ type: 'section', title: 'Extra', content: '<p>Section body</p>' }]
    };
    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await expect(page.locator('#c-titulo')).toHaveValue(fixture.sceneTitle);
    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-cena-json').fill(JSON.stringify(payload));
    await page.getByRole('button', { name: 'Carregar Página' }).click();
    await expect(page.locator('#import-cena-json')).toHaveCount(0);
    await page.evaluate(() => toggleParticipanteInput('Alice'));
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await responsePromise).status()).toBe(200);
    const row = (await sql`SELECT titulo, categoria, status, theme, infobox, blocks FROM wiki_posts WHERE id = ${sceneId}`)[0];
    expect(row.titulo).toBe(payload.titulo);
    expect(row.categoria).toBe(payload.categoria);
    expect(row.status).toBe(payload.status);
    expect(row.theme).toEqual(payload.theme);
    expect(row.infobox.participants).toEqual(['Doe, Jane', 'Alice']);
    expect(row.infobox).toEqual(Object.assign({}, payload.infobox, { participants: ['Doe, Jane', 'Alice'] }));
    expect(row.blocks).toHaveLength(1);
    await page.getByRole('link', { name: 'Customizar Página', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar JSON' }).click()
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.schemaVersion).toBe(1);
    expect(exported.categoria).toBe(payload.categoria);
    expect(exported.status).toBe(payload.status);
    expect(exported.theme).toEqual(payload.theme);
    expect(exported.infobox).toEqual(Object.assign({}, payload.infobox, { participants: ['Doe, Jane', 'Alice'] }));
    expect(exported.blocks).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('scene participant editing preserves comma-bearing identities through add, remove, draft, save and export', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    const sceneId = fixture.sceneIds[0];
    const rows = page.locator('#c-ib-participants-list .infobox-participant-row');
    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-cena-json').fill(JSON.stringify(sceneParticipantPayload(fixture, ['Doe, Jane'])));
    await page.getByRole('button', { name: 'Carregar Página' }).click();
    await expect(page.locator('#import-cena-json')).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.ib-participant-name')).toHaveValue('Doe, Jane');

    // Add and remove through the ordinary controls.
    await page.getByRole('button', { name: '+ Adicionar Participante', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator('.ib-participant-name').fill('Bob');
    await expect(rows.nth(1).locator('.ib-participant-name')).toHaveValue('Bob');
    await rows.nth(1).getByRole('button', { name: 'Remover', exact: true }).click();
    await expect(rows).toHaveCount(1);

    // The existing quick-add shortcut toggles one row, not a comma-split identity.
    await page.evaluate(() => toggleParticipanteInput('Alice'));
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator('.ib-participant-name')).toHaveValue('Alice');
    await page.evaluate(() => toggleParticipanteInput('Alice'));
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.ib-participant-name')).toHaveValue('Doe, Jane');

    // A comma-bearing participant and an unsaved draft survive a reload.
    await page.getByRole('button', { name: '+ Adicionar Participante', exact: true }).click();
    await rows.nth(1).locator('.ib-participant-name').fill('Bob, Jr.');
    const sceneKey = resourceDraftKey(fixture.users[0].id, 'scene', sceneId);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), sceneKey)).not.toBeNull();
    const storedDraft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), sceneKey);
    expect(storedDraft.values.infobox.participants).toEqual(['Doe, Jane', 'Bob, Jr.']);
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.ib-participant-name')).toHaveValue('Doe, Jane');
    await expect(rows.nth(1).locator('.ib-participant-name')).toHaveValue('Bob, Jr.');

    const saveResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await saveResponse).status()).toBe(200);
    const fresh = await (await context.request.get(`${origin}/api/wiki-posts/${sceneId}`)).json();
    expect(fresh.wikiPost.infobox.participants).toEqual(['Doe, Jane', 'Bob, Jr.']);

    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.ib-participant-name')).toHaveValue('Doe, Jane');
    await expect(rows.nth(1).locator('.ib-participant-name')).toHaveValue('Bob, Jr.');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar JSON' }).click()
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.infobox.participants).toEqual(['Doe, Jane', 'Bob, Jr.']);

    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-cena-json').fill(JSON.stringify(exported));
    await page.getByRole('button', { name: 'Carregar Página' }).click();
    await expect(page.locator('#import-cena-json')).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.ib-participant-name')).toHaveValue('Doe, Jane');
    await expect(rows.nth(1).locator('.ib-participant-name')).toHaveValue('Bob, Jr.');
    const reimportResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await reimportResponse).status()).toBe(200);
    const afterReimport = await (await context.request.get(`${origin}/api/wiki-posts/${sceneId}`)).json();
    expect(afterReimport.wikiPost.infobox.participants).toEqual(['Doe, Jane', 'Bob, Jr.']);
  } finally {
    await context.close();
  }
});

test('scene participant editing preserves duplicates and hostile text, allows an empty list and defers limits to the server', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    const sceneId = fixture.sceneIds[0];
    const rows = page.locator('#c-ib-participants-list .infobox-participant-row');
    const hostile = '"><img src=x onerror=alert(1)>';
    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await page.getByRole('button', { name: 'Importar JSON' }).click();
    await page.locator('#import-cena-json').fill(JSON.stringify(
      sceneParticipantPayload(fixture, ['Doe, Jane', 'Doe, Jane', hostile])));
    await page.getByRole('button', { name: 'Carregar Página' }).click();
    await expect(page.locator('#import-cena-json')).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    const savedDuplicates = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await savedDuplicates).status()).toBe(200);
    const firstRead = await (await context.request.get(`${origin}/api/wiki-posts/${sceneId}`)).json();
    expect(firstRead.wikiPost.infobox.participants).toEqual(['Doe, Jane', 'Doe, Jane', hostile]);
    await expect(page.locator('.custom-wiki-page .tag').filter({ hasText: hostile })).toHaveCount(1);
    expect(await page.locator('.custom-wiki-page img[src="x"], .custom-wiki-page [onerror]').count()).toBe(0);

    // Empty participant lists are valid and stay empty.
    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await expect(rows).toHaveCount(3);
    while (await rows.count()) await rows.nth(0).getByRole('button', { name: 'Remover', exact: true }).click();
    const emptySaveResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await emptySaveResponse).status()).toBe(200);
    const emptyRead = await (await context.request.get(`${origin}/api/wiki-posts/${sceneId}`)).json();
    expect(emptyRead.wikiPost.infobox.participants).toEqual([]);

    // The client does not invent a smaller or larger limit than the server.
    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await expect(page.locator('#c-ib-participants-list')).toBeAttached();
    await page.evaluate(() => {
      for (let index = 1; index <= 30; index += 1) addParticipanteRow(`Limit ${index}`);
    });
    await expect(rows).toHaveCount(30);
    const thirtySaveResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await thirtySaveResponse).status()).toBe(200);
    const thirtyRead = await (await context.request.get(`${origin}/api/wiki-posts/${sceneId}`)).json();
    expect(thirtyRead.wikiPost.infobox.participants).toHaveLength(30);

    await page.goto(`${origin}/cenas/${sceneId}/editar`);
    await expect(page.locator('#c-ib-participants-list')).toBeAttached();
    await page.evaluate(() => addParticipanteRow('Overflow participant'));
    await expect(rows).toHaveCount(31);
    await clearToasts(page);
    const overflowResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/wiki-posts/${sceneId}`);
    await page.getByRole('button', { name: 'Salvar Alterações da Página' }).click();
    expect((await overflowResponse).status()).toBe(400);
    await expect(page.locator('#toast-container .toast-error').last()).toBeVisible();
    const unchanged = await sql`SELECT infobox FROM wiki_posts WHERE id = ${sceneId}`;
    expect(unchanged[0].infobox.participants).toHaveLength(30);
    expect(unchanged[0].infobox.participants).not.toContain('Overflow participant');
  } finally {
    await context.close();
  }
});

function sceneParticipantPayload(f, participants) {
  return {
    schemaVersion: 1,
    titulo: `Participant scene ${f.suffix}`,
    subtitulo: 'Participant identity test',
    categoria: 'Cena de RPG',
    status: 'Em Andamento',
    resumo: 'Synthetic participant fixture',
    banner: '',
    descricao: '<p>Synthetic participant opening.</p>',
    theme: { accentColor: '#ffffff', bannerStyle: 'none', layout: 'sidebar-left', fontFamily: 'serif', bgEffect: 'none', bgm: '' },
    infobox: { show: true, title: 'Participantes', image: '', caption: '', participants, fields: [] },
    blocks: []
  };
}

test('navigation controls expose real URLs, open in new tabs, and survive direct reloads', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);
    await page.goto(`${origin}/personagens`);
    await expect(page.locator('#nav-bar a[href="/wiki"]')).toHaveCount(1);
    const charLink = page.locator(`a.char-card[href="/personagens/${fixture.characterId}"]`);
    await expect(charLink).toHaveCount(1);
    await expect(charLink).toHaveAttribute('href', `/personagens/${fixture.characterId}`);

    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      charLink.click({ button: 'middle' })
    ]);
    await newTab.waitForLoadState('domcontentloaded');
    expect(new URL(newTab.url()).pathname).toBe(`/personagens/${fixture.characterId}`);
    await newTab.close();

    await charLink.click();
    await expect(page).toHaveURL(`${origin}/personagens/${fixture.characterId}`);

    await page.goto(`${origin}/perfil`);
    await expect(page.locator('#prof-title')).toBeVisible();
    await page.goto(`${origin}/personagens/novo`);
    await expect(page.locator('#p-nome')).toHaveValue('');
    await page.goto(`${origin}/personagens/${fixture.characterId}/editar`);
    await expect(page.locator('#p-nome')).toHaveValue(fixture.characterName);
    await page.goto(`${origin}/cenas/nova`);
    await expect(page.locator('#c-titulo')).toBeVisible();
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}/editar`);
    await expect(page.locator('#c-titulo')).toHaveValue(fixture.sceneTitle);
    await page.goto(`${origin}/forum/categorias/${fixture.categoryId}/novo`);
    await expect(page.locator('#thread-title')).toBeVisible();
    await page.goto(`${origin}/forum/topicos/${fixture.threadId}/editar`);
    await expect(page.locator('#thread-title')).toHaveValue(fixture.threadTitle);

    const guest = await browser.newContext();
    try {
      const guestPage = await guest.newPage();
      await guestPage.goto(`${origin}/sobre`);
      await expect(guestPage.locator('.cat-header').first()).toContainText('Sobre o Projeto');
      await guestPage.goto(`${origin}/registro`);
      await expect(guestPage.locator('#reg-username')).toBeVisible();
    } finally {
      await guest.close();
    }
  } finally {
    await context.close();
  }
});

test('UI-02 turn drafts are per scene and hostile character drafts are sanitized on recovery', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await context.addInitScript(() => { window.__uiDraftRuns = []; });
    await login(page, fixture.users[0]);

    const turnTitleA = `Turno da cena A ${fixture.suffix}`;
    const turnTitleB = `Turno da cena B ${fixture.suffix}`;
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.locator('#turn-title').fill(turnTitleA);
    await page.locator('#turn-editor').fill(`Narrativa A ${fixture.suffix}`);
    const turnKeyA = resourceDraftKey(fixture.users[0].id, 'turn', fixture.sceneIds[0]);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), turnKeyA)).not.toBeNull();
    await page.reload();
    await expect(page.locator('#turn-title')).toHaveValue(turnTitleA);
    await expect(page.locator('#turn-editor')).toContainText(`Narrativa A ${fixture.suffix}`);

    await page.goto(`${origin}/cenas/${fixture.sceneIds[1]}`);
    await page.locator('#turn-title').fill(turnTitleB);
    await page.locator('#turn-editor').fill(`Narrativa B ${fixture.suffix}`);
    const turnKeyB = resourceDraftKey(fixture.users[0].id, 'turn', fixture.sceneIds[1]);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), turnKeyB)).not.toBeNull();
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await expect(page.locator('#turn-title')).toHaveValue(turnTitleA);
    await page.goto(`${origin}/cenas/${fixture.sceneIds[1]}`);
    await expect(page.locator('#turn-title')).toHaveValue(turnTitleB);

    const hostile = `<p>safe-draft-${fixture.suffix}</p><img src="https://example.test/trigger.png" onerror="window.__uiDraftRuns.push('image')"><script>window.__uiDraftRuns.push('script')</script>`;
    const characterKey = resourceDraftKey(fixture.users[0].id, 'character', 'new');
    const draft = {
      version: 1,
      accountId: fixture.users[0].id,
      kind: 'character',
      resourceId: 'new',
      updatedAt: new Date().toISOString(),
      values: {
        nome: `Recovered character ${fixture.suffix}`,
        categoria: 'Personagem Principal',
        titulo: '', raca: '', faccao: '', status: '', imagem: '',
        descricao: hostile,
        stats: {}, skills: [], mascaraTier: '',
        theme: { accentColor: '#ffffff' }, blocks: [],
      },
    };
    await page.evaluate(({ key, record }) => localStorage.setItem(key, JSON.stringify(record)), { key: characterKey, record: draft });
    const previewResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/content/preview');
    await page.goto(`${origin}/personagens`);
    await page.getByRole('link', { name: '+ Novo Personagem', exact: true }).click();
    const previewResponse = await previewResponsePromise;
    expect(previewResponse.status()).toBe(200);
    const safePreview = await previewResponse.json();
    expect(safePreview.html).toContain(`safe-draft-${fixture.suffix}`);
    expect(safePreview.html).not.toMatch(/<script|onerror|onload/i);
    await expect(page.locator('#p-nome')).toHaveValue(`Recovered character ${fixture.suffix}`);
    await expect(page.locator('#p-editor')).toContainText(`safe-draft-${fixture.suffix}`);
    await expect(page.locator('#p-editor script, #p-editor [onerror], #p-editor [onload]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__uiDraftRuns)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('UI-02 rapid double clicks send at most one create POST for each resource form', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    const characterPost = await countDelayedPost(page, '**/api/personagens');
    await page.goto(`${origin}/personagens`);
    await page.getByRole('link', { name: '+ Novo Personagem', exact: true }).click();
    await page.locator('#p-nome').fill(`Single character ${fixture.suffix}`);
    await page.locator('#p-editor').fill(`Character content ${fixture.suffix}`);
    const characterResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/personagens');
    await page.getByRole('button', { name: 'Cadastrar Personagem', exact: true }).dblclick({ delay: 20 });
    expect((await characterResponsePromise).status()).toBe(201);
    await page.waitForTimeout(350);
    expect(characterPost.count).toBe(1);
    await page.unroute('**/api/personagens', characterPost.handler);

    const scenePost = await countDelayedPost(page, '**/api/wiki-posts');
    await page.goto(`${origin}/cenas`);
    await page.getByRole('link', { name: '+ Nova Cena / Post Customizável', exact: true }).click();
    await page.locator('#c-titulo').fill(`Single scene ${fixture.suffix}`);
    await page.locator('#c-editor').fill(`Scene opening ${fixture.suffix}`);
    const sceneResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/wiki-posts');
    await page.getByRole('button', { name: 'Publicar Cena / Post na Wikia', exact: true }).dblclick({ delay: 20 });
    expect((await sceneResponsePromise).status()).toBe(201);
    await page.waitForTimeout(350);
    expect(scenePost.count).toBe(1);
    await page.unroute('**/api/wiki-posts', scenePost.handler);

    const turnPost = await countDelayedPost(page, '**/api/wiki-posts/*/turns');
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.locator('#turn-title').fill(`Single turn ${fixture.suffix}`);
    await page.locator('#turn-editor').fill(`Turn narrative ${fixture.suffix}`);
    const turnPath = `/api/wiki-posts/${fixture.sceneIds[0]}/turns`;
    const turnResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === turnPath);
    await page.getByRole('button', { name: 'Publicar Turno na Cena', exact: true }).dblclick({ delay: 20 });
    expect((await turnResponsePromise).status()).toBe(201);
    await page.waitForTimeout(350);
    expect(turnPost.count).toBe(1);
    await page.unroute('**/api/wiki-posts/*/turns', turnPost.handler);
  } finally {
    await context.close();
  }
});

test('UI-02 failed profile, create, turn, and post-edit requests report errors and restore drafts', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    const profileTitle = `Profile rejected ${fixture.suffix}`;
    const profileBio = `Profile bio rejected ${fixture.suffix}`;
    await page.locator('#top-btn-area').getByText('Perfil', { exact: true }).click();
    await page.locator('#prof-title').fill(profileTitle);
    await page.locator('#prof-bio').fill(profileBio);
    const profileKey = resourceDraftKey(fixture.users[0].id, 'profile', 'profile');
    const profileFailure = await interceptFailure(page, '/api/auth/profile', 'PUT', { status: 401 });
    await clearToasts(page);
    const profileResponsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/auth/profile');
    await page.locator('#main').getByRole('button', { name: 'Salvar Alterações do Perfil', exact: true }).click();
    expect((await profileResponsePromise).status()).toBe(401);
    await expectFailureAndNoSuccess(page);
    expect(profileFailure.count).toBe(1);
    await page.unroute('**/api/auth/profile', profileFailure.handler);
    await expectStoredDraft(page, profileKey, fixture.users[0].id, 'profile');
    await page.reload();
    await expect(page.locator('#top-user-info')).toContainText(fixture.users[0].username);
    await page.locator('#top-btn-area').getByText('Perfil', { exact: true }).click();
    await expect(page.locator('#prof-title')).toHaveValue(profileTitle);
    await expect(page.locator('#prof-bio')).toHaveValue(profileBio);
    const unchangedProfile = await sql`SELECT title, bio FROM users WHERE id = ${fixture.users[0].id}`;
    expect(unchangedProfile).toEqual([{ title: '', bio: '' }]);

    const characterName = `Character rejected ${fixture.suffix}`;
    await page.goto(`${origin}/personagens`);
    await page.getByRole('link', { name: '+ Novo Personagem', exact: true }).click();
    await page.locator('#p-nome').fill(characterName);
    await page.locator('#p-editor').fill(`Character draft ${fixture.suffix}`);
    const characterKey = resourceDraftKey(fixture.users[0].id, 'character', 'new');
    const characterFailure = await interceptFailure(page, '/api/personagens', 'POST', { status: 403 });
    await clearToasts(page);
    const characterResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/personagens');
    await page.getByRole('button', { name: 'Cadastrar Personagem', exact: true }).click();
    expect((await characterResponsePromise).status()).toBe(403);
    await expectFailureAndNoSuccess(page);
    expect(characterFailure.count).toBe(1);
    await page.unroute('**/api/personagens', characterFailure.handler);
    await expectStoredDraft(page, characterKey, fixture.users[0].id, 'character');
    await page.reload();
    await expect(page.locator('#p-nome')).toHaveValue(characterName);
    await expect(page.locator('#p-editor')).toContainText(`Character draft ${fixture.suffix}`);
    const createdCharacters = await sql`SELECT id FROM personagens WHERE author_id = ${fixture.users[0].id} AND nome = ${characterName}`;
    expect(createdCharacters).toEqual([]);

    const sceneTitle = `Scene rejected ${fixture.suffix}`;
    await page.goto(`${origin}/cenas`);
    await page.getByRole('link', { name: '+ Nova Cena / Post Customizável', exact: true }).click();
    await page.locator('#c-titulo').fill(sceneTitle);
    await page.locator('#c-editor').fill(`Scene draft ${fixture.suffix}`);
    const sceneKey = resourceDraftKey(fixture.users[0].id, 'scene', 'new');
    const sceneFailure = await interceptFailure(page, '/api/wiki-posts', 'POST', { status: 409 });
    await clearToasts(page);
    const sceneResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/wiki-posts');
    await page.getByRole('button', { name: 'Publicar Cena / Post na Wikia', exact: true }).click();
    expect((await sceneResponsePromise).status()).toBe(409);
    await expectFailureAndNoSuccess(page);
    expect(sceneFailure.count).toBe(1);
    await page.unroute('**/api/wiki-posts', sceneFailure.handler);
    await expectStoredDraft(page, sceneKey, fixture.users[0].id, 'scene');
    await page.reload();
    await expect(page.locator('#c-titulo')).toHaveValue(sceneTitle);
    await expect(page.locator('#c-editor')).toContainText(`Scene draft ${fixture.suffix}`);
    const createdScenes = await sql`SELECT id FROM wiki_posts WHERE author_id = ${fixture.users[0].id} AND titulo = ${sceneTitle}`;
    expect(createdScenes).toEqual([]);

    const turnTitle = `Turn rejected ${fixture.suffix}`;
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.locator('#turn-title').fill(turnTitle);
    await page.locator('#turn-editor').fill(`Turn draft ${fixture.suffix}`);
    const turnKey = resourceDraftKey(fixture.users[0].id, 'turn', fixture.sceneIds[0]);
    const turnPath = `/api/wiki-posts/${fixture.sceneIds[0]}/turns`;
    const turnFailure = await interceptFailure(page, turnPath, 'POST', { status: 500 });
    await clearToasts(page);
    const turnResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === turnPath);
    await page.getByRole('button', { name: 'Publicar Turno na Cena', exact: true }).click();
    expect((await turnResponsePromise).status()).toBe(500);
    await expectFailureAndNoSuccess(page);
    expect(turnFailure.count).toBe(1);
    await page.unroute(`**${turnPath}`, turnFailure.handler);
    await expectStoredDraft(page, turnKey, fixture.users[0].id, 'turn');
    await page.reload();
    await expect(page.locator('#turn-title')).toHaveValue(turnTitle);
    await expect(page.locator('#turn-editor')).toContainText(`Turn draft ${fixture.suffix}`);
    const createdTurns = await sql`SELECT id FROM scene_turns WHERE scene_id = ${fixture.sceneIds[0]}
      AND author_id = ${fixture.users[0].id} AND presentation->>'turnTitle' = ${turnTitle} AND deleted_at IS NULL`;
    expect(createdTurns).toEqual([]);

    await page.goto(`${origin}/forum/topicos/${fixture.threadId}`);
    await page.locator('#main .post-actions').getByText('Editar', { exact: true }).click();
    const editedContent = `Edited draft rejected ${fixture.suffix}`;
    const editedSummary = `Synthetic edit ${fixture.suffix}`;
    await page.locator('#edit-post-editor').fill(editedContent);
    await page.locator('#edit-post-summary').fill(editedSummary);
    const postKey = resourceDraftKey(fixture.users[0].id, 'forum-post-edit', fixture.postId);
    const postPath = `/api/forum/posts/${fixture.postId}`;
    const postFailure = await interceptFailure(page, postPath, 'PATCH', { offline: true });
    await clearToasts(page);
    const failedRequest = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === postPath);
    await page.locator('#modal-container').getByRole('button', { name: 'Salvar', exact: true }).click();
    await failedRequest;
    await expectFailureAndNoSuccess(page);
    expect(postFailure.count).toBe(1);
    await page.unroute(`**${postPath}`, postFailure.handler);
    await expectStoredDraft(page, postKey, fixture.users[0].id, 'forum-post-edit');
    await page.reload();
    await expect(page.locator('.post-content')).toContainText(fixture.forumOpening);
    const previewResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/content/preview');
    await page.locator('#main .post-actions').getByText('Editar', { exact: true }).click();
    expect((await previewResponsePromise).status()).toBe(200);
    await expect(page.locator('#edit-post-editor')).toContainText(editedContent);
    await expect(page.locator('#edit-post-summary')).toHaveValue(editedSummary);
    const unchangedPost = await sql`SELECT content, version FROM posts WHERE id = ${fixture.postId}`;
    expect(unchangedPost).toEqual([{ content: `<p>${fixture.forumOpening}</p>`, version: 1 }]);
  } finally {
    await context.close();
  }
});

test('UI-02 failed character, scene, and turn edits keep drafts without changing canonical rows', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    const characterName = `Edited character draft ${fixture.suffix}`;
    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha', exact: true }).click();
    await page.locator('#p-nome').fill(characterName);
    await page.locator('#p-editor').fill(`Edited character description ${fixture.suffix}`);
    const characterKey = resourceDraftKey(fixture.users[0].id, 'character', fixture.characterId);
    const characterPath = `/api/personagens/${fixture.characterId}`;
    const characterFailure = await interceptFailure(page, characterPath, 'PUT', { status: 401 });
    await clearToasts(page);
    const characterResponsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === characterPath);
    await page.getByRole('button', { name: 'Salvar Alterações', exact: true }).click();
    expect((await characterResponsePromise).status()).toBe(401);
    await expectFailureAndNoSuccess(page);
    expect(characterFailure.count).toBe(1);
    await page.unroute(`**${characterPath}`, characterFailure.handler);
    await expectStoredDraft(page, characterKey, fixture.users[0].id, 'character');
    await page.reload();
    await page.goto(`${origin}/personagens/${fixture.characterId}`);
    await page.getByRole('link', { name: 'Editar Ficha', exact: true }).click();
    await expect(page.locator('#p-nome')).toHaveValue(characterName);
    await expect(page.locator('#p-editor')).toContainText(`Edited character description ${fixture.suffix}`);
    const unchangedCharacter = await sql`SELECT nome, descricao, version FROM personagens WHERE id = ${fixture.characterId}`;
    expect(unchangedCharacter).toEqual([{ nome: fixture.characterName, descricao: fixture.characterDescription, version: 1 }]);

    const sceneTitle = `Edited scene draft ${fixture.suffix}`;
    const scenePath = `/api/wiki-posts/${fixture.sceneIds[0]}`;
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.getByRole('link', { name: 'Customizar Página', exact: true }).click();
    await page.locator('#c-titulo').fill(sceneTitle);
    await page.locator('#c-editor').fill(`Edited scene opening ${fixture.suffix}`);
    const sceneKey = resourceDraftKey(fixture.users[0].id, 'scene', fixture.sceneIds[0]);
    const sceneFailure = await interceptFailure(page, scenePath, 'PUT', { status: 403 });
    await clearToasts(page);
    const sceneResponsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === scenePath);
    await page.getByRole('button', { name: 'Salvar Alterações da Página', exact: true }).click();
    expect((await sceneResponsePromise).status()).toBe(403);
    await expectFailureAndNoSuccess(page);
    expect(sceneFailure.count).toBe(1);
    await page.unroute(`**${scenePath}`, sceneFailure.handler);
    await expectStoredDraft(page, sceneKey, fixture.users[0].id, 'scene');
    await page.reload();
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.getByRole('link', { name: 'Customizar Página', exact: true }).click();
    await expect(page.locator('#c-titulo')).toHaveValue(sceneTitle);
    await expect(page.locator('#c-editor')).toContainText(`Edited scene opening ${fixture.suffix}`);
    const unchangedScene = await sql`SELECT titulo, descricao, version FROM wiki_posts WHERE id = ${fixture.sceneIds[0]}`;
    expect(unchangedScene).toEqual([{ titulo: fixture.sceneTitle, descricao: fixture.sceneDescription, version: 1 }]);

    const turnTitle = `Edited turn draft ${fixture.suffix}`;
    // The scene API exposes the legacy identifier as the edit route ID when present.
    const turnPath = `/api/wiki-posts/${fixture.sceneIds[0]}/turns/${fixture.turnLegacyId}`;
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.locator('.turn-footer-bar .post-actions').getByText('Editar', { exact: true }).click();
    await page.locator('#edit-turn-title').fill(turnTitle);
    await page.locator('#edit-turn-editor').fill(`Edited turn content ${fixture.suffix}`);
    const turnKey = resourceDraftKey(fixture.users[0].id, 'turn-edit', `${fixture.sceneIds[0]}:${fixture.turnLegacyId}`);
    const turnFailure = await interceptFailure(page, turnPath, 'PUT', { status: 409 });
    await clearToasts(page);
    const turnResponsePromise = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === turnPath);
    await page.locator('#modal-container').getByRole('button', { name: 'Salvar Turno', exact: true }).click();
    expect((await turnResponsePromise).status()).toBe(409);
    await expectFailureAndNoSuccess(page);
    expect(turnFailure.count).toBe(1);
    await page.unroute(`**${turnPath}`, turnFailure.handler);
    await expectStoredDraft(page, turnKey, fixture.users[0].id, 'turn-edit');
    await page.reload();
    await page.goto(`${origin}/cenas/${fixture.sceneIds[0]}`);
    await page.locator('.turn-footer-bar .post-actions').getByText('Editar', { exact: true }).click();
    await expect(page.locator('#edit-turn-title')).toHaveValue(turnTitle);
    await expect(page.locator('#edit-turn-editor')).toContainText(`Edited turn content ${fixture.suffix}`);
    const unchangedTurn = await sql`SELECT content, presentation, version FROM scene_turns WHERE id = ${fixture.turnId}`;
    expect(unchangedTurn).toEqual([{
      content: fixture.turnContent,
      presentation: fixture.turnPresentation,
      version: 1,
    }]);
  } finally {
    await context.close();
  }
});

test('UI-02 failed forum topic, topic edit, and reply submissions restore account-scoped drafts', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    const topicTitle = `Rejected topic ${fixture.suffix}`;
    const topicContent = `Topic body draft ${fixture.suffix}`;
    await page.goto(`${origin}/forum/categorias/${fixture.categoryId}`);
    await page.getByRole('link', { name: '+ Novo Tópico', exact: true }).click();
    await page.locator('#thread-title').fill(topicTitle);
    await page.locator('#thread-tag').selectOption('rp');
    await page.locator('#thread-editor').fill(topicContent);
    const topicKey = forumDraftKey(fixture.users[0].id, 'topic', 'new');
    const topicPath = '/api/forum/threads';
    const topicFailure = await interceptFailure(page, topicPath, 'POST', { status: 500 });
    await clearToasts(page);
    const topicResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === topicPath);
    await page.getByRole('button', { name: 'Publicar Tópico', exact: true }).click();
    expect((await topicResponsePromise).status()).toBe(500);
    await expectFailureAndNoSuccess(page);
    expect(topicFailure.count).toBe(1);
    await page.unroute(`**${topicPath}`, topicFailure.handler);
    await expectStoredForumDraft(page, topicKey, fixture.users[0].id, 'topic', 'new');
    await page.reload();
    await page.goto(`${origin}/forum/categorias/${fixture.categoryId}`);
    await page.getByRole('link', { name: '+ Novo Tópico', exact: true }).click();
    await expect(page.locator('#thread-title')).toHaveValue(topicTitle);
    await expect(page.locator('#thread-tag')).toHaveValue('rp');
    await expect(page.locator('#thread-editor')).toContainText(topicContent);
    const rejectedTopics = await sql`SELECT id FROM threads WHERE category_id = ${fixture.categoryId} AND title = ${topicTitle}`;
    expect(rejectedTopics).toEqual([]);

    const editedTopicTitle = `Edited topic draft ${fixture.suffix}`;
    await page.goto(`${origin}/forum/topicos/${fixture.threadId}`);
    await page.locator('#main').getByRole('link', { name: 'Editar', exact: true }).click();
    await page.locator('#thread-title').fill(editedTopicTitle);
    await page.locator('#thread-tag').selectOption('wiki');
    const topicEditKey = forumDraftKey(fixture.users[0].id, 'topic-edit', fixture.threadId);
    const topicEditPath = `/api/forum/threads/${fixture.threadId}`;
    const topicEditFailure = await interceptFailure(page, topicEditPath, 'PATCH', { offline: true });
    await clearToasts(page);
    const failedTopicEdit = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === topicEditPath);
    await page.getByRole('button', { name: 'Salvar Alterações', exact: true }).click();
    await failedTopicEdit;
    await expectFailureAndNoSuccess(page);
    expect(topicEditFailure.count).toBe(1);
    await page.unroute(`**${topicEditPath}`, topicEditFailure.handler);
    await expectStoredForumDraft(page, topicEditKey, fixture.users[0].id, 'topic-edit', fixture.threadId);
    await page.reload();
    await page.goto(`${origin}/forum/topicos/${fixture.threadId}`);
    await page.locator('#main').getByRole('link', { name: 'Editar', exact: true }).click();
    await expect(page.locator('#thread-title')).toHaveValue(editedTopicTitle);
    await expect(page.locator('#thread-tag')).toHaveValue('wiki');
    const unchangedTopic = await sql`SELECT title, tag, version FROM threads WHERE id = ${fixture.threadId}`;
    expect(unchangedTopic).toEqual([{ title: `UI drafts topic ${fixture.suffix}`, tag: 'draft', version: 1 }]);

    const replyContent = `Rejected reply ${fixture.suffix}`;
    const replyPath = `/api/forum/threads/${fixture.threadId}/posts`;
    const replyKey = forumDraftKey(fixture.users[0].id, 'reply', fixture.threadId);
    await page.goto(`${origin}/forum/topicos/${fixture.threadId}`);
    await page.locator('#reply-editor').fill(replyContent);
    const replyFailure = await interceptFailure(page, replyPath, 'POST', { status: 401 });
    await clearToasts(page);
    const replyResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === replyPath);
    await page.getByRole('button', { name: 'Enviar Resposta', exact: true }).click();
    expect((await replyResponsePromise).status()).toBe(401);
    await expectFailureAndNoSuccess(page);
    expect(replyFailure.count).toBe(1);
    await page.unroute(`**${replyPath}`, replyFailure.handler);
    await expectStoredForumDraft(page, replyKey, fixture.users[0].id, 'reply', fixture.threadId);
    await page.reload();
    await expect(page.locator('#reply-editor')).toContainText(replyContent);
    const replyCount = await sql`SELECT count(*)::int AS count FROM posts WHERE thread_id = ${fixture.threadId}`;
    expect(replyCount).toEqual([{ count: 1 }]);
  } finally {
    await context.close();
  }
});

test('UI-02 failed wiki create, revision, publish, and member proposal flows preserve canonical state', async ({ browser }) => {
  const context = await isolatedContext(browser);
  try {
    const page = await context.newPage();
    await login(page, fixture.users[0]);

    const newPageTitle = `Rejected wiki page ${fixture.suffix}`;
    const newPageSlug = `rejected-wiki-page-${fixture.suffix}`;
    const newPageBody = `Wiki page draft ${fixture.suffix}`;
    await page.goto(`${origin}/wiki/novo`);
    await page.locator('#wiki-editor-title').fill(newPageTitle);
    await page.locator('#wiki-editor-slug').fill(newPageSlug);
    await page.locator('#wiki-editor-summary').fill(`Summary ${fixture.suffix}`);
    await page.locator('#wiki-section-heading-0').fill(`Overview ${fixture.suffix}`);
    await page.locator('#wiki-section-0').fill(newPageBody);
    const newPageKey = wikiDraftKey(fixture.users[0].id, 'editor', 'new');
    const newPagePath = '/api/staff/wiki/pages';
    const newPageFailure = await interceptFailure(page, newPagePath, 'POST', { status: 403 });
    await clearToasts(page);
    const newPageResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === newPagePath);
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    expect((await newPageResponsePromise).status()).toBe(403);
    await expectFailureAndNoSuccess(page);
    expect(newPageFailure.count).toBe(1);
    await page.unroute(`**${newPagePath}`, newPageFailure.handler);
    await expectStoredWikiDraft(page, newPageKey, fixture.users[0].id, 'editor');
    await page.reload();
    await expect(page.locator('#wiki-editor-title')).toHaveValue(newPageTitle);
    await expect(page.locator('#wiki-editor-slug')).toHaveValue(newPageSlug);
    await expect(page.locator('#wiki-section-heading-0')).toHaveValue(`Overview ${fixture.suffix}`);
    await expect(page.locator('#wiki-section-0')).toContainText(newPageBody);
    const rejectedPage = await sql`SELECT p.id FROM wiki_pages p JOIN wiki_revisions r ON r.page_id = p.id
      WHERE p.created_by = ${fixture.users[0].id} AND r.snapshot->>'slug' = ${newPageSlug}`;
    expect(rejectedPage).toEqual([]);

    const revisedTitle = `Revised wiki title ${fixture.suffix}`;
    const revisedSummary = `Revision failure draft ${fixture.suffix}`;
    const revisedBody = `Revision body draft ${fixture.suffix}`;
    const revisionPath = `/api/staff/wiki/pages/${fixture.wikiPageId}/revisions`;
    await page.goto(`${origin}/wiki/editor/${fixture.wikiPageId}`);
    await expect(page.locator('#wiki-editor-title')).toHaveValue(fixture.wikiTitle);
    await page.locator('#wiki-editor-title').fill(revisedTitle);
    await page.locator('#wiki-editor-edit-summary').fill(revisedSummary);
    await page.locator('#wiki-section-heading-0').fill(`Revised overview ${fixture.suffix}`);
    await page.locator('#wiki-section-0').fill(revisedBody);
    const revisionKey = wikiDraftKey(fixture.users[0].id, 'editor', fixture.wikiPageId);
    const revisionFailure = await interceptFailure(page, revisionPath, 'POST', { status: 409 });
    await clearToasts(page);
    const revisionResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === revisionPath);
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    expect((await revisionResponsePromise).status()).toBe(409);
    await expectFailureAndNoSuccess(page);
    expect(revisionFailure.count).toBe(1);
    await page.unroute(`**${revisionPath}`, revisionFailure.handler);
    await expectStoredWikiDraft(page, revisionKey, fixture.users[0].id, 'editor');
    await page.reload();
    await expect(page.locator('#wiki-editor-title')).toHaveValue(revisedTitle);
    await expect(page.locator('#wiki-editor-edit-summary')).toHaveValue(revisedSummary);
    await expect(page.locator('#wiki-section-heading-0')).toHaveValue(`Revised overview ${fixture.suffix}`);
    await expect(page.locator('#wiki-section-0')).toContainText(revisedBody);
    const unchangedPageAfterRevision = await wikiPageCanonicalState(fixture.wikiPageId);
    expect(unchangedPageAfterRevision).toEqual({
      workVersion: 1, publicVersion: 1, headRevisionId: fixture.wikiRevisionId,
      publishedRevisionId: fixture.wikiRevisionId, revisionCount: 1,
    });

    // Publishing is an action on the shared head revision; the UI blocks it while an editor draft exists.
    await page.getByRole('button', { name: 'Descartar rascunho local', exact: true }).click();
    const publishPath = `/api/staff/wiki/pages/${fixture.wikiPageId}/publish`;
    const publishFailure = await interceptFailure(page, publishPath, 'POST', { status: 500 });
    await clearToasts(page);
    const publishResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === publishPath);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Publicar para todos', exact: true }).click();
    expect((await publishResponsePromise).status()).toBe(500);
    await expectFailureAndNoSuccess(page);
    expect(publishFailure.count).toBe(1);
    await page.unroute(`**${publishPath}`, publishFailure.handler);
    await page.reload();
    await expect(page.locator('#wiki-editor-title')).toHaveValue(fixture.wikiTitle);
    const unchangedPageAfterPublish = await wikiPageCanonicalState(fixture.wikiPageId);
    expect(unchangedPageAfterPublish).toEqual(unchangedPageAfterRevision);

    const logoutResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/logout');
    await page.locator('#top-btn-area').getByText('Sair', { exact: true }).click();
    expect((await logoutResponsePromise).status()).toBe(200);
    await expect(page.locator('#top-user-info')).toContainText('Visitante');
    await login(page, fixture.users[2]);
    await page.goto(`${origin}/wiki/${fixture.wikiSlug}`);
    await expect(page.locator('#wiki-proposal-summary')).toBeVisible();
    const proposalSummary = `Proposal summary ${fixture.suffix}`;
    const proposalHeading = `Proposal heading ${fixture.suffix}`;
    const proposalBody = `Proposal body draft ${fixture.suffix}`;
    await page.locator('#wiki-proposal-summary').fill(proposalSummary);
    await page.locator('#wiki-proposal-heading').fill(proposalHeading);
    await page.locator('#wiki-proposal-body').fill(proposalBody);
    const proposalKey = wikiDraftKey(fixture.users[2].id, 'proposal', fixture.wikiPageId);
    const proposalPath = `/api/wiki/pages/${fixture.wikiPageId}/proposals`;
    const proposalFailure = await interceptFailure(page, proposalPath, 'POST', { offline: true });
    await clearToasts(page);
    const failedProposal = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === proposalPath);
    await page.getByRole('button', { name: 'Enviar proposta para revisão', exact: true }).click();
    await failedProposal;
    await expectFailureAndNoSuccess(page);
    expect(proposalFailure.count).toBe(1);
    await page.unroute(`**${proposalPath}`, proposalFailure.handler);
    await expectStoredWikiDraft(page, proposalKey, fixture.users[2].id, 'proposal');
    await page.reload();
    await expect(page.locator('#wiki-proposal-summary')).toHaveValue(proposalSummary);
    await expect(page.locator('#wiki-proposal-heading')).toHaveValue(proposalHeading);
    await expect(page.locator('#wiki-proposal-body')).toContainText(proposalBody);
    const rejectedProposals = await sql`SELECT id FROM wiki_proposals WHERE page_id = ${fixture.wikiPageId}
      AND proposer_id = ${fixture.users[2].id}`;
    expect(rejectedProposals).toEqual([]);
    expect(await wikiPageCanonicalState(fixture.wikiPageId)).toEqual(unchangedPageAfterRevision);
  } finally {
    await context.close();
  }
});

async function assertRequiredSchema() {
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries;
  const required = journal.findIndex((entry) => entry.tag === REQUIRED_MIGRATION);
  assert.ok(required >= 0, 'The reviewed portable wiki transfer migration must be registered.');
  const ledger = await sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, required + 1, 'Run only against the reviewed isolated test schema; do not migrate inside tests.');
  for (let index = 0; index <= required; index += 1) {
    const entry = journal[index];
    const hash = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'drizzle', `${entry.tag}.sql`))).digest('hex');
    assert.equal(Number(ledger[index].id), entry.idx + 1);
    assert.equal(ledger[index].hash, hash, 'Isolated migration history differs from reviewed SQL.');
  }
  const tables = await sql`SELECT to_regclass('public.users') IS NOT NULL AS users,
    to_regclass('public.personagens') IS NOT NULL AS personagens,
    to_regclass('public.wiki_posts') IS NOT NULL AS wiki_posts,
    to_regclass('public.scene_turns') IS NOT NULL AS scene_turns,
    to_regclass('public.request_keys') IS NOT NULL AS request_keys`;
  assert.equal(tables[0].users && tables[0].personagens && tables[0].wiki_posts
    && tables[0].scene_turns && tables[0].request_keys, true);
}

async function makeFixture() {
  const suffix = randomUUID().slice(0, 8);
  const f = {
    suffix,
    users: [],
    sceneIds: [randomUUID(), randomUUID()],
    characterId: randomUUID(),
    characterName: `UI drafts character ${suffix}`,
    characterDescription: `<p>Original character ${suffix}</p>`,
    turnId: randomUUID(),
    turnLegacyId: `turn-${suffix}`,
    turnContent: `<p>Original turn ${suffix}</p>`,
    turnPresentation: {
      characterName: `Fixture character ${suffix}`,
      characterTitle: 'Fixture title',
      characterAvatar: '',
      turnTitle: `Fixture turn ${suffix}`,
      location: 'Fixture location',
      accentColor: '#ffffff',
      banner: '',
      bannerStyle: 'panoramic',
      images: [],
      oocNotes: '',
    },
    wikiPageId: randomUUID(),
    wikiRevisionId: randomUUID(),
    wikiTitle: `UI drafts wiki ${suffix}`,
    wikiSlug: `ui-drafts-wiki-${suffix}`,
    wikiContent: `Original wiki content ${suffix}`,
    failedCreateWikiSlug: `rejected-wiki-page-${suffix}`,
    sceneTitle: `UI drafts scene 1 ${suffix}`,
    sceneDescription: '<p>Synthetic browser fixture.</p>',
    categoryId: null,
    threadId: null,
    threadTitle: `UI drafts topic ${suffix}`,
    postId: randomUUID(),
    forumOpening: `Synthetic forum opening ${suffix}`,
  };
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  try {
    await sql.begin(async (tx) => {
      for (const label of ['a', 'b', 'member']) {
        const username = `ui-drafts-${label}-${suffix}`;
        const role = label === 'member' ? 'member' : 'moderador';
        const rows = await tx`INSERT INTO users (username, email, password_hash, role)
          VALUES (${username}, ${`${username}@example.test`}, ${passwordHash}, ${role}) RETURNING id`;
        f.users.push({ id: rows[0].id, username });
      }
      const characterRows = await tx`INSERT INTO personagens
        (id, author_id, nome, categoria, descricao, blocks, theme)
        VALUES (${f.characterId}, ${f.users[0].id}, ${f.characterName}, 'Personagem Principal',
          ${f.characterDescription}, ${tx.json([])}, ${tx.json({})}) RETURNING id`;
      f.characterId = characterRows[0].id;
      for (const [index, sceneId] of f.sceneIds.entries()) {
        const owner = f.users[index].id;
        const rawTurns = index === 0 ? [{ id: f.turnLegacyId, content: f.turnContent }] : [];
        const legacyDigest = createHash('sha256').update(JSON.stringify(rawTurns)).digest('hex');
        await tx`INSERT INTO wiki_posts
          (id, author_id, titulo, categoria, status, descricao, theme, infobox, blocks, turns)
          VALUES (${sceneId}, ${owner}, ${`UI drafts scene ${index + 1} ${suffix}`}, 'Cena de RPG', 'Em Andamento',
            ${index === 0 ? f.sceneDescription : '<p>Synthetic browser fixture.</p>'}, ${tx.json({ bannerStyle: 'none', layout: 'full', fontFamily: 'serif' })},
            ${tx.json({ show: false })}, ${tx.json([])}, ${tx.json([])})`;
        await tx`INSERT INTO scene_turn_legacy_backups (scene_id, turns, legacy_sha256)
          VALUES (${sceneId}, ${tx.json(rawTurns)}, ${legacyDigest})`;
        await tx`INSERT INTO scene_turn_migrations (scene_id, turn_count, legacy_sha256)
          VALUES (${sceneId}, ${rawTurns.length}, ${legacyDigest})`;
        if (index === 0) {
          await tx`INSERT INTO scene_turns (id, scene_id, author_id, legacy_id, ordinal, content, presentation)
            VALUES (${f.turnId}, ${sceneId}, ${f.users[0].id}, ${f.turnLegacyId}, 0, ${f.turnContent}, ${tx.json(f.turnPresentation)})`;
        }
      }
      const wikiSnapshot = {
        schemaVersion: 1,
        title: f.wikiTitle,
        slug: f.wikiSlug,
        aliases: [],
        type: 'concept',
        summary: `Synthetic wiki summary ${suffix}`,
        categories: [],
        accessLevel: 'public',
        audience: 'reader',
        body: { format: 'richtext-v1', infobox: [], sections: [{
          id: randomUUID(), heading: `Overview ${suffix}`, html: `<p>${f.wikiContent}</p>`,
          blocks: [], authority: [], knowledgeLayer: 'unspecified',
        }] },
      };
      await tx`INSERT INTO wiki_pages (id, created_by, access_level, work_version, public_version, published_at)
        VALUES (${f.wikiPageId}, ${f.users[0].id}, 'public', 1, 1, now())`;
      await tx`INSERT INTO wiki_revisions (id, page_id, sequence, actor_id, edit_summary, snapshot)
        VALUES (${f.wikiRevisionId}, ${f.wikiPageId}, 1, ${f.users[0].id}, 'Synthetic initial publication', ${tx.json(wikiSnapshot)})`;
      await tx`UPDATE wiki_pages SET head_revision_id = ${f.wikiRevisionId}, published_revision_id = ${f.wikiRevisionId}
        WHERE id = ${f.wikiPageId}`;
      await tx`INSERT INTO wiki_names (name_key, page_id, kind) VALUES (${f.wikiSlug}, ${f.wikiPageId}, 'canonical')`;
      const categoryRows = await tx`INSERT INTO categories (name, description)
        VALUES (${`UI drafts forum ${suffix}`}, 'Synthetic fixture for UI draft error recovery') RETURNING id`;
      f.categoryId = categoryRows[0].id;
      const threadRows = await tx`INSERT INTO threads (category_id, author_id, title, tag)
        VALUES (${f.categoryId}, ${f.users[0].id}, ${f.threadTitle}, 'draft') RETURNING id`;
      f.threadId = threadRows[0].id;
      await tx`INSERT INTO posts (id, thread_id, author_id, content, post_no)
        VALUES (${f.postId}, ${f.threadId}, ${f.users[0].id}, ${`<p>${f.forumOpening}</p>`}, 1)`;
    });
    return f;
  } catch (error) {
    await cleanFixture(f);
    throw error;
  }
}

async function cleanFixture(f) {
  if (!sql || !f) return;
  await sql.begin(async (tx) => {
    const fixtureThreads = f.categoryId
      ? await tx`SELECT id FROM threads WHERE category_id = ${f.categoryId}` : [];
    for (const thread of fixtureThreads) {
      await tx`DELETE FROM post_revisions WHERE post_id IN (SELECT id FROM posts WHERE thread_id = ${thread.id})`;
      await tx`DELETE FROM forum_migration_issues WHERE thread_id = ${thread.id}`;
      await tx`DELETE FROM posts WHERE thread_id = ${thread.id}`;
      await tx`DELETE FROM threads WHERE id = ${thread.id}`;
    }
    if (f.categoryId) await tx`DELETE FROM categories WHERE id = ${f.categoryId}`;
    if (f.wikiPageId) await tx`ALTER TABLE wiki_revisions DISABLE TRIGGER wiki_revisions_immutable`;
    const fixtureWikiOwnerId = f.users[0] ? f.users[0].id : null;
    const fixturePages = f.wikiPageId
      ? await tx`SELECT DISTINCT p.id FROM wiki_pages p LEFT JOIN wiki_revisions r ON r.page_id = p.id
          WHERE p.id = ${f.wikiPageId} OR (p.created_by = ${fixtureWikiOwnerId} AND r.snapshot->>'slug' = ${f.failedCreateWikiSlug})`
      : [];
    for (const page of fixturePages) {
      await tx`UPDATE wiki_revisions SET accepted_proposal_id = NULL WHERE page_id = ${page.id}`;
      const proposals = await tx`SELECT id FROM wiki_proposals WHERE page_id = ${page.id}`;
      for (const proposal of proposals) {
        await tx`DELETE FROM audit_events WHERE target_id = ${proposal.id}`;
        await tx`DELETE FROM wiki_proposals WHERE id = ${proposal.id}`;
      }
      await tx`DELETE FROM audit_events WHERE target_id = ${page.id}`;
      await tx`DELETE FROM wiki_revision_categories WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${page.id})`;
      await tx`DELETE FROM wiki_revision_links WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${page.id})`;
      await tx`DELETE FROM wiki_revision_citations WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE page_id = ${page.id})`;
      await tx`UPDATE wiki_pages SET head_revision_id = NULL, published_revision_id = NULL WHERE id = ${page.id}`;
      const revisions = await tx`SELECT id FROM wiki_revisions WHERE page_id = ${page.id} ORDER BY sequence DESC`;
      for (const revision of revisions) await tx`DELETE FROM wiki_revisions WHERE id = ${revision.id}`;
      await tx`DELETE FROM wiki_names WHERE page_id = ${page.id}`;
      await tx`DELETE FROM wiki_pages WHERE id = ${page.id}`;
    }
    if (f.wikiPageId) await tx`ALTER TABLE wiki_revisions ENABLE TRIGGER wiki_revisions_immutable`;
    for (const user of f.users) {
      const authoredScenes = await tx`SELECT id FROM wiki_posts WHERE author_id = ${user.id}`;
      const sceneIds = [...new Set([...f.sceneIds, ...authoredScenes.map((row) => row.id)])];
      for (const sceneId of sceneIds) {
        await tx`DELETE FROM scene_turn_migration_issues WHERE scene_id = ${sceneId}`;
        await tx`DELETE FROM scene_turns WHERE scene_id = ${sceneId}`;
        await tx`DELETE FROM scene_turn_migrations WHERE scene_id = ${sceneId}`;
        await tx`DELETE FROM scene_turn_legacy_backups WHERE scene_id = ${sceneId}`;
      }
      await tx`DELETE FROM wiki_posts WHERE author_id = ${user.id}`;
      await tx`DELETE FROM personagens WHERE author_id = ${user.id}`;
      await tx`DELETE FROM request_keys WHERE actor_id = ${user.id}`;
      await tx`DELETE FROM audit_events WHERE actor_id = ${user.id}`;
    }
    for (const user of f.users) await tx`DELETE FROM users WHERE id = ${user.id}`;
  });
}

function resourceDraftKey(accountId, kind, resourceId) {
  return `aetherverse:form-draft:v1:${encodeURIComponent(accountId)}:${kind}:${encodeURIComponent(String(resourceId))}`;
}

function forumDraftKey(accountId, kind, resourceId) {
  return `aetherverse:forum-draft:v1:${encodeURIComponent(accountId)}:${kind}:${encodeURIComponent(String(resourceId))}`;
}

function wikiDraftKey(accountId, kind, resourceId) {
  return `aetherverse:wiki-draft:v1:${accountId}:${kind}:${encodeURIComponent(String(resourceId))}`;
}

async function expectStoredForumDraft(page, key, accountId, kind, resourceId) {
  await expect.poll(() => page.evaluate((draftKey) => localStorage.getItem(draftKey), key)).not.toBeNull();
  const record = await page.evaluate((draftKey) => JSON.parse(localStorage.getItem(draftKey)), key);
  expect(record.version).toBe(1);
  expect(record.accountId).toBe(accountId);
  expect(record.kind).toBe(kind);
  expect(record.resourceId).toBe(String(resourceId));
}

async function expectStoredWikiDraft(page, key, accountId, kind) {
  await expect.poll(() => page.evaluate((draftKey) => localStorage.getItem(draftKey), key)).not.toBeNull();
  const record = await page.evaluate((draftKey) => JSON.parse(localStorage.getItem(draftKey)), key);
  expect(record.version).toBe(1);
  expect(record.accountId).toBe(accountId);
  expect(record.snapshot).toBeTruthy();
  expect(record.snapshot.body.sections.length).toBeGreaterThan(0);
  if (kind === 'editor') expect(record.snapshot.title).toBeTruthy();
  if (kind === 'proposal') expect(record.summary).toBeTruthy();
}

async function wikiPageCanonicalState(pageId) {
  const rows = await sql`SELECT work_version AS "workVersion", public_version AS "publicVersion",
    head_revision_id AS "headRevisionId", published_revision_id AS "publishedRevisionId",
    (SELECT count(*)::int FROM wiki_revisions WHERE page_id = ${pageId}) AS "revisionCount"
    FROM wiki_pages WHERE id = ${pageId}`;
  return rows[0];
}

async function countDelayedPost(page, pattern) {
  const state = { count: 0, handler: null };
  state.handler = async (route) => {
    if (route.request().method() === 'POST') {
      state.count += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  };
  await page.route(pattern, state.handler);
  return state;
}

async function interceptFailure(page, pathname, method, outcome) {
  const state = { count: 0, handler: null };
  state.handler = async (route) => {
    if (route.request().method() !== method) return route.continue();
    state.count += 1;
    if (outcome.offline) return route.abort('failed');
    return route.fulfill({
      status: outcome.status,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic save failure.' }),
    });
  };
  await page.route(`**${pathname}`, state.handler);
  return state;
}

async function expectFailureAndNoSuccess(page) {
  await expect(page.locator('#toast-container .toast-error').last()).toBeVisible();
  await expect(page.locator('#toast-container .toast-success')).toHaveCount(0);
}

async function clearToasts(page) {
  await page.evaluate(() => {
    const container = document.getElementById('toast-container');
    if (container) container.replaceChildren();
  });
}

async function expectStoredDraft(page, key, accountId, kind) {
  await expect.poll(() => page.evaluate((draftKey) => localStorage.getItem(draftKey), key)).not.toBeNull();
  const record = await page.evaluate((draftKey) => JSON.parse(localStorage.getItem(draftKey)), key);
  expect(record.accountId).toBe(accountId);
  expect(record.kind).toBe(kind);
}

async function login(page, user) {
  await page.goto(`${origin}/forum`);
  await expect(page.locator('#top-user-info')).toContainText('Visitante');
  await page.locator('#top-btn-area').getByText('Entrar', { exact: true }).click();
  await page.locator('#login-username').fill(user.username);
  await page.locator('#login-password').fill(PASSWORD);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/login');
  await page.locator('#modal-container').getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator('#top-user-info')).toContainText(user.username);
}

async function isolatedContext(browser) {
  const context = await browser.newContext();
  await context.route(/^https:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|example\.test)\//, (route) => route.abort());
  return context;
}
