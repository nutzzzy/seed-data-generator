import { escapeHtml, type TableData } from './exporters';
import { isNotSpecified } from './model';
import type { ColumnDef, IssueRule } from './types';
import type { ValidationResult } from './validate';

/** Field names of the QA Seed Data Guide (v4), in the guide's order. Columns are matched by these names. */
export const SEED_FIELDS = {
  id: 'Seed Data ID',
  name: 'Name',
  domain: 'Domain',
  owner: 'Owner',
  environment: 'Environment',
  seedStatus: 'Seed Status',
  usageMode: 'Usage Mode',
  lastVerified: 'Last Verified',
  dependencies: 'Dependencies',
  purpose: 'Purpose',
  data: 'Data',
  preconditions: 'Preconditions',
  howToCreate: 'How to Create / Verify',
  reset: 'Reset / Cleanup',
  usedBy: 'Used By',
} as const;
export type SeedField = keyof typeof SEED_FIELDS;

/** Fields of the Metadata table (inside Page Properties); the others are the page body, in this order. */
export const METADATA_FIELDS: SeedField[] = ['id', 'name', 'domain', 'owner', 'environment', 'seedStatus', 'usageMode', 'lastVerified', 'dependencies'];
export const BODY_FIELDS: SeedField[] = ['purpose', 'data', 'preconditions', 'howToCreate', 'reset', 'usedBy'];

const norm = (s: string) => s.trim().toLowerCase();

export function seedColumn(columns: ColumnDef[], field: SeedField): ColumnDef | undefined {
  return columns.find((c) => norm(c.name) === norm(SEED_FIELDS[field]));
}

/** Guide fields that a structure is missing, by name. Empty when the structure follows the guide. */
export function missingSeedFields(columns: ColumnDef[]): string[] {
  return (Object.keys(SEED_FIELDS) as SeedField[]).filter((f) => !seedColumn(columns, f)).map((f) => SEED_FIELDS[f]);
}

const SPELLING: Partial<Record<SeedField, string[]>> = {
  environment: ['stage', 'UAT', 'production'],
  seedStatus: ['Active', 'Broken', 'Deprecated'],
  usageMode: ['Shared', 'Exclusive'],
};

/**
 * Deterministic clean-up of generated cells (keyed by column id): Seed Data ID and Domain in the naming convention's
 * form (uppercase, hyphens), and Environment / Seed Status / Usage Mode in the guide's spelling. Values that are
 * Not specified are left alone.
 */
export function normalizeSeedCells(columns: ColumnDef[], rows: Record<string, string>[]): Record<string, string>[] {
  const idCol = seedColumn(columns, 'id');
  const domainCol = seedColumn(columns, 'domain');
  return rows.map((row) => {
    const next = { ...row };
    const id = idCol && next[idCol.id];
    if (id && !isNotSpecified(id)) next[idCol.id] = id.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-');
    const domain = domainCol && next[domainCol.id];
    if (domain && !isNotSpecified(domain)) next[domainCol.id] = domain.trim().toUpperCase();
    for (const [field, values] of Object.entries(SPELLING) as [SeedField, string[]][]) {
      const col = seedColumn(columns, field);
      const v = col && next[col.id];
      if (col && v && !isNotSpecified(v)) next[col.id] = values.find((e) => norm(e) === norm(v)) ?? v.trim();
    }
    return next;
  });
}

// --- Checklist (the guide's "before publishing a Seed Data page" list) ---------------------------------------

export type CheckState = 'ok' | 'fail' | 'review' | 'manual';

export interface ChecklistItem {
  label: string;
  state: CheckState;
  /** Zero-based rows that fail or need review. */
  rows: number[];
  detail?: string;
}

interface CheckDef {
  label: string;
  fields?: SeedField[];
  /** Checks every column instead of some fields. */
  anyColumn?: boolean;
  fail?: IssueRule[];
  review?: IssueRule[];
  manual?: boolean;
}

