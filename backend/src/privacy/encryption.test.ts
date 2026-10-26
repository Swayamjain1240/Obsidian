import { describe, expect, it } from 'vitest';

import { createKeyring, decryptText, encryptText, parseConfiguredKeyring, rotateText } from './encryption.js';

describe('privacy encryption lifecycle', () => {
  const first = Buffer.alloc(32, 1);
  const second = Buffer.alloc(32, 2);

  it('round trips authenticated ciphertext and rejects tampering', () => {
    const keyring = createKeyring(new Map([['v1', first]]), 'v1');
    const envelope = encryptText('private token', keyring);
    expect(decryptText(envelope, keyring)).toBe('private token');
    expect(() => decryptText({ ...envelope, ciphertext: `${envelope.ciphertext}x` }, keyring)).toThrow(/authenticated/);
  });

  it('supports explicit key rotation and fails closed for missing keys', () => {
    const oldRing = createKeyring(new Map([['v1', first]]), 'v1');
    const newRing = createKeyring(new Map([['v1', first], ['v2', second]]), 'v2');
    const rotated = rotateText(encryptText('private source', oldRing), newRing);
    expect(rotated.keyId).toBe('v2');
    expect(decryptText(rotated, newRing)).toBe('private source');
    expect(() => decryptText(rotated, oldRing)).toThrow(/unavailable/);
  });

  it('rejects ambiguous configured key ids', () => {
    const encoded = first.toString('base64url');
    expect(() => parseConfiguredKeyring(`v1:${encoded},v1:${encoded}`, 'v1')).toThrow(/duplicate/);
  });
});
