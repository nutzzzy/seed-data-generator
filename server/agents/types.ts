import type { ProviderRequest } from '../providers.ts';

/** One setting of a provider; drives the Add / Edit agent form. */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'url' | 'select';
  required?: boolean;
  /** Stored encrypted in the SecretStore and never sent back to the browser. */
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
}

export type AgentSettings = Record<string, string>;

export interface ConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

/** What every provider implements. Adding a provider = one more definition in the registry. */
export interface ProviderDefinition {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
  /** Builds the request for this provider; `secrets` holds the decrypted secret fields. */
  generate(req: ProviderRequest, settings: AgentSettings, secrets: AgentSettings): Promise<string>;
  testConnection(settings: AgentSettings, secrets: AgentSettings): Promise<ConnectionResult>;
}

/** A ready-made starting point in the Add Agent form: a provider type with suggested settings. */
export interface AgentTemplate {
  id: string;
  label: string;
  description: string;
  providerType: string;
  /** Suggested agent name. */
  name: string;
  settings: AgentSettings;
}

/** Stored in agents.json (no secrets). */
export interface AgentConfig {
  id: string;
  name: string;
  providerType: string;
  settings: AgentSettings;
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the browser sees: secrets only as set / masked. */
export interface AgentView extends AgentConfig {
  isDefault: boolean;
  secrets: Record<string, { set: boolean; masked: string | null; fromEnv: boolean }>;
}