const CHECKS: CheckDef[] = [
  { label: 'Seed Data ID (= عنوان صفحه) مشخص و طبق Naming Convention است', fields: ['id'], fail: ['required', 'pattern'], review: ['not-specified'] },
  { label: 'Seed Data ID یکتاست', fields: ['id'], fail: ['unique'] },
  {
    label: 'فیلدهای اجباری Metadata پر شده‌اند',
    fields: ['name', 'domain', 'owner', 'seedStatus', 'usageMode', 'lastVerified'],
    fail: ['required', 'allowed', 'pattern', 'max-length'],
    review: ['not-specified'],
  },
  { label: 'Environment برابر stage یا UAT است', fields: ['environment'], fail: ['required', 'allowed'], review: ['not-specified'] },
  { label: 'Purpose نوشته شده است', fields: ['purpose'], fail: ['required'], review: ['not-specified'] },
  { label: 'جدول Data ثبت شده و Status هر Entity در آن آمده است', fields: ['data'], fail: ['required', 'pattern'], review: ['not-specified'] },
  { label: 'Preconditions شرط‌های لازم را دارد', fields: ['preconditions'], fail: ['required'], review: ['not-specified'] },
  { label: 'How to Create / Verify پر شده است', fields: ['howToCreate'], fail: ['required'], review: ['not-specified'] },
  { label: 'Reset / Cleanup و Dependencies پر شده‌اند', fields: ['reset', 'dependencies'], review: ['not-specified'] },
  { label: 'Used By کلید تست‌کیس‌های Zephyr را دارد', fields: ['usedBy'], fail: ['required'], review: ['not-specified'] },
  { label: 'اطلاعات حساس ثبت نشده است', anyColumn: true, fail: ['forbidden'] },
  { label: 'قبل از ایجاد، Seed Data موجود در Confluence جستجو شده است', manual: true },
];

/** Scores the guide's checklist from the deterministic validation result. */
export function seedChecklist(table: TableData, validation: ValidationResult): ChecklistItem[] {
  const issues = [...validation.errors, ...validation.warnings];
  return CHECKS.map((def) => {
    if (def.manual) return { label: def.label, state: 'manual', rows: [] };
    const cols = (def.fields ?? []).map((f) => seedColumn(table.columns, f));
    const missing = (def.fields ?? []).filter((_, i) => !cols[i]);
    if (missing.length) return { label: def.label, state: 'fail', rows: [], detail: `ستون ${missing.map((f) => `«${SEED_FIELDS[f]}»`).join('، ')} در جدول نیست.` };
    if (table.rows.length === 0) return { label: def.label, state: 'review', rows: [], detail: 'جدول هنوز ردیفی ندارد.' };

    const ids = new Set(cols.map((c) => c!.id));
    const relevant = issues.filter((i) => i.row !== undefined && (def.anyColumn || (i.columnId !== undefined && ids.has(i.columnId))));
    const rowsWith = (rules: IssueRule[] = []) =>
      [...new Set(relevant.filter((i) => i.rule && rules.includes(i.rule)).map((i) => i.row!))].sort((a, b) => a - b);
    const failRows = rowsWith(def.fail);
    const reviewRows = rowsWith(def.review);
    if (failRows.length) return { label: def.label, state: 'fail', rows: failRows };
    if (reviewRows.length) return { label: def.label, state: 'review', rows: reviewRows };
    return { label: def.label, state: 'ok', rows: [] };
  });
}

// --- Exports: the v4 page layout -----------------------------------------------------------------------------

const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const KEY_VALUE = /^([^:：]{1,60})[:：]\s*(.*)$/;
const NUMBERING = /^\s*(?:\d+[.)]|[-*•])\s*/;

/** "Used By" may be one comma-separated line or one item per line. */
const listItems = (field: SeedField | undefined, v: string) => {
  const ls = lines(v).map((l) => l.replace(NUMBERING, ''));
  return field === 'usedBy' && ls.length === 1 ? ls[0].split(/[,،]/).map((s) => s.trim()).filter(Boolean) : ls;
};

const fieldOf = (col: ColumnDef): SeedField | undefined =>
  (Object.keys(SEED_FIELDS) as SeedField[]).find((f) => norm(SEED_FIELDS[f]) === norm(col.name));

export function seedIdOf(t: TableData, cells: Record<string, string>, index: number): string {
  const idCol = seedColumn(t.columns, 'id');
  const id = idCol ? (cells[idCol.id] ?? '').trim() : '';
  return id && !isNotSpecified(id) ? id : `Seed Data ${index + 1}`;
}

/** "paste" = HTML for the Confluence editor / clipboard; "storage" = Confluence storage format (XHTML) for publishing. */
export type Flavor = 'paste' | 'storage';

const RTL = { paste: ' dir="auto"', storage: ' class="bidi-direction-rtl" style="text-align: right;"' } as const;
const TABLE = { paste: '', storage: ' class="bidi-direction-rtl my-bidi-table wrapped" style="text-align: right;direction: rtl;"' } as const;
const BR = { paste: '<br>', storage: '<br />' } as const;

