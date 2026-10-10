import { newId, nowIso } from './ids';
import type { ColumnDef, GeneratedTable, Standard, TableRow, Template } from './types';

export function blankStandard(name = 'Untitled standard'): Standard {
  return {
    id: newId('std'),
    name,
    description: '',
    rules: '',
    requiredContent: '',
    validationCriteria: '',
    examples: '',
    updatedAt: nowIso(),
  };
}

export function blankColumn(name = ''): ColumnDef {
  return {
    id: newId('col'),
    name,
    description: '',
    required: false,
    expected: '',
    allowedValues: '',
    pattern: '',
    maxLength: null,
    unique: false,
  };
}

export function blankTemplate(name = 'Untitled template'): Template {
  return { id: newId('tpl'), name, columns: [blankColumn('Column 1')], updatedAt: nowIso() };
}

export function blankRow(columns: ColumnDef[]): TableRow {
  return { id: newId('row'), cells: Object.fromEntries(columns.map((c) => [c.id, ''])) };
}

/** Builds a table whose columns are an independent copy of the template's columns. */
export function tableFromRows(
  columns: ColumnDef[],
  rows: Record<string, string>[],
  source: GeneratedTable['source'],
  notes: GeneratedTable['notes'] = [],
): GeneratedTable {
  const cols = columns.map((c) => ({ ...c }));
  return {
    columns: cols,
    rows: rows.map((values) => ({
      id: newId('row'),
      cells: Object.fromEntries(cols.map((c) => [c.id, values[c.id] ?? ''])),
    })),
    source,
    generatedAt: nowIso(),
    notes,
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Returns a list of problems that prevent generating with this template. */
export function templateProblems(template: Template): string[] {
  const problems: string[] = [];
  if (template.columns.length === 0) problems.push('The table structure has no columns. Add at least one column.');
  const seen = new Set<string>();
  template.columns.forEach((c, i) => {
    const name = c.name.trim();
    if (!name) problems.push(`Column ${i + 1} has no name.`);
    else if (seen.has(name.toLowerCase())) problems.push(`Column name "${name}" is used more than once.`);
    seen.add(name.toLowerCase());
  });
  return problems;
}

export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isNotSpecified(value: string): boolean {
  return /^\s*not specified\b/i.test(value);
}

/** Stable comparison used for "unsaved changes" indicators (ignores the timestamp). */
export function sameContent<T extends { updatedAt: string }>(a: T, b: T | undefined): boolean {
  if (!b) return false;
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });
}
