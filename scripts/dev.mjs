import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [
  { name: 'frontend', cwd: path.join(root, 'frontend') },
  { name: 'backend', cwd: path.join(root, 'backend'), usesPort: true },
];
const children = [];
let stopping = false;

// A stray PORT exported by the parent shell (for example PORT=0 from an IDE) wins
// over backend/.env because dotenv never overrides variables that are already set,
// and the backend then aborts with "Invalid environment configuration: PORT".
// Drop an unusable value so the service's own .env decides; honour a usable one.
function sanitizePort(env, name) {
  const port = env.PORT;
  if (port === undefined || port === '') return env;
  if (/^\d+$/.test(String(port).trim()) && Number(port) > 0) return env;
  delete env.PORT;
  console.warn(`[dev] ignoring unusable PORT=${JSON.stringify(port)} from your shell for ${name}; its .env value will be used.`);
  return env;
}

function pipeOutput(name, stream, method = 'log') {
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => console[method](`[${name}] ${line}`));
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) terminate(child);
  setTimeout(() => process.exit(code), 250).unref();
}

for (const service of services) {
  const spawnedEnv = { ...process.env, FORCE_COLOR: '1' };
  const child = spawn(npm, ['run', 'dev'], {
    cwd: service.cwd,
    env: service.usesPort ? sanitizePort(spawnedEnv, service.name) : spawnedEnv,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  pipeOutput(service.name, child.stdout);
  pipeOutput(service.name, child.stderr, 'error');
  child.on('error', (error) => {
    console.error(`[${service.name}] failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${service.name}] stopped${signal ? ` from ${signal}` : ` with exit code ${code ?? 1}`}`);
    stop(code && code > 0 ? code : 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
