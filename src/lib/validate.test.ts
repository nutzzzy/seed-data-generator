import { describe, expect, it } from 'vitest';
import { exampleStandard, exampleTemplate, seedDataStandard, seedDataTemplate } from './defaults';
import { blankColumn, tableFromRows } from './model';
import type { Template } from './types';
import { validateTable } from './validate';

const tpl = exampleTemplate;
const [ID, SCEN, GIVEN, WHEN, THEN, PRIO] = tpl.columns.map((c) => c.id);

const good = (n: number, prio = 'High') => ({
  [ID]: `AC-${n}`,
  [SCEN]: `Scenario ${n}`,
  [GIVEN]: 'Given x',
  [WHEN]: 'When y',
  [THEN]: 'Then z',
  [PRIO]: prio,
});

describe('validateTable', () => {
  it('passes a correct table and lists the standard rules for manual review', () => {
    const r = validateTable(tableFromRows(tpl.columns, [good(1), good(2, 'low')], 'ai'), tpl, exampleStandard);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.manualChecks).toContain('Each row describes exactly one testable behaviour.');
  });

  it('flags empty required cells, Not specified values, allowed values, patterns, length and uniqueness', () => {
    const rows = [
      { ...good(1), [GIVEN]: '' },
      { ...good(1), [WHEN]: 'Not specified' },
      { ...good(3), [PRIO]: 'Urgent' },
      { ...good(4), [ID]: 'X-4' },
      { ...good(5), [SCEN]: 'x'.repeat(81) },
    ];
    const r = validateTable(tableFromRows(tpl.columns, rows, 'ai'), tpl, exampleStandard);
    const msgs = r.errors.map((e) => e.message);
    expect(msgs).toContain('Row 1: required "Given" is empty.');
    expect(msgs).toContain('Row 3: "Priority" must be one of High, Medium, Low (found "Urgent").');
    expect(msgs).toContain('Row 4: "ID" does not match the pattern ^AC-\\d+$ (expected: AC-1, AC-2, … in order).');
    expect(msgs).toContain('Row 5: "Scenario" is 81 characters (max 80).');
    expect(msgs).toContain('Row 2: "ID" value "AC-1" is already used in row 1.');
    expect(r.warnings.map((w) => w.message)).toContain('Row 2: "When" is marked Not specified — needs review.');
    // Cell-level issues point at the right cell.
    expect(r.errors.find((e) => e.message.startsWith('Row 1: required'))).toMatchObject({ row: 0, columnId: GIVEN });
  });

  it('detects missing, unexpected and reordered columns', () => {
    const table = tableFromRows(tpl.columns, [good(1)], 'ai');
    table.columns = [table.columns[1], table.columns[0], ...table.columns.slice(2, 5), { ...blankColumn('Owner'), id: 'own' }];
    const r = validateTable(table, tpl, exampleStandard);
    const msgs = r.errors.map((e) => e.message);
    expect(msgs.some((m) => m.startsWith('Column order differs from the template'))).toBe(true);
    expect(msgs).toContain('Unexpected column "Owner" is not part of the template "Acceptance criteria table".');
    expect(r.warnings.map((w) => w.message)).toContain('Optional column "Priority" is missing.');

    const noRequired = tableFromRows(tpl.columns.slice(1), [good(1)], 'ai');
    expect(validateTable(noRequired, tpl, exampleStandard).errors.map((e) => e.message)).toContain('Required column "ID" is missing.');
  });

  it('detects duplicate rows, empty rows, inconsistent rows and an empty table', () => {
    const table = tableFromRows(tpl.columns, [good(1), good(1), {}], 'ai');
    delete table.rows[0].cells[THEN];
    const r = validateTable(table, tpl, exampleStandard);
    expect(r.warnings.map((w) => w.message)).toEqual(expect.arrayContaining(['Row 3 is empty.']));
    expect(r.errors.map((e) => e.message)).toContain('Row 1 is missing cells for: Then.');

    const dup = validateTable(tableFromRows(tpl.columns, [good(1, 'High'), good(1, 'high')], 'ai'), tpl, exampleStandard);
    expect(dup.warnings.map((w) => w.message)).toContain('Row 2 duplicates row 1.');

    expect(validateTable(tableFromRows(tpl.columns, [], 'ai'), tpl, exampleStandard).warnings.map((w) => w.message)).toContain('The table has no rows.');
  });

  it('works for any user-defined template and reports invalid regex patterns', () => {
    const custom: Template = {
      id: 't',
      name: 'Endpoints',
      updatedAt: '',
      columns: [
        { ...blankColumn('Method'), id: 'm', required: true, allowedValues: 'GET, POST' },
        { ...blankColumn('Path'), id: 'p', pattern: '([' },
      ],
    };
    const r = validateTable(tableFromRows(custom.columns, [{ m: 'PUT', p: '/x' }], 'manual'), custom, exampleStandard);
    expect(r.errors.map((e) => e.message)).toEqual(['Row 1: "Method" must be one of GET, POST (found "PUT").']);
    expect(r.warnings.map((w) => w.message)).toContain('The pattern for "Path" is not a valid regular expression, so it was not checked.');
  });
});

