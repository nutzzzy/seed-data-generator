import { NOT_SPECIFIED, type ColumnDef, type Issue } from './types';

export interface ParsedRows {
  /** Cell values keyed by column id. */
  rows: Record<string, string>[];
  notes: Issue[];
}

export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResponseError';
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** Extracts the JSON value from a model answer that may be wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());
  const firstObj = trimmed.indexOf('{');
  const lastObj = trimmed.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1));
  const firstArr = trimmed.indexOf('[');
  const lastArr = trimmed.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new InvalidResponseError('پاسخ AI یک JSON معتبر نبود.');
}

function toCell(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => toCell(v) ?? '').filter(Boolean).join('\n');
  return JSON.stringify(value);
}

/**
 * Validates and normalizes a model answer into rows that match the configured columns exactly.
 * Throws InvalidResponseError when nothing usable came back, so callers can keep the existing table.
 */
export function normalizeResponse(text: string, columns: ColumnDef[]): ParsedRows {
  const data = extractJson(text);
  const rawRows: unknown = Array.isArray(data) ? data : (data as { rows?: unknown })?.rows;
  if (!Array.isArray(rawRows)) throw new InvalidResponseError('پاسخ AI فهرست «rows» نداشت.');
  if (rawRows.length === 0) throw new InvalidResponseError('AI هیچ ردیفی برنگرداند. بررسی کنید ورودی، داده‌های موردنیاز تست را توضیح دهد.');

  const notes: Issue[] = [];
  const byName = new Map(columns.map((c) => [norm(c.name), c]));
  const ignored = new Set<string>();

  const rows = rawRows.map((raw, r) => {
    const row: Record<string, string> = {};
    if (Array.isArray(raw)) {
      columns.forEach((c, i) => (row[c.id] = toCell(raw[i]) ?? ''));
      if (raw.length !== columns.length) {
        notes.push({ level: 'warning', rule: 'generation', message: `ردیف ${r + 1} به جای ${columns.length} مقدار، ${raw.length} مقدار داشت.`, row: r });
      }
    } else if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const col = byName.get(norm(key));
        if (col) row[col.id] = toCell(value) ?? '';
        else ignored.add(key);
      }
    } else {
      throw new InvalidResponseError(`ردیف ${r + 1} در پاسخ AI یک شیء نیست.`);
    }
    for (const col of columns) {
      if (row[col.id] === undefined || (col.required && row[col.id] === '')) row[col.id] = NOT_SPECIFIED;
    }
    return row;
  });

  if (ignored.size) {
    notes.push({ level: 'warning', rule: 'generation', message: `فیلدهایی که جزو ستون‌ها نبودند نادیده گرفته شدند: ${[...ignored].join('، ')}.` });
  }

  const rawIssues = (data as { issues?: unknown })?.issues;
  if (Array.isArray(rawIssues)) {
    for (const issue of rawIssues) {
      if (!issue || typeof issue !== 'object') continue;
      const { row, column, message } = issue as { row?: unknown; column?: unknown; message?: unknown };
      if (typeof message !== 'string' || !message.trim()) continue;
      const rowIndex = typeof row === 'number' && row >= 1 && row <= rows.length ? row - 1 : undefined;
      const col = typeof column === 'string' ? byName.get(norm(column)) : undefined;
      notes.push({
        level: 'warning',
        rule: 'generation',
        message: `${rowIndex !== undefined ? `ردیف ${rowIndex + 1}: ` : ''}${col ? `«${col.name}»: ` : ''}${message.trim()}`,
        row: rowIndex,
        columnId: col?.id,
      });
    }
  }

  return { rows, notes };
}
