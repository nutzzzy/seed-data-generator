import type { ColumnDef, Settings, Standard, Template, Workspace } from './types';

// Example content only, so the app is understandable on first launch. Nothing in the app depends on it.

const EPOCH = '2026-01-01T00:00:00.000Z';

export const exampleStandard: Standard = {
  id: 'std_example',
  name: 'Acceptance criteria (Given/When/Then)',
  description: 'Testable acceptance criteria written from the user’s point of view.',
  rules: [
    'Each row describes exactly one testable behaviour.',
    'Given / When / Then are full sentences in the present tense.',
    'Do not mention implementation details (database, API names, UI frameworks).',
    'Priority comes from the source; never guess it.',
  ].join('\n'),
  requiredContent: 'Every scenario mentioned in the source must have a row, including error cases.',
  validationCriteria: 'IDs are unique and follow AC-<number>. Priority is High, Medium or Low.',
  examples:
    'AC-1 | Successful login | Given a registered user is on the login page | When they submit a valid email and password | Then they see their dashboard | High',
  updatedAt: EPOCH,
};

export const exampleTemplate: Template = {
  id: 'tpl_example',
  name: 'Acceptance criteria table',
  columns: [
    {
      id: 'col_ex_id',
      name: 'ID',
      description: 'Unique identifier',
      required: true,
      expected: 'AC-1, AC-2, … in order',
      allowedValues: '',
      pattern: '^AC-\\d+$',
      maxLength: null,
      unique: true,
      forbidden: '',
    },
    {
      id: 'col_ex_scenario',
      name: 'Scenario',
      description: 'Short name of the behaviour',
      required: true,
      expected: 'At most 8 words',
      allowedValues: '',
      pattern: '',
      maxLength: 80,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_given',
      name: 'Given',
      description: 'Starting situation',
      required: true,
      expected: 'Starts with "Given"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_when',
      name: 'When',
      description: 'User action or event',
      required: true,
      expected: 'Starts with "When"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_then',
      name: 'Then',
      description: 'Observable result',
      required: true,
      expected: 'Starts with "Then"',
      allowedValues: '',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
    {
      id: 'col_ex_priority',
      name: 'Priority',
      description: 'Business priority from the source',
      required: false,
      expected: '',
      allowedValues: 'High, Medium, Low',
      pattern: '',
      maxLength: null,
      unique: false,
      forbidden: '',
    },
  ],
  updatedAt: EPOCH,
};

export const exampleInput = `Password reset feature

- A user who forgot their password can request a reset link from the login page by entering their email. (High)
- If the email is not registered, show the same confirmation message so accounts can't be discovered.
- The reset link expires after 30 minutes. Opening an expired link shows an error and offers to send a new link.
- The new password must have at least 12 characters. Priority: Medium`;

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
    'One row per Seed Data: data used by several test cases or features, data that is complex or slow to create, data that must be in a specific state, or data several QAs share.',
    'Simple data used by only one test case stays in Zephyr as Test Data: do not create a row for it; add an issue saying it should be kept in Zephyr.',
    'A combined setup (e.g. Vendor + Store + Active Menu + Pending Order + Successful Payment) is one Seed Data, not several.',
    'Seed Data ID follows SD-[ENTITY]-[DESCRIPTION]-[NUMBER] in uppercase, e.g. SD-VENDOR-ACTIVE-001, SD-ORDER-PAID-001. Numbers start at 001 per entity and description. Use the ID from the source when it gives one.',
    'Name is short and clear, e.g. "Paid Order - Active Vendor".',
    'Environment is exactly stage, UAT or production, and only when the source says so.',
    'Data has one "Field: Value" per line with the main fields (IDs, name, type, city, payment…) and always the entity status, e.g. "Order Status: Pending". Write "Dynamic" only when the source says the value changes per run.',
    'Preconditions: one condition per line, e.g. "Vendor must be Active".',
    'How to Create: numbered steps; include the API request or query when the source gives one.',
    'Used For lists the test cases or features that can use this Seed Data.',
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
    'Seed Data ID: SD-VENDOR-ACTIVE-001',
    'Name: Active Vendor',
    'Purpose: برای تست سناریوهایی که نیاز به یک Vendor فعال در Food Partner دارند.',
    'Environment: UAT',
    'Data: Vendor ID: 100977 / Vendor Name: QA Vendor 01 / Status: Active / City: Tehran / Type: Restaurant (one field per line)',
    'Preconditions: Vendor must be Active.',
    'Used For: Vendor Login, Vendor Dashboard, Order Management, Menu Management, Delivery Management',
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
export const presetStandards: Standard[] = [seedDataStandard, exampleStandard];
export const presetTemplates: Template[] = [seedDataTemplate, exampleTemplate];
export const presetIds = () => [...presetStandards, ...presetTemplates].map((p) => p.id);

/** The example input that fits a template, for the "Use example" button. */
export function exampleInputFor(templateId: string): string {
  return templateId === exampleTemplate.id ? exampleInput : seedDataInput;
}

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
  };
}
