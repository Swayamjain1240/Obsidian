import { isSensitivePath, redactText } from './redaction.js';

export interface ContextFile {
  path: string;
  content: string;
}

export interface PrivacySafeContext {
  files: Array<{ path: string; content: string; truncated: boolean }>;
  excludedPaths: string[];
  totalBytes: number;
}

export interface ContextPolicy {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

const defaultPolicy: ContextPolicy = { maxFiles: 20, maxFileBytes: 8 * 1024, maxTotalBytes: 64 * 1024 };

export function minimizeContext(files: readonly ContextFile[], policy: Partial<ContextPolicy> = {}): PrivacySafeContext {
  const limits = { ...defaultPolicy, ...policy };
  const included: PrivacySafeContext['files'] = [];
  const excludedPaths: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (isSensitivePath(file.path)) {
      excludedPaths.push(file.path);
      continue;
    }
    if (included.length >= limits.maxFiles || totalBytes >= limits.maxTotalBytes) {
      excludedPaths.push(file.path);
      continue;
    }
    const remaining = Math.max(0, limits.maxTotalBytes - totalBytes);
    const maxBytes = Math.min(limits.maxFileBytes, remaining);
    const content = redactText(file.content, maxBytes).slice(0, maxBytes);
    const truncated = file.content.length > maxBytes;
    included.push({ path: file.path, content, truncated });
    totalBytes += content.length;
  }
  return { files: included, excludedPaths, totalBytes };
}
