import 'dotenv/config';

import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AI_PROVIDER: z.string().min(1).default('disabled'),
  AI_PROVIDER_API_KEY: z.string().optional(),
  AI_PROVIDER_BASE_URL: z.string().url().optional(),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CALLBACK_URL: z.string().url().optional(),
  GITHUB_OAUTH_SCOPES: z.string().default('read:user,repo'),
  AUTH_SESSION_SECRET: z.string().min(32).optional(),
  SNAPSHOT_MAX_BYTES: z.coerce.number().int().positive().max(500_000_000).default(52_428_800),
  SNAPSHOT_ROOT: z.string().min(1).default('.obsidian-workspaces'),
  SNAPSHOT_MAX_EXTRACTED_BYTES: z.coerce.number().int().positive().max(2_000_000_000).default(209_715_200),
  SNAPSHOT_MAX_FILES: z.coerce.number().int().positive().max(100_000).default(10_000),
  SNAPSHOT_MAX_DIRECTORIES: z.coerce.number().int().positive().max(50_000).default(5_000),
  SNAPSHOT_MAX_SINGLE_FILE_BYTES: z.coerce.number().int().positive().max(500_000_000).default(20_971_520),
  SNAPSHOT_MAX_PATH_LENGTH: z.coerce.number().int().positive().max(8_192).default(1_024),
  SNAPSHOT_EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().max(3_600_000).default(120_000),
  DETECTION_MAX_EVIDENCE_FILE_BYTES: z.coerce.number().int().positive().max(10_000_000).default(1_048_576),
  DETECTION_MAX_EVIDENCE_PATHS: z.coerce.number().int().positive().max(1_000).default(100),
  DETECTION_MIN_VISIBLE_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
  DETECTION_POLL_INTERVAL_MS: z.coerce.number().int().positive().max(10_000).default(500),
  COMPLETENESS_MAX_FILE_BYTES: z.coerce.number().int().positive().max(10_000_000).default(262_144),
  COMPLETENESS_MAX_FILES: z.coerce.number().int().positive().max(100_000).default(2_000),
  COMPLETENESS_MAX_BYTES: z.coerce.number().int().positive().max(50_000_000).default(8_388_608),
  COMPLETENESS_MAX_FINDINGS: z.coerce.number().int().positive().max(10_000).default(500),
  COMPLETENESS_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  return result.data;
}
