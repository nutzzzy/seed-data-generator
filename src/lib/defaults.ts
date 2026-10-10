import type { ColumnDef, Settings, Standard, Template, Workspace } from './types';

export const EPOCH = '2026-01-01T00:00:00.000Z';

/**
 * Bump when the built-in guide (standard or template below) changes. Stored workspaces with an older version get
 * the new preset content and switch back to it as the active standard and table structure.
 */
export const GUIDE_VERSION = 2;

export const defaultSettings: Settings = {
  provider: 'claude-code',
  claudeCodeModel: '',
  anthropicModel: 'claude-opus-5-5',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  timeoutSeconds: 120,
};

// --- QA Seed Data preset: the team's "QA Seed Data Guide" as a standard + table template ---------------------

const SENSITIVE = 'password, passwd, token, secret, api key, apikey, رمز';

export const seedDataStandard: Standard = {
  id: 'std_qa_seed_data',
  name: 'QA Seed Data (Confluence)',
  description:
    'Reusable test data defined once in Confluence and referenced from Zephyr test cases. Test Case says what to test; Seed Data says which data to test with.',
  rules: [
    'A row is a Seed Data (a piece of test data in a specific state), never a test scenario, test step or acceptance criterion. Do not write Given/When/Then, steps to test or expected results: those belong in Zephyr.',
    'One row per Seed Data: data used by several test cases or features, data that is complex or slow to create, data that must be in a specific state, or data several QAs share.',
    'Simple data used by only one test case stays in Zephyr as Test Data: do not create a row for it; add an issue saying it should be kept in Zephyr.',
    'A combined setup (e.g. Vendor + Store + Active Menu + Pending Order + Successful Payment) is one Seed Data, not several.',
    'Seed Data ID follows SD-[ENTITY]-[DESCRIPTION]-[NUMBER] in uppercase, e.g. SD-VENDOR-ACTIVE-001, SD-ORDER-PAID-001. Numbers start at 001 per entity and description. Use the ID from the source when it gives one.',
    'Name is short and clear, e.g. "Paid Order - Active Vendor".',
    'Environment is exactly stage, UAT or production, and only when the source says so.',
    'Data has one "Field: Value" per line with the main fields (IDs, name, type, city, payment…) and always the entity status, e.g. "Order Status: Pending". Write "Dynamic" only when the source says the value changes per run.',
    'Preconditions: one condition per line, e.g. "Vendor must be Active".',
    'How to Create: numbered steps; include the API request or query when the source gives one.',
    'Used For lists the test cases or features that can use this Seed Data, comma-separated, exactly as the source names them.',
    'Fill every field only from the source. When the source does not give a value, write exactly "Not specified" and add an issue naming the missing information. Never guess IDs, environments, statuses or test cases.',
    'An entity the source says is not created yet keeps its real status in Data (e.g. "Status: Inactive") and gets an issue saying it must be created first; IDs it does not have yet are "Not specified".',
    'Never record passwords, tokens, secrets or real customer data. If the source contains them, leave them out and add an issue.',
    'Write Purpose, Preconditions and How to Create in the language of the source; keep field names, IDs, statuses and environment names in English.',
    'A QA who did not create the data must understand what it is and which tests it is for.',
  ].join('\n'),
  requiredContent:
    'Every entity and state the source needs for testing gets a Seed Data row (e.g. active vendor, inactive vendor, pending / paid / delivered order).',
  validationCriteria: [
    'Seed Data ID, Name, Purpose and Environment are filled in.',
    'The main data and its status are recorded.',
    'Preconditions and How to Create are written where needed.',
    'No sensitive information is recorded.',
    'It is clear which test cases can use the Seed Data.',
    'Existing Seed Data was searched first, so this one is not a duplicate.',
  ].join('\n'),
  examples: [
    'Example 1 (from the guide):',
    'Seed Data ID: SD-VENDOR-ACTIVE-001',
    'Name: Active Vendor',
    'Purpose: برای تست سناریوهایی که نیاز به یک Vendor فعال در Food Partner دارند.',
    'Environment: UAT',
    'Data:\n  Vendor ID: 100977\n  Vendor Name: QA Vendor 01\n  Status: Active\n  City: Tehran\n  Type: Restaurant',
    'Preconditions: Vendor must be Active.',
    'How to Create: Not specified',
    'Used For: Vendor Login, Vendor Dashboard, Order Management, Menu Management, Delivery Management',
    '',
    'Example 2 (from the guide):',
    'Seed Data ID: SD-ORDER-PAID-001',
    'Name: Paid Order - Active Vendor',
    'Purpose: برای تست سناریوهای مرتبط با Order پرداخت‌شده در Food Partner.',
    'Environment: Not specified (the source must name stage, UAT or production)',
    'Data:\n  Vendor ID: 100977\n  Vendor Status: Active\n  Order ID: Dynamic\n  Order Status: Paid\n  Payment Status: Successful\n  Order Type: Delivery',
    'Preconditions:\n  Vendor must be Active.\n  Order must exist.\n  Payment must be Successful.',
    'How to Create:\n  1. یک Vendor فعال ایجاد کنید.\n  2. یک Order برای Vendor ایجاد کنید.\n  3. Payment را انجام دهید.\n  4. وضعیت Order را بررسی کنید.\n  5. اطلاعات نهایی را در Seed Data ثبت کنید.',
    'Used For: Not specified',
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

export const seedDataTemplate: Template = {
  id: 'tpl_qa_seed_data',
  name: 'QA Seed Data table',
  columns: [
    seedColumn('col_sd_id', 'Seed Data ID', {
      description: 'Identifier used as the reference in Zephyr test cases',
      expected: 'SD-[ENTITY]-[DESCRIPTION]-[NUMBER], e.g. SD-ORDER-PENDING-001',
      pattern: '^SD-[A-Z0-9]+(-[A-Z0-9]+)*-\\d{3}$',
      unique: true,
    }),
    seedColumn('col_sd_name', 'Name', { description: 'Short, clear name', expected: 'e.g. Paid Order - Active Vendor', maxLength: 80 }),
    seedColumn('col_sd_purpose', 'Purpose', { description: 'What kind of tests this data is for' }),
    seedColumn('col_sd_env', 'Environment', { description: 'Where the data exists', allowedValues: 'stage, UAT, production' }),
    seedColumn('col_sd_data', 'Data', {
      description: 'Main data, one "Field: Value" per line',
      expected: 'one "Field: Value" per line including the status, e.g. Order Status: Pending',
      pattern: '[Ss]tatus\\s*[:=]',
      forbidden: SENSITIVE,
    }),
    seedColumn('col_sd_pre', 'Preconditions', { description: 'What must be true before using the data', required: false, forbidden: SENSITIVE }),
    seedColumn('col_sd_how', 'How to Create', {
      description: 'Steps, API request or query to create the data',
      expected: 'Numbered steps',
      required: false,
      forbidden: SENSITIVE,
    }),
    seedColumn('col_sd_used', 'Used For', { description: 'Test cases or features that can use this Seed Data' }),
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
