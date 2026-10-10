import { NOT_SPECIFIED, type ColumnDef, type Standard } from './types';

export interface GenerationPrompt {
  system: string;
  user: string;
  /** JSON schema the model's answer must follow. */
  schema: Record<string, unknown>;
}

const SYSTEM = `You turn source material into rows of a table.
Follow the standard and the column definitions you are given.
Use only information that is present in the source input. Do not invent facts, names, numbers or priorities.
When a value for a column is not in the source, write exactly "${NOT_SPECIFIED}" and add an entry to "issues" explaining what is missing.
Also add an entry to "issues" when something in the source is ambiguous or contradictory.
Use the column names exactly as given, in the given order. Answer with JSON only.`;

function columnSpec(c: ColumnDef) {
  const spec: Record<string, unknown> = { name: c.name.trim(), required: c.required };
  if (c.description.trim()) spec.description = c.description.trim();
  if (c.expected.trim()) spec.expected = c.expected.trim();
  if (c.allowedValues.trim()) spec.allowed_values = c.allowedValues.trim();
  if (c.pattern.trim()) spec.regex = c.pattern.trim();
  if (c.maxLength) spec.max_length = c.maxLength;
  if (c.unique) spec.unique = true;
  return spec;
}

function standardSpec(s: Standard) {
  const parts: [string, string][] = [
    ['name', s.name],
    ['description', s.description],
    ['rules', s.rules],
    ['required_content', s.requiredContent],
    ['validation_criteria', s.validationCriteria],
    ['examples_of_correct_output', s.examples],
  ];
  return parts
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `<${k}>\n${v.trim()}\n</${k}>`)
    .join('\n');
}

/** Builds a compact prompt containing only what this generation needs. */
export function buildPrompt(standard: Standard, columns: ColumnDef[], input: string): GenerationPrompt {
  const names = columns.map((c) => c.name.trim());
  const user = [
    `<standard>\n${standardSpec(standard)}\n</standard>`,
    `<columns>\n${JSON.stringify(columns.map(columnSpec), null, 1)}\n</columns>`,
    `<source_input>\n${input.trim()}\n</source_input>`,
    `Return {"rows": [...], "issues": [...]}. Each row is an object with exactly these keys: ${JSON.stringify(names)}. ` +
      `"issues" items are {"row": <1-based row number or 0 for the whole table>, "column": <column name or "">, "message": <text>}.`,
  ].join('\n\n');

  const schema = {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.fromEntries(columns.map((c) => [c.name.trim(), { type: 'string' }])),
          required: names,
          additionalProperties: false,
        },
      },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: { row: { type: 'integer' }, column: { type: 'string' }, message: { type: 'string' } },
          required: ['row', 'column', 'message'],
          additionalProperties: false,
        },
      },
    },
    required: ['rows', 'issues'],
    additionalProperties: false,
  };

  return { system: SYSTEM, user, schema };
}
