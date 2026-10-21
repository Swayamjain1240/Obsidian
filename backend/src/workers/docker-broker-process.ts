import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { recoverManagedSmokeContainer, type ManagedContainerRecovery } from './container-inventory.js';
import { DockerExecutor } from './docker-executor.js';
import type { BaselineCommandSpec } from '../baseline/adapters.js';
import type { BaselineCommandRunnerOptions, BaselineCommandResult } from '../baseline/runner.js';
import type { DockerResourceLimits } from './docker-policy.js';
import type { WorkspaceLimits } from './workspace-policy.js';

interface RunRequest {
  type: 'run';
  command: BaselineCommandSpec;
  options: Omit<BaselineCommandRunnerOptions, 'signal'>;
  trustedSnapshotRoot?: string;
  image: string;
  dockerBinary?: string;
  cleanupTimeoutMs: number;
  resourceLimits?: Partial<DockerResourceLimits>;
  workspaceLimits?: Partial<WorkspaceLimits>;
  workerJobId: string;
  workerOwnerId: string;
  workerLeaseExpiresAt: number;
}

interface RecoveryRequest {
  type: 'recover';
  dockerBinary?: string;
  leases: Array<{ containerName: string; jobId: string }>;
}

type BrokerRequest = RunRequest | RecoveryRequest;

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validWorkerId(value: unknown): value is string {
  return boundedString(value, 160) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validRunRequest(value: Record<string, unknown>): boolean {
  const options = value.options;
  const command = value.command;
  if (value.type !== 'run' || typeof command !== 'object' || command === null || Array.isArray(command)) return false;
  const commandRecord = command as Record<string, unknown>;
  if (!Array.isArray(commandRecord.args)) return false;
  return boundedString(commandRecord.id, 160)
    && boundedString(commandRecord.executable, 64)
    && commandRecord.args.every((arg: unknown) => boundedString(arg, 512))
    && typeof options === 'object' && options !== null && !Array.isArray(options)
    && Number.isSafeInteger((options as Record<string, unknown>).timeoutMs)
    && Number.isSafeInteger((options as Record<string, unknown>).maxOutputBytes)
    && validWorkerId(value.workerJobId)
    && validWorkerId(value.workerOwnerId)
    && Number.isSafeInteger(value.workerLeaseExpiresAt)
    && boundedString(value.image, 256)
    && Number.isSafeInteger(value.cleanupTimeoutMs)
    && (value.trustedSnapshotRoot === undefined || boundedString(value.trustedSnapshotRoot, 512));
}

function validRecoveryRequest(value: Record<string, unknown>): boolean {
  return value.type === 'recover'
    && Array.isArray(value.leases)
    && value.leases.length <= 100
    && value.leases.every((lease) => {
      if (typeof lease !== 'object' || lease === null || Array.isArray(lease)) return false;
      const candidate = lease as Record<string, unknown>;
      return validWorkerId(candidate.jobId) && boundedString(candidate.containerName, 256) && /^[A-Za-z0-9._:-]+$/.test(candidate.containerName as string);
    });
}

function validateRequest(value: unknown): BrokerRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('broker-request-invalid');
  const candidate = value as Record<string, unknown>;
  if (validRunRequest(candidate) || validRecoveryRequest(candidate)) return value as BrokerRequest;
  throw new Error('broker-request-invalid');
}

async function parseRequest(body: string): Promise<BrokerRequest> {
  return validateRequest(JSON.parse(body) as unknown);
}

async function readRequest(): Promise<BrokerRequest> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > 256 * 1024) throw new Error('broker-request-too-large');
    chunks.push(Buffer.from(chunk));
  }
  return parseRequest(Buffer.concat(chunks).toString('utf8'));
}

async function run(request: RunRequest): Promise<BaselineCommandResult> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Worker broker interrupted.'));
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const executor = new DockerExecutor({
      trustedSnapshotRoot: request.trustedSnapshotRoot,
      image: request.image,
      dockerBinary: request.dockerBinary,
      cleanupTimeoutMs: request.cleanupTimeoutMs,
      resourceLimits: request.resourceLimits,
      workspaceLimits: request.workspaceLimits,
    });
    return await executor.run(request.command, {
      ...request.options,
      signal: controller.signal,
      workerJobId: request.workerJobId,
      workerOwnerId: request.workerOwnerId,
      workerLeaseExpiresAt: request.workerLeaseExpiresAt,
    });
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

async function recover(request: RecoveryRequest): Promise<Record<string, ManagedContainerRecovery>> {
  const output: Record<string, ManagedContainerRecovery> = {};
  for (const lease of request.leases) {
    output[lease.jobId] = await recoverManagedSmokeContainer({ ...lease, dockerBinary: request.dockerBinary });
  }
  return output;
}

function configuredRunRequest(request: RunRequest): RunRequest {
  const image = process.env.BASELINE_WORKER_IMAGE ?? request.image;
  if (process.env.BASELINE_WORKER_IMAGE && request.image !== image) throw new Error('broker-image-mismatch');
  return {
    ...request,
    image,
    trustedSnapshotRoot: process.env.SNAPSHOT_ROOT ?? request.trustedSnapshotRoot,
    dockerBinary: process.env.BASELINE_DOCKER_BINARY ?? request.dockerBinary,
    cleanupTimeoutMs: Number(process.env.BASELINE_WORKER_CLEANUP_TIMEOUT_MS ?? request.cleanupTimeoutMs),
    resourceLimits: request.resourceLimits,
    workspaceLimits: request.workspaceLimits,
  };
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice('Bearer '.length)
    : '';
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readHttpBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > 256 * 1024) throw new Error('broker-request-too-large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
  if (request.method !== 'POST' || (request.url !== '/run' && request.url !== '/recover')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not-found' }));
    return;
  }
  if (!authorized(request, token)) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (request.headers['content-type'] !== 'application/json') {
    response.writeHead(415, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unsupported-media-type' }));
    return;
  }
  try {
    const parsed = await parseRequest(await readHttpBody(request));
    if ((request.url === '/run' && parsed.type !== 'run') || (request.url === '/recover' && parsed.type !== 'recover')) throw new Error('broker-route-mismatch');
    const result = parsed.type === 'run' ? await run(configuredRunRequest(parsed)) : await recover(parsed);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not_available', summary: 'The worker broker could not complete the request.', outputBytes: 0, outputTruncated: false, exitCode: null }));
  }
}

async function runServer(): Promise<void> {
  const token = process.env.OBSIDIAN_WORKER_BROKER_TOKEN;
  if (!token || token.length < 32) throw new Error('worker-broker-token-required');
  const server = createServer((request, response) => { void handleHttpRequest(request, response, token); });
  const host = process.env.OBSIDIAN_WORKER_BROKER_HOST ?? '127.0.0.1';
  const port = Number(process.env.OBSIDIAN_WORKER_BROKER_PORT ?? 4081);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  await new Promise<void>((resolve) => {
    const close = (): void => { server.close(() => resolve()); };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  });
}

if (process.argv.includes('--server') || process.env.OBSIDIAN_WORKER_BROKER_SERVER === '1') {
  try {
    await runServer();
  } catch {
    process.exitCode = 1;
  }
} else {
  try {
    const request = await readRequest();
    const response = request.type === 'run' ? await run(request) : await recover(request);
    process.stdout.write(JSON.stringify(response));
  } catch {
    process.stdout.write(JSON.stringify({ status: 'not_available', summary: 'The worker broker could not complete the request.', outputBytes: 0, outputTruncated: false, exitCode: null }));
    process.exitCode = 1;
  }
}
