import Anthropic from '@anthropic-ai/sdk';
import { CODEX, CURSOR, cliVersion, GEMINI, generateWithCodex, generateWithCursor, generateWithGemini, resolveBin, type CliRequest, type CliSpec } from '../cliAgents.ts';
import { generateWithOpenAiCompatible, listOpenAiModels, type ResponseFormat } from '../openaiCompatible.ts';
import { agentHttp } from '../network/httpClient.ts';
import { anthropicFetch, claudeCodeVersion, generateWithAnthropic, generateWithClaudeCode, generateWithOllama, ProviderError } from '../providers.ts';
import type { AgentTemplate, ConnectionResult, FieldSpec, ProviderDefinition } from './types.ts';

export interface RegistryOptions {
  /** ANTHROPIC_API_KEY from .env.local; used when an Anthropic agent has no key of its own. */
  anthropicApiKey?: string;
}

export function checkHttpUrl(value: string | undefined, label: string): string {
  let url: URL;
  try {
    url = new URL((value ?? '').trim());
  } catch {
    throw new ProviderError(400, `آدرس ${label} معتبر نیست.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProviderError(400, `آدرس ${label} باید با http:// یا https:// شروع شود.`);
  return url.toString();
}

export const MISSING_ANTHROPIC_KEY =
  'برای این Agent کلید Anthropic API تنظیم نشده است. در «تنظیمات» ← ویرایش همین Agent کلید API را وارد کنید (یا ANTHROPIC_API_KEY را در .env.local بگذارید)، یا Agent دیگری مثل Claude Code انتخاب کنید.';

const fail = (err: unknown): ConnectionResult => ({ ok: false, message: err instanceof Error ? err.message : String(err) });

/** A coding-agent CLI (Codex, Cursor, Gemini) as a provider: its login or an optional key, read-only, no project files. */
function cliProvider(
  type: string,
  spec: CliSpec,
  description: string,
  modelHelp: string,
  generate: (req: CliRequest) => Promise<string>,
  versionArgs: string[] = ['--version'],
): ProviderDefinition {
  const fields: FieldSpec[] = [
    { key: 'model', label: 'مدل', type: 'text', placeholder: `پیش‌فرض ${spec.label}`, help: modelHelp },
    { key: 'apiKey', label: 'کلید API', type: 'text', secret: true, help: `اختیاری؛ خالی = حسابی که با «${spec.loginHint}» وارد شده‌اید` },
    { key: 'cliPath', label: 'مسیر فایل اجرایی', type: 'text', placeholder: spec.names[0], help: `اختیاری؛ وقتی ${spec.names[0]} در PATH نیست` },
  ];
  return {
    type,
    label: spec.label,
    description,
    fields,
    generate: (req, s, secrets) => generate({ ...req, model: (s.model ?? '').trim(), bin: s.cliPath || undefined, apiKey: secrets.apiKey || undefined }),
    async testConnection(s, secrets) {
      const bin = resolveBin(spec, s.cliPath);
      const version = await cliVersion(bin, versionArgs);
      if (!version) return { ok: false, message: `${spec.label} پیدا نشد (${bin}). آن را نصب کنید یا مسیر فایل اجرایی را وارد کنید.` };
      const auth = secrets.apiKey ? 'کلید API ذخیره‌شده استفاده می‌شود.' : `اگر وارد حساب نشده‌اید، یک بار «${spec.loginHint}» را در ترمینال اجرا کنید.`;
      return { ok: true, message: `${spec.label} پیدا شد (${version}). ${auth}` };
    },
  };
}

/** Ready-made starting points shown in the Add Agent form. */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  { id: 'claude-code', label: 'Claude Code', description: 'CLI؛ حساب Claude Code همین سیستم', providerType: 'claude-code', name: 'Claude Code', settings: {} },
  { id: 'codex', label: 'Codex', description: 'CLI؛ OpenAI Codex با حساب ChatGPT یا کلید API', providerType: 'codex-cli', name: 'Codex', settings: {} },
  { id: 'cursor', label: 'Cursor', description: 'CLI؛ Cursor Agent با حساب Cursor یا کلید API', providerType: 'cursor-cli', name: 'Cursor', settings: {} },
  { id: 'gemini-cli', label: 'Gemini CLI', description: 'CLI؛ Gemini با حساب Google یا کلید API', providerType: 'gemini-cli', name: 'Gemini CLI', settings: {} },
  {
    id: 'gemini-api',
    label: 'Gemini API',
    description: 'API؛ کلید از Google AI Studio',
    providerType: 'openai-compatible',
    name: 'Gemini API',
    settings: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', responseFormat: 'json_schema' },
  },
  { id: 'anthropic', label: 'Claude (Anthropic API)', description: 'API؛ کلید Anthropic', providerType: 'anthropic', name: 'Claude API', settings: {} },
  { id: 'ollama', label: 'Ollama', description: 'مدل محلی', providerType: 'ollama', name: 'Ollama', settings: {} },
  { id: 'openai-compatible', label: 'سرویس سازگار با OpenAI', description: 'OpenAI، OpenRouter، Azure، LM Studio، vLLM…', providerType: 'openai-compatible', name: '', settings: {} },
];

/**
 * The provider types the app supports. The core workflow only talks to ProviderDefinition, so adding a provider
 * means adding one entry here (plus its request function), nothing else.
 */
export function createRegistry(options: RegistryOptions = {}): Map<string, ProviderDefinition> {
  const anthropicKey = (secrets: Record<string, string>) => secrets.apiKey || options.anthropicApiKey || undefined;

  const providers: ProviderDefinition[] = [
    {
      type: 'claude-code',
      label: 'Claude Code',
      description: 'از Claude Code همین سیستم و حسابی که با آن وارد شده‌اید استفاده می‌کند. کلید API لازم نیست.',
      fields: [{ key: 'model', label: 'مدل', type: 'text', placeholder: 'پیش‌فرض Claude Code', help: 'اختیاری، مثلاً opus یا sonnet' }],
      generate: (req, s) => generateWithClaudeCode({ ...req, model: (s.model ?? '').trim() }),
      async testConnection() {
        const version = await claudeCodeVersion();
        return version
          ? { ok: true, message: `Claude Code پیدا شد (${version}).` }
          : { ok: false, message: 'Claude Code روی این سیستم پیدا نشد. آن را نصب کنید یا CLAUDE_CODE_PATH را در .env.local تنظیم کنید.' };
      },
    },
    {
      type: 'anthropic',
      label: 'Claude (Anthropic API)',
      description: 'Claude از طریق API شرکت Anthropic (هزینه‌دار).',
      fields: [
        { key: 'model', label: 'مدل', type: 'text', required: true, default: 'claude-opus-5-5' },
        { key: 'apiKey', label: 'کلید API', type: 'text', secret: true, help: 'خالی = ANTHROPIC_API_KEY از .env.local' },
      ],
      generate: (req, s, secrets) =>
        generateWithAnthropic({ ...req, model: (s.model ?? '').trim() }, anthropicKey(secrets)).catch((err: unknown) => {
          // The SDK's "Could not resolve authentication method" means no key anywhere: point to where it can be set.
          if (err instanceof ProviderError && err.status === 401 && !anthropicKey(secrets)) throw new ProviderError(401, MISSING_ANTHROPIC_KEY);
          throw err;
        }),
      async testConnection(s, secrets) {
        const apiKey = anthropicKey(secrets);
        if (!apiKey) return { ok: false, message: MISSING_ANTHROPIC_KEY };
        try {
          const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000, fetch: anthropicFetch });
          const model = await client.models.retrieve((s.model ?? '').trim());
          return { ok: true, message: `اتصال برقرار است؛ مدل ${model.id} در دسترس است.` };
        } catch (err) {
          if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'کلید Anthropic پذیرفته نشد.' };
          if (err instanceof Anthropic.NotFoundError) return { ok: false, message: `کلید معتبر است اما مدل «${s.model}» پیدا نشد.` };
          if (err instanceof Anthropic.APIConnectionError) return { ok: false, message: err.cause instanceof Error && err.cause.name === 'NetworkRouteError' ? err.cause.message : 'اتصال به Anthropic برقرار نشد.' };
          return fail(err);
        }
      },
    },
    {
      type: 'ollama',
      label: 'Ollama (مدل محلی)',
      description: 'مدل‌های محلی، رایگان و آفلاین. کیفیت به مدل بستگی دارد.',
      fields: [
        { key: 'baseUrl', label: 'آدرس Ollama', type: 'url', required: true, default: 'http://localhost:11434' },
        { key: 'model', label: 'مدل', type: 'text', required: true, default: 'llama3.1' },
      ],
      generate: (req, s) => generateWithOllama({ ...req, model: (s.model ?? '').trim(), baseUrl: checkHttpUrl(s.baseUrl, 'Ollama') }),
      async testConnection(s) {
        try {
          const r = await agentHttp().fetch(new URL('/api/tags', checkHttpUrl(s.baseUrl, 'Ollama')), { signal: AbortSignal.timeout(3000) });
          const data = (await r.json()) as { models?: { name: string }[] };
          const models = (data.models ?? []).map((m) => m.name);
          if (!r.ok) return { ok: false, message: `Ollama پاسخ نداد (HTTP ${r.status}).`, models };
          const model = (s.model ?? '').trim();
          const installed = models.some((m) => m === model || m === `${model}:latest`);
          return installed
            ? { ok: true, message: `Ollama در حال اجراست و مدل ${model} نصب است.`, models }
            : { ok: false, message: `Ollama در حال اجراست اما مدل «${model}» نصب نیست (ollama pull ${model}).`, models };
        } catch (err) {
          if (err instanceof ProviderError) return fail(err);
          return { ok: false, message: `Ollama در آدرس ${s.baseUrl} در دسترس نیست.` };
        }
      },
    },
    {
      type: 'openai-compatible',
      label: 'سرویس سازگار با OpenAI',
      description: 'OpenAI، Azure OpenAI، OpenRouter، Gemini (OpenAI endpoint)، LM Studio، vLLM و هر سرویس با Chat Completions API.',
      fields: [
        { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.openai.com/v1' },
        { key: 'model', label: 'مدل', type: 'text', required: true, placeholder: 'gpt-…' },
        { key: 'apiKey', label: 'کلید API', type: 'text', secret: true, help: 'برای سرویس‌های محلی مثل LM Studio لازم نیست' },
        {
          key: 'responseFormat',
          label: 'خروجی ساخت‌یافته',
          type: 'select',
          default: 'json_schema',
          options: [
            { value: 'json_schema', label: 'JSON Schema (پیشنهادی)' },
            { value: 'json_object', label: 'JSON object' },
            { value: 'none', label: 'بدون محدودیت (فقط دستور در متن)' },
          ],
          help: 'اگر سرویس json_schema را پشتیبانی نمی‌کند، گزینهٔ دیگری انتخاب کنید',
        },
      ],
      generate: (req, s, secrets) =>
        generateWithOpenAiCompatible({
          ...req,
          model: (s.model ?? '').trim(),
          baseUrl: checkHttpUrl(s.baseUrl, 'سرویس AI'),
          apiKey: secrets.apiKey || undefined,
          responseFormat: (['json_schema', 'json_object', 'none'].includes(s.responseFormat) ? s.responseFormat : 'json_schema') as ResponseFormat,
        }),
      async testConnection(s, secrets) {
        try {
          const models = await listOpenAiModels(checkHttpUrl(s.baseUrl, 'سرویس AI'), secrets.apiKey || undefined);
          const model = (s.model ?? '').trim();
          if (models.length && !models.includes(model)) return { ok: false, message: `اتصال برقرار است اما مدل «${model}» در فهرست مدل‌ها نیست.`, models };
          return { ok: true, message: 'اتصال برقرار است.', models };
        } catch (err) {
          return fail(err);
        }
      },
    },
    cliProvider('codex-cli', CODEX, 'OpenAI Codex CLI در حالت فقط‌خواندنی؛ با حساب ChatGPT (codex login) یا کلید API.', 'اختیاری، مثلاً gpt-5-codex', generateWithCodex),
    cliProvider('cursor-cli', CURSOR, 'Cursor Agent CLI در حالت ask (فقط‌خواندنی)؛ با حساب Cursor (cursor-agent login) یا کلید API.', 'اختیاری؛ فهرست: cursor-agent --list-models', generateWithCursor),
    cliProvider('gemini-cli', GEMINI, 'Gemini CLI در حالت plan (فقط‌خواندنی)؛ با حساب Google یا کلید Gemini API.', 'اختیاری، مثلاً gemini-2.5-pro', generateWithGemini),
  ];
  return new Map(providers.map((p) => [p.type, p]));
}
