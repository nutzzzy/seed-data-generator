import { seedDataTemplate } from '../lib/defaults';

/** A complete Seed Data following guide v4, by field name (as an agent would answer). */
export const SEED_ROW: Record<string, string> = {
  'Seed Data ID': 'SD-BORDAR-VENDOR-INACTIVE-001',
  Name: 'Inactive Bordar Vendor - Tehran',
  Domain: 'BORDAR',
  Owner: 'Not specified',
  Environment: 'stage',
  'Seed Status': 'Active',
  'Usage Mode': 'Shared',
  'Last Verified': 'Not specified',
  Dependencies: '-',
  Purpose: 'برای تست رفتار پنل بردار با Vendor غیرفعال.',
  Data: 'Vendor ID: 31756\nVendor Status: Inactive\nCity: Tehran (City ID: 1)',
  Preconditions: 'Vendor Status برابر Inactive باشد.\nکاربر پنل با نقش ROLE_MANAGER لاگین کرده باشد.',
  'How to Create / Verify': '1. در پنل بردار Vendor 31756 را جستجو کنید.\n2. بررسی کنید Status برابر Inactive است.',
  'Reset / Cleanup': '-',
  'Used By': 'BOR-T12 Inactive vendor cannot request a courier',
};

/** The same Seed Data as cells keyed by the guide template's column ids. */
export function seedCells(patch: Record<string, string> = {}): Record<string, string> {
  const byName = { ...SEED_ROW, ...patch };
  return Object.fromEntries(seedDataTemplate.columns.map((c) => [c.id, byName[c.name] ?? '']));
}

export const colId = (name: string) => seedDataTemplate.columns.find((c) => c.name === name)!.id;
