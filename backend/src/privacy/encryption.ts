import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptionKeyring {
  currentKeyId: string;
  getKey(keyId: string): Buffer | undefined;
}

export interface EncryptedEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function assertKey(key: Buffer | undefined, keyId: string): Buffer {
  if (!key || key.byteLength !== 32) throw new Error(`Encryption key '${keyId}' is unavailable or invalid.`);
  return key;
}

export function createKeyring(keys: ReadonlyMap<string, Buffer>, currentKeyId: string): EncryptionKeyring {
  if (!currentKeyId || !keys.has(currentKeyId)) throw new Error(`Encryption current key '${currentKeyId}' is unavailable.`);
  return { currentKeyId, getKey: (keyId) => keys.get(keyId) };
}

export function parseConfiguredKeyring(serialized: string | undefined, currentKeyId: string | undefined): EncryptionKeyring | undefined {
  if (!serialized && !currentKeyId) return undefined;
  if (!serialized || !currentKeyId) throw new Error('Encryption key configuration requires both keys and a current key id.');
  const entries = serialized.split(',').map((entry) => entry.trim()).filter(Boolean);
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new Error('Encryption key configuration is invalid.');
    const keyId = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64url');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || key.byteLength !== 32) throw new Error('Encryption key configuration is invalid.');
    if (keys.has(keyId)) throw new Error('Encryption key configuration contains a duplicate key id.');
    keys.set(keyId, key);
  }
  return createKeyring(keys, currentKeyId);
}

export function encryptText(plaintext: string, keyring: EncryptionKeyring): EncryptedEnvelope {
  const key = assertKey(keyring.getKey(keyring.currentKeyId), keyring.currentKeyId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', keyId: keyring.currentKeyId, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

export function decryptText(envelope: EncryptedEnvelope, keyring: EncryptionKeyring): string {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported encrypted envelope.');
  const key = assertKey(keyring.getKey(envelope.keyId), envelope.keyId);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Encrypted value could not be authenticated.');
  }
}

export function rotateText(envelope: EncryptedEnvelope, keyring: EncryptionKeyring): EncryptedEnvelope {
  return encryptText(decryptText(envelope, keyring), keyring);
}
