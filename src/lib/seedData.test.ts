import { describe, expect, it } from 'vitest';
import { seedDataStandard, seedDataTemplate } from './defaults';
import { tableFromRows } from './model';
import { missingSeedFields, normalizeSeedCells, seedChecklist, toSeedDataHtml, toSeedDataText, toZephyrReference } from './seedData';
import { exampleTemplate } from '../test/fixtures';
import { validateTable } from './validate';

const cols = seedDataTemplate.columns;
const id = (name: string) => cols.find((c) => c.name === name)!.id;
const row = (patch: Record<string, string> = {}) => ({
  [id('Seed Data ID')]: 'SD-ORDER-PAID-001',
  [id('Name')]: 'Paid Order - Active Vendor',
  [id('Purpose')]: 'برای تست Order پرداخت‌شده',
  [id('Environment')]: 'UAT',
  [id('Data')]: 'Vendor ID: 100977\nOrder ID: Dynamic\nOrder Status: Paid',
  [id('Preconditions')]: 'Vendor must be Active.\nPayment must be Successful.',
  [id('How to Create')]: '1. Create an order.\n2. Pay it.',
  [id('Used For')]: 'Vendor Login, Order Management',
  ...patch,
});
const checklistOf = (rows: Record<string, string>[]) => {
  const table = tableFromRows(cols, rows, 'ai');
  return seedChecklist(table, validateTable(table, seedDataTemplate, seedDataStandard));
};
const stateOf = (items: ReturnType<typeof checklistOf>, startsWith: string) => items.find((i) => i.label.startsWith(startsWith))!;

describe('seed data checklist', () => {
  it('passes every automatic item of the guide checklist for a correct Seed Data', () => {
    const items = checklistOf([row()]);
    expect(items.filter((i) => i.state !== 'manual').every((i) => i.state === 'ok')).toBe(true);
    expect(items.at(-1)).toMatchObject({ state: 'manual' });
  });

  it('maps rule failures to the matching checklist items and rows', () => {
    const items = checklistOf([
      row(),
      row({ [id('Seed Data ID')]: 'order-2', [id('Environment')]: 'dev', [id('Data')]: 'Vendor ID: 1' }),
      row({ [id('Seed Data ID')]: 'SD-ORDER-PAID-002', [id('How to Create')]: 'Use token abc', [id('Used For')]: 'Not specified' }),
    ]);
    expect(stateOf(items, 'Seed Data ID طبق Naming Convention')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'Environment')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'Status')).toMatchObject({ state: 'fail', rows: [1] });
    expect(stateOf(items, 'اطلاعات حساس')).toMatchObject({ state: 'fail', rows: [2] });
    expect(stateOf(items, 'مشخص شده که Seed Data')).toMatchObject({ state: 'review', rows: [2] });
    expect(stateOf(items, 'Name')).toMatchObject({ state: 'ok' });
  });

  it('fails items whose column is missing from the table', () => {
    const table = tableFromRows(cols.filter((c) => c.name !== 'Environment'), [row()], 'ai');
    const items = seedChecklist(table, validateTable(table, seedDataTemplate, seedDataStandard));
    expect(stateOf(items, 'Environment')).toMatchObject({ state: 'fail', detail: 'ستون «Environment» در جدول نیست.' });
  });
});

describe('seed data exports', () => {
  const table = tableFromRows(cols, [row(), row({ [id('Seed Data ID')]: 'SD-VENDOR-ACTIVE-001', [id('How to Create')]: 'Not specified' })], 'ai');

  it('builds one Confluence section per Seed Data in the guide structure', () => {
    const html = toSeedDataHtml(table);
    expect(html).toContain('<h3>SD-ORDER-PAID-001</h3>\n<h4>Name</h4>\n<p dir="auto">Paid Order - Active Vendor</p>');
    expect(html).toContain('<h4>Data</h4>\n<table><tbody><tr><th>Vendor ID</th><td dir="auto">100977</td></tr><tr><th>Order ID</th>');
    expect(html).toContain('<h4>Preconditions</h4>\n<ul><li dir="auto">Vendor must be Active.</li><li dir="auto">Payment must be Successful.</li></ul>');
    expect(html).toContain('<h4>How to Create</h4>\n<ol><li dir="auto">Create an order.</li><li dir="auto">Pay it.</li></ol>');
    expect(html).toContain('<h4>Used For</h4>\n<ul><li dir="auto">Vendor Login</li><li dir="auto">Order Management</li></ul>');
    expect(html).toContain('<h3>SD-VENDOR-ACTIVE-001</h3>');
    expect(html).toContain('<h4>How to Create</h4>\n<p dir="auto">Not specified</p>');
    expect(html).not.toMatch(/<script|style=/);
  });

  it('escapes content and offers a plain-text version', () => {
    const t = tableFromRows(cols, [row({ [id('Name')]: '<b>A & B</b>' })], 'ai');
    expect(toSeedDataHtml(t)).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
    expect(toSeedDataText(table).split('\n').slice(0, 4)).toEqual(['SD-ORDER-PAID-001', 'Name: Paid Order - Active Vendor', 'Purpose: برای تست Order پرداخت‌شده', 'Environment: UAT']);
  });

  it('creates the Zephyr reference from valid IDs only', () => {
    expect(toZephyrReference(table)).toBe('Test Data:\nSD-ORDER-PAID-001\nSD-VENDOR-ACTIVE-001');
    const none = tableFromRows(cols, [row({ [id('Seed Data ID')]: 'Not specified' })], 'ai');
    expect(toZephyrReference(none)).toBe('');
  });
});

describe('guide structure', () => {
  it('lists the guide fields a structure is missing', () => {
    expect(missingSeedFields(cols)).toEqual([]);
    expect(missingSeedFields(exampleTemplate.columns)).toEqual(['Seed Data ID', 'Name', 'Purpose', 'Environment', 'Data', 'Preconditions', 'How to Create', 'Used For']);
  });

  it('normalizes Seed Data IDs and Environment names', () => {
    const [id, , , env] = cols;
    const [row] = normalizeSeedCells(cols, [{ [id.id]: ' sd-order_pending  001 ', [env.id]: 'uat' }]);
    expect(row[id.id]).toBe('SD-ORDER-PENDING-001');
    expect(row[env.id]).toBe('UAT');
    const [kept] = normalizeSeedCells(cols, [{ [id.id]: 'Not specified', [env.id]: 'Stage' }]);
    expect(kept).toEqual({ [id.id]: 'Not specified', [env.id]: 'stage' });
  });
});
