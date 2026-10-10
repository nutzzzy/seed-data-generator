/** The text used everywhere for information that the source input does not contain. */
export const NOT_SPECIFIED = 'Not specified';

export interface Standard {
  id: string;
  name: string;
  description: string;
  /** Free-text rules and constraints, one per line. */
  rules: string;
  requiredContent: string;
  validationCriteria: string;
  examples: string;
  updatedAt: string;
}

export interface ColumnDef {
  id: string;
  name: string;
  description: string;
  required: boolean;
  /** Free-text guidance about what the column should contain. */
  expected: string;
  /** Optional deterministic rules, checked by the validator. */
  allowedValues: string;
  pattern: string;
  maxLength: number | null;
  unique: boolean;
}

export interface Template {
  id: string;
  name: string;
  columns: ColumnDef[];
  updatedAt: string;
}

export interface TableRow {
  id: string;
  /** Cell values keyed by column id. */
  cells: Record<string, string>;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
  /** Zero-based row index, when the issue belongs to one row. */
  row?: number;
  /** Column id, when the issue belongs to one column. */
  columnId?: string;
}

export type GenerationSource = 'ai' | 'basic' | 'manual';

export interface GeneratedTable {
  /** The table keeps its own copy of the columns, so editing it never changes the saved template. */
  columns: ColumnDef[];
  rows: TableRow[];
  source: GenerationSource;
  generatedAt: string;
  /** Points flagged for review by the generator (e.g. missing information). */
  notes: Issue[];
}

export interface SavedTable {
  id: string;
  name: string;
  table: GeneratedTable;
  savedAt: string;
}

export type ProviderId = 'basic' | 'claude-code' | 'anthropic' | 'ollama';

export interface Settings {
  provider: ProviderId;
  /** Empty = the model Claude Code uses by default. */
  claudeCodeModel: string;
  anthropicModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  timeoutSeconds: number;
}

export interface Workspace {
  version: 1;
  standards: Standard[];
  templates: Template[];
  savedTables: SavedTable[];
  /** Working copies being edited; saved into the lists only when the user clicks Save. */
  standardDraft: Standard;
  templateDraft: Template;
  input: string;
  table: GeneratedTable | null;
  settings: Settings;
}
