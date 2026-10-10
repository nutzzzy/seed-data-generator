import { describe, expect, it } from 'vitest';
import { blankColumn } from './model';
import { safeFileName, toConfluenceWiki, toCsv, toHtml, toMarkdown, toTsv, type TableData } from './exporters';

function sample(): TableData {
  const a = { ...blankColumn('Name'), id: 'a' };
  const b = { ...blankColumn('Notes'), id: 'b' };
  return {
    columns: [a, b],
    rows: [
      { id: 'r1', cells: { a: 'Tom & <Jerry>', b: 'line 1\nline 2' } },
      { id: 'r2', cells: { a: 'Say "hi", ok', b: 'pipe | here' } },
    ],
  };
}

describe('exporters', () => {
  it('builds a well-formed, escaped HTML table with header and preserved order', () => {
    const html = toHtml(sample());
    expect(html).toContain('<thead>\n    <tr><th>Name</th><th>Notes</th></tr>');
    expect(html).toContain('<td>Tom &amp; &lt;Jerry&gt;</td><td>line 1<br>line 2</td>');
    expect(html).toContain('<td>Say &quot;hi&quot;, ok</td>');
    expect(html).not.toMatch(/style=|<script/i);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Name', 'Notes'],
      ['Tom & <Jerry>', 'line 1line 2'],
      ['Say "hi", ok', 'pipe | here'],
    ]);
  });

  it('creates RFC 4180 CSV with BOM, quoting and CRLF', () => {
    const csv = toCsv(sample());
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿Name,Notes\r\nTom & <Jerry>,"line 1\nline 2"\r\n"Say ""hi"", ok",pipe | here\r\n');
  });

  it('creates Markdown with escaped pipes and <br> line breaks', () => {
    expect(toMarkdown(sample())).toBe(
      '| Name | Notes |\n| --- | --- |\n| Tom & <Jerry> | line 1<br>line 2 |\n| Say "hi", ok | pipe \\| here |',
    );
  });

  it('creates Confluence wiki markup with escaped special characters', () => {
    const t = sample();
    t.rows.push({ id: 'r3', cells: { a: '', b: '[link] {macro} *bold*' } });
    expect(toConfluenceWiki(t).split('\n')).toEqual([
      '||Name||Notes||',
      '|Tom & <Jerry>|line 1 \\\\ line 2|',
      '|Say "hi", ok|pipe \\| here|',
      '| |\\[link\\] \\{macro\\} \\*bold\\*|',
    ]);
  });

  it('creates single-line TSV for the plain-text clipboard flavour', () => {
    expect(toTsv(sample())).toBe('Name\tNotes\nTom & <Jerry>\tline 1 line 2\nSay "hi", ok\tpipe | here');
  });

  it('exports a header-only table when there are no rows', () => {
    const t = { ...sample(), rows: [] };
    expect(toCsv(t, { bom: false })).toBe('Name,Notes\r\n');
    expect(toHtml(t)).toContain('<tbody>\n  </tbody>');
  });

  it('makes safe file names', () => {
    expect(safeFileName('Acceptance / criteria: v2', 'csv')).toBe('Acceptance-criteria-v2.csv');
    expect(safeFileName('   ', 'html')).toBe('table.html');
  });
});
