import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const uri = process.env.OBSIDIAN_MONGODB_TEST_URI;
if (!process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS || !uri || !uri.includes('obsidian_phase3')) {
  console.error('Backup/restore verification requires OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS=1 and a disposable obsidian_phase3 URI.');
  process.exitCode = 2;
  process.exit();
}

const directory = mkdtempSync(path.join(tmpdir(), 'obsidian-phase3-backup-'));
try {
  execFileSync('mongodump', ['--uri', uri, '--out', directory], { stdio: 'inherit' });
  const restoreUri = process.env.OBSIDIAN_MONGODB_RESTORE_URI;
  if (!restoreUri || !restoreUri.includes('obsidian_phase3_restore')) throw new Error('A disposable restore URI is required.');
  execFileSync('mongorestore', ['--uri', restoreUri, '--drop', path.join(directory, 'obsidian_phase3')], { stdio: 'inherit' });
  console.log('MongoDB backup and restore verification completed against disposable databases.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
