'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'http://eterverso.test';
const IDS = {
  admin: '11111111-1111-4111-8111-111111111111',
  member: '22222222-2222-4222-8222-222222222222',
  exportPage: '33333333-3333-4333-8333-333333333333',
  exportRevision: '44444444-4444-4444-8444-444444444444',
  importPage: '55555555-5555-4555-8555-555555555555',
  conflictPage: '66666666-6666-4666-8666-666666666666',
  blockedPage: '77777777-7777-4777-8777-777777777777',
  reusedPage: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source: '88888888-8888-4888-8888-888888888888',
  conflictSource: '99999999-9999-4999-8999-999999999999',
};
const TEST_BUNDLE = {
  version: 1,
  bundleId: 'synthetic-portable-wiki-bundle',
  pages: [{ id: 'source-page', title: 'Página sintética' }],
};

test('admin wiki transfer controls stay hidden from members and reject client-side calls', async ({ browser }) => {
  const context = await browser.newContext();
  const transferCalls = [];
  await stubApi(context, 'member', { transferCalls });
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/admin`);
    await expect(page.locator('#main')).toContainText('Acesso negado.');
    await expect(page.locator('#nav-admin-btn button')).toHaveCount(0);
    await expect(page.locator('#admin-wiki-transfers')).toHaveCount(0);
    await page.evaluate(() => {
      loadAdminWikiTransferPages(true);
      return exportAdminWikiBundle();
    });
    expect(transferCalls).toEqual([]);
  } finally {
    await context.close();
  }
});

test('admin can export selected current heads as a JSON download', async ({ browser }) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 375, height: 812 } });
  const calls = { export: [], transferCalls: [] };
  await stubApi(context, 'admin', calls);
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/admin`);
    await expect(page.locator('#admin-wiki-transfers')).toBeVisible();
    await expect(page.locator('#wiki-transfer-export-pages')).toBeVisible();
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.clientWidth);
    const pageCheckbox = page.locator(`#wiki-transfer-export-${IDS.exportPage}`);
    await expect(pageCheckbox).toBeVisible();
    await pageCheckbox.check();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar pacote JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^aetherverse-wiki-\d{4}-\d{2}-\d{2}\.json$/);
    expect(calls.export).toHaveLength(1);
    expect(calls.export[0].body).toEqual({ pageIds: [IDS.exportPage] });
    expect(calls.export[0].headers['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const filePath = await download.path();
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(TEST_BUNDLE);
    await expect(page.locator('#admin-wiki-transfers')).toContainText('Pacote JSON baixado');
  } finally {
    await context.close();
  }
});

