import type { ColumnDef, TableRow } from './types';

export interface TableData {
  columns: ColumnDef[];
  rows: TableRow[];
}

const cellsOf = (t: TableData) => t.rows.map((r) => t.columns.map((c) => r.cells[c.id] ?? ''));
const headersOf = (t: TableData) => t.columns.map((c) => c.name);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const htmlCell = (text: string) => escapeHtml(text.trim()).replace(/\r?\n/g, '<br>');

/** Plain HTML table: header row, escaped cells, no styling, no scripts. */
export function toHtml(t: TableData): string {
  const head = headersOf(t).map((h) => `<th>${htmlCell(h)}</th>`).join('');
  const body = cellsOf(t)
    .map((row) => `    <tr>${row.map((v) => `<td>${htmlCell(v)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table>\n  <thead>\n    <tr>${head}</tr>\n  </thead>\n  <tbody>\n${body}${body ? '\n' : ''}  </tbody>\n</table>`;
}

/** Standalone UTF-8 HTML document for the "Download HTML" option. */
export function toHtmlDocument(t: TableData, title: string): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${toHtml(t)}\n</body>\n</html>\n`;
}

/** RFC 4180 CSV with CRLF line endings. Prefixed with a BOM so Excel detects UTF-8. */
export function toCsv(t: TableData, { bom = true } = {}): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headersOf(t), ...cellsOf(t)].map((row) => row.map(quote).join(','));
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/** Tab-separated text: the plain-text flavour placed on the clipboard next to HTML. */
export function toTsv(t: TableData): string {
  const clean = (v: string) => v.replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  return [headersOf(t), ...cellsOf(t)].map((row) => row.map(clean).join('\t')).join('\n');
}

/** GitHub-flavoured Markdown table. Pipes are escaped and line breaks become <br>. */
export function toMarkdown(t: TableData): string {
  const md = (v: string) => v.trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const row = (cells: string[]) => `| ${cells.map(md).join(' | ')} |`;
  return [row(headersOf(t)), `| ${t.columns.map(() => '---').join(' | ')} |`, ...cellsOf(t).map(row)].join('\n');
}

/**
 * Confluence wiki markup (Insert → Markup in Confluence Cloud, or the wiki markup editor in Data Center/Server).
 * Characters with table, link, macro or bold/italic meaning are backslash-escaped; line breaks become "\\".
 */
export function toConfluenceWiki(t: TableData): string {
  const wiki = (v: string) => {
    const text = v
      .trim()
      .replace(/\\/g, '\\\\')
      .replace(/([|{}[\]*_])/g, '\\$1')
      .replace(/\r?\n/g, ' \\\\ ');
    return text || ' ';
  };
  const header = `||${headersOf(t).map(wiki).join('||')}||`;
  const rows = cellsOf(t).map((r) => `|${r.map(wiki).join('|')}|`);
  return [header, ...rows].join('\n');
}

export function safeFileName(name: string, ext: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N}._ -]+/gu, '').replace(/\s+/g, '-') || 'table';
  return `${base}.${ext}`;
}
