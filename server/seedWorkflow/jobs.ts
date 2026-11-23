import { randomBytes } from 'node:crypto';
import type { AgentService } from '../agents/agentService.ts';
import { confluenceApi, ConfluenceError, resolvePageRef, webUrl, type ConfluenceApi, type ConfluenceCredentials, type ContentJson } from '../confluence/api.ts';
import type { ConfluenceCredentialStore } from '../confluence/credentials.ts';
import { traverse, type RetrievalFailure, type RetrievedPage } from '../confluence/traverse.ts';
import { domainCodes, loadSkill, referencePageIds } from './skill.ts';
import { DUPLICATE_SCHEMA, DUPLICATE_SYSTEM, duplicatePrompt, extractSeedEntries, overlapScore, parseDuplicates, rankCandidates, SEED_ID, tokens, type DuplicateMatch } from './duplicates.ts';

/** SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] (guide v4): the only allowed title of a Seed Data page. */
export const SEED_PAGE_TITLE = /^SD-[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)+-\d{3}$/;

export type JobStatus = 'retrieving' | 'checking' | 'awaiting-decision' | 'ready' | 'publishing' | 'published' | 'cancelled' | 'failed';

export interface Decision {
  action: 'new' | 'overwrite';
  /** For overwrite: the existing page the user chose. */
  targetPageId?: string;
}

export interface PublishedPage {
  pageId: string;
  title: string;
  url: string;
  version: number;
  labels: string[];
  /** e.g. labels that could not be added. */
  warning?: string;
}

export interface PublishResult {
  operation: 'create' | 'update';
  pages: PublishedPage[];
  agentName: string;
  publishedAt: string;
}

/** A Domain page under QA Seed Data (from the Skill's Domain codes and the reference page's children). */
export interface DomainInfo {
  code: string;
  name: string;
  pageId?: string;
  url?: string;
}

interface Job {
  id: string;
  status: JobStatus;
  createdAt: string;
  agentId: string;
  agentName: string;
  url: string;
  request: string;
  instructions: string;
  progress: { read: number; current: string };
  pages: RetrievedPage[];
  failures: RetrievalFailure[];
  skippedByLimit: number;
  seedEntries: number;
  /** Reference pages from the Skill (the guide and its examples) that were read but not compared. */
  excludedReferences: { id: string; title: string; url: string }[];
  duplicates: DuplicateMatch[];
  /** Seed Data IDs that already exist (pages read + pages labelled seed_data in the space), for numbering. */
  existingIds: string[];
  domains: DomainInfo[];
  /** Non-fatal notes, e.g. a lookup that failed. */
  notes: string[];
  /** Domain page pages (id -> spaceKey) that may be used as parents besides the pages read. */
  extraParents: Record<string, string | undefined>;
  /** Pages created so far, so a retry after a partial failure does not create them twice. */
  created: PublishedPage[];
  decision?: Decision;
  context?: { text: string; included: string[]; omitted: string[] };
  result?: PublishResult;
  error?: string;
  controller: AbortController;
}

export interface StartInput {
  url?: unknown;
  agentId?: unknown;
  request?: unknown;
  instructions?: unknown;
}

export interface PublishInput {
  approved?: unknown;
  mode?: unknown;
  /** create: one entry per Seed Data page. */
  pages?: unknown;
  /** update: */
  pageId?: unknown;
  expectedVersion?: unknown;
  title?: unknown;
  storage?: unknown;
  labels?: unknown;
}

interface PageInput {
  title: string;
  storage: string;
  labels: string[];
  parentId: string;
}

/** The page changed after the preview: the client must refresh, preview and ask for approval again. */
export class VersionConflict extends ConfluenceError {
  constructor(readonly current: { version: number; title: string; storage: string; url?: string }) {
    super(409, `صفحه بعد از پیش‌نمایش در Confluence تغییر کرده است (نسخهٔ ${current.version}). محتوای جدید صفحه دریافت شد؛ پیش‌نمایش را دوباره بررسی و تأیید کنید.`);
  }
}

