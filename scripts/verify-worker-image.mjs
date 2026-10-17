import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const image = process.argv[2] ?? 'obsidian-sandbox:dev';
const inspected = JSON.parse(execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .}}'], { encoding: 'utf8' }));
const dockerfile = readFileSync(new URL('../infra/sandbox/Dockerfile', import.meta.url), 'utf8');

if (inspected.Config?.User !== 'node') throw new Error('Worker image must run as the non-root node user.');
if (JSON.stringify(inspected.Config?.Entrypoint) !== JSON.stringify(['node', '/opt/obsidian/baseline-runner.mjs'])) throw new Error('Worker image entrypoint is not the reviewed baseline runner.');
if (!/^FROM .*@sha256:[a-f0-9]{64}$/im.test(dockerfile)) throw new Error('Worker Dockerfile base image must be pinned by digest.');
if (!String(inspected.Id).startsWith('sha256:')) throw new Error('Worker image does not have a content digest.');

process.stdout.write(`Worker image policy verified: ${image} ${inspected.Id}\n`);
