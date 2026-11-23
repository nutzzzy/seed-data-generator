import { ProviderError, type ProviderRequest } from './providers.ts';
import { agentHttp, NetworkRouteError } from './network/httpClient.ts';
import { redact } from './redact.ts';

export type ResponseFormat = 'json_schema' | 'json_object' | 'none';

export interface OpenAiRequest extends ProviderRequest {
  baseUrl: string;
  apiKey?: string;
  responseFormat: ResponseFormat;
}

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, '')}/${path}`;

function headers(apiKey?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

async function errorText(res: Response, apiKey?: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string; message?: string } | null;
  const msg = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message ?? '');
  return redact(String(msg).slice(0, 300), [apiKey]);
}

function statusError(res: Response, detail: string, model?: string): ProviderError {
  if (res.status === 401 || res.status === 403) return new ProviderError(401, `کلید API پذیرفته نشد${detail ? `: ${detail}` : '.'}`);
  if (res.status === 404) return new ProviderError(400, `آدرس یا مدل${model ? ` «${model}»` : ''} پیدا نشد${detail ? `: ${detail}` : '.'}`);
  if (res.status === 429) return new ProviderError(429, 'به سقف تعداد درخواست سرویس رسیدید. کمی صبر کنید و دوباره تلاش کنید.');
  return new ProviderError(502, `خطای سرویس AI (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
}

/**
 * Any service with the OpenAI Chat Completions API: OpenAI, Azure OpenAI (v1 endpoint), OpenRouter,
 * Gemini's OpenAI endpoint, LM Studio, vLLM… Structured output uses json_schema when the service supports it;
 * otherwise the schema is added to the system prompt.
 */
export async function generateWithOpenAiCompatible(req: OpenAiRequest): Promise<string> {
  const schemaHint = `\n\nAnswer with a single JSON object that follows this JSON schema:\n${JSON.stringify(req.schema)}`;
  const system = req.responseFormat === 'json_schema' ? req.system : req.system + schemaHint;
  const responseFormat =
    req.responseFormat === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: 'result', schema: req.schema, strict: true } }
      : req.responseFormat === 'json_object'
        ? { type: 'json_object' }
        : undefined;

  let res: Response;
  try {
    res = await agentHttp().fetch(endpoint(req.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: headers(req.apiKey),
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.user },
        ],
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]),
    });
  } catch (err) {
    if (req.signal.aborted || err instanceof NetworkRouteError) throw err;
    if (err instanceof Error && err.name === 'TimeoutError') throw new ProviderError(504, 'زمان پاسخ سرویس AI تمام شد.');
    throw new ProviderError(502, `سرویس AI در آدرس ${req.baseUrl} در دسترس نیست.`);
  }
  if (!res.ok) throw statusError(res, await errorText(res, req.apiKey), req.model);
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] } | null;
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) throw new ProviderError(422, 'مدل این درخواست را رد کرد. ورودی را بازنویسی کنید و دوباره تلاش کنید.');
  if (choice?.finish_reason === 'length') throw new ProviderError(422, 'پاسخ خیلی طولانی بود و ناقص ماند. ورودی را به چند بخش کوچک‌تر تقسیم کنید.');
  const text = choice?.message?.content;
  if (!text?.trim()) throw new ProviderError(502, 'سرویس AI پاسخ خالی برگرداند.');
  return text;
}

/** Checks the URL and key with GET /models; returns the model ids the service offers. */
export async function listOpenAiModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  let res: Response;
  try {
    res = await agentHttp().fetch(endpoint(baseUrl, 'models'), { headers: headers(apiKey), signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    if (err instanceof NetworkRouteError) throw err;
    throw new ProviderError(502, `سرویس AI در آدرس ${baseUrl} در دسترس نیست.`);
  }
  if (!res.ok) throw statusError(res, await errorText(res, apiKey));
  const data = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  return (data?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
}
