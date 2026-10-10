import { isNotSpecified, splitList } from './model';
import type { ColumnDef, GeneratedTable, Issue, Standard, Template } from './types';

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  /** Standard rules that code cannot check; shown as a manual checklist. */
  manualChecks: string[];
  ok: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Deterministic checks of a table against the template it should follow and the selected standard.
 * Column rules are looked up from the template by column name, so renamed or extra columns are reported.
 */
export function validateTable(table: GeneratedTable, template: Template, standard: Standard): ValidationResult {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], message: string, extra: Partial<Issue> = {}) =>
    issues.push({ level, message, ...extra });

  // --- Column structure -------------------------------------------------------
  const tableNames = table.columns.map((c) => c.name.trim());
  const seen = new Map<string, number>();
  table.columns.forEach((c, i) => {
    const key = norm(c.name);
    if (!key) add('error', `Column ${i + 1} has no name.`, { columnId: c.id });
    else if (seen.has(key)) add('error', `Column "${c.name.trim()}" appears more than once.`, { columnId: c.id });
    seen.set(key, i);
  });

  const byName = new Map(table.columns.map((c) => [norm(c.name), c]));
  const templateNames = new Set(template.columns.map((c) => norm(c.name)));

  for (const tc of template.columns) {
    if (!byName.has(norm(tc.name))) {
      add(tc.required ? 'error' : 'warning', `${tc.required ? 'Required' : 'Optional'} column "${tc.name}" is missing.`);
    } else if (byName.get(norm(tc.name))!.name.trim() !== tc.name.trim()) {
      add('warning', `Column "${byName.get(norm(tc.name))!.name.trim()}" should be named exactly "${tc.name.trim()}".`, {
        columnId: byName.get(norm(tc.name))!.id,
      });
    }
  }
  for (const c of table.columns) {
    if (c.name.trim() && !templateNames.has(norm(c.name))) {
      add('error', `Unexpected column "${c.name.trim()}" is not part of the template "${template.name}".`, { columnId: c.id });
    }
  }

  const expectedOrder = template.columns.map((c) => norm(c.name)).filter((n) => byName.has(n));
  const actualOrder = tableNames.map(norm).filter((n) => templateNames.has(n));
  if (expectedOrder.join('\u0000') !== actualOrder.join('\u0000')) {
    add('error', `Column order differs from the template. Expected: ${template.columns.map((c) => c.name).join(' → ')}.`);
  }

  // --- Rows ------------------------------------------------------------------------
  if (table.rows.length === 0) add('warning', 'The table has no rows.');

  const rules = new Map<string, ColumnDef>(template.columns.map((c) => [norm(c.name), c]));
  const rowKeys = new Map<string, number>();

  table.rows.forEach((row, r) => {
    const label = `Row ${r + 1}`;
    const missingCells = table.columns.filter((c) => !(c.id in row.cells));
    if (missingCells.length) {
      add('error', `${label} is missing cells for: ${missingCells.map((c) => c.name).join(', ')}.`, { row: r });
    }
    const values = table.columns.map((c) => (row.cells[c.id] ?? '').trim());
    if (values.every((v) => !v)) {
      add('warning', `${label} is empty.`, { row: r });
      return;
    }

    const key = values.map(norm).join('\u0000');
    if (rowKeys.has(key)) add('warning', `${label} duplicates row ${rowKeys.get(key)! + 1}.`, { row: r });
    else rowKeys.set(key, r);

    table.columns.forEach((col) => {
      const rule = rules.get(norm(col.name));
      if (!rule) return;
      const value = (row.cells[col.id] ?? '').trim();
      const at = { row: r, columnId: col.id };
      if (!value) {
        if (rule.required) add('error', `${label}: required "${col.name}" is empty.`, at);
        return;
      }
      if (isNotSpecified(value)) {
        add(rule.required ? 'warning' : 'info', `${label}: "${col.name}" is marked Not specified — needs review.`, at);
        return;
      }
      const allowed = splitList(rule.allowedValues);
      if (allowed.length && !allowed.some((a) => norm(a) === norm(value))) {
        add('error', `${label}: "${col.name}" must be one of ${allowed.join(', ')} (found "${value}").`, at);
      }
      if (rule.pattern.trim()) {
        const re = compile(rule.pattern);
        if (re && !re.test(value)) add('error', `${label}: "${col.name}" does not match the pattern ${rule.pattern}.`, at);
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        add('error', `${label}: "${col.name}" is ${value.length} characters (max ${rule.maxLength}).`, at);
      }
    });
  });

  // --- Column-level rules ----------------------------------------------------------
  for (const col of table.columns) {
    const rule = rules.get(norm(col.name));
    if (!rule) continue;
    if (rule.pattern.trim() && !compile(rule.pattern)) {
      add('warning', `The pattern for "${col.name}" is not a valid regular expression, so it was not checked.`, { columnId: col.id });
    }
    if (rule.unique) {
      const firstSeen = new Map<string, number>();
      table.rows.forEach((row, r) => {
        const v = (row.cells[col.id] ?? '').trim();
        if (!v || isNotSpecified(v)) return;
        if (firstSeen.has(norm(v))) {
          add('error', `Row ${r + 1}: "${col.name}" value "${v}" is already used in row ${firstSeen.get(norm(v))! + 1}.`, {
            row: r,
            columnId: col.id,
          });
        } else firstSeen.set(norm(v), r);
      });
    }
  }

  const manualChecks = [standard.rules, standard.requiredContent, standard.validationCriteria]
    .flatMap((t) => t.split('\n'))
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level !== 'error');
  return { errors, warnings, manualChecks, ok: errors.length === 0 };
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern.trim());
  } catch {
    return null;
  }
}
