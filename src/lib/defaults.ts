import type { ColumnDef, Settings, Standard, Template, Workspace } from './types';

export const EPOCH = '2026-01-01T00:00:00.000Z';

/**
 * Bump when the built-in guide (standard or template below) changes. Stored workspaces with an older version get
 * the new preset content and switch back to it as the active standard and table structure.
 */
export const GUIDE_VERSION = 3;

export const defaultSettings: Settings = {
  provider: 'claude-code',
  claudeCodeModel: '',
  anthropicModel: 'claude-opus-5-5',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  timeoutSeconds: 120,
};

// --- QA Seed Data preset: the team's "QA Seed Data Guide" (v4) as a standard + table template ---------------------
// Source: .claude/skills/qa-seed-data/SKILL.md and the Confluence page QA Seed Data (QC / 247858019).

const SENSITIVE = 'password, passwd, token, secret, api key, apikey, otp, رمز';

/** Domain codes of the guide: code -> name of the Domain page under "QA Seed Data". */
export const DOMAIN_CODES: Record<string, string> = { FP: 'Food Partner', BORDAR: 'Bordar', BIKEREXP: 'Biker Experience' };

export const seedDataStandard: Standard = {
  id: 'std_qa_seed_data',
  name: 'QA Seed Data (Confluence)',
  description:
    'QA Seed Data Guide v4: reusable test data, one Confluence page per Seed Data (title = Seed Data ID), referenced from Zephyr test cases. Test Case says what to test; Seed Data says which data to test with.',
  rules: [
    'A row is one Seed Data (one Confluence page): a piece of test data in a specific state, never a test scenario, test step or acceptance criterion. Steps and expected results belong in Zephyr.',
    'Create a row only for data used by several test cases, data that is complex or slow to create, data that must be in a specific state, or data several QAs share. Simple data for one test case stays in Zephyr: add an issue instead of a row.',
    'Seed Data ID is SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] in uppercase (letters, digits, hyphens), e.g. SD-FP-VENDOR-ACTIVE-001, SD-BORDAR-VENDOR-INACTIVE-001, SD-BIKEREXP-BIKER-ACTIVE-FREE-001. The ID is also the Confluence page title, so never use a description as the ID.',
    `DOMAIN is the owning team's Domain Code: ${Object.entries(DOMAIN_CODES)
      .map(([code, name]) => `${code} (${name})`)
      .join(', ')}. Take it from the request or from the Domain page the documentation is under; write "Not specified" and add an issue when it cannot be determined.`,
    'NNN is the next free three-digit number for the same SD-[DOMAIN]-[ENTITY]-[STATE] prefix among the existing Seed Data IDs given in the source (001 when there is none). Never reuse an existing ID unless you are updating that same Seed Data.',
    'Name is short and clear, e.g. "Inactive Bordar Vendor - Tehran".',
    'Domain is the Domain Code only (e.g. BORDAR).',
    'Owner and Last Verified ("YYYY-MM-DD - name") only when the source gives them; otherwise "Not specified".',
    'Environment is exactly stage or UAT, only when the source says so. Never production: if the source asks for production, write "Not specified" and add an issue.',
    'Seed Status is Active, Broken or Deprecated (Active for new, healthy data). Usage Mode is Shared (tests do not change the data) or Exclusive (tests change the data, e.g. accept an order).',
    'Dependencies lists the Seed Data IDs this data depends on, or "-" when none.',
    'Purpose says what kind of tests the data is for.',
    'Data has one "Field: Value" per line: only fields that affect the tests, the explicit status of every entity (e.g. "Vendor Status: Inactive"), internal codes with their meaning (e.g. "C (FREE)"), City in English with City ID (e.g. "Tehran (City ID: 1)"). No null or irrelevant fields.',
    'Preconditions: one condition per line, all conditions the service needs (status, open, service enabled, area, role, app version…), no steps.',
    'How to Create / Verify: numbered steps to create the data (with the API request or query when given), or, when the data already exists, how to verify it and how to recreate it. No test steps: the data must end exactly as in Data.',
    'Reset / Cleanup: how to return the data to the Data state after a test; required when Usage Mode is Exclusive, "-" when Shared.',
    'Used By: the Zephyr keys of the test cases (e.g. "BOR-T67 …"), one per line; "Not specified" when the source gives no keys.',
    'Fill every field only from the source. When the source does not give a value, write exactly "Not specified" and add an issue naming the missing information. Never guess IDs, environments, statuses, owners or test cases.',
    'Never record passwords, tokens, secrets, API keys, OTP values, real customer / vendor / biker data or personal mobile numbers. A test-account mobile number only when the source says it is an organisational test SIM, and say so. If the source contains such data, leave it out and add an issue.',
    'Write Purpose, Preconditions, How to Create / Verify and Reset / Cleanup in the language of the source; keep field names, IDs, statuses and environment names in English.',
  ].join('\n'),
  requiredContent: 'Every entity and state the source needs for testing gets its own Seed Data row (e.g. active vendor, inactive vendor, pending / paid order).',
  validationCriteria: [
    'Seed Data ID follows SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN], is unique and does not collide with an existing ID.',
    'Name, Domain, Environment (stage or UAT), Seed Status, Usage Mode and Purpose are filled in.',
    'Data has the status of every entity.',
    'How to Create / Verify is filled and contains no test steps; Reset / Cleanup is filled for Exclusive data.',
    'No sensitive information is recorded.',
    'Existing Seed Data was searched first, so this one is not a duplicate.',
  ].join('\n'),
  examples: [
    'Example (from the guide; page title = Seed Data ID):',
    'Seed Data ID: SD-FP-VENDOR-ACTIVE-001',
    'Name: Active Vendor - Tehran',
    'Domain: FP',
    'Owner: Not specified',
    'Environment: UAT',
    'Seed Status: Active',
    'Usage Mode: Shared',
    'Last Verified: Not specified',
    'Dependencies: -',
    'Purpose: برای تست سناریوهایی که نیاز به یک Vendor فعال در Food Partner دارند.',
    'Data:\n  Vendor ID: 100977\n  Vendor Name: QA Vendor 01\n  Vendor Status: Active\n  City: Tehran (City ID: 1)\n  Vendor Type: Restaurant\n  Panel Username: qa.vendor01 (حساب تستی)',
    'Preconditions:\n  Vendor Status برابر Active باشد.\n  Vendor در ساعت کاری و در وضعیت باز باشد.',
    'How to Create / Verify:\n  1. داده از قبل وجود دارد. در پنل Vendor Management، Vendor ID 100977 را جستجو کنید و Status و ساعت کاری را چک کنید.\n  2. ساخت مجدد: یک Vendor از نوع Restaurant در تهران بسازید، فعال کنید و ID جدید را در جدول Data ثبت کنید.',
    'Reset / Cleanup: -',
    'Used By:\n  FP-T101 Vendor Login\n  FP-T102 Vendor Dashboard\n  FP-T123 Vendor can accept pending order',
  ].join('\n'),
  updatedAt: EPOCH,
};

