// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAIN_CODES, seedDataStandard, seedDataTemplate } from '../src/lib/defaults.ts';
import { SEED_FIELDS } from '../src/lib/seedData.ts';
import { domainCodes, referencePageIds } from './seedWorkflow/skill.ts';

const cols = seedDataTemplate.columns;

describe('project Skill and the built-in guide', () => {
  const skill = readFileSync(join(process.cwd(), '.claude', 'skills', 'qa-seed-data', 'SKILL.md'), 'utf8');

  it('name the same Seed Data fields, naming convention, domains and environments, so generation rules cannot drift apart', () => {
    for (const field of Object.values(SEED_FIELDS)) {
      expect(skill).toContain(field);
      expect(cols.map((c) => c.name)).toContain(field);
    }
    expect(skill).toContain('SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN]');
    expect(seedDataStandard.rules).toContain('SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN]');
    expect(domainCodes(skill)).toEqual(DOMAIN_CODES);
    expect(cols.find((c) => c.name === 'Environment')!.allowedValues).toBe('stage, UAT');
    expect(skill).toMatch(/Never on `production`/);
    const pattern = new RegExp(cols.find((c) => c.name === 'Seed Data ID')!.pattern);
    for (const ok of ['SD-FP-VENDOR-ACTIVE-001', 'SD-BORDAR-VENDOR-INACTIVE-002', 'SD-BIKEREXP-BIKER-ACTIVE-FREE-001']) expect(pattern.test(ok)).toBe(true);
    for (const bad of ['SD-VENDOR-001', 'Seed Data – Inactive Bordar Vendor - Tehran', 'SD-BORDAR-VENDOR-INACTIVE-2']) expect(pattern.test(bad)).toBe(false);
  });

  it('lists the QA Seed Data guide page as a reference page, so it is never compared as existing Seed Data', () => {
    expect([...referencePageIds(skill)]).toEqual(['247858019']);
  });
});
