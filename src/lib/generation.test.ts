import { describe, expect, it, vi } from 'vitest';
import { generateBasic } from './basicGenerator';
import { defaultSettings, exampleStandard, exampleTemplate } from './defaults';
import { generateTable, GenerationError, type AiTransport } from './generate';
import { blankColumn } from './model';
import { extractJson, normalizeResponse } from './parseResponse';
import { buildPrompt } from './prompt';
import { NOT_SPECIFIED, type Template } from './types';

const tpl = exampleTemplate;
const names = tpl.columns.map((c) => c.name);
const anthropic = { ...defaultSettings, provider: 'anthropic' as const };
const signal = () => new AbortController().signal;

describe('buildPrompt', () => {
  it('contains the standard, the exact column names in order, the input, and a strict schema', () => {
    const p = buildPrompt(exampleStandard, tpl.columns, 'some notes');
    expect(p.user).toContain('<source_input>\nsome notes\n</source_input>');
    expect(p.user).toContain(JSON.stringify(names));
    expect(p.user).toContain('Priority comes from the source; never guess it.');
    expect(p.system).toContain(`"${NOT_SPECIFIED}"`);
    const rowSchema = (p.schema as { properties: { rows: { items: { required: string[]; additionalProperties: boolean } } } }).properties.rows.items;
    expect(rowSchema.required).toEqual(names);
    expect(rowSchema.additionalProperties).toBe(false);
  });

  it('omits empty standard fields to keep the prompt concise', () => {
    const p = buildPrompt({ ...exampleStandard, examples: '', description: '' }, tpl.columns, 'x');
    expect(p.user).not.toContain('<examples_of_correct_output>');
    expect(p.user).not.toContain('<description>');
  });
});

describe('normalizeResponse', () => {
  it('maps rows by column name (case-insensitive), converts values and fills gaps with Not specified', () => {
    const text = JSON.stringify({
      rows: [{ id: 'AC-1', SCENARIO: 'A', Given: 'Given', When: ['When', 'and'], Then: 3, extra: 'x' }],
      issues: [{ row: 1, column: 'Priority', message: 'No priority in source' }],
    });
    const { rows, notes } = normalizeResponse(text, tpl.columns);
    expect(rows[0]).toEqual({
      [tpl.columns[0].id]: 'AC-1',
      [tpl.columns[1].id]: 'A',
      [tpl.columns[2].id]: 'Given',
      [tpl.columns[3].id]: 'When\nand',
      [tpl.columns[4].id]: '3',
      [tpl.columns[5].id]: NOT_SPECIFIED,
    });
    expect(notes.map((n) => n.message)).toEqual(['Ignored fields that are not table columns: extra.', 'Row 1: "Priority": No priority in source']);
  });

  it('accepts JSON wrapped in prose or code fences, and positional arrays', () => {
    expect(extractJson('Here you go:\n```json\n{"rows": []}\n```')).toEqual({ rows: [] });
    const { rows } = normalizeResponse('[["AC-1","S","G","W","T","Low"]]', tpl.columns);
    expect(Object.values(rows[0])).toEqual(['AC-1', 'S', 'G', 'W', 'T', 'Low']);
  });

  it('rejects malformed answers', () => {
    expect(() => normalizeResponse('not json at all', tpl.columns)).toThrow('not valid JSON');
    expect(() => normalizeResponse('{"data": 1}', tpl.columns)).toThrow('"rows"');
    expect(() => normalizeResponse('{"rows": []}', tpl.columns)).toThrow('no rows');
    expect(() => normalizeResponse('{"rows": ["x"]}', tpl.columns)).toThrow('not an object');
  });
});