const seedColumn = (id: string, name: string, patch: Partial<ColumnDef>): ColumnDef => ({
  id,
  name,
  description: '',
  required: true,
  expected: '',
  allowedValues: '',
  pattern: '',
  maxLength: null,
  unique: false,
  forbidden: '',
  ...patch,
});

/** The guide's ID format: SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] (STATE may have several parts). */
export const SEED_ID_PATTERN = '^SD-[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)+-\\d{3}$';

export const seedDataTemplate: Template = {
  id: 'tpl_qa_seed_data',
  name: 'QA Seed Data table',
  columns: [
    seedColumn('col_sd_id', 'Seed Data ID', {
      description: 'Identifier and Confluence page title; the reference used in Zephyr test cases',
      expected: 'SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN], e.g. SD-BORDAR-VENDOR-INACTIVE-001',
      pattern: SEED_ID_PATTERN,
      unique: true,
    }),
    seedColumn('col_sd_name', 'Name', { description: 'Short, clear name', expected: 'e.g. Inactive Bordar Vendor - Tehran', maxLength: 80 }),
    seedColumn('col_sd_domain', 'Domain', { description: 'Domain Code of the owning team', expected: Object.keys(DOMAIN_CODES).join(', '), pattern: '^[A-Z0-9]+$' }),
    seedColumn('col_sd_owner', 'Owner', { description: 'Person who maintains the data' }),
    seedColumn('col_sd_env', 'Environment', { description: 'Where the data exists (never production)', allowedValues: 'stage, UAT' }),
    seedColumn('col_sd_status', 'Seed Status', { description: 'Health of the Seed Data', allowedValues: 'Active, Broken, Deprecated' }),
    seedColumn('col_sd_usage', 'Usage Mode', { description: 'Shared: tests do not change the data; Exclusive: they do', allowedValues: 'Shared, Exclusive' }),
    seedColumn('col_sd_verified', 'Last Verified', { description: 'Last health check', expected: 'YYYY-MM-DD - name' }),
    seedColumn('col_sd_deps', 'Dependencies', { description: 'Seed Data IDs this one depends on, or -', required: false }),
    seedColumn('col_sd_purpose', 'Purpose', { description: 'What kind of tests this data is for' }),
    seedColumn('col_sd_data', 'Data', {
      description: 'Main data, one "Field: Value" per line',
      expected: 'one "Field: Value" per line including the status of every entity, e.g. Vendor Status: Inactive',
      pattern: '[Ss]tatus\\s*[:=]',
      forbidden: SENSITIVE,
    }),
    seedColumn('col_sd_pre', 'Preconditions', { description: 'What must be true before using the data', forbidden: SENSITIVE }),
    seedColumn('col_sd_how', 'How to Create / Verify', {
      description: 'Steps to create the data, or how to verify and recreate existing data',
      expected: 'Numbered steps, no test steps',
      forbidden: SENSITIVE,
    }),
    seedColumn('col_sd_reset', 'Reset / Cleanup', { description: 'Required for Exclusive data; - for Shared', required: false, forbidden: SENSITIVE }),
    seedColumn('col_sd_used', 'Used By', { description: 'Zephyr keys of the test cases that use this Seed Data' }),
  ],
  updatedAt: EPOCH,
};

