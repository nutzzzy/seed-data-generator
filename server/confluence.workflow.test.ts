// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentService } from './agents/agentService.ts';
import { confluenceApi, ConfluenceError, type ConfluenceApi, type ContentJson } from './confluence/api.ts';
import { ConfluenceCredentialStore } from './confluence/credentials.ts';
import { storageToText, traverse } from './confluence/traverse.ts';
import type { ProviderRequest } from './providers.ts';
import { SecretStore } from './secretStore.ts';
import { extractSeedEntries, parseDuplicates, rankCandidates } from './seedWorkflow/duplicates.ts';
import { loadSkill, SeedJobService, VersionConflict } from './seedWorkflow/jobs.ts';
import { referencePageIds } from './seedWorkflow/skill.ts';

const BASE = 'https://confluence.example.com';
const TOKEN = 'confluence-pat-0123456789';

// ---- A fake Confluence ------------------------------------------------------------------------------------------

interface FakePage {
  id: string;
  title: string;
  storage: string;
  parent?: string;
  version?: number;
  /** The token may not read this page / list its children. */
  forbidden?: boolean;
  childrenForbidden?: boolean;
  labels?: string[];
  space?: string;
}

function page(p: FakePage): ContentJson {
  return {
    id: p.id,
    title: p.title,
    type: 'page',
    version: { number: p.version ?? 1, when: '2026-10-01T10:00:00.000Z', by: { displayName: 'QA Lead' } },
    space: { key: p.space ?? 'QA' },
    body: { storage: { value: p.storage } },
    ancestors: p.parent ? [{ id: p.parent }] : [],
    _links: { webui: `/pages/viewpage.action?pageId=${p.id}` },
  };
}

/** Routes REST paths like Confluence Data Center, with paginated child lists. */
function fakeConfluence(pages: FakePage[]) {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const calls: { path: string; init?: RequestInit }[] = [];
  let nextId = 0;
  const api: ConfluenceApi = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    calls.push({ path, init });
    const url = new URL(path, BASE);
    const children = /^\/rest\/api\/content\/(\d+)\/child\/page$/.exec(url.pathname);
    if (children) {
      const parent = byId.get(children[1])!;
      if (parent.childrenForbidden) throw new ConfluenceError(403, 'با این توکن به این صفحه دسترسی ندارید (صفحهٔ محدود).');
      const all = pages.filter((p) => p.parent === parent.id);
      const start = Number(url.searchParams.get('start') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const slice = all.slice(start, start + limit);
      return { results: slice.map(page), size: slice.length, _links: start + limit < all.length ? { next: 'more' } : {} } as T;
    }
    const one = /^\/rest\/api\/content\/(\d+)$/.exec(url.pathname);
    if (one && (!init.method || init.method === 'GET')) {
      const p = byId.get(one[1]);
      if (!p) throw new ConfluenceError(404, 'صفحه در Confluence پیدا نشد.');
      if (p.forbidden) throw new ConfluenceError(403, 'با این توکن به این صفحه دسترسی ندارید (صفحهٔ محدود).');
      return page(p) as T;
    }
    if (one && init.method === 'PUT') {
      const body = JSON.parse(init.body as string);
      const p = byId.get(one[1])!;
      p.storage = body.body.storage.value;
      p.version = body.version.number;
      p.title = body.title;
      return page(p) as T;
    }
    if (url.pathname === '/rest/api/content/search') {
      const cql = url.searchParams.get('cql') ?? '';
      const space = /space = "([^"]+)"/.exec(cql)?.[1];
      const label = /label = "([^"]+)"/.exec(cql)?.[1];
      const found = pages.filter((p) => (p.space ?? 'QA') === space && (!label || p.labels?.includes(label)));
      return { results: found.map(page), size: found.length } as T;
    }
    const labels = /^\/rest\/api\/content\/(\d+)\/label$/.exec(url.pathname);
    if (labels && init.method === 'POST') {
      const p = byId.get(labels[1])!;
      p.labels = [...(p.labels ?? []), ...JSON.parse(init.body as string).map((l: { name: string }) => l.name)];
      return [] as T;
    }
    if (url.pathname === '/rest/api/content' && init.method === 'POST') {
      const body = JSON.parse(init.body as string);
      if (pages.some((p) => p.title === body.title)) throw new ConfluenceError(400, 'خطای Confluence 400: A page with this title already exists');
      const created: FakePage = { id: String(900 + nextId++), title: body.title, storage: body.body.storage.value, parent: body.ancestors[0].id, space: body.space.key };
      pages.push(created);
      byId.set(created.id, created);
      return page(created) as T;
    }
    throw new Error(`unexpected ${init.method ?? 'GET'} ${path}`);
  };
  return { api, calls, byId };
}

