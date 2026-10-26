const SECRET_PATH = /(?:^|[./_-])(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc|credentials?(?:\.json)?|secrets?(?:\.json)?|id_rsa|id_ed25519|private[_-]?key)(?:$|[./_-])/i;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi;
const AUTH_HEADER = /\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi;
const COOKIE_HEADER = /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/gi;
const COMMON_TOKEN = /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export const DEFAULT_REDACTION_MAX_BYTES = 16 * 1024;

export function isSensitivePath(value: string): boolean {
  return SECRET_PATH.test(value.replaceAll('\\', '/'));
}

export function redactText(value: string, maxBytes = DEFAULT_REDACTION_MAX_BYTES): string {
  const bounded = value.length > maxBytes ? `${value.slice(0, maxBytes)}...[TRUNCATED]` : value;
  return bounded
    .replace(PRIVATE_KEY, '[REDACTED_PRIVATE_KEY]')
    .replace(AUTH_HEADER, 'authorization: [REDACTED]')
    .replace(COOKIE_HEADER, 'cookie: [REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(KEY_ASSIGNMENT, '[REDACTED]')
    .replace(COMMON_TOKEN, '[REDACTED_TOKEN]')
    .replace(JWT, '[REDACTED_JWT]');
}

export function redact(value: unknown, maxBytes = DEFAULT_REDACTION_MAX_BYTES): unknown {
  if (typeof value === 'string') return redactText(value, maxBytes);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, maxBytes));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:authorization|proxy-authorization|cookie|set-cookie|accessToken|access_token|refreshToken|refresh_token|clientSecret|client_secret|password|secret|token|content)$/i.test(key)) {
        output[key] = '[REDACTED]';
      } else if (/^(?:source|sourceText|rawSource|prompt|completion|body|headers)$/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redact(item, maxBytes);
      }
    }
    return output;
  }
  return value;
}

export function safeDiagnostic(value: unknown, maxBytes = DEFAULT_REDACTION_MAX_BYTES): string {
  const text = typeof value === 'string' ? value : JSON.stringify(redact(value, maxBytes));
  return redactText(text ?? '', maxBytes);
}
