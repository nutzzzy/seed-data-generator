import { escapeHtml, type TableData } from './exporters';
import { isNotSpecified } from './model';
import type { ColumnDef, IssueRule } from './types';
import type { ValidationResult } from './validate';

/** Field names of the QA Seed Data Guide, in the guide's order. Columns are matched by these names. */
export const SEED_FIELDS = {
  id: 'Seed Data ID',
  name: 'Name',
  purpose: 'Purpose',
  environment: 'Environment',
  data: 'Data',
  preconditions: 'Preconditions',
  howToCreate: 'How to Create',
  usedFor: 'Used For',
} as const;
export type SeedField = keyof typeof SEED_FIELDS;

const norm = (s: string) => s.trim().toLowerCase();

export function seedColumn(columns: ColumnDef[], field: SeedField): ColumnDef | undefined {
  return columns.find((c) => norm(c.name) === norm(SEED_FIELDS[field]));
}

/** Guide fields that a structure is missing, by name. Empty when the structure follows the guide. */
export function missingSeedFields(columns: ColumnDef[]): string[] {
  return (Object.keys(SEED_FIELDS) as SeedField[]).filter((f) => !seedColumn(columns, f)).map((f) => SEED_FIELDS[f]);
}

const ENVIRONMENTS = ['stage', 'UAT', 'production'];

/**
 * Deterministic clean-up of generated cells (keyed by column id): Seed Data IDs in the naming convention's form
 * (uppercase, hyphens) and Environment in the guide's spelling. Values that are Not specified are left alone.
 */
export function normalizeSeedCells(columns: ColumnDef[], rows: Record<string, string>[]): Record<string, string>[] {
  const idCol = seedColumn(columns, 'id');
  const envCol = seedColumn(columns, 'environment');
  return rows.map((row) => {
    const next = { ...row };
    const id = idCol && next[idCol.id];
    if (id && !isNotSpecified(id)) {
      next[idCol.id] = id.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-');
    }
    const env = envCol && next[envCol.id];
    if (env && !isNotSpecified(env)) {
      next[envCol.id] = ENVIRONMENTS.find((e) => norm(e) === norm(env)) ?? env.trim();
    }
    return next;
  });
}

// --- Checklist (the guide's "before registering Seed Data" list) ---------------------------------------------

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
  field?: SeedField;
  /** Checks every column instead of one field. */
  anyColumn?: boolean;
  fail?: IssueRule[];
  review?: IssueRule[];
  manual?: boolean;
}

const CHECKS: CheckDef[] = [
  { label: 'Seed Data ID مشخص است', field: 'id', fail: ['required'], review: ['not-specified'] },
  { label: 'Seed Data ID طبق Naming Convention است', field: 'id', fail: ['pattern'] },
  { label: 'Seed Data ID تکراری نیست', field: 'id', fail: ['unique'] },
  { label: 'Name مشخص است', field: 'name', fail: ['required', 'max-length'], review: ['not-specified'] },
  { label: 'Purpose مشخص است', field: 'purpose', fail: ['required'], review: ['not-specified'] },
  { label: 'Environment مشخص و مجاز است', field: 'environment', fail: ['required', 'allowed'], review: ['not-specified'] },
  { label: 'Data اصلی ثبت شده است', field: 'data', fail: ['required'], review: ['not-specified'] },
  { label: 'Status مشخص است', field: 'data', fail: ['pattern'] },
  { label: 'Preconditions در صورت نیاز نوشته شده است', field: 'preconditions', fail: ['required'], review: ['not-specified'] },
  { label: 'نحوهٔ ایجاد در صورت نیاز نوشته شده است', field: 'howToCreate', fail: ['required'], review: ['not-specified'] },
  { label: 'اطلاعات حساس ثبت نشده است', anyColumn: true, fail: ['forbidden'] },
  { label: 'مشخص شده که Seed Data برای چه Test Caseهایی قابل استفاده است', field: 'usedFor', fail: ['required'], review: ['not-specified'] },
  { label: 'قبل از ایجاد، Seed Dataهای موجود در Confluence جستجو شده‌اند', manual: true },
];

