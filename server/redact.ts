/**
 * Removes credentials from text before it is logged or sent to the browser (e.g. an upstream error body
 * that echoes a header). Known secret values are replaced first, then common token shapes.
 */
export function redact(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out
    .replace(/(authorization\s*[:=]\s*)(bearer|basic)?\s*[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})/g, '[REDACTED]')
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s]+/gi, '$1[REDACTED]');
}
