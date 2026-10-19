import { createHash } from 'node:crypto';

export function deliveryBranchName(version2RunId: string, manifestHash: string): string {
  const run = version2RunId.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 80);
  return `ai/enhancement/${run}-${manifestHash.slice(0, 16).toLowerCase()}`;
}

export function deliveryCommitMessage(version2RunId: string, manifestHash: string): string {
  return `Obsidian Version 2: ${version2RunId} (${manifestHash.slice(0, 16).toLowerCase()})`;
}

export function responseHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}
