import { describe, expect, it } from 'vitest';
import { exampleTemplate } from '../test/fixtures';
import { colId as id, seedCells as row } from '../test/seedFixtures';
import { seedDataStandard, seedDataTemplate } from './defaults';
import { tableFromRows } from './model';
import { missingSeedFields, normalizeSeedCells, seedChecklist, seedPageBody, toSeedDataHtml, toSeedDataText, toZephyrReference } from './seedData';
import { validateTable } from './validate';

const cols = seedDataTemplate.columns;
const checklistOf = (rows: Record<string, string>[]) => {
  const table = tableFromRows(cols, rows, 'ai');
  return seedChecklist(table, validateTable(table, seedDataTemplate, seedDataStandard));
};
const stateOf = (items: ReturnType<typeof checklistOf>, startsWith: string) => items.find((i) => i.label.startsWith(startsWith))!;

describe('seed data checklist (guide v4)', () => {
  it('passes every automatic item for a complete Seed Data; unknown Owner / Last Verified need review', () => {
    const complete = row({ Owner: '@ali', 'Last Verified': '2026-11-09 - @ali' });
    const items = checklistOf([complete]);
    expect(items.filter((i) => i.state !== 'manual').every((i) => i.state === 'ok')).toBe(true);
    expect(items.at(-1)).toMatchObject({ state: 'manual' });
    expect(stateOf(checklistOf([row()]), 'فیلدهای اجباری Metadata')).toMatchObject({ state: 'review', rows: [0] });
  });

  it('maps rule failures to the matching checklist items and rows', () => {
    const items = checklistOf([
      row(),
      row({ 'Seed Data ID': 'SD-VENDOR-INACTIVE-001', Environment: 'production', Data: 'Vendor ID: 1' }),
      row({ 'Seed Data ID': 'SD-BORDAR-VENDOR-INACTIVE-002', 'How to Create / Verify': 'Use token abc', 'Used By': 'Not specified', 'Usage Mode': 'Sometimes' }),
    ]);
    expect(stateOf(items, 'Seed Data ID (= عنوان صفحه)')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'Environment')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'جدول Data')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'اطلاعات حساس')).toMatchObject({ state: 'fail', rows: [2] });
    expect(stateOf(items, 'فیلدهای اجباری Metadata')).toMatchObject({ state: 'fail', rows: [2] });
    expect(stateOf(items, 'Used By')).toMatchObject({ state: 'review', rows: [2] });
  });

  it('fails items whose column is missing from the table', () => {
    const table = tableFromRows(cols.filter((c) => c.name !== 'Environment'), [row()], 'ai');
    const items = seedChecklist(table, validateTable(table, seedDataTemplate, seedDataStandard));
    expect(stateOf(items, 'Environment')).toMatchObject({ state: 'fail', detail: 'ستون «Environment» در جدول نیست.' });
  });
});

describe('seed data page layout', () => {
  const table = tableFromRows(cols, [row(), row({ 'Seed Data ID': 'SD-FP-VENDOR-ACTIVE-001', 'Reset / Cleanup': '1. Re-open the vendor.\n2. Check status.' })], 'ai');

  it('puts the Metadata table in Page Properties and the body in the guide order (storage format)', () => {
    const page = seedPageBody(table, table.rows[0].cells, 'storage');
    expect(page.startsWith('<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table')).toBe(true);
    expect(page).toContain('<tr><th>Seed Data ID</th><td>SD-BORDAR-VENDOR-INACTIVE-001</td></tr><tr><th>Name</th>');
    expect(page).toContain('<tr><th>Usage Mode</th><td>Shared</td></tr>');
    const order = ['Purpose', 'Data', 'Preconditions', 'How to Create / Verify', 'Reset / Cleanup', 'Used By'].map((h) => page.indexOf(`>${h}</h3>`));
    expect(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]))).toBe(true);
    expect(page).toContain('<tbody><tr><th>Field</th><th>Value</th></tr><tr><td>Vendor ID</td><td>31756</td></tr>');
    expect(page).toContain('<ol class="bidi-direction-rtl" style="text-align: right;"><li>در پنل بردار');
    expect(page).not.toMatch(/<br>/);
    // Body fields are not repeated in the Metadata table.
    expect(page.indexOf('<th>Purpose</th>')).toBe(-1);
  });

  it('copies one section per Seed Data titled with its ID, escaped, with a plain-text version', () => {
    const html = toSeedDataHtml(table);
    expect(html).toContain('<h2>SD-BORDAR-VENDOR-INACTIVE-001</h2>');
    expect(html).toContain('<h2>SD-FP-VENDOR-ACTIVE-001</h2>');
    expect(html).toContain('<h3 dir="auto">Reset / Cleanup</h3><ol dir="auto"><li>Re-open the vendor.</li><li>Check status.</li></ol>');
    expect(html).not.toMatch(/<script|style=/);
    const t = tableFromRows(cols, [row({ Name: '<b>A & B</b>' })], 'ai');
    expect(toSeedDataHtml(t)).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
    expect(toSeedDataText(table).split('\n').slice(0, 3)).toEqual(['SD-BORDAR-VENDOR-INACTIVE-001', 'Name: Inactive Bordar Vendor - Tehran', 'Domain: BORDAR']);
  });

  it('creates the Zephyr reference from valid IDs only', () => {
    expect(toZephyrReference(table)).toBe('Test Data:\nSD-BORDAR-VENDOR-INACTIVE-001\nSD-FP-VENDOR-ACTIVE-001');
    expect(toZephyrReference(tableFromRows(cols, [row({ 'Seed Data ID': 'Not specified' })], 'ai'))).toBe('');
  });
});

describe('guide structure', () => {
  it('lists the guide fields a structure is missing', () => {
    expect(missingSeedFields(cols)).toEqual([]);
    expect(missingSeedFields(exampleTemplate.columns)).toContain('Usage Mode');
  });

  it('normalizes IDs, Domain, Environment, Seed Status and Usage Mode', () => {
    const [cells] = normalizeSeedCells(cols, [
      { [id('Seed Data ID')]: ' sd-bordar_vendor inactive  001 ', [id('Domain')]: 'bordar', [id('Environment')]: 'Stage', [id('Seed Status')]: 'active', [id('Usage Mode')]: 'exclusive' },
    ]);
    expect(cells).toMatchObject({
      [id('Seed Data ID')]: 'SD-BORDAR-VENDOR-INACTIVE-001',
      [id('Domain')]: 'BORDAR',
      [id('Environment')]: 'stage',
      [id('Seed Status')]: 'Active',
      [id('Usage Mode')]: 'Exclusive',
    });
    const [kept] = normalizeSeedCells(cols, [{ [id('Seed Data ID')]: 'Not specified' }]);
    expect(kept[id('Seed Data ID')]).toBe('Not specified');
  });
});