export const seedDataInput = `Food Partner – داده‌های موردنیاز تست در محیط UAT

- یک Vendor فعال برای تست Vendor Login، Vendor Dashboard، Order Management و Menu Management.
  Vendor ID: 100977، Vendor Name: QA Vendor 01، City: Tehran، Type: Restaurant
- یک Vendor غیرفعال برای بررسی اینکه Login آن مسدود می‌شود. هنوز ساخته نشده است.
- یک Order پرداخت‌شده از نوع Delivery برای Vendor 100977. Order ID در هر اجرا تغییر می‌کند و Payment موفق است.
  روش ساخت: یک Order برای Vendor ثبت کنید، پرداخت را انجام دهید و وضعیت Order را بررسی کنید.
  استفاده در: Vendor can accept pending order و تست‌های Order Management
- یک Order در وضعیت Pending برای Vendor 100977 تا Vendor بتواند آن را Accept یا Reject کند.
- Customer ID: 1258 فقط برای تست Customer can view order history`;

/** Built-in presets. They are added once to every workspace, including ones saved by an older version. */
export const presetStandards: Standard[] = [seedDataStandard];
export const presetTemplates: Template[] = [seedDataTemplate];
export const presetIds = () => [...presetStandards, ...presetTemplates].map((p) => p.id);

export function defaultWorkspace(): Workspace {
  return {
    version: 1,
    standards: structuredClone(presetStandards),
    templates: structuredClone(presetTemplates),
    savedTables: [],
    standardDraft: structuredClone(seedDataStandard),
    templateDraft: structuredClone(seedDataTemplate),
    input: seedDataInput,
    table: null,
    settings: { ...defaultSettings },
    presets: presetIds(),
    guideVersion: GUIDE_VERSION,
  };
}