// ---- Confluence client ------------------------------------------------------------------------------------------

describe('Confluence API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries rate-limited requests after Retry-After, and sends the token only in the header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const waits: number[] = [];
    const api = confluenceApi({ baseUrl: BASE, authType: 'bearer', token: TOKEN }, { wait: async (ms) => void waits.push(ms) });
    expect(await api('/rest/api/x')).toEqual({ ok: 1 });
    expect(waits).toEqual([2000]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/rest/api/x`);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('uses Basic auth for Cloud and maps 401 / 403 / 404 / persistent 429 without exposing the token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const api = confluenceApi({ baseUrl: BASE, authType: 'basic', email: 'qa@example.com', token: TOKEN }, { wait: async () => {}, retries: 1 });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const err = (await api('/x').catch((e: unknown) => e)) as ConfluenceError;
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(TOKEN);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`qa@example.com:${TOKEN}`).toString('base64')}`);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 403 });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 404 });
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 429 });
  });
});

// ---- Credentials ------------------------------------------------------------------------------------------------

describe('Confluence credentials', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'conf-'))));

  it('reports a missing token, falls back to .env.local, and prefers settings saved in the app', () => {
    const none = new ConfluenceCredentialStore(dir, new SecretStore(dir), { baseUrl: BASE });
    expect(none.resolve()).toBeNull();
    expect(none.status()).toMatchObject({ tokenSet: false, source: null });
    expect(() => none.require()).toThrow(/توکن Confluence تنظیم نشده/);

    const env = new ConfluenceCredentialStore(dir, new SecretStore(dir), { baseUrl: BASE, token: 'env-token-123456' });
    expect(env.status()).toMatchObject({ tokenSet: true, source: 'env' });

    const status = env.save({ baseUrl: 'https://wiki.example.com/', authType: 'bearer', token: TOKEN });
    expect(status).toMatchObject({ tokenSet: true, source: 'app', baseUrl: 'https://wiki.example.com', masked: '••••6789' });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(readFileSync(join(dir, 'confluence.json'), 'utf8')).not.toContain(TOKEN);
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain(TOKEN);
    expect(env.resolve()).toMatchObject({ baseUrl: 'https://wiki.example.com', token: TOKEN });

    // Saving without a token keeps the saved one; removing it goes back to the .env.local fallback.
    env.save({ baseUrl: 'https://wiki.example.com', authType: 'bearer' });
    expect(env.resolve()?.token).toBe(TOKEN);
    expect(env.remove()).toMatchObject({ source: 'env' });
  });

  it('validates the form', () => {
    const store = new ConfluenceCredentialStore(dir, new SecretStore(dir), { baseUrl: BASE });
    expect(() => store.candidate({ baseUrl: 'not a url', token: TOKEN })).toThrow(/معتبر نیست/);
    expect(() => store.candidate({ baseUrl: BASE, authType: 'basic', token: TOKEN })).toThrow(/ایمیل/);
    expect(() => store.candidate({ baseUrl: BASE })).toThrow(/توکن/);
    expect(store.candidate({ baseUrl: 'https://x.atlassian.net/wiki/', authType: 'basic', email: 'a@b.c', token: TOKEN })).toMatchObject({
      baseUrl: 'https://x.atlassian.net/wiki',
      authType: 'basic',
    });
  });
});

