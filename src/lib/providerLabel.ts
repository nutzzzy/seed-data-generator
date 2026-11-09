import type { Settings } from './types';

export function providerLabel(s: Settings): string {
  if (s.provider === 'claude-code') return `Claude Code${s.claudeCodeModel ? ` · ${s.claudeCodeModel}` : ''}`;
  if (s.provider === 'anthropic') return `Claude · ${s.anthropicModel}`;
  if (s.provider === 'ollama') return `Ollama · ${s.ollamaModel}`;
  if (s.provider === 'agent') return s.agentName || 'Agent';
  return 'ساده (آفلاین)';
}
