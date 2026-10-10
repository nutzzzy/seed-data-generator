import { NOT_SPECIFIED, type ColumnDef, type Issue } from './types';

export interface BasicResult {
  /** Cell values keyed by column id. */
  rows: Record<string, string>[];
  notes: Issue[];
}

const norm = (s: string) => s.trim().toLowerCase();
const BULLET = /^\s*(?:[-*•+]|\d+[.)]|\[[ xX]\])\s+/;

/**
 * Offline generator used when no AI provider is configured. It never interprets or invents content:
 * - a Markdown, tab-separated or CSV-like table whose header matches column names is mapped column by column;
 * - "Column name: value" lines fill the matching column;
 * - every other bullet / line / paragraph becomes one row, with its text placed in the main column.
 * Anything not found is set to "Not specified" and flagged for review.
 */
export function generateBasic(input: string, columns: ColumnDef[]): BasicResult {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (!text || columns.length === 0) return { rows: [], notes: [] };

  const byName = new Map(columns.map((c) => [norm(c.name), c]));
  const table = parseDelimitedTable(text, byName);
  const items = table ?? splitItems(text).map((item) => parseItem(item, byName));

  const primary = pickPrimaryColumn(columns);
  const rows: Record<string, string>[] = [];
  const notes: Issue[] = [];

  for (const item of items) {
    const row: Record<string, string> = {};
    for (const col of columns) row[col.id] = item.values[col.id] ?? '';
    if (item.rest && primary) {
      row[primary.id] = row[primary.id] ? `${row[primary.id]}\n${item.rest}` : item.rest;
    }
    if (columns.every((c) => !row[c.id])) continue;
    columns.forEach((col) => {
      if (!row[col.id]) {
        row[col.id] = NOT_SPECIFIED;
        if (col.required) notes.push({ level: 'warning', message: `Row ${rows.length + 1}: "${col.name}" was not found in the input.`, row: rows.length, columnId: col.id });
      }
    });
    rows.push(row);
  }
  return { rows, notes };
}

interface Item {
  values: Record<string, string>;
  rest: string;
}

function pickPrimaryColumn(columns: ColumnDef[]): ColumnDef | undefined {
  const idLike = /^(id|#|no\.?|nr\.?|number|key|ref(erence)?)$/i;
  return columns.find((c) => c.required && !idLike.test(c.name.trim())) ?? columns.find((c) => !idLike.test(c.name.trim())) ?? columns[0];
}

/** Paragraphs that contain "Key: value" lines are items; otherwise every non-empty line is an item. */
function splitItems(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const items: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const keyValueLines = lines.filter((l) => /^[^:]{1,40}:\s*\S/.test(l.replace(BULLET, '')));
    if (keyValueLines.length >= 2 && keyValueLines.length >= lines.length / 2) items.push(block);
    else items.push(...lines);
  }
  return items;
}

function parseItem(item: string, byName: Map<string, ColumnDef>): Item {
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (const rawLine of item.split('\n')) {
    const line = rawLine.replace(BULLET, '').trim();
    if (!line) continue;
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(line);
    const col = m ? byName.get(norm(m[1])) : undefined;
    if (col && m) {
      values[col.id] = m[2].trim();
      continue;
    }
    // Trailing "Priority: High" or "(High)"-style hints are only used when they name a column exactly.
    const inline = /^(.*?)[\s.;,]+([^:.;,]{1,40}):\s*([^:]+)$/.exec(line);
    const inlineCol = inline ? byName.get(norm(inline[2])) : undefined;
    if (inline && inlineCol) {
      values[inlineCol.id] = inline[3].trim();
      rest.push(inline[1].trim());
      continue;
    }
    rest.push(line);
  }
  return { values, rest: rest.join('\n') };
}

/** Detects a Markdown / TSV / CSV table whose header row names at least one column. */
function parseDelimitedTable(text: string, byName: Map<string, ColumnDef>): Item[] | null {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = lines[0];
  let split: (line: string) => string[];
  if (header.trim().startsWith('|')) {
    split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  } else if (header.includes('\t')) {
    split = (l) => l.split('\t').map((c) => c.trim());
  } else if (header.includes(',')) {
    split = parseCsvLine;
  } else return null;

  const headers = split(header);
  const mapped = headers.map((h) => byName.get(norm(h)));
  if (!mapped.some(Boolean)) return null;

  const body = lines.slice(1).filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l));
  return body.map((line) => {
    const cells = split(line);
    const values: Record<string, string> = {};
    const rest: string[] = [];
    cells.forEach((cell, i) => {
      const col = mapped[i];
      if (col) values[col.id] = cell.replace(/<br\s*\/?>/gi, '\n');
      else if (cell) rest.push(headers[i] ? `${headers[i]}: ${cell}` : cell);
    });
    return { values, rest: rest.join('\n') };
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
