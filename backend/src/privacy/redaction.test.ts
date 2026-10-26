import { describe, expect, it } from 'vitest';

import { isSensitivePath, redact, redactText, safeDiagnostic } from './redaction.js';

describe('privacy redaction', () => {
  it('redacts headers, cookies, common tokens, JWTs and private keys deterministically', () => {
    const begin = ['-----BEGIN', ' PRIVATE KEY-----'].join('');
    const end = ['-----END', ' PRIVATE KEY-----'].join('');
    const value = `Authorization: Bearer secret-token Cookie: obsidian_session=secret ghp_123456789012345678901234567890 eyJabcdefghijk.lmnopqrstuv.wxyz1234567890 ${begin}secret${end}`;
    const result = redactText(value);
    expect(result).not.toContain('secret-token');
    expect(result).not.toContain('obsidian_session=secret');
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain(['BEGIN', ' PRIVATE KEY'].join(''));
    expect(result).toContain('[REDACTED]');
  });

  it('redacts sensitive object fields and bounds diagnostics', () => {
    const result = redact({ token: 'secret', source: 'private source', safe: 'ok' }, 20) as Record<string, unknown>;
    expect(result.token).toBe('[REDACTED]');
    expect(result.source).not.toContain('private source');
    expect(safeDiagnostic({ password: 'secret', safe: 'ok' }, 20)).not.toContain('secret');
    expect(redactText('a'.repeat(100), 10)).toContain('[TRUNCATED]');
  });

  it('classifies secret-bearing paths', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('config/credentials.json')).toBe(true);
    expect(isSensitivePath('src/index.ts')).toBe(false);
  });
});
