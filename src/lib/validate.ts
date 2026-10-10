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
const list = (items: string[]) => items.join('، ');

/**
 * Deterministic checks of a table against the template it should follow and the selected standard.
 * Column rules are looked up from the template by column name, so renamed or extra columns are reported.
 */
export function validateTable(table: GeneratedTable, template: Template, standard: Standard): ValidationResult {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], rule: Issue['rule'], message: string, extra: Partial<Issue> = {}) =>
    issues.push({ level, rule, message, ...extra });

  // --- Column structure -------------------------------------------------------
  const tableNames = table.columns.map((c) => c.name.trim());
  const seen = new Map<string, number>();
  table.columns.forEach((c, i) => {
    const key = norm(c.name);
    if (!key) add('error', 'structure', `ستون ${i + 1} نام ندارد.`, { columnId: c.id });
    else if (seen.has(key)) add('error', 'structure', `ستون «${c.name.trim()}» بیش از یک بار آمده است.`, { columnId: c.id });
    seen.set(key, i);
  });

  const byName = new Map(table.columns.map((c) => [norm(c.name), c]));
  const templateNames = new Set(template.columns.map((c) => norm(c.name)));

  for (const tc of template.columns) {
    const found = byName.get(norm(tc.name));
    if (!found) {
      add(tc.required ? 'error' : 'warning', 'structure', `ستون ${tc.required ? 'اجباری' : 'اختیاری'} «${tc.name}» در جدول نیست.`);
    } else if (found.name.trim() !== tc.name.trim()) {
      add('warning', 'structure', `نام ستون «${found.name.trim()}» باید دقیقاً «${tc.name.trim()}» باشد.`, { columnId: found.id });
    }
  }
  for (const c of table.columns) {
    if (c.name.trim() && !templateNames.has(norm(c.name))) {
      add('error', 'structure', `ستون «${c.name.trim()}» جزو ساختار «${template.name}» نیست.`, { columnId: c.id });
    }
  }

  const expectedOrder = template.columns.map((c) => norm(c.name)).filter((n) => byName.has(n));
  const actualOrder = tableNames.map(norm).filter((n) => templateNames.has(n));
  if (expectedOrder.join('\u0000') !== actualOrder.join('\u0000')) {
    add('error', 'structure', `ترتیب ستون‌ها با ساختار جدول یکی نیست. ترتیب درست: ${list(template.columns.map((c) => c.name))}.`);
  }

  // --- Rows ------------------------------------------------------------------------
  if (table.rows.length === 0) add('warning', 'empty-row', 'جدول هیچ ردیفی ندارد.');

  const rules = new Map<string, ColumnDef>(template.columns.map((c) => [norm(c.name), c]));
  const rowKeys = new Map<string, number>();

  table.rows.forEach((row, r) => {
    const label = `ردیف ${r + 1}`;
    const missingCells = table.columns.filter((c) => !(c.id in row.cells));
    if (missingCells.length) {
      add('error', 'structure', `${label}: این سلول‌ها وجود ندارند: ${list(missingCells.map((c) => c.name))}.`, { row: r });
    }
    const values = table.columns.map((c) => (row.cells[c.id] ?? '').trim());
    if (values.every((v) => !v)) {
      add('warning', 'empty-row', `${label} خالی است.`, { row: r });
      return;
    }

    const key = values.map(norm).join('\u0000');
    if (rowKeys.has(key)) add('warning', 'duplicate-row', `${label} با ردیف ${rowKeys.get(key)! + 1} یکسان است.`, { row: r });
    else rowKeys.set(key, r);

    table.columns.forEach((col) => {
      const rule = rules.get(norm(col.name));
      if (!rule) return;
      const value = (row.cells[col.id] ?? '').trim();
      const at = { row: r, columnId: col.id };
      if (!value) {
        if (rule.required) add('error', 'required', `${label}: «${col.name}» اجباری است و خالی مانده است.`, at);
        return;
      }
      if (isNotSpecified(value)) {
        add(rule.required ? 'warning' : 'info', 'not-specified', `${label}: «${col.name}» مقدار Not specified دارد و باید بررسی شود.`, at);
        return;
      }
      const allowed = splitList(rule.allowedValues);
      if (allowed.length && !allowed.some((a) => norm(a) === norm(value))) {
        add('error', 'allowed', `${label}: «${col.name}» باید یکی از این مقدارها باشد: ${list(allowed)} (مقدار فعلی: «${value}»).`, at);
      }
      if (rule.pattern.trim()) {
        const re = compile(rule.pattern);
        if (re && !re.test(value)) {
          const expected = rule.expected.trim() || rule.pattern.trim();
          add('error', 'pattern', `${label}: «${col.name}» با قالب موردانتظار مطابقت ندارد: ${expected}`, at);
        }
      }
      const found = splitList(rule.forbidden ?? '').filter((w) => norm(value).includes(norm(w)));
      if (found.length) add('error', 'forbidden', `${label}: «${col.name}» نباید اطلاعات حساس داشته باشد (${list(found)}).`, at);
      if (rule.maxLength && value.length > rule.maxLength) {
        add('error', 'max-length', `${label}: «${col.name}» ${value.length} کاراکتر است (حداکثر ${rule.maxLength}).`, at);
      }
    });
  });

  // --- Column-level rules ----------------------------------------------------------
  for (const col of table.columns) {
    const rule = rules.get(norm(col.name));
    if (!rule) continue;
    if (rule.pattern.trim() && !compile(rule.pattern)) {
      add('warning', 'pattern', `الگوی ستون «${col.name}» یک Regex معتبر نیست و بررسی نشد.`, { columnId: col.id });
    }
    if (rule.unique) {
      const firstSeen = new Map<string, number>();
      table.rows.forEach((row, r) => {
        const v = (row.cells[col.id] ?? '').trim();
        if (!v || isNotSpecified(v)) return;
        if (firstSeen.has(norm(v))) {
          add('error', 'unique', `ردیف ${r + 1}: مقدار «${v}» در «${col.name}» تکراری است (ردیف ${firstSeen.get(norm(v))! + 1}).`, {
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
