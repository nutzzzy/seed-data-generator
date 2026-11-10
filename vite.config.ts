/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createAgentRuntime, type AgentRuntime } from './server/agents/runtime.ts';
import { agentsPlugin } from './server/agentsPlugin.ts';
import { aiPlugin } from './server/aiPlugin.ts';
import { confluencePlugin } from './server/confluencePlugin.ts';
import { seedWorkflowPlugin } from './server/seedWorkflowPlugin.ts';

// A fixed port keeps the browser origin stable, so locally stored work is found again after a restart.
const PORT = 5173;

export default defineConfig(({ mode }) => {
  // Load every variable from .env files for the server only (no VITE_ prefix => never exposed to the browser).
  const env = loadEnv(mode, process.cwd(), '');
  if (env.CLAUDE_CODE_PATH) process.env.CLAUDE_CODE_PATH = env.CLAUDE_CODE_PATH;
  // Agent configs and encrypted secrets live in .data/ (or SEED_DATA_DIR); created on the first request that needs them.
  let runtime: AgentRuntime | undefined;
  const getRuntime = () =>
    (runtime ??= createAgentRuntime({
      dataDir: env.SEED_DATA_DIR || undefined,
      secretKey: env.SEED_SECRET_KEY || undefined,
      anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
      confluenceEnv: { baseUrl: env.CONFLUENCE_BASE_URL || 'https://confluence.snappfood.ir', token: env.CONFLUENCE_TOKEN || undefined },
    }));
  return {
    plugins: [
      react(),
      aiPlugin({ anthropicApiKey: env.ANTHROPIC_API_KEY || undefined, runtime: getRuntime }),
      agentsPlugin(getRuntime),
      confluencePlugin({ store: () => getRuntime().confluence }),
      seedWorkflowPlugin(() => getRuntime().jobs),
    ],
    server: { port: PORT, strictPort: true },
    preview: { port: PORT, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // UI flows (modal, full app) can exceed the default 5 s when the whole suite runs in parallel.
      testTimeout: 15_000,
    },
  };
});
