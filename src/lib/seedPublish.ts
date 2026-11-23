import type { TableData } from './exporters';
import { isNotSpecified } from './model';
import { seedColumn, seedIdOf, seedPageBody, type SeedField } from './seedData';
import type { GeneratedTable } from './types';

/** SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] (guide v4). */
export const SEED_ID_RE = /^SD-[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)+-\d{3}$/;
/** Any SD-… id in free text (also the older SD-[ENTITY]-[DESCRIPTION]-[NNN] form). */
export const SEED_ID_IN_TEXT = /\bSD-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}\b/g;

const cellOf = (t: TableData, cells: Record<string, string>, field: SeedField) => {
  const col = seedColumn(t.columns, field);
  const v = col ? (cells[col.id] ?? '').trim() : '';
  return v && !isNotSpecified(v) ? v : '';
};

/** The guide's required labels: seed_data, sd-[domain], sd-[entity], env-[environment] (lowercase). */
export function seedLabels(t: TableData, cells: Record<string, string>): string[] {
  const id = cellOf(t, cells, 'id');
  const domain = cellOf(t, cells, 'domain') || id.split('-')[1] || '';
  const entity = SEED_ID_RE.test(id) ? id.split('-')[2] : '';
  const env = cellOf(t, cells, 'environment');
  const label = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return ['seed_data', domain && `sd-${label(domain)}`, entity && `sd-${label(entity)}`, env && `env-${label(env)}`].filter(Boolean) as string[];
}

export interface SeedPage {
  row: number;
  /** Page title = Seed Data ID. */
  title: string;
  /** Valid v4 ID, so the page can be published. */
  valid: boolean;
  domain: string;
  storage: string;
  labels: string[];
}

/** One Confluence page per Seed Data: title = ID, Metadata in Page Properties, then the body sections. */
export function seedPages(t: TableData): SeedPage[] {
  return t.rows.map((row, i) => {
    const title = seedIdOf(t, row.cells, i);
    return {
      row: i,
      title,
      valid: SEED_ID_RE.test(title),
      domain: cellOf(t, row.cells, 'domain') || (SEED_ID_RE.test(title) ? title.split('-')[1] : ''),
      storage: seedPageBody(t, row.cells, 'storage'),
      labels: seedLabels(t, row.cells),
    };
  });
}

export interface Renamed {
  from: string;
  to: string;
}

/**
 * Makes every Seed Data ID unique: an ID that already exists in Confluence (or twice in the table) gets the next free
 * number for its SD-[DOMAIN]-[ENTITY]-[STATE] prefix. `keep` is the ID of the page being overwritten, which may stay.
 */
export function assignFreeIds(table: GeneratedTable, existing: string[], keep?: string): { table: GeneratedTable; renamed: Renamed[] } {
  const idCol = seedColumn(table.columns, 'id');
  if (!idCol) return { table, renamed: [] };
  const taken = new Set(existing.filter((id) => id !== keep));
  const renamed: Renamed[] = [];
  const rows = table.rows.map((row) => {
    const id = (row.cells[idCol.id] ?? '').trim();
    if (!SEED_ID_RE.test(id)) return row;
    if (!taken.has(id)) {
      taken.add(id);
      return row;
    }
    const prefix = id.slice(0, -4);
    const used = [...taken].filter((x) => x.startsWith(`${prefix}-`) && /-\d{3}$/.test(x)).map((x) => Number(x.slice(-3)));
    let n = Math.max(0, ...used) + 1;
    while (taken.has(`${prefix}-${String(n).padStart(3, '0')}`)) n++;
    const next = `${prefix}-${String(n).padStart(3, '0')}`;
    taken.add(next);
    renamed.push({ from: id, to: next });
    return { ...row, cells: { ...row.cells, [idCol.id]: next } };
  });
  return { table: renamed.length ? { ...table, rows } : table, renamed };
}

/** A standalone document for the sandboxed preview frame (Confluence-like look; no scripts can run in it). */
export function previewDocument(storage: string, dark = false): string {
  const css = `
    :root { color-scheme: ${dark ? 'dark' : 'light'}; }
    body { font: 14px/1.6 -apple-system, 'Segoe UI', Vazirmatn, Tahoma, sans-serif; margin: 16px; color: ${dark ? '#e6e9ef' : '#172b4d'}; background: ${dark ? '#1a1e26' : '#fff'}; }
    h1,h2,h3,h4 { margin: 1.2em 0 .4em; } h2 { border-bottom: 1px solid ${dark ? '#2e3440' : '#dfe1e6'}; padding-bottom: 4px; }
    table { border-collapse: collapse; margin: 6px 0; } th, td { border: 1px solid ${dark ? '#3d4554' : '#c1c7d0'}; padding: 6px 10px; text-align: start; vertical-align: top; }
    th { background: ${dark ? '#24304d' : '#f4f5f7'}; } pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; }
    p, li { unicode-bidi: plaintext; } .ac { color: #888; font-style: italic; }
    .page-properties { border-inline-start: 3px solid #4c9aff; padding-inline-start: 8px; }
    .page-properties::before { content: 'Page Properties'; display: block; font-size: 11px; color: #6b778c; }`;
  const body = storage
    // Page Properties shows its table, like in Confluence.
    .replace(/<ac:structured-macro ac:name="details"[^>]*>\s*<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>\s*<\/ac:structured-macro>/g, '<div class="page-properties">$1</div>')
    .replace(/<ac:link>\s*<ri:user[^>]*\/>\s*<\/ac:link>/g, '<span class="ac">@user</span>')
    .replace(/<ac:link>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>\s*<\/ac:link>/g, '<a>$1</a>')
    // Other macros cannot be rendered here; show a placeholder instead of dropping them silently.
    .replace(/<ac:structured-macro[\s\S]*?<\/ac:structured-macro>/g, '<p class="ac">[Confluence macro]</p>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body dir="auto">${body}</body></html>`;
}