function valueHtml(field: SeedField | undefined, value: string, f: Flavor): string {
  const p = (v: string) => `<p${RTL[f]}>${lines(v).map(escapeHtml).join(BR[f])}</p>`;
  const list = (items: string[], tag: 'ul' | 'ol') => `<${tag}${RTL[f]}>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</${tag}>`;
  if (!value.trim()) return p('-');
  if (isNotSpecified(value)) return p(value);
  if (field === 'data') {
    const ls = lines(value);
    if (ls.every((l) => KEY_VALUE.test(l))) {
      const rows = ls.map((l) => {
        const [, k, v] = KEY_VALUE.exec(l)!;
        return `<tr><td>${escapeHtml(k.trim())}</td><td>${escapeHtml(v.trim())}</td></tr>`;
      });
      return `<table${TABLE[f]}><tbody><tr><th>Field</th><th>Value</th></tr>${rows.join('')}</tbody></table>`;
    }
    return p(value);
  }
  if (field === 'preconditions' || field === 'usedBy') return list(listItems(field, value), 'ul');
  if (field === 'howToCreate' || field === 'reset') return lines(value).length > 1 ? list(listItems(field, value), 'ol') : p(value);
  return p(value);
}

/** The Metadata table and the body sections of one Seed Data, in the v4 page layout. */
export function seedPageBody(t: TableData, cells: Record<string, string>, f: Flavor): string {
  const cell = (field: SeedField) => {
    const col = seedColumn(t.columns, field);
    return col ? (cells[col.id] ?? '').trim() : '';
  };
  const metaRows = METADATA_FIELDS.filter((field) => seedColumn(t.columns, field))
    .map((field) => `<tr><th>${escapeHtml(SEED_FIELDS[field])}</th><td>${escapeHtml(lines(cell(field)).join(' ') || '-')}</td></tr>`)
    .join('');
  const table = `<table${TABLE[f]}><tbody>${metaRows}</tbody></table>`;
  const metadata = f === 'storage' ? `<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body>${table}</ac:rich-text-body></ac:structured-macro>` : table;
  // Columns outside the guide (a customised template) are kept as extra sections, so nothing is lost.
  const known = new Set<string>(Object.values(SEED_FIELDS).map(norm));
  const extra = t.columns.filter((c) => !known.has(norm(c.name)));
  const sections = [
    ...BODY_FIELDS.filter((field) => seedColumn(t.columns, field)).map((field) => ({ name: SEED_FIELDS[field], field: field as SeedField | undefined, value: cell(field) })),
    ...extra.map((c) => ({ name: c.name, field: fieldOf(c), value: (cells[c.id] ?? '').trim() })),
  ];
  return [metadata, ...sections.map((s) => `<h3${RTL[f]}>${escapeHtml(s.name)}</h3>${valueHtml(s.field, s.value, f)}`)].join('');
}

/**
 * One section per Seed Data for pasting into Confluence: the ID as heading (= the page title), then the Metadata
 * table and the body sections, as on the guide's example page.
 */
export function toSeedDataHtml(t: TableData): string {
  return t.rows.map((row, i) => `<h2>${escapeHtml(seedIdOf(t, row.cells, i))}</h2>\n${seedPageBody(t, row.cells, 'paste')}`).join('\n\n');
}

/** Plain-text flavour of toSeedDataHtml, used as the clipboard fallback. */
export function toSeedDataText(t: TableData): string {
  const idCol = seedColumn(t.columns, 'id');
  return t.rows
    .map((row, i) => {
      const fields = t.columns
        .filter((c) => c !== idCol)
        .map((c) => {
          const ls = lines(row.cells[c.id] ?? '');
          return ls.length > 1 ? `${c.name}:\n${ls.map((l) => `  ${l}`).join('\n')}` : `${c.name}: ${ls[0] ?? '-'}`;
        });
      return [seedIdOf(t, row.cells, i), ...fields].join('\n');
    })
    .join('\n\n');
}

/** The reference a Zephyr test case should contain instead of copying the Seed Data details. */
export function toZephyrReference(t: TableData): string {
  const idCol = seedColumn(t.columns, 'id');
  const ids = idCol ? t.rows.map((r) => (r.cells[idCol.id] ?? '').trim()).filter((v) => v && !isNotSpecified(v)) : [];
  return ids.length ? `Test Data:\n${[...new Set(ids)].join('\n')}` : '';
}
