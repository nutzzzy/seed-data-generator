import { join } from 'node:path';
import { ConfluenceCredentialStore } from '../confluence/credentials.ts';
import { useNetworkRouter } from '../network/httpClient.ts';
import { createRoutingProvider } from '../network/index.ts';
import { NetworkRouter } from '../network/router.ts';
import { resolveDataDir, SecretStore } from '../secretStore.ts';
import { SeedJobService } from '../seedWorkflow/jobs.ts';
import { AgentService } from './agentService.ts';
import { createRegistry } from './registry.ts';
import type { ProviderDefinition } from './types.ts';

export interface AgentRuntime {
  registry: Map<string, ProviderDefinition>;
  agents: AgentService;
  secrets: SecretStore;
  confluence: ConfluenceCredentialStore;
  jobs: SeedJobService;
  /** Per-request network paths ("Use VPN for Agent Requests"). */
  network: NetworkRouter;
}

export interface RuntimeOptions {
  dataDir?: string;
  /** SEED_SECRET_KEY: base64 32-byte key; otherwise a key file is generated in the data dir. */
  secretKey?: string;
  anthropicApiKey?: string;
  /** CONFLUENCE_BASE_URL / CONFLUENCE_TOKEN from .env.local: the fallback when no token is saved in the app. */
  confluenceEnv?: { baseUrl: string; token?: string };
  /** The project Skill used for generation. */
  skillPath?: string;
}

/** Builds the services shared by the local API plugins. Nothing touches the disk until the first request. */
export function createAgentRuntime(options: RuntimeOptions = {}): AgentRuntime {
  const dir = options.dataDir ?? resolveDataDir();
  const registry = createRegistry({ anthropicApiKey: options.anthropicApiKey });
  const secrets = new SecretStore(dir, options.secretKey || undefined);
  const anthropicEnv = Boolean(options.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const network = new NetworkRouter(dir, createRoutingProvider());
  useNetworkRouter(network);
  const agents = new AgentService(dir, registry, secrets, new Set(anthropicEnv ? ['anthropic'] : []), network);
  const confluence = new ConfluenceCredentialStore(dir, secrets, options.confluenceEnv ?? { baseUrl: 'https://confluence.snappfood.ir' });
  const jobs = new SeedJobService({
    agents,
    confluence,
    skillPath: options.skillPath ?? join(process.cwd(), '.claude', 'skills', 'qa-seed-data', 'SKILL.md'),
  });
  return { registry, agents, secrets, confluence, jobs, network };
}
