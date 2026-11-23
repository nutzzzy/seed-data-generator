// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWithOpenAiCompatible, listOpenAiModels, type ResponseFormat } from './openaiCompatible.ts';
import { ProviderError } from './providers.ts';

const KEY = 'sk-live-abcdefghijklmnop';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = (content: string, finish = 'stop') => json(200, { choices: [{ message: { content }, finish_reason: finish }] });

const req = (responseFormat: ResponseFormat = 'json_schema') => ({
  baseUrl: 'https://api.example.com/v1/',
  apiKey: KEY,
  model: 'gpt-x',
  system: 'SYSTEM',
  user: 'USER',
  schema: { type: 'object' },
  timeoutMs: 5000,
  signal: new AbortController().signal,
  responseFormat,
});

afterEach(() => vi.restoreAllMocks());

describe('OpenAI-compatible provider', () => {
  it('sends a chat completion with the JSON schema and the key, and returns the content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer('{"rows":[]}'));
    expect(await generateWithOpenAiCompatible(req())).toBe('{"rows":[]}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: 'gpt-x', response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } } });
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'USER' },
    ]);
  });

  it('puts the schema in the system prompt when the service has no json_schema support', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer('{}'));
    await generateWithOpenAiCompatible({ ...req('none'), apiKey: undefined });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toContain('JSON schema');
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('maps invalid keys, rate limits, truncation and unreachable services, without leaking the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(401, { error: { message: `Incorrect API key provided: ${KEY}` } }));
    const err = await generateWithOpenAiCompatible(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(401);
    expect((err as Error).message).not.toContain(KEY);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(429, {}));
    await expect(generateWithOpenAiCompatible(req())).rejects.toMatchObject({ status: 429 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer('{"rows":[', 'length'));
    await expect(generateWithOpenAiCompatible(req())).rejects.toMatchObject({ status: 422 });

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(generateWithOpenAiCompatible(req())).rejects.toMatchObject({ status: 502 });
  });

  it('lists models for the connection test', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }));
    expect(await listOpenAiModels('https://api.example.com/v1', KEY)).toEqual(['gpt-x', 'gpt-y']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(403, {}));
    await expect(listOpenAiModels('https://api.example.com/v1', 'bad')).rejects.toMatchObject({ status: 401 });
  });
});
