import { describe, expect, it } from 'vitest';
import { seedCells } from '../test/seedFixtures';
import { seedDataTemplate } from './defaults';
import { tableFromRows } from './model';
import { assignFreeIds, previewDocument, seedLabels, seedPages } from './seedPublish';

const cols = seedDataTemplate.columns;
const table = tableFromRows(cols, [seedCells(), seedCells({ 'Seed Data ID': 'SD-FP-ORDER-PAID-001', Domain: 'FP', Environment: 'UAT' })], 'ai');

describe('one Confluence page per Seed Data', () => {
  it('titles each page with its Seed Data ID and adds the guide labels', () => {
    const pages = seedPages(table);
    expect(pages.map((p) => [p.title, p.valid, p.domain])).toEqual([
      ['SD-BORDAR-VENDOR-INACTIVE-001', true, 'BORDAR'],
      ['SD-FP-ORDER-PAID-001', true, 'FP'],
    ]);
    expect(pages[0].labels).toEqual(['seed_data', 'sd-bordar', 'sd-vendor', 'env-stage']);
    expect(pages[1].labels).toEqual(['seed_data', 'sd-fp', 'sd-order', 'env-uat']);
    expect(pages[0].storage).toContain('<ac:structured-macro ac:name="details"');
    expect(pages[0].storage).not.toContain('SD-FP-ORDER-PAID-001');
  });

  it('marks a descriptive title as invalid, so it can never become the page title', () => {
    const bad = tableFromRows(cols, [seedCells({ 'Seed Data ID': 'Seed Data – Inactive Bordar Vendor - Tehran' })], 'ai');
    expect(seedPages(bad)[0]).toMatchObject({ valid: false });
    expect(seedLabels(bad, bad.rows[0].cells)).toEqual(['seed_data', 'sd-bordar', 'env-stage']);
  });
});

describe('Seed Data ID numbering', () => {
  it('gives an existing ID the next free number for the same prefix and leaves other prefixes alone', () => {
    const existing = ['SD-BORDAR-VENDOR-ACTIVE-001', 'SD-BORDAR-VENDOR-INACTIVE-001'];
    const { table: out, renamed } = assignFreeIds(table, existing);
    expect(renamed).toEqual([{ from: 'SD-BORDAR-VENDOR-INACTIVE-001', to: 'SD-BORDAR-VENDOR-INACTIVE-002' }]);
    expect(seedPages(out).map((p) => p.title)).toEqual(['SD-BORDAR-VENDOR-INACTIVE-002', 'SD-FP-ORDER-PAID-001']);
  });

  it('numbers duplicates inside the table, skips taken numbers, and keeps the ID of the page being overwritten', () => {
    const twice = tableFromRows(cols, [seedCells(), seedCells()], 'ai');
    const { table: out } = assignFreeIds(twice, ['SD-BORDAR-VENDOR-INACTIVE-002']);
    expect(seedPages(out).map((p) => p.title)).toEqual(['SD-BORDAR-VENDOR-INACTIVE-001', 'SD-BORDAR-VENDOR-INACTIVE-003']);
    const kept = assignFreeIds(tableFromRows(cols, [seedCells()], 'ai'), ['SD-BORDAR-VENDOR-INACTIVE-001'], 'SD-BORDAR-VENDOR-INACTIVE-001');
    expect(kept.renamed).toEqual([]);
  });
});

describe('preview', () => {
  it('shows Page Properties and links like Confluence, and placeholders for other macros, without scripts', () => {
    const doc = previewDocument(
      '<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table><tr><th>Owner</th><td><ac:link><ri:user ri:userkey="x" /></ac:link></td></tr></table></ac:rich-text-body></ac:structured-macro>' +
        '<p><ac:link><ri:page ri:content-title="SD-BIKEREXP-BIKER-ACTIVE-FREE-001" /></ac:link></p><ac:structured-macro ac:name="code">x</ac:structured-macro>',
    );
    expect(doc).toContain('<div class="page-properties"><table><tr><th>Owner</th><td><span class="ac">@user</span></td></tr></table></div>');
    expect(doc).toContain('<a>SD-BIKEREXP-BIKER-ACTIVE-FREE-001</a>');
    expect(doc).toContain('[Confluence macro]');
    expect(doc).not.toContain('<script');
  });
});