// ---- Traversal --------------------------------------------------------------------------------------------------

const ROOT_URL = `${BASE}/spaces/QA/pages/1/Root`;

describe('hierarchy traversal', () => {
  it('reads the root and every descendant across paginated child lists, keeping ids, titles, URLs and versions', async () => {
    const kids = Array.from({ length: 5 }, (_, i) => ({ id: String(10 + i), title: `Child ${i}`, storage: `<p>child ${i}</p>`, parent: '1' }));
    const { api, calls } = fakeConfluence([
      { id: '1', title: 'Root', storage: '<h2>Overview</h2><p>Vendors &amp; orders</p>', version: 7 },
      ...kids,
      { id: '20', title: 'Grandchild', storage: '<p>deep</p>', parent: '12' },
    ]);
    const progress: number[] = [];
    const result = await traverse(api, BASE, ROOT_URL, { pageSize: 2, onProgress: (p) => progress.push(p.read) });
    expect(result.pages.map((p) => p.title)).toEqual(['Root', 'Child 0', 'Child 1', 'Child 2', 'Child 3', 'Child 4', 'Grandchild']);
    expect(result.root).toMatchObject({ id: '1', version: 7, url: `${BASE}/pages/viewpage.action?pageId=1`, text: '## Overview\nVendors & orders' });
    expect(result.pages.find((p) => p.id === '20')).toMatchObject({ parentId: '12', depth: 2, updatedBy: 'QA Lead' });
    expect(calls.filter((c) => c.path.startsWith('/rest/api/content/1/child')).map((c) => /start=(\d+)/.exec(c.path)?.[1])).toEqual(['0', '2', '4']);
    expect(result.failures).toEqual([]);
    expect(progress.at(-1)).toBe(7);
  });

  it('reports restricted child lists and pages instead of skipping them silently', async () => {
    const { api } = fakeConfluence([
      { id: '1', title: 'Root', storage: '' },
      { id: '2', title: 'Restricted branch', storage: '<p>x</p>', parent: '1', childrenForbidden: true },
      { id: '3', title: 'Leaf', storage: '<p>y</p>', parent: '1' },
    ]);
    const result = await traverse(api, BASE, ROOT_URL);
    expect(result.pages.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(result.failures).toEqual([expect.objectContaining({ id: '2', title: 'Restricted branch', what: 'children', status: 403 })]);
  });

  it('stops at the page limit and says how many pages were not read', async () => {
    const { api } = fakeConfluence([{ id: '1', title: 'Root', storage: '' }, ...Array.from({ length: 6 }, (_, i) => ({ id: String(10 + i), title: `C${i}`, storage: '', parent: '1' }))]);
    const result = await traverse(api, BASE, ROOT_URL, { maxPages: 4 });
    expect(result.pages).toHaveLength(4);
    expect(result.skippedByLimit).toBe(3);
  });

  it('rejects links to other hosts and deleted pages', async () => {
    const { api } = fakeConfluence([{ id: '1', title: 'Root', storage: '' }]);
    await expect(traverse(api, BASE, 'https://evil.example.com/pages/1')).rejects.toMatchObject({ status: 400 });
    await expect(traverse(api, BASE, `${BASE}/pages/viewpage.action?pageId=404`)).rejects.toMatchObject({ status: 404 });
  });

  it('turns storage format into readable text', () => {
    const text = storageToText('<table><tr><th>Field</th><th>Value</th></tr><tr><td>Status</td><td>Active</td></tr></table><ul><li>a</li></ul>');
    expect(text.split('\n').filter(Boolean)).toEqual(['Field | Value |', 'Status | Active |', '- a']);
  });
});

// ---- Duplicate detection ----------------------------------------------------------------------------------------

const VENDOR_SECTION = '<h3>SD-VENDOR-ACTIVE-001</h3><h4>Name</h4><p>Active Vendor</p><h4>Data</h4><p>Vendor ID: 100977<br />Status: Active</p>';
const ORDER_SECTION = '<h3>SD-ORDER-PENDING-001</h3><h4>Name</h4><p>Pending Order</p><h4>Data</h4><p>Order Status: Pending</p>';

describe('duplicate detection', () => {
  const asPage = (id: string, title: string, storage: string) => ({
    id,
    title,
    url: `${BASE}/p/${id}`,
    version: 1,
    parentId: null,
    depth: 1,
    storage,
    text: storageToText(storage),
  });

  it('splits a page into one entry per Seed Data ID', () => {
    const entries = extractSeedEntries(asPage('5', 'Seed Data', VENDOR_SECTION + ORDER_SECTION));
    expect(entries.map((e) => e.seedDataId)).toEqual(['SD-VENDOR-ACTIVE-001', 'SD-ORDER-PENDING-001']);
    expect(entries[0].text).toContain('Vendor ID: 100977');
    expect(entries[0].text).not.toContain('Pending');
  });

  it('ranks by content, not title: a different title with the same data beats a similar title with other data', () => {
    const sameContent = { pageId: 'a', pageTitle: 'Restaurants', pageUrl: '', text: 'SD-RESTAURANT-001 Vendor ID 100977 Vendor Status Active city Tehran restaurant login dashboard' };
    const sameTitle = { pageId: 'b', pageTitle: 'Active Vendor', pageUrl: '', text: 'SD-COURIER-001 Courier bike Offline shift night' };
    const ranked = rankCandidates('Active vendor 100977 in Tehran for login and dashboard tests', [sameTitle, sameContent], 2);
    expect(ranked[0].pageId).toBe('a');
  });

  it('keeps only real candidates from the agent answer (no invented pages), multiple matches ordered by similarity', () => {
    const candidates = [
      { pageId: '5', pageTitle: 'Seed A', pageUrl: `${BASE}/p/5`, seedDataId: 'SD-A-001', text: '' },
      { pageId: '6', pageTitle: 'Seed B', pageUrl: `${BASE}/p/6`, seedDataId: 'SD-B-001', text: '' },
    ];
    const text = JSON.stringify({
      matches: [
        { candidate: 2, similarity: 'medium', explanation: 'x', matchingFields: ['Status'] },
        { candidate: 1, similarity: 'exact', explanation: 'y', matchingFields: [] },
        { candidate: 7, similarity: 'exact', explanation: 'invented', matchingFields: [] },
      ],
    });
    expect(parseDuplicates(text, candidates).map((m) => [m.pageId, m.similarity])).toEqual([
      ['5', 'exact'],
      ['6', 'medium'],
    ]);
    expect(parseDuplicates('{"matches": []}', candidates)).toEqual([]);
    expect(() => parseDuplicates('no json', candidates)).toThrow();
  });
});

// ---- Workflow jobs and publishing ---------------------------------------------------------------------------------

describe('seed data workflow', () => {
  let dir: string;
  let skillPath: string;
  let store: ConfluenceCredentialStore;
  let agentAnswer: (req: ProviderRequest) => Promise<string>;
  let agentCalls: ProviderRequest[];

  const agents = {
    get: (id: string) => {
      if (id !== 'claude-code') throw new ConfluenceError(404, 'not found');
      return { id, name: 'Claude Code', enabled: true };
    },
    generate: (_id: string, req: ProviderRequest) => {
      agentCalls.push(req);
      return agentAnswer(req);
    },
  } as unknown as AgentService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobs-'));
    skillPath = join(dir, 'SKILL.md');
    writeFileSync(skillPath, '---\nname: qa-seed-data\n---\n# QA Seed Data Guide\nRule: SD-[ENTITY]-[DESCRIPTION]-[NUMBER]');
    store = new ConfluenceCredentialStore(dir, new SecretStore(dir), { baseUrl: BASE, token: TOKEN });
    agentCalls = [];
    agentAnswer = async () => JSON.stringify({ matches: [] });
  });

  function service(pages: FakePage[]) {
    const fake = fakeConfluence(pages);
    return { svc: new SeedJobService({ agents, confluence: store, skillPath, api: () => fake.api }), fake };
  }
  const settle = async (svc: SeedJobService, id: string) => {
    await vi.waitFor(() => expect(['retrieving', 'checking']).not.toContain(svc.view(id).status));
    return svc.view(id);
  };
  const DOCS: FakePage[] = [
    { id: '1', title: 'Food Partner', storage: '<p>Vendors can be Active or Inactive.</p>' },
    { id: '2', title: 'Seed Data – Vendors', storage: VENDOR_SECTION + ORDER_SECTION, parent: '1', version: 3 },
  ];

  it('loads the Skill without its front matter', () => {
    expect(loadSkill(skillPath)).toBe('# QA Seed Data Guide\nRule: SD-[ENTITY]-[DESCRIPTION]-[NUMBER]');
  });

  it('needs a Confluence token and a link on the configured host before anything starts', () => {
    const noToken = new SeedJobService({ agents, confluence: new ConfluenceCredentialStore(dir, new SecretStore(dir), { baseUrl: BASE }), skillPath });
    expect(() => noToken.start({ url: ROOT_URL, agentId: 'claude-code', request: 'x' })).toThrow(/توکن Confluence/);
    const { svc } = service(DOCS);
    expect(() => svc.start({ url: 'https://other.example.com/pages/1', agentId: 'claude-code', request: 'x' })).toThrow(/فقط صفحات/);
    expect(() => svc.start({ url: ROOT_URL, agentId: 'claude-code', request: ' ' })).toThrow(/توضیح/);
  });

  it('goes straight to generation when no Seed Data exists yet; the context has the Skill, request and all pages', async () => {
    const { svc } = service([{ id: '1', title: 'Food Partner', storage: '<p>Vendors can be Active.</p>' }, { id: '3', title: 'Orders', storage: '<p>Pending</p>', parent: '1' }]);
    const { id } = svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'An active vendor' });
    const job = await settle(svc, id);
    expect(job.status).toBe('ready');
    expect(agentCalls).toHaveLength(0); // nothing to compare against
    expect(job.context?.text).toContain('<project_skill name="qa-seed-data">\n# QA Seed Data Guide');
    expect(job.context?.text).toContain('<seed_data_request>\nAn active vendor');
    expect(job.context?.text).toContain('title="Orders"');
    expect(job.context?.included).toEqual(['Food Partner', 'Orders']);
  });

  it('stops on similar Seed Data and shows the matches; the user can cancel', async () => {
    agentAnswer = async () => JSON.stringify({ matches: [{ candidate: 1, similarity: 'exact', explanation: 'همان Vendor فعال', matchingFields: ['Vendor ID', 'Status'] }] });
    const { svc, fake } = service(DOCS);
    const { id } = svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'Active vendor 100977' });
    const job = await settle(svc, id);
    expect(job.status).toBe('awaiting-decision');
    expect(job.context).toBeUndefined(); // nothing is generated before the decision
    expect(job.duplicates).toEqual([
      expect.objectContaining({ pageId: '2', pageUrl: `${BASE}/pages/viewpage.action?pageId=2`, seedDataId: 'SD-VENDOR-ACTIVE-001', similarity: 'exact', updatedBy: 'QA Lead' }),
    ]);
    expect(agentCalls[0].user).toContain('SD-VENDOR-ACTIVE-001');
    expect(svc.decide(id, { action: 'cancel' }).status).toBe('cancelled');
    await expect(svc.publish(id, { approved: true, mode: 'create', pages: [{ title: 'SD-QA-VENDOR-ACTIVE-002', parentId: '1', storage: '<p/>', labels: [] }] })).rejects.toMatchObject({ status: 409 });
    expect(fake.calls.some((c) => c.init?.method === 'POST' || c.init?.method === 'PUT')).toBe(false);
  });

  it('never generates when duplicate detection fails', async () => {
    agentAnswer = async () => Promise.reject(new Error('agent down'));
    const { svc } = service(DOCS);
    const job = await settle(svc, svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'x' }).id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/تکراری.*agent down/);
    expect(job.context).toBeUndefined();
  });

  it('asks before continuing with partly retrieved documentation', async () => {
    const { svc } = service([
      { id: '1', title: 'Root', storage: '<p>x</p>' },
      { id: '2', title: 'Secret', storage: '', parent: '1', childrenForbidden: true },
    ]);
    const job = await settle(svc, svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'x' }).id);
    expect(job.status).toBe('awaiting-decision');
    expect(job.failures).toHaveLength(1);
    const next = svc.decide(job.id, { action: 'new' });
    expect(next.status).toBe('ready');
    expect(next.context?.text).toContain('<documentation_gaps>');
  });

  const pageInput = (title: string, parentId = '1', labels = ['seed_data', 'sd-qa', 'env-stage']) => ({ title, storage: `<p>${title}</p>`, labels, parentId });

  it('generate as new: one page per Seed Data titled with its ID, with labels, only with approval', async () => {
    agentAnswer = async () => JSON.stringify({ matches: [{ candidate: 1, similarity: 'high', explanation: 'x', matchingFields: [] }] });
    const { svc, fake } = service(DOCS);
    const { id } = svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'Active vendor' });
    await settle(svc, id);
    expect(svc.decide(id, { action: 'new' }).status).toBe('ready');

    const two = [pageInput('SD-QA-VENDOR-INACTIVE-001'), pageInput('SD-QA-ORDER-PAID-001', '2')];
    await expect(svc.publish(id, { mode: 'create', pages: two })).rejects.toThrow(/تأیید/);
    await expect(svc.publish(id, { approved: true, mode: 'update', pageId: '2', expectedVersion: 3, storage: '<p>x</p>' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.publish(id, { approved: true, mode: 'create', pages: [pageInput('Seed Data – Inactive Vendor')] })).rejects.toThrow(/Seed Data ID معتبر نیست/);
    await expect(svc.publish(id, { approved: true, mode: 'create', pages: [pageInput('SD-QA-VENDOR-INACTIVE-001', '777')] })).rejects.toThrow(/والد/);
    await expect(svc.publish(id, { approved: true, mode: 'create', pages: [two[0], two[0]] })).rejects.toThrow(/دو بار/);
    expect(fake.calls.some((c) => c.init?.method === 'POST' && c.path === '/rest/api/content')).toBe(false);

    const result = await svc.publish(id, { approved: true, mode: 'create', pages: two });
    expect(result).toMatchObject({ operation: 'create', agentName: 'Claude Code' });
    expect(result.pages.map((p) => [p.title, p.labels.length, p.url.startsWith(`${BASE}/pages/viewpage.action?pageId=`)])).toEqual([
      ['SD-QA-VENDOR-INACTIVE-001', 3, true],
      ['SD-QA-ORDER-PAID-001', 3, true],
    ]);
    const posts = fake.calls.filter((c) => c.init?.method === 'POST' && c.path === '/rest/api/content').map((c) => JSON.parse(c.init!.body as string));
    expect(posts.map((b) => [b.title, b.ancestors[0].id, b.space.key])).toEqual([
      ['SD-QA-VENDOR-INACTIVE-001', '1', 'QA'],
      ['SD-QA-ORDER-PAID-001', '2', 'QA'],
    ]);
    expect(fake.byId.get(result.pages[0].pageId)!.labels).toEqual(['seed_data', 'sd-qa', 'env-stage']);
    expect(fake.byId.get('2')!.storage).toBe(VENDOR_SECTION + ORDER_SECTION); // the existing page is untouched
    await expect(svc.publish(id, { approved: true, mode: 'create', pages: two })).rejects.toThrow(/قبلاً منتشر/);
  });

  it('knows the existing IDs (pages read + seed_data labels in the space) and the Domain pages under the reference page', async () => {
    writeFileSync(skillPath, '# Guide\n\n## Reference pages\n\n- https://confluence.example.com/spaces/QA/pages/50/QA+Seed+Data\n\n## Domain codes\n\n| Domain code | Service / team |\n|---|---|\n| BORDAR | Bordar |\n| FP | Food Partner |\n');
    const { svc } = service([
      { id: '50', title: 'QA Seed Data', storage: '<p>SD-FP-VENDOR-ACTIVE-001 is an example</p>' },
      { id: '51', title: 'Bordar', storage: '', parent: '50' },
      { id: '52', title: 'SD-BORDAR-VENDOR-ACTIVE-001', storage: '<p>Vendor Status: Active</p>', parent: '51', labels: ['seed_data'] },
      { id: '60', title: 'SD-BORDAR-VENDOR-INACTIVE-001', storage: '', labels: ['seed_data'] }, // elsewhere in the space
      { id: '70', title: 'Bordar docs', storage: '<p>Vendors</p>' },
    ]);
    const job = await settle(svc, svc.start({ url: `${BASE}/pages/viewpage.action?pageId=51`, agentId: 'claude-code', request: 'inactive vendor' }).id);
    expect(job.existingIds).toEqual(['SD-BORDAR-VENDOR-ACTIVE-001', 'SD-BORDAR-VENDOR-INACTIVE-001']);
    expect(job.domains).toEqual([
      { code: 'BORDAR', name: 'Bordar', pageId: '51', url: `${BASE}/pages/viewpage.action?pageId=51` },
      { code: 'FP', name: 'Food Partner' },
    ]);
    const ready = job.status === 'ready' ? job : svc.decide(job.id, { action: 'new' });
    expect(ready.context?.text).toContain('<existing_seed_data_ids>\nSD-BORDAR-VENDOR-ACTIVE-001\nSD-BORDAR-VENDOR-INACTIVE-001\n</existing_seed_data_ids>');
    expect(ready.context?.text).toContain('- BORDAR: Bordar (the linked documentation is this Domain page or under it)');
    expect(ready.context?.text).toContain('<page_tree>\n- Bordar\n  - SD-BORDAR-VENDOR-ACTIVE-001\n</page_tree>');
  });

  it('overwrite: only the chosen page, only at the previewed version; a changed page needs a new preview; the title becomes the ID', async () => {
    agentAnswer = async () => JSON.stringify({ matches: [{ candidate: 1, similarity: 'exact', explanation: 'x', matchingFields: [] }] });
    const { svc, fake } = service(DOCS);
    const { id } = svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'Active vendor' });
    await settle(svc, id);
    expect(() => svc.decide(id, { action: 'overwrite', targetPageId: '1' })).toThrow(/انتخاب کنید/);
    const job = svc.decide(id, { action: 'overwrite', targetPageId: '2' });
    expect(job.context?.text).toContain('<existing_seed_data_page_to_update title="Seed Data – Vendors"');
    expect(await svc.target(id)).toMatchObject({ id: '2', version: 3 });

    // Someone edits the page after the preview.
    fake.byId.get('2')!.version = 4;
    fake.byId.get('2')!.storage = VENDOR_SECTION + '<p>note by a colleague</p>';
    const update = { approved: true, mode: 'update', pageId: '2', title: 'SD-QA-VENDOR-ACTIVE-001', storage: '<p>mine</p>', labels: ['seed_data', 'sd-qa'] };
    const conflict = (await svc.publish(id, { ...update, expectedVersion: 3 }).catch((e: unknown) => e)) as VersionConflict;
    expect(conflict).toBeInstanceOf(VersionConflict);
    expect(conflict.current).toMatchObject({ version: 4, storage: expect.stringContaining('note by a colleague') });
    expect(fake.calls.some((c) => c.init?.method === 'PUT')).toBe(false);

    await expect(svc.publish(id, { ...update, expectedVersion: 4, title: 'Seed Data – Vendors 2' })).rejects.toThrow(/معتبر نیست/);
    const result = await svc.publish(id, { ...update, expectedVersion: 4 });
    expect(result).toMatchObject({ operation: 'update', pages: [{ pageId: '2', version: 5, title: 'SD-QA-VENDOR-ACTIVE-001', labels: ['seed_data', 'sd-qa'] }] });
    expect(fake.byId.get('2')!.title).toBe('SD-QA-VENDOR-ACTIVE-001');
    await expect(svc.publish(id, { ...update, pageId: '1', expectedVersion: 1 })).rejects.toThrow();
  });

  it('reads reference pages from the Skill and never compares against their example Seed Data', async () => {
    writeFileSync(
      skillPath,
      '# QA Seed Data Guide\n\n## Reference pages\n\n- Guide: https://confluence.example.com/spaces/QA/pages/1/Guide — page ID 1\n- Never compare against reference pages.\n\n## Goal\nSee https://confluence.example.com/pages/2 (not a reference).',
    );
    expect([...referencePageIds(loadSkill(skillPath))]).toEqual(['1']);
    agentAnswer = async () => JSON.stringify({ matches: [{ candidate: 1, similarity: 'exact', explanation: 'x', matchingFields: [] }] });
    const { svc } = service([
      { id: '1', title: 'QA Seed Data', storage: `<p>Example:</p>${VENDOR_SECTION}` },
      { id: '2', title: 'SD-FP-ORDER-PENDING-001', storage: ORDER_SECTION, parent: '1' },
    ]);
    const job = await settle(svc, svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'Active vendor 100977' }).id);
    expect(job.excludedReferences).toEqual([{ id: '1', title: 'QA Seed Data', url: `${BASE}/pages/viewpage.action?pageId=1` }]);
    // Only the real Seed Data page was offered to the agent; the guide's example was not.
    expect(agentCalls[0].user).toContain('SD-ORDER-PENDING-001');
    expect(agentCalls[0].user).not.toContain('SD-VENDOR-ACTIVE-001');
    expect(job.duplicates.map((d) => d.pageId)).toEqual(['2']);
    const ready = svc.decide(job.id, { action: 'new' });
    expect(ready.context?.text).toMatch(/<page id="1" title="QA Seed Data"[^>]*role="reference-guide/);
  });

  it('with only the reference page, nothing is compared and generation goes ahead', async () => {
    writeFileSync(skillPath, '# Guide\n\n## Reference pages\n\n- https://confluence.example.com/spaces/QA/pages/1/Guide\n');
    const { svc } = service([{ id: '1', title: 'QA Seed Data', storage: VENDOR_SECTION + ORDER_SECTION }]);
    const job = await settle(svc, svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'Active vendor' }).id);
    expect(job.status).toBe('ready');
    expect(job.seedEntries).toBe(0);
    expect(agentCalls).toHaveLength(0);
  });

  it('a partly failed publication can be retried without creating pages twice', async () => {
    const { svc, fake } = service([...DOCS.slice(0, 1), { id: '5', title: 'SD-QA-ORDER-PAID-001', storage: '', parent: '1' }]);
    const { id } = svc.start({ url: ROOT_URL, agentId: 'claude-code', request: 'x' });
    const job = await settle(svc, id);
    if (job.status === 'awaiting-decision') svc.decide(id, { action: 'new' });
    const pages = [pageInput('SD-QA-VENDOR-INACTIVE-001'), pageInput('SD-QA-ORDER-PAID-001')];
    // The second title already exists in the space.
    await expect(svc.publish(id, { approved: true, mode: 'create', pages })).rejects.toThrow(/SD-QA-ORDER-PAID-001.*وجود دارد.*SD-QA-VENDOR-INACTIVE-001 ساخته شد/);
    expect(svc.view(id).status).toBe('ready');
    const posts = () => fake.calls.filter((c) => c.init?.method === 'POST' && c.path === '/rest/api/content').length;
    expect(posts()).toBe(2);

    const result = await svc.publish(id, { approved: true, mode: 'create', pages: [pages[0], pageInput('SD-QA-ORDER-PAID-002')] });
    expect(result.pages.map((p) => p.title)).toEqual(['SD-QA-VENDOR-INACTIVE-001', 'SD-QA-ORDER-PAID-002']);
    expect(posts()).toBe(3); // the first page was not created again
  });
});
