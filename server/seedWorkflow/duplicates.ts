import type { RetrievedPage } from '../confluence/traverse.ts';

/** A piece of existing seed data found in the documentation. */
export interface SeedEntry {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  lastUpdated?: string;
  updatedBy?: string;
  /** The SD-… id when the entry has one. */
  seedDataId?: string;
  text: string;
}

export interface DuplicateMatch {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  seedDataId?: string;
  similarity: 'exact' | 'high' | 'medium';
  explanation: string;
  matchingFields: string[];
  lastUpdated?: string;
  updatedBy?: string;
}

export const SEED_ID = /\bSD-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}\b/g;
const ENTRY_CHARS = 3000;

/**
 * Seed data entries of a page: one per SD-… id (from the id to the next id), or the whole page when its title says it
 * holds seed data but no ids are used.
 */
export function extractSeedEntries(page: RetrievedPage): SeedEntry[] {
  const base = { pageId: page.id, pageTitle: page.title, pageUrl: page.url, lastUpdated: page.lastUpdated, updatedBy: page.updatedBy };
  const hits = [...page.text.matchAll(SEED_ID)];
  if (!hits.length) {
    return /seed|test data|داده.?(ی)? تست/i.test(page.title) && page.text.trim() ? [{ ...base, text: page.text.slice(0, ENTRY_CHARS) }] : [];
  }
  const seen = new Set<string>();
  const entries: SeedEntry[] = [];
  hits.forEach((m, i) => {
    const id = m[0];
    if (seen.has(id)) return; // the same id mentioned again, e.g. in "Used For" of another entry
    seen.add(id);
    const end = hits.slice(i + 1).find((h) => h[0] !== id)?.index ?? page.text.length;
    entries.push({ ...base, seedDataId: id, text: page.text.slice(m.index, Math.min(end, m.index! + ENTRY_CHARS)) });
  });
  return entries;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'not', 'specified', 'برای', 'که', 'در', 'از', 'به', 'با', 'را', 'یک', 'این', 'است', 'و']);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Share of the request's words found in the entry (word overlap; titles alone do not decide). */
export function overlapScore(request: Set<string>, entry: Set<string>): number {
  if (!request.size || !entry.size) return 0;
  let shared = 0;
  for (const t of request) if (entry.has(t)) shared++;
  return shared / Math.min(request.size, entry.size);
}

/** Deterministic pre-filter: the most similar entries, so the agent compares a bounded, relevant set. */
export function rankCandidates(request: string, entries: SeedEntry[], limit = 20): SeedEntry[] {
  const req = tokens(request);
  return entries
    .map((e) => ({ e, score: overlapScore(req, tokens(`${e.seedDataId ?? ''} ${e.text}`)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

export const DUPLICATE_SYSTEM = `You check whether a requested QA Seed Data already exists in Confluence.
Compare the request with each numbered existing Seed Data entry by meaning, not by title: business purpose, data structure, fields and values, related entities, statuses, preconditions and dependencies, and the business scenario.
A different title with the same data and purpose is a duplicate. A similar title with different entities, states or purpose is not.
Report only entries that are exact or clearly similar ("exact", "high") or overlap in a way the user must know about ("medium"). Leave out unrelated entries.
Use only the given candidate numbers. Write "explanation" in Persian (keep field names, IDs and statuses in English); list the matching fields or scenario parts in "matchingFields". Answer with JSON only.`;

export const DUPLICATE_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'integer' },
          similarity: { type: 'string', enum: ['exact', 'high', 'medium'] },
          explanation: { type: 'string' },
          matchingFields: { type: 'array', items: { type: 'string' } },
        },
        required: ['candidate', 'similarity', 'explanation', 'matchingFields'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

export function duplicatePrompt(request: string, candidates: SeedEntry[]): string {
  const list = candidates
    .map((c, i) => `<candidate number="${i + 1}" page="${c.pageTitle}"${c.seedDataId ? ` id="${c.seedDataId}"` : ''}>\n${c.text}\n</candidate>`)
    .join('\n');
  return `<requested_seed_data>\n${request}\n</requested_seed_data>\n\n<existing_seed_data>\n${list}\n</existing_seed_data>\n\nReturn {"matches": [...]} with the candidate numbers that duplicate or resemble the request.`;
}

function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced);
}

/** Maps the agent's answer back to real pages; numbers outside the candidate list are dropped (no invented links). */
export function parseDuplicates(text: string, candidates: SeedEntry[]): DuplicateMatch[] {
  const data = parseJson(text) as { matches?: unknown };
  if (!Array.isArray(data?.matches)) throw new Error('پاسخ Agent برای بررسی تکراری‌ها قابل استفاده نبود.');
  const out: DuplicateMatch[] = [];
  const seen = new Set<string>();
  for (const m of data.matches as Record<string, unknown>[]) {
    const c = typeof m.candidate === 'number' ? candidates[m.candidate - 1] : undefined;
    const similarity = m.similarity;
    if (!c || (similarity !== 'exact' && similarity !== 'high' && similarity !== 'medium')) continue;
    const key = `${c.pageId}|${c.seedDataId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      pageId: c.pageId,
      pageTitle: c.pageTitle,
      pageUrl: c.pageUrl,
      seedDataId: c.seedDataId,
      similarity,
      explanation: typeof m.explanation === 'string' ? m.explanation : '',
      matchingFields: Array.isArray(m.matchingFields) ? m.matchingFields.filter((f): f is string => typeof f === 'string') : [],
      lastUpdated: c.lastUpdated,
      updatedBy: c.updatedBy,
    });
  }
  const order = { exact: 0, high: 1, medium: 2 };
  return out.sort((a, b) => order[a.similarity] - order[b.similarity]);
}