/** Scores the guide's checklist from the deterministic validation result. */
export function seedChecklist(table: TableData, validation: ValidationResult): ChecklistItem[] {
  const issues = [...validation.errors, ...validation.warnings];
  return CHECKS.map((def) => {
    if (def.manual) return { label: def.label, state: 'manual', rows: [] };
    const col = def.field ? seedColumn(table.columns, def.field) : undefined;
    if (def.field && !col) return { label: def.label, state: 'fail', rows: [], detail: `ستون «${SEED_FIELDS[def.field]}» در جدول نیست.` };
    if (table.rows.length === 0) return { label: def.label, state: 'review', rows: [], detail: 'جدول هنوز ردیفی ندارد.' };

    const relevant = issues.filter((i) => i.row !== undefined && (def.anyColumn || i.columnId === col?.id));
    const rowsWith = (rules: IssueRule[] = []) =>
      [...new Set(relevant.filter((i) => i.rule && rules.includes(i.rule)).map((i) => i.row!))].sort((a, b) => a - b);
    const failRows = rowsWith(def.fail);
    const reviewRows = rowsWith(def.review);
    if (failRows.length) return { label: def.label, state: 'fail', rows: failRows };
    if (reviewRows.length) return { label: def.label, state: 'review', rows: reviewRows };
    return { label: def.label, state: 'ok', rows: [] };
  });
}

// --- Exports -------------------------------------------------------------------------------------------------

const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const KEY_VALUE = /^([^:：]{1,60})[:：]\s*(.*)$/;
const NUMBERING = /^\s*(?:\d+[.)]|[-*•])\s*/;

/** "Used For" may be one comma-separated line or one item per line. */
const listItems = (field: SeedField | undefined, v: string) => {
  const ls = lines(v).map((l) => l.replace(NUMBERING, ''));
  return field === 'usedFor' && ls.length === 1 ? ls[0].split(/[,،]/).map((s) => s.trim()).filter(Boolean) : ls;
};

const fieldOf = (col: ColumnDef): SeedField | undefined =>
  (Object.keys(SEED_FIELDS) as SeedField[]).find((f) => norm(SEED_FIELDS[f]) === norm(col.name));

function seedIdOf(t: TableData, cells: Record<string, string>, index: number): string {
  const idCol = seedColumn(t.columns, 'id');
  const id = idCol ? (cells[idCol.id] ?? '').trim() : '';
  return id && !isNotSpecified(id) ? id : `Seed Data ${index + 1}`;
}

/**
 * One section per Seed Data, in the guide's Confluence structure: the ID as heading, then each field.
 * Data becomes a Field/Value table, Preconditions and Used For bullet lists, How to Create a numbered list.
 */
export function toSeedDataHtml(t: TableData): string {
  const p = (v: string) => `<p dir="auto">${lines(v).map(escapeHtml).join('<br>')}</p>`;
  const ul = (items: string[], tag: 'ul' | 'ol') => `<${tag}>${items.map((i) => `<li dir="auto">${escapeHtml(i)}</li>`).join('')}</${tag}>`;

  const block = (col: ColumnDef, value: string): string => {
    const field = fieldOf(col);
    if (!value.trim()) return p('-');
    if (isNotSpecified(value)) return p(value);
    if (field === 'data') {
      const ls = lines(value);
      if (ls.every((l) => KEY_VALUE.test(l))) {
        const rows = ls.map((l) => {
          const [, k, v] = KEY_VALUE.exec(l)!;
          return `<tr><th>${escapeHtml(k.trim())}</th><td dir="auto">${escapeHtml(v.trim())}</td></tr>`;
        });
        return `<table><tbody>${rows.join('')}</tbody></table>`;
      }
      return p(value);
    }
    if (field === 'preconditions' || field === 'usedFor') return ul(listItems(field, value), 'ul');
    if (field === 'howToCreate') return lines(value).length > 1 ? ul(listItems(field, value), 'ol') : p(value);
    return p(value);
  };

  const idCol = seedColumn(t.columns, 'id');
  return t.rows
    .map((row, i) => {
      const sections = t.columns
        .filter((c) => c !== idCol)
        .map((c) => `<h4>${escapeHtml(c.name)}</h4>\n${block(c, row.cells[c.id] ?? '')}`);
      return [`<h3>${escapeHtml(seedIdOf(t, row.cells, i))}</h3>`, ...sections].join('\n');
    })
    .join('\n\n');
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
