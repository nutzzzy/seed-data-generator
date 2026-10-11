/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiPlugin } from './server/aiPlugin.ts';
import { confluencePlugin } from './server/confluencePlugin.ts';

// A fixed port keeps the browser origin stable, so locally stored work is found again after a restart.
const PORT = 5173;

export default defineConfig(({ mode }) => {
  // Load every variable from .env files for the server only (no VITE_ prefix => never exposed to the browser).
  const env = loadEnv(mode, process.cwd(), '');
  if (env.CLAUDE_CODE_PATH) process.env.CLAUDE_CODE_PATH = env.CLAUDE_CODE_PATH;
  return {
    plugins: [
      react(),
      aiPlugin({ anthropicApiKey: env.ANTHROPIC_API_KEY || undefined }),
      confluencePlugin({ baseUrl: env.CONFLUENCE_BASE_URL || 'https://confluence.snappfood.ir', token: env.CONFLUENCE_TOKEN || undefined }),
    ],
    server: { port: PORT, strictPort: true },
    preview: { port: PORT, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