test('admin can review a bundle, refresh it, and commit while preserving selections after an error', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const calls = { import: [], refresh: [], commit: [], transferCalls: [], commitMode: 'error' };
  await stubApi(context, 'admin', calls);
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/admin`);
    await expect(page.locator('#admin-wiki-transfers')).toBeVisible();
    await page.locator('#wiki-transfer-file').setInputFiles({
      name: 'portable-wiki.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(TEST_BUNDLE)),
    });
    await expect(page.locator('#admin-wiki-transfers')).toContainText('Arquivo selecionado: portable-wiki.json');
    await page.getByRole('button', { name: 'Enviar e analisar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prévia da importação', exact: true })).toBeVisible();
    expect(calls.import).toHaveLength(1);
    expect(calls.import[0].body).toEqual({ bundle: TEST_BUNDLE });
    expect(calls.import[0].headers['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(page.locator('#wiki-transfer-preview')).toContainText('synthetic-bundle-id');
    await expect(page.locator('#wiki-transfer-preview')).toContainText('hash-do-plano-v3');
    await expect(page.locator('#wiki-transfer-preview')).toContainText('source-pack/referencias.json');
    await expect(page.locator('#wiki-transfer-preview')).toContainText('sha256-da-fonte-sintetica');
    await expect(page.locator('.wiki-transfer-count-grid')).toContainText('Será criada: 2');
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.clientWidth);
    const importPage = page.locator(`#wiki-transfer-import-${IDS.importPage}`);
    const conflictPage = page.locator(`#wiki-transfer-import-${IDS.conflictPage}`);
    const blockedPage = page.locator(`#wiki-transfer-import-${IDS.blockedPage}`);
    const reusedPage = page.locator(`#wiki-transfer-import-${IDS.reusedPage}`);
    await expect(importPage).toBeChecked();
    await expect(reusedPage).toBeChecked();
    await expect(reusedPage).toBeEnabled();
    await reusedPage.uncheck();
    await expect(conflictPage).toBeDisabled();
    await expect(blockedPage).toBeDisabled();
    await expect(page.locator('#wiki-transfer-preview')).toContainText('Conflito');

    await page.getByRole('button', { name: 'Atualizar prévia', exact: true }).click();
    await expect(page.locator('#wiki-transfer-preview')).toContainText('hash-do-plano-v4');
    await expect(importPage).toBeChecked();
    expect(calls.refresh).toHaveLength(1);
    expect(calls.refresh[0].method).toBe('POST');
    expect(calls.refresh[0].pathname).toBe('/api/admin/wiki-transfers/imports/synthetic-import-id/refresh');
    expect(calls.refresh[0].body).toEqual({});
    expect(calls.refresh[0].headers['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.locator('#wiki-transfer-confirm').check();
    const commitButton = page.getByRole('button', { name: 'Confirmar importação', exact: true });
    await expect(commitButton).toBeEnabled();
    await commitButton.click();
    await expect(page.locator('#wiki-transfer-preview [role="alert"]')).toContainText('A prévia ficou desatualizada.');
    await expect(page.locator(`#wiki-transfer-import-${IDS.importPage}`)).toBeChecked();
    await expect(page.locator(`#wiki-transfer-import-${IDS.conflictPage}`)).toBeDisabled();
    await expect(page.locator('#wiki-transfer-confirm')).toBeChecked();
    await expect(page.locator('#wiki-transfer-preview')).toContainText('hash-do-plano-v4');
    expect(calls.commit).toHaveLength(1);
    expect(calls.commit[0].body).toEqual({
      expectedVersion: 4,
      planHash: 'hash-do-plano-v4',
      pageIds: [IDS.importPage],
      sourceIds: [IDS.source],
    });
    expect(calls.commit[0].headers['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);

    calls.commitMode = 'success';
    await page.getByRole('button', { name: 'Confirmar importação', exact: true }).click();
    await expect(page.locator('#wiki-transfer-preview [role="status"]')).toContainText('a publicação é uma ação editorial separada');
    await expect(page.locator('#wiki-transfer-preview')).toContainText('Resultado da importação');
    await expect(page.locator(`#wiki-transfer-import-${IDS.importPage}`)).toBeChecked();
    await expect(page.locator('#wiki-transfer-commit-button')).toBeDisabled();
    await expect(page.locator(`#wiki-transfer-import-${IDS.importPage}`)).toBeDisabled();
    expect(calls.commit).toHaveLength(2);
  } finally {
    await context.close();
  }
});

async function stubApi(context, role, calls) {
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
    ['/client/api.js', ['client/api.js', 'text/javascript; charset=utf-8']],
  ]);
  await context.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (body, status = 200, headers = {}) => route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      headers,
      body: JSON.stringify(body),
    });
    const staticFile = files.get(pathname);
    if (staticFile) return route.fulfill({ status: 200, contentType: staticFile[1], body: fs.readFileSync(path.join(ROOT, staticFile[0])) });
    if (!pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'index.html')) });

    if (pathname === '/api/auth/me') {
      const isAdmin = role === 'admin';
      return json({ user: {
        id: isAdmin ? IDS.admin : IDS.member,
        username: isAdmin ? 'Admin sintético' : 'Membro sintético',
        email: 'synthetic@example.test',
        role,
        joinDate: '2026-01-01',
        posts: 0,
      } });
    }
    if (pathname === '/api/auth/csrf') return json({ csrfToken: 'c'.repeat(43) });
    if (pathname === '/api/personagens' || pathname === '/api/wiki-posts') return json({ data: [] });
    if (pathname === '/api/admin/users') return json({ data: [], page: { limit: 50, offset: 0, hasMore: false } });
    if (pathname === '/api/admin/categories' || pathname === '/api/admin/audit-events') return json({ data: [] });
    if (pathname === '/api/staff/wiki/pages') return json({ data: [
      {
        id: IDS.exportPage,
        headRevisionId: IDS.exportRevision,
        publishedRevisionId: null,
        workVersion: 4,
        accessLevel: 'staff',
        archivedAt: null,
        head: { id: IDS.exportRevision, sequence: 4, snapshot: { title: 'Página atual exportável', slug: 'pagina-atual-exportavel' } },
      },
    ], page: { limit: 100, offset: 0, hasMore: false } });
    if (pathname === '/api/admin/wiki-transfers/export' && request.method() === 'POST') {
      const record = { body: request.postDataJSON(), headers: await request.allHeaders() };
      (calls.export || []).push(record);
      (calls.transferCalls || []).push(`${request.method()} ${pathname}`);
      return json(TEST_BUNDLE, 200, { 'content-disposition': 'attachment; filename="portable-wiki.json"' });
    }
    if (pathname === '/api/admin/wiki-transfers/imports' && request.method() === 'POST') {
      const record = { body: request.postDataJSON(), headers: await request.allHeaders() };
      (calls.import || []).push(record);
      (calls.transferCalls || []).push(`${request.method()} ${pathname}`);
      return json({ data: importResult(3, 'hash-do-plano-v3') }, 201);
    }
    const refreshMatch = pathname.match(/^\/api\/admin\/wiki-transfers\/imports\/([^/]+)\/refresh$/);
    if (refreshMatch && request.method() === 'POST') {
      (calls.refresh || []).push({
        method: request.method(),
        pathname,
        body: request.postDataJSON(),
        headers: await request.allHeaders(),
      });
      (calls.transferCalls || []).push(`${request.method()} ${pathname}`);
      return json({ data: importResult(4, 'hash-do-plano-v4') });
    }
    const commitMatch = pathname.match(/^\/api\/admin\/wiki-transfers\/imports\/([^/]+)\/commit$/);
    if (commitMatch && request.method() === 'POST') {
      const record = { body: request.postDataJSON(), headers: await request.allHeaders() };
      (calls.commit || []).push(record);
      (calls.transferCalls || []).push(`${request.method()} ${pathname}`);
      if (calls.commitMode !== 'success') return json({ error: 'A prévia ficou desatualizada.' }, 409);
      return json({ data: { report: { createdPages: 1, reusedSources: 1 } } });
    }
    return json({ error: 'Rota sintética não configurada.' }, 404);
  });
}