export interface JobServiceDeps {
  agents: AgentService;
  confluence: ConfluenceCredentialStore;
  /** Path of the project Skill (.claude/skills/qa-seed-data/SKILL.md). */
  skillPath: string;
  /** Replaced in tests. */
  api?: (creds: ConfluenceCredentials) => ConfluenceApi;
  /** Characters of documentation sent to the agent for generation. */
  contextBudget?: number;
}

const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export { loadSkill } from './skill.ts';

/**
 * Seed data generation jobs: Confluence retrieval → duplicate detection (by the selected agent) → the user's decision →
 * generation context → (generation, preview and approval in the browser) → publishing. Each step only runs after the
 * previous one finished; publishing needs the explicit approval and the page version seen in the preview.
 */
export class SeedJobService {
  private jobs = new Map<string, Job>();

  constructor(private readonly deps: JobServiceDeps) {}

  private api(): { api: ConfluenceApi; creds: ConfluenceCredentials } {
    const creds = this.deps.confluence.require();
    return { api: (this.deps.api ?? confluenceApi)(creds), creds };
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new ConfluenceError(404, 'این درخواست ساخت پیدا نشد (ممکن است سرور دوباره اجرا شده باشد). دوباره شروع کنید.');
    return job;
  }

  start(input: StartInput): { id: string } {
    const url = str(input.url, 2000);
    const request = str(input.request, 50_000);
    const agentId = str(input.agentId, 200);
    if (!url) throw new ConfluenceError(400, 'لینک صفحهٔ Confluence را وارد کنید.');
    if (!request) throw new ConfluenceError(400, 'توضیح Seed Data موردنیاز را وارد کنید.');
    const { creds } = this.api(); // fails early without a token
    resolvePageRef(creds.baseUrl, url); // fails early for other hosts or bad links
    const agent = this.deps.agents.get(agentId);
    if (!agent.enabled) throw new ConfluenceError(409, `Agent «${agent.name}» غیرفعال است.`);

    // Keep memory bounded: drop finished jobs older than a day.
    for (const [id, j] of this.jobs) if (Date.now() - Date.parse(j.createdAt) > 86_400_000) this.jobs.delete(id);

    const job: Job = {
      id: `job_${randomBytes(8).toString('hex')}`,
      status: 'retrieving',
      createdAt: now(),
      agentId: agent.id,
      agentName: agent.name,
      url,
      request,
      instructions: str(input.instructions, 20_000),
      progress: { read: 0, current: '' },
      pages: [],
      failures: [],
      skippedByLimit: 0,
      seedEntries: 0,
      excludedReferences: [],
      duplicates: [],
      existingIds: [],
      domains: [],
      notes: [],
      extraParents: {},
      created: [],
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    void this.run(job);
    return { id: job.id };
  }

  private async run(job: Job) {
    const signal = job.controller.signal;
    try {
      const { api, creds } = this.api();
      const result = await traverse(api, creds.baseUrl, job.url, { signal, onProgress: (p) => (job.progress = p) });
      job.pages = result.pages;
      job.failures = result.failures;
      job.skippedByLimit = result.skippedByLimit;

      job.status = 'checking';
      const skill = loadSkill(this.deps.skillPath);
      // The guide's reference pages hold example Seed Data: never compare against them.
      const references = referencePageIds(skill);
      job.excludedReferences = result.pages.filter((p) => references.has(p.id)).map(({ id, title, url }) => ({ id, title, url }));
      await this.lookupNaming(job, api, creds.baseUrl, skill, references, signal);
      const entries = result.pages.filter((p) => !references.has(p.id)).flatMap(extractSeedEntries);
      job.seedEntries = entries.length;
      if (entries.length) {
        const candidates = rankCandidates(`${job.request}\n${job.instructions}`, entries);
        let text: string;
        try {
          text = await this.deps.agents.generate(job.agentId, {
            model: '',
            system: DUPLICATE_SYSTEM,
            user: duplicatePrompt(`${job.request}\n${job.instructions}`.trim(), candidates),
            schema: DUPLICATE_SCHEMA,
            timeoutMs: 300_000,
            signal,
          });
        } catch (err) {
          throw new Error(`بررسی Seed Data تکراری با Agent ناموفق بود؛ بدون این بررسی چیزی ساخته نمی‌شود. ${err instanceof Error ? err.message : ''}`.trim());
        }
        job.duplicates = parseDuplicates(text, candidates);
      }
      if (signal.aborted) return;
      if (job.duplicates.length || job.failures.length || job.skippedByLimit) job.status = 'awaiting-decision';
      else this.ready(job, { action: 'new' });
    } catch (err) {
      if (signal.aborted) return;
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * What the naming convention needs: the existing Seed Data IDs (pages read, plus every page labelled seed_data in the
   * space) and the Domain pages under the guide's reference page. Lookups that fail become notes, not errors.
   */
  private async lookupNaming(job: Job, api: ConfluenceApi, baseUrl: string, skill: string, references: Set<string>, signal: AbortSignal) {
    const ids = new Set<string>();
    for (const p of job.pages) {
      if (references.has(p.id)) continue;
      for (const m of `${p.title}\n${p.text}`.matchAll(SEED_ID)) ids.add(m[0]);
    }
    const space = job.pages[0]?.spaceKey;
    if (space) {
      try {
        for (let start = 0; start < 1000; start += 100) {
          const cql = encodeURIComponent(`space = "${space}" and label = "seed_data" and type = page`);
          const r = await api<{ results: { title: string }[]; size: number }>(`/rest/api/content/search?cql=${cql}&limit=100&start=${start}`, { signal });
          for (const p of r.results) if (/^SD-/.test(p.title)) ids.add(p.title.trim());
          if (r.results.length < 100) break;
        }
      } catch (err) {
        if (signal.aborted) throw err;
        job.notes.push(`فهرست Seed Data در Space ${space} خوانده نشد؛ شماره‌گذاری فقط بر اساس صفحات خوانده‌شده است. (${err instanceof Error ? err.message : err})`);
      }
    }
    job.existingIds = [...ids].sort();

    const codes = domainCodes(skill);
    const pages = new Map<string, { id: string; url?: string; spaceKey?: string }>();
    for (const p of job.pages) pages.set(p.title.trim().toLowerCase(), { id: p.id, url: p.url, spaceKey: p.spaceKey });
    for (const ref of references) {
      try {
        const r = await api<{ results: ContentJson[] }>(`/rest/api/content/${ref}/child/page?limit=100&expand=space`, { signal });
        for (const c of r.results) {
          const key = c.title.trim().toLowerCase();
          if (!pages.has(key)) pages.set(key, { id: c.id, url: webUrl(baseUrl, c), spaceKey: c.space?.key });
          job.extraParents[c.id] = c.space?.key;
        }
      } catch (err) {
        if (signal.aborted) throw err;
        job.notes.push(`صفحات Domain زیر صفحهٔ مرجع خوانده نشدند. (${err instanceof Error ? err.message : err})`);
      }
    }
    job.domains = Object.entries(codes).map(([code, name]) => {
      const page = pages.get(name.toLowerCase());
      return { code, name, ...(page ? { pageId: page.id, url: page.url } : {}) };
    });
  }

  /** The user's choice after duplicate detection: generate as new, or overwrite one of the matched pages. */
  decide(id: string, input: { action?: unknown; targetPageId?: unknown }) {
    const job = this.job(id);
    if (job.status !== 'awaiting-decision') throw new ConfluenceError(409, 'این مرحله قبلاً انجام شده است.');
    if (input.action === 'cancel') return this.cancel(id);
    if (input.action === 'new') this.ready(job, { action: 'new' });
    else if (input.action === 'overwrite') {
      const target = typeof input.targetPageId === 'string' ? input.targetPageId : '';
      if (!job.duplicates.some((d) => d.pageId === target)) throw new ConfluenceError(400, 'صفحه‌ای را که باید بازنویسی شود از فهرست موارد مشابه انتخاب کنید.');
      this.ready(job, { action: 'overwrite', targetPageId: target });
    } else throw new ConfluenceError(400, 'گزینهٔ نامعتبر.');
    return this.view(id);
  }

  cancel(id: string) {
    const job = this.job(id);
    job.controller.abort();
    if (job.status !== 'published') job.status = 'cancelled';
    return this.view(id);
  }

  /** Builds what the agent gets for generation: the Skill, the request and the documentation within a size budget. */
  private ready(job: Job, decision: Decision) {
    job.decision = decision;
    const budget = this.deps.contextBudget ?? 120_000;
    const req = tokens(`${job.request} ${job.instructions}`);
    const [root, ...rest] = job.pages;
    const ordered = [root, ...rest.map((p) => ({ p, s: overlapScore(req, tokens(`${p.title} ${p.text}`)) })).sort((a, b) => b.s - a.s).map((x) => x.p)].filter(Boolean);
    const included: string[] = [];
    const omitted: string[] = [];
    const blocks: string[] = [];
    let used = 0;
    const references = new Set(job.excludedReferences.map((r) => r.id));
    for (const p of ordered) {
      const role = references.has(p.id) ? ' role="reference-guide: structure and examples only, not existing Seed Data"' : '';
      const block = `<page id="${p.id}" title="${p.title}" version="${p.version}" url="${p.url}"${role}>\n${p.text}\n</page>`;
      if (used + block.length > budget && included.length) {
        omitted.push(p.title);
        continue;
      }
      blocks.push(block);
      included.push(p.title);
      used += block.length;
    }
    const target = decision.action === 'overwrite' ? job.pages.find((p) => p.id === decision.targetPageId) : undefined;
    const unavailable = job.failures.map((f) => `- ${f.title ?? f.id ?? f.url ?? '?'} (${f.what === 'children' ? 'زیرصفحه‌ها' : 'صفحه'}): ${f.reason}`);
    const text = [
      `<project_skill name="qa-seed-data">\n${loadSkill(this.deps.skillPath)}\n</project_skill>`,
      `<seed_data_request>\n${job.request}\n</seed_data_request>`,
      job.instructions && `<additional_instructions>\n${job.instructions}\n</additional_instructions>`,
      `<confluence_documentation root="${root?.title ?? ''}">\n${blocks.join('\n')}\n</confluence_documentation>`,
      unavailable.length || omitted.length
        ? `<documentation_gaps>\n${[...unavailable, ...omitted.map((t) => `- ${t}: not sent (size limit)`)].join('\n')}\n</documentation_gaps>`
        : '',
      `<page_tree>\n${job.pages.map((p) => `${'  '.repeat(p.depth)}- ${p.title}`).join('\n')}\n</page_tree>`,
      job.domains.length
        ? `<domain_pages>\n${job.domains.map((d) => `- ${d.code}: ${d.name}${d.pageId && job.pages.some((p) => p.id === d.pageId) ? ' (the linked documentation is this Domain page or under it)' : ''}`).join('\n')}\n</domain_pages>`
        : '',
      `<existing_seed_data_ids>\n${job.existingIds.join('\n') || '(none)'}\n</existing_seed_data_ids>\nChoose each new Seed Data ID as SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] with the next free NNN for its prefix among these IDs. The ID is also the page title.`,
      target
        ? `<existing_seed_data_page_to_update title="${target.title}" id="${target.id}">\n${target.text}\n</existing_seed_data_page_to_update>\nUpdate this one Seed Data for the request. Keep its Seed Data ID when it already follows SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN]; otherwise give it a correct ID (the page will be renamed to it).`
        : '',
      'Use the Confluence documentation as the source of truth together with the request. Follow the project Skill. Do not add fields, values or references that are not in the request or the documentation; write "Not specified" and add an issue for anything missing, and add an issue for every assumption or conflict between request and documentation.',
    ]
      .filter(Boolean)
      .join('\n\n');
    job.context = { text, included, omitted };
    job.status = 'ready';
  }

  view(id: string) {
    const job = this.job(id);
    const { controller: _c, pages, context, ...rest } = job;
    return {
      ...rest,
      pages: pages.map(({ storage: _s, text: _t, ...meta }) => meta),
      context: context && { text: context.text, included: context.included, omitted: context.omitted },
    };
  }

  /** Current content of the page chosen for overwrite, for the before / after preview (and after a conflict). */
  async target(id: string) {
    const job = this.job(id);
    if (job.decision?.action !== 'overwrite' || !job.decision.targetPageId) throw new ConfluenceError(400, 'برای این درخواست صفحه‌ای برای بازنویسی انتخاب نشده است.');
    const { api, creds } = this.api();
    const page = await api<ContentJson>(`/rest/api/content/${job.decision.targetPageId}?expand=body.storage,version`);
    return { id: page.id, title: page.title, version: page.version.number, storage: page.body?.storage?.value ?? '', url: webUrl(creds.baseUrl, page) };
  }

  /** Adds the guide's labels; a failure is reported on the page instead of failing the publication. */
  private async addLabels(api: ConfluenceApi, pageId: string, labels: string[]): Promise<string | undefined> {
    if (!labels.length) return undefined;
    try {
      await api(`/rest/api/content/${pageId}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))),
      });
      return undefined;
    } catch (err) {
      return `برچسب‌ها (Label) اضافه نشدند (${labels.join(', ')}): ${err instanceof Error ? err.message : err}`;
    }
  }

  private cleanLabels(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string' && /^[a-z0-9_-]{1,100}$/.test(l)).slice(0, 20) : [];
  }

  private cleanPages(job: Job, raw: unknown): PageInput[] {
    if (!Array.isArray(raw) || !raw.length) throw new ConfluenceError(400, 'صفحه‌ای برای انتشار ارسال نشده است.');
    if (raw.length > 50) throw new ConfluenceError(400, 'حداکثر ۵۰ صفحه در یک انتشار.');
    const titles = new Set<string>();
    return raw.map((r: Record<string, unknown>) => {
      const title = str(r?.title, 255);
      if (!SEED_PAGE_TITLE.test(title)) throw new ConfluenceError(400, `عنوان «${title || '-'}» Seed Data ID معتبر نیست. عنوان صفحه باید ID به شکل SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] باشد.`);
      if (titles.has(title)) throw new ConfluenceError(400, `Seed Data ID «${title}» دو بار آمده است.`);
      titles.add(title);
      const storage = typeof r.storage === 'string' ? r.storage : '';
      if (!storage.trim() || storage.length > 2_000_000) throw new ConfluenceError(400, `محتوای «${title}» خالی یا خیلی بزرگ است.`);
      const parentId = typeof r.parentId === 'string' ? r.parentId : '';
      if (!job.pages.some((p) => p.id === parentId) && !(parentId in job.extraParents)) {
        throw new ConfluenceError(400, `صفحهٔ والد «${title}» باید یکی از صفحات خوانده‌شده یا صفحات Domain باشد.`);
      }
      return { title, storage, labels: this.cleanLabels(r.labels), parentId };
    });
  }

  /** Confluence Publishing Service. Runs only with approval, for the option the user chose, and version-checked. */
  async publish(id: string, input: PublishInput): Promise<PublishResult> {
    const job = this.job(id);
    if (input.approved !== true) throw new ConfluenceError(400, 'انتشار فقط بعد از تأیید صریح پیش‌نمایش انجام می‌شود.');
    if (job.status === 'published') throw new ConfluenceError(409, 'این Seed Data قبلاً منتشر شده است.');
    if (job.status !== 'ready' || !job.decision) throw new ConfluenceError(409, 'هنوز آمادهٔ انتشار نیست.');
    const { api, creds } = this.api();
    const references = referencePageIds(loadSkill(this.deps.skillPath));
    const urlOf = (p: ContentJson) => webUrl(creds.baseUrl, p) ?? `${creds.baseUrl}/pages/viewpage.action?pageId=${p.id}`;

    if (input.mode === 'create') {
      if (job.decision.action !== 'new') throw new ConfluenceError(400, 'برای این درخواست «بازنویسی صفحهٔ موجود» انتخاب شده است.');
      const pages = this.cleanPages(job, input.pages);
      job.status = 'publishing';
      try {
        for (const page of pages) {
          if (job.created.some((c) => c.title === page.title)) continue; // created by an earlier, partly failed attempt
          const spaceKey = job.pages.find((p) => p.id === page.parentId)?.spaceKey ?? job.extraParents[page.parentId];
          const created = await api<ContentJson>('/rest/api/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'page',
              title: page.title,
              space: { key: spaceKey },
              ancestors: [{ id: page.parentId }],
              body: { storage: { value: page.storage, representation: 'storage' } },
            }),
          }).catch((err: unknown) => {
            const done = job.created.length ? ` (${job.created.map((c) => c.title).join('، ')} ساخته شد.)` : '';
            if (err instanceof ConfluenceError && err.status === 400 && /title/i.test(err.message)) {
              throw new ConfluenceError(400, `صفحه‌ای با عنوان «${page.title}» در این Space وجود دارد؛ این Seed Data ID قبلاً استفاده شده است.${done}`);
            }
            if (err instanceof ConfluenceError) throw new ConfluenceError(err.status, `ساخت «${page.title}» ناموفق بود: ${err.message}${done}`);
            throw err;
          });
          const warning = await this.addLabels(api, created.id, page.labels);
          job.created.push({ pageId: created.id, title: created.title, url: urlOf(created), version: created.version.number, labels: page.labels, ...(warning ? { warning } : {}) });
        }
      } catch (err) {
        job.status = 'ready';
        throw err;
      }
      job.result = { operation: 'create', pages: job.created, agentName: job.agentName, publishedAt: now() };
      job.status = 'published';
      return job.result;
    }

    if (input.mode === 'update') {
      if (references.has(String(input.pageId))) throw new ConfluenceError(400, 'این صفحه مرجع راهنمای Seed Data است و به‌روزرسانی نمی‌شود.');
      if (job.decision.action !== 'overwrite' || input.pageId !== job.decision.targetPageId) {
        throw new ConfluenceError(400, 'فقط صفحه‌ای که برای بازنویسی انتخاب کرده‌اید به‌روزرسانی می‌شود.');
      }
      if (typeof input.expectedVersion !== 'number') throw new ConfluenceError(400, 'نسخهٔ صفحه در پیش‌نمایش ارسال نشده است.');
      const storage = typeof input.storage === 'string' ? input.storage : '';
      if (!storage.trim()) throw new ConfluenceError(400, 'محتوایی برای انتشار وجود ندارد.');
      if (storage.length > 2_000_000) throw new ConfluenceError(400, 'محتوا خیلی بزرگ است.');
      const title = str(input.title, 255);
      if (title && !SEED_PAGE_TITLE.test(title)) throw new ConfluenceError(400, `عنوان «${title}» Seed Data ID معتبر نیست.`);
      job.status = 'publishing';
      try {
        const current = await api<ContentJson>(`/rest/api/content/${job.decision.targetPageId}?expand=body.storage,version`);
        if (current.version.number !== input.expectedVersion) {
          throw new VersionConflict({ version: current.version.number, title: current.title, storage: current.body?.storage?.value ?? '', url: webUrl(creds.baseUrl, current) });
        }
        const page = await api<ContentJson>(`/rest/api/content/${current.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: current.id,
            type: current.type,
            // The title is the Seed Data ID; an old descriptive title is replaced by it.
            title: title || current.title,
            body: { storage: { value: storage, representation: 'storage' } },
            version: { number: current.version.number + 1, message: `Seed Data updated by ${job.agentName} (approved in Seed Data Generator)` },
          }),
        });
        const labels = this.cleanLabels(input.labels);
        const warning = await this.addLabels(api, page.id, labels);
        job.result = {
          operation: 'update',
          pages: [{ pageId: page.id, title: page.title, url: urlOf(page), version: page.version.number, labels, ...(warning ? { warning } : {}) }],
          agentName: job.agentName,
          publishedAt: now(),
        };
        job.status = 'published';
        return job.result;
      } catch (err) {
        job.status = 'ready';
        throw err;
      }
    }
    throw new ConfluenceError(400, 'نوع انتشار نامعتبر است.');
  }
}