describe('generateBasic (offline)', () => {
  it('turns bullets into rows, fills "Column: value" hints, and flags missing required data', () => {
    const { rows, notes } = generateBasic('- First thing happens\n- Second thing. Priority: Low', tpl.columns);
    expect(rows).toHaveLength(2);
    const [id, scen, , , , prio] = tpl.columns.map((c) => c.id);
    expect(rows[0][scen]).toBe('First thing happens');
    expect(rows[0][id]).toBe(NOT_SPECIFIED);
    expect(rows[1][scen]).toBe('Second thing');
    expect(rows[1][prio]).toBe('Low');
    expect(notes.some((n) => n.message === 'Row 1: "ID" was not found in the input.')).toBe(true);
  });

  it('maps a pasted Markdown table and key/value blocks by column name', () => {
    const md = '| ID | Then | Other |\n|---|---|---|\n| AC-9 | Then done | foo |';
    const [id, , , , then] = tpl.columns.map((c) => c.id);
    const t = generateBasic(md, tpl.columns);
    expect(t.rows[0][id]).toBe('AC-9');
    expect(t.rows[0][then]).toBe('Then done');

    const kv = generateBasic('ID: AC-1\nGiven: Given a\nWhen: When b\n\nID: AC-2\nThen: Then c', tpl.columns);
    expect(kv.rows.map((r) => r[id])).toEqual(['AC-1', 'AC-2']);
  });

  it('works with any template and returns nothing for empty input', () => {
    const custom = [{ ...blankColumn('Title'), id: 't', required: true }];
    expect(generateBasic('one\ntwo', custom).rows).toEqual([{ t: 'one' }, { t: 'two' }]);
    expect(generateBasic('   ', custom).rows).toEqual([]);
  });
});

describe('generateTable', () => {
  it('rejects empty input and broken templates without calling the provider', async () => {
    const transport = vi.fn<AiTransport>();
    await expect(generateTable({ standard: exampleStandard, template: tpl, input: '  ', settings: anthropic, signal: signal(), transport })).rejects.toThrow(GenerationError);
    const dupes: Template = { ...tpl, columns: [blankColumn('A'), blankColumn('a')] };
    await expect(generateTable({ standard: exampleStandard, template: dupes, input: 'x', settings: anthropic, signal: signal(), transport })).rejects.toThrow('used more than once');
    expect(transport).not.toHaveBeenCalled();
  });

  it('sends only the current configuration and returns a table with the exact template columns', async () => {
    const transport = vi.fn<AiTransport>().mockResolvedValue(JSON.stringify({ rows: [Object.fromEntries(names.map((n) => [n, `${n} value`]))], issues: [] }));
    const table = await generateTable({ standard: exampleStandard, template: tpl, input: 'notes', settings: anthropic, signal: signal(), transport });
    expect(table.columns.map((c) => c.name)).toEqual(names);
    expect(table.columns[0]).not.toBe(tpl.columns[0]); // a copy, so editing the table can't change the template
    expect(table.rows[0].cells[tpl.columns[1].id]).toBe('Scenario value');
    const req = transport.mock.calls[0][0];
    expect(req).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(Object.keys(req).sort()).toEqual(['model', 'provider', 'schema', 'system', 'timeoutMs', 'user', 'baseUrl'].sort());
  });

  it('wraps provider failures, malformed responses and timeouts in GenerationError', async () => {
    const args = { standard: exampleStandard, template: tpl, input: 'x', settings: anthropic, signal: signal() };
    await expect(generateTable({ ...args, transport: () => Promise.reject(new GenerationError('API key rejected')) })).rejects.toThrow('API key rejected');
    await expect(generateTable({ ...args, transport: () => Promise.resolve('Sorry, I cannot.') })).rejects.toThrow('not valid JSON');

    const slow: AiTransport = (_req, s) => new Promise((_, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await expect(generateTable({ ...args, settings: { ...anthropic, timeoutSeconds: 0.01 }, transport: slow })).rejects.toThrow(/did not answer within/);
  }, 10_000);

  it('uses Claude Code by default and lets it pick its own model', async () => {
    const transport = vi.fn<AiTransport>().mockResolvedValue('{"rows":[{"ID":"AC-1"}],"issues":[]}');
    await generateTable({ standard: exampleStandard, template: tpl, input: 'notes', settings: defaultSettings, signal: signal(), transport });
    expect(transport.mock.calls[0][0]).toMatchObject({ provider: 'claude-code', model: '' });
  });

  it('uses the offline generator when no AI is configured', async () => {
    const transport = vi.fn<AiTransport>();
    const table = await generateTable({ standard: exampleStandard, template: tpl, input: '- a\n- b', settings: { ...defaultSettings, provider: 'basic' }, signal: signal(), transport });
    expect(table.source).toBe('basic');
    expect(table.rows).toHaveLength(2);
    expect(transport).not.toHaveBeenCalled();
  });
});
