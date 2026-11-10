import { describe, expect, it } from 'vitest';
import { exampleStandard, exampleTemplate } from '../test/fixtures';
import { seedDataStandard, seedDataTemplate } from './defaults';
import { blankColumn, tableFromRows } from './model';
import type { Template } from './types';
import { validateTable } from './validate';
import { seedCells } from '../test/seedFixtures';

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
    expect(msgs).toContain('ردیف 1: «Given» اجباری است و خالی مانده است.');
    expect(msgs).toContain('ردیف 3: «Priority» باید یکی از این مقدارها باشد: High، Medium، Low (مقدار فعلی: «Urgent»).');
    expect(msgs).toContain('ردیف 4: «ID» با قالب موردانتظار مطابقت ندارد: AC-1, AC-2, … in order');
    expect(msgs).toContain('ردیف 5: «Scenario» 81 کاراکتر است (حداکثر 80).');
    expect(msgs).toContain('ردیف 2: مقدار «AC-1» در «ID» تکراری است (ردیف 1).');
    expect(r.warnings.map((w) => w.message)).toContain('ردیف 2: «When» مقدار Not specified دارد و باید بررسی شود.');
    // Cell-level issues point at the right cell.
    expect(r.errors.find((e) => e.message.startsWith('ردیف 1: «Given» اجباری'))).toMatchObject({ row: 0, columnId: GIVEN });
  });

  it('detects missing, unexpected and reordered columns', () => {
    const table = tableFromRows(tpl.columns, [good(1)], 'ai');
    table.columns = [table.columns[1], table.columns[0], ...table.columns.slice(2, 5), { ...blankColumn('Owner'), id: 'own' }];
    const r = validateTable(table, tpl, exampleStandard);
    const msgs = r.errors.map((e) => e.message);
    expect(msgs.some((m) => m.startsWith('ترتیب ستون‌ها با ساختار جدول یکی نیست'))).toBe(true);
    expect(msgs).toContain('ستون «Owner» جزو ساختار «Acceptance criteria table» نیست.');
    expect(r.warnings.map((w) => w.message)).toContain('ستون اختیاری «Priority» در جدول نیست.');

    const noRequired = tableFromRows(tpl.columns.slice(1), [good(1)], 'ai');
    expect(validateTable(noRequired, tpl, exampleStandard).errors.map((e) => e.message)).toContain('ستون اجباری «ID» در جدول نیست.');
  });

  it('detects duplicate rows, empty rows, inconsistent rows and an empty table', () => {
    const table = tableFromRows(tpl.columns, [good(1), good(1), {}], 'ai');
    delete table.rows[0].cells[THEN];
    const r = validateTable(table, tpl, exampleStandard);
    expect(r.warnings.map((w) => w.message)).toEqual(expect.arrayContaining(['ردیف 3 خالی است.']));
    expect(r.errors.map((e) => e.message)).toContain('ردیف 1: این سلول‌ها وجود ندارند: Then.');

    const dup = validateTable(tableFromRows(tpl.columns, [good(1, 'High'), good(1, 'high')], 'ai'), tpl, exampleStandard);
    expect(dup.warnings.map((w) => w.message)).toContain('ردیف 2 با ردیف 1 یکسان است.');

    expect(validateTable(tableFromRows(tpl.columns, [], 'ai'), tpl, exampleStandard).warnings.map((w) => w.message)).toContain('جدول هیچ ردیفی ندارد.');
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
    expect(r.errors.map((e) => e.message)).toEqual(['ردیف 1: «Method» باید یکی از این مقدارها باشد: GET، POST (مقدار فعلی: «PUT»).']);
    expect(r.warnings.map((w) => w.message)).toContain('الگوی ستون «Path» یک Regex معتبر نیست و بررسی نشد.');
  });
});

describe('QA Seed Data template (guide v4)', () => {
  const sd = seedDataTemplate;
  const cells = (patch: Record<string, string> = {}) => seedCells(patch);

  it('accepts rows that follow the guide, including multi-part states', () => {
    const r = validateTable(tableFromRows(sd.columns, [cells(), cells({ 'Seed Data ID': 'SD-BIKEREXP-BIKER-ACTIVE-FREE-001' })], 'ai'), sd, seedDataStandard);
    expect(r.errors).toEqual([]);
  });

  it('flags the naming convention, production, Seed Status / Usage Mode, missing status, sensitive data and duplicate IDs', () => {
    const rows = [
      cells({ 'Seed Data ID': 'SD-VENDOR-INACTIVE-001' }), // no Domain part (old format)
      cells({ 'Seed Data ID': 'SD-BORDAR-VENDOR-A-001', Environment: 'production', 'Seed Status': 'Healthy', 'Usage Mode': 'Private' }),
      cells({ 'Seed Data ID': 'SD-BORDAR-VENDOR-B-001', Data: 'Vendor ID: 31756' }),
      cells({ 'Seed Data ID': 'SD-BORDAR-USER-C-001', 'How to Create / Verify': 'Login with password 1234 and OTP 5555' }),
      cells({ 'Seed Data ID': 'SD-BORDAR-VENDOR-B-001', Name: 'Same ID as row 3' }),
    ];
    const msgs = validateTable(tableFromRows(sd.columns, rows, 'ai'), sd, seedDataStandard).errors.map((e) => e.message);
    expect(msgs).toContain('ردیف 1: «Seed Data ID» با قالب موردانتظار مطابقت ندارد: SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN], e.g. SD-BORDAR-VENDOR-INACTIVE-001');
    expect(msgs).toContain('ردیف 2: «Environment» باید یکی از این مقدارها باشد: stage، UAT (مقدار فعلی: «production»).');
    expect(msgs).toContain('ردیف 2: «Seed Status» باید یکی از این مقدارها باشد: Active، Broken، Deprecated (مقدار فعلی: «Healthy»).');
    expect(msgs).toContain('ردیف 2: «Usage Mode» باید یکی از این مقدارها باشد: Shared، Exclusive (مقدار فعلی: «Private»).');
    expect(msgs.some((m) => m.startsWith('ردیف 3: «Data» با قالب موردانتظار مطابقت ندارد'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('ردیف 4: «How to Create / Verify» نباید اطلاعات حساس داشته باشد'))).toBe(true);
    expect(msgs).toContain('ردیف 5: مقدار «SD-BORDAR-VENDOR-B-001» در «Seed Data ID» تکراری است (ردیف 3).');
  });
});
