import { GenerationError, httpTransport, type AiTransport } from '../lib/generate';
import { extractJson } from '../lib/parseResponse';
import type { Settings } from '../lib/types';
import { useCaseMarkdown } from './confluenceExport';
import { normalizeMermaid } from './confluenceParse';
import { blankExtension, blankUseCase } from './model';
import { DIAGRAM_RULES, DOMAINS, USE_CASE_RULES } from './rules';
import type { DiagramSection, UseCase } from './types';

const strings = { type: 'array', items: { type: 'string' } };
const outlineHelp = 'One array item per line. Indent nested items with two spaces per level. A line starting with "### " is a sub-heading.';

const FLOWCHART_SCHEMA = {
  type: 'object',
  properties: {
    heading: { type: 'string', description: '"<Domain> — <Service or capability>" with an em dash' },
    description: { type: 'string', description: 'One paragraph: what the diagram covers, entry points, hand-offs to other domains' },
    mermaid: { type: 'string', description: 'Mermaid source starting with "flowchart TD" or "flowchart LR"' },
  },
  required: ['heading', 'description', 'mermaid'],
  additionalProperties: false,
};

const USE_CASE_SCHEMA = {
  type: 'object',
  properties: {
    useCase: {
      type: 'object',
      properties: {
        ucId: { type: 'string' },
        title: { type: 'string' },
        scope: { type: 'string' },
        primaryActor: { type: 'string' },
        preconditions: { ...strings, description: outlineHelp },
        postconditions: { ...strings, description: outlineHelp },
        mainScenario: { ...strings, description: `Numbered happy-path steps (numbers are added by Confluence; do not write them). ${outlineHelp}` },
        extensions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, steps: { ...strings, description: outlineHelp } },
            required: ['title', 'steps'],
            additionalProperties: false,
          },
        },
        exceptions: { ...strings, description: outlineHelp },
        specialRequirements: { ...strings, description: outlineHelp },
        relatedUseCases: { ...strings, description: 'UC IDs only' },
      },
      required: ['ucId', 'title', 'scope', 'primaryActor', 'preconditions', 'postconditions', 'mainScenario', 'extensions', 'exceptions', 'specialRequirements', 'relatedUseCases'],
      additionalProperties: false,
    },
    flowchart: FLOWCHART_SCHEMA,
    issues: { ...strings, description: 'Missing or unclear information, in Persian' },
  },
  required: ['useCase', 'flowchart', 'issues'],
  additionalProperties: false,
};

const FLOWCHART_ONLY_SCHEMA = {
  type: 'object',
  properties: { flowchart: FLOWCHART_SCHEMA, issues: { ...strings, description: 'Missing or unclear information, in Persian' } },
  required: ['flowchart', 'issues'],
  additionalProperties: false,
};

const numbered = (list: string[]) => list.map((r, i) => `${i + 1}. ${r}`).join('\n');

const SYSTEM = [
  'You write Food Partner (SnappFood vendor panel "Dakhl") use cases and their flowcharts for the team\'s Confluence space,',
  'following the team\'s rules exactly. Answer only with JSON that matches the given schema.',
  '',
  'USE CASE RULES',
  numbered(USE_CASE_RULES),
  '',
  'DIAGRAM RULES',
  numbered(DIAGRAM_RULES),
  '',
  `Domains: ${DOMAINS.join(', ')}.`,
].join('\n');

export interface GeneratedUseCase {
  useCase: UseCase;
  flowchart: Pick<DiagramSection, 'heading' | 'description' | 'mermaid'>;
  issues: string[];
}

interface Args {
  settings: Settings;
  signal: AbortSignal;
  transport?: AiTransport;
}

