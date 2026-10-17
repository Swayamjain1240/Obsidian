
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ManagedContainer {
  id: string;
  name: string;
  state: string;
  status: string;
}

const SMOKE_NAME =
  /^obsidian-smoke-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only inventory of Obsidian smoke-test containers.
 *
 * Does not stop, restart, or remove any containers.
 */
export async function listManagedSmokeContainers():
  Promise<ManagedContainer[]> {
  const { stdout } = await execFileAsync(
    'docker',
    [
      'ps',
      '-a',
      '--filter', 'label=com.obsidian.managed=true',
      '--filter', 'label=com.obsidian.worker=baseline-smoke',
      '--format', '{{json .}}',
    ],
    {
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 32 * 1024,
    },
  );

  const containers: ManagedContainer[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const record: unknown = JSON.parse(line);

    if (
      typeof record !== 'object' ||
      record === null ||
      Array.isArray(record)
    ) {
      throw new Error('Invalid Docker container inventory.');
    }

    const value = record as Record<string, unknown>;

    if (
      typeof value.ID !== 'string' ||
      !/^[a-f0-9]{12,64}$/i.test(value.ID) ||
      typeof value.Names !== 'string' ||
      !SMOKE_NAME.test(value.Names) ||
      typeof value.State !== 'string' ||
      typeof value.Status !== 'string'
    ) {
      throw new Error('Unexpected managed container metadata.');
    }

    containers.push({
      id: value.ID,
      name: value.Names,
      state: value.State,
      status: value.Status,
    });
  }

  return containers;
}