function importResult(version, planHash) {
  return {
    id: 'synthetic-import-id',
    version,
    planHash,
    preview: {
      bundleId: 'synthetic-bundle-id',
      status: 'conflict',
      planVersion: version,
      planHash,
      pageCounts: { total: 4, create: 2, reuse: 1, conflict: 1 },
      sourceCounts: { reuse: 1, conflict: 1 },
      pages: [
        {
          sourcePageId: IDS.importPage,
          sourceRevisionId: 'synthetic-revision-id',
          slug: 'pagina-de-importacao',
          title: 'Página pronta para importar',
          action: 'create',
          requiredSourceIds: [IDS.source],
        },
        {
          sourcePageId: IDS.conflictPage,
          slug: 'pagina-com-conflito',
          title: 'Página em conflito',
          action: 'conflict',
          reason: 'O destino contém uma página com o mesmo identificador.',
          requiredSourceIds: [IDS.conflictSource],
        },
        {
          sourcePageId: IDS.blockedPage,
          slug: 'pagina-com-fonte-em-conflito',
          title: 'Página dependente de fonte em conflito',
          action: 'create',
          requiredSourceIds: [IDS.conflictSource],
        },
        {
          sourcePageId: IDS.reusedPage,
          sourceRevisionId: 'synthetic-reused-revision-id',
          slug: 'pagina-ja-importada',
          title: 'Página já importada sem alterações',
          action: 'reuse',
          requiredSourceIds: [IDS.source],
        },
      ],
      sources: [
        {
          sourceSourceId: IDS.source,
          archiveSha256: 'sha256-do-arquivo-sintetico',
          relativePath: 'source-pack/referencias.json',
          sha256: 'sha256-da-fonte-sintetica',
          action: 'reuse',
        },
        {
          sourceSourceId: IDS.conflictSource,
          archiveSha256: 'sha256-de-outro-arquivo-sintetico',
          relativePath: 'source-pack/conflito.json',
          sha256: 'sha256-da-fonte-em-conflito',
          action: 'conflict',
          reason: 'A fonte existente possui conteúdo diferente.',
        },
      ],
      conflicts: [{ title: 'Página em conflito', reason: 'O destino contém uma página com o mesmo identificador.' }],
      validationErrors: [],
    },
    state: 'staged',
  };
}