describe('QA Seed Data template', () => {
  const sd = seedDataTemplate;
  const byName = (name: string) => sd.columns.find((c) => c.name === name)!.id;
  const row = (patch: Record<string, string> = {}) => ({
    [byName('Seed Data ID')]: 'SD-ORDER-PENDING-001',
    [byName('Name')]: 'Pending Order - Active Vendor',
    [byName('Purpose')]: 'Order acceptance tests',
    [byName('Environment')]: 'UAT',
    [byName('Data')]: 'Vendor ID: 100977\nOrder ID: Dynamic\nOrder Status: Pending',
    [byName('Preconditions')]: 'Vendor must be Active.',
    [byName('How to Create')]: '1. Create an order.',
    [byName('Used For')]: 'Vendor can accept pending order',
    ...patch,
  });

  it('accepts rows that follow the guide, including IDs without a description part', () => {
    const r = validateTable(tableFromRows(sd.columns, [row(), row({ [byName('Seed Data ID')]: 'SD-ORDER-001' })], 'ai'), sd, seedDataStandard);
    expect(r.errors).toEqual([]);
  });

  it('flags naming convention, environment, missing status, sensitive data and duplicate IDs', () => {
    const rows = [
      row({ [byName('Seed Data ID')]: 'sd-order-1' }),
      row({ [byName('Environment')]: 'dev' }),
      row({ [byName('Seed Data ID')]: 'SD-VENDOR-001', [byName('Data')]: 'Vendor ID: 100977' }),
      row({ [byName('Seed Data ID')]: 'SD-USER-001', [byName('How to Create')]: 'Login with password 1234' }),
      row({ [byName('Name')]: 'Same ID as row 2' }),
    ];
    const msgs = validateTable(tableFromRows(sd.columns, rows, 'ai'), sd, seedDataStandard).errors.map((e) => e.message);
    expect(msgs).toContain('Row 1: "Seed Data ID" does not match the pattern ^SD-[A-Z0-9]+(-[A-Z0-9]+)*-\\d{3}$ (expected: SD-[ENTITY]-[DESCRIPTION]-[NUMBER], e.g. SD-ORDER-PENDING-001).');
    expect(msgs).toContain('Row 2: "Environment" must be one of stage, UAT, production (found "dev").');
    expect(msgs.some((m) => m.startsWith('Row 3: "Data" does not match the pattern'))).toBe(true);
    expect(msgs).toContain('Row 4: "How to Create" must not contain password.');
    expect(msgs).toContain('Row 5: "Seed Data ID" value "SD-ORDER-PENDING-001" is already used in row 2.');
  });
});