async function call(args: Args, user: string, schema: Record<string, unknown>): Promise<unknown> {
  const { settings, signal, transport = httpTransport } = args;
  if (settings.provider === 'basic') throw new GenerationError('ساخت Use Case به AI نیاز دارد. در تنظیمات Claude Code را انتخاب کنید.');
  const timeoutMs = (settings.timeoutSeconds > 0 ? settings.timeoutSeconds : 120) * 1000;
  const timeout = AbortSignal.timeout(timeoutMs);
  let text: string;
  try {
    text = await transport(
      {
        provider: settings.provider,
        model: { 'claude-code': settings.claudeCodeModel, anthropic: settings.anthropicModel, ollama: settings.ollamaModel }[settings.provider],
        baseUrl: settings.provider === 'ollama' ? settings.ollamaBaseUrl : undefined,
        system: SYSTEM,
        user,
        schema,
        timeoutMs,
      },
      AbortSignal.any([signal, timeout]),
    );
  } catch (err) {
    if (signal.aborted) throw err;
    if (timeout.aborted) throw new GenerationError(`AI در ${settings.timeoutSeconds} ثانیه پاسخ نداد. دوباره تلاش کنید یا زمان انتظار را در تنظیمات بیشتر کنید.`);
    if (err instanceof GenerationError) throw err;
    throw new GenerationError(err instanceof Error ? err.message : 'درخواست AI ناموفق بود.');
  }
  try {
    return extractJson(text);
  } catch (err) {
    throw new GenerationError(err instanceof Error ? err.message : 'پاسخ AI قابل استفاده نبود.');
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.replace(/\s+$/, '')).join('\n') : str(v));

function readFlowchart(v: unknown): GeneratedUseCase['flowchart'] {
  const f = (v ?? {}) as Record<string, unknown>;
  return { heading: str(f.heading), description: str(f.description), mermaid: normalizeMermaid(str(f.mermaid)) };
}

/** Requirements / notes → a Use Case in the Confluence structure, plus its flowchart. */
export async function generateUseCase(input: string, args: Args): Promise<GeneratedUseCase> {
  if (!input.trim()) throw new GenerationError('ابتدا نیازمندی‌ها یا توضیحات Use Case را وارد کنید.');
  const data = (await call(
    args,
    `Write one use case and its flowchart from this source. Use only facts from it.\n\n<source>\n${input}\n</source>`,
    USE_CASE_SCHEMA,
  )) as Record<string, unknown>;
  const u = (data.useCase ?? {}) as Record<string, unknown>;
  if (!u || typeof u !== 'object') throw new GenerationError('پاسخ AI بخش useCase نداشت.');
  const useCase: UseCase = {
    ...blankUseCase(),
    ucId: str(u.ucId),
    title: str(u.title),
    scope: str(u.scope),
    primaryActor: str(u.primaryActor) || 'Vendor',
    preconditions: lines(u.preconditions),
    postconditions: lines(u.postconditions),
    mainScenario: lines(u.mainScenario),
    extensions: (Array.isArray(u.extensions) ? u.extensions : []).map((e: Record<string, unknown>) => ({ ...blankExtension(str(e?.title)), body: lines(e?.steps) })),
    exceptions: lines(u.exceptions),
    specialRequirements: lines(u.specialRequirements),
    relatedUseCases: lines(u.relatedUseCases),
  };
  if (!useCase.mainScenario) throw new GenerationError('AI سناریوی اصلی (Main Success Scenario) برنگرداند. ورودی را کامل‌تر کنید.');
  return { useCase, flowchart: readFlowchart(data.flowchart), issues: Array.isArray(data.issues) ? data.issues.filter((i): i is string => typeof i === 'string') : [] };
}

/** The use case's algorithm → its flowchart section (heading, description, Mermaid). */
export async function generateFlowchart(useCase: UseCase, current: DiagramSection, args: Args): Promise<{ flowchart: GeneratedUseCase['flowchart']; issues: string[] }> {
  const data = (await call(
    args,
    [
      'Draw the flowchart section for this use case, following the diagram rules (entry point, main scenario steps, alternative flows, exceptions, links to other domains).',
      current.heading.trim() ? `Keep the heading "${current.heading.trim()}" unless it breaks the rules.` : '',
      current.mermaid.trim().split('\n').length > 1 ? `Current Mermaid source to improve:\n${current.mermaid}` : '',
      `<use_case>\n${useCaseMarkdown(useCase)}\n</use_case>`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    FLOWCHART_ONLY_SCHEMA,
  )) as Record<string, unknown>;
  const flowchart = readFlowchart(data.flowchart);
  if (!flowchart.mermaid) throw new GenerationError('AI کد Mermaid برنگرداند.');
  return { flowchart, issues: Array.isArray(data.issues) ? data.issues.filter((i): i is string => typeof i === 'string') : [] };
}
