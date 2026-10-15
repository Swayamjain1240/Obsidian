import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DetectionResult, RepositorySummary } from './api';
import { ConfirmationPanel } from './components/ConfirmationPanel';
import { DetectionProgress } from './components/DetectionProgress';
import { DetailPager, paginateLines } from './components/PagedText';
import { RepositoryPicker } from './components/RepositoryPicker';

function result(): DetectionResult {
  return {
    runId: `run-${'r'.repeat(180)}`, snapshotId: 'snapshot-1', baseCommit: 'original-commit', archiveSha256: 'original-hash', status: 'awaiting_confirmation',
    candidates: Array.from({ length: 7 }, (_, index) => ({ id: `candidate-${index}`, language: index === 0 ? 'TypeScript' : `Language ${index}`, frameworks: ['React'], packageManager: 'npm', evidenceStrength: 'strong', evidenceRefs: Array.from({ length: 9 }, (_, evidence) => ({ path: `src/${'long-directory/'.repeat(12)}file-${evidence}.ts`, reason: `Reference ${evidence}: ${'A long reason supported by actual evidence. '.repeat(12)}`, kind: 'source-extension' })), adapterAvailable: true })),
    primaryCandidateId: 'candidate-0', unknownReason: null, fileCount: 90, evidenceFileCount: 20, policyVersion: 'v1', progress: { stage: 'evidence_finalized', files: 90, bytes: 8192 }, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function readAllText(label: string): string {
  const next = screen.getByRole('button', { name: `Next ${label.toLowerCase()} text` });
  let text = '';
  for (let guard = 0; guard < 200; guard += 1) {
    text += Array.from(screen.getByLabelText(label).querySelectorAll('.text-line')).map((line) => line.textContent).join('');
    if ((next as HTMLButtonElement).disabled) return text;
    fireEvent.click(next);
  }
  throw new Error('Text pagination did not terminate.');
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear(); });

describe('bounded review content', () => {
  it('preserves every character in long names, paths, reasons and identifiers through text pages', () => {
    const value = 'a-very-long-identifier-'.repeat(60);
    expect(paginateLines(value, 70, (line) => line.length * 7).join('')).toBe(value);
    render(<DetailPager label="Record detail" fields={[{ label: 'Identifier', value, code: true }, { label: 'Reason', value: 'A reason that remains available.' }]} />);
    expect(readAllText('Identifier')).toBe(value);
    fireEvent.change(screen.getByLabelText('Record detail'), { target: { value: '1' } });
    expect(readAllText('Reason')).toBe('A reason that remains available.');
  });

  it('shows one candidate at a time on small screens, keeps selections across pages, and exposes bounded evidence', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const run = result();
    function Review() {
      const [ids, setIds] = useState<string[]>([]);
      return <ConfirmationPanel run={run} selectedIds={ids} onToggle={(id) => setIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id])} />;
    }
    render(<Review />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TypeScript' }));
    fireEvent.change(screen.getByLabelText('Candidate'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Language 6' }));
    fireEvent.change(screen.getByLabelText('Candidate'), { target: { value: '0' } });
    expect(screen.getByRole('checkbox', { name: 'Select TypeScript' })).toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    fireEvent.change(screen.getByLabelText('Evidence reference'), { target: { value: '8' } });
    expect(readAllText('File path')).toBe(run.candidates[0].evidenceRefs[8].path);
    fireEvent.change(screen.getByLabelText('Evidence detail'), { target: { value: '1' } });
    expect(readAllText('Reason')).toBe(run.candidates[0].evidenceRefs[8].reason);
    fireEvent.click(screen.getByRole('tab', { name: 'Run details' }));
    expect(readAllText('Run ID')).toBe(run.runId);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Run details' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Stack' })).toHaveFocus();
    expect(screen.getByRole('checkbox', { name: 'Select TypeScript' })).toBeChecked();
  });

  it('renders two candidates per desktop page and resets pagination when the run changes', () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    const run = result();
    const { rerender } = render(<ConfirmationPanel run={run} selectedIds={[]} onToggle={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(within(screen.getByLabelText('Candidate pagination')).getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('checkbox', { name: 'Select Language 2' })).toBeTruthy();
    rerender(<ConfirmationPanel run={{ ...run, runId: 'rescan-2', candidates: run.candidates.slice(0, 1) }} selectedIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Select TypeScript' })).toBeTruthy();
  });

  it('keeps completed scan messaging honest and makes full failure details reachable', () => {
    const run = result();
    const { rerender } = render(<DetectionProgress run={run} phase="scanning" scanComplete busy error={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete — review opens shortly');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    const failure = 'Snapshot verification failed. '.repeat(18);
    rerender(<DetectionProgress run={{ ...run, status: 'failed', error: { code: 'VERIFY_FAILED', message: failure } }} phase="terminal" scanComplete={false} busy={false} error={null} onRescan={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Scan failed.' })).toBeTruthy();
    expect(readAllText('Error details')).toBe(failure);
    expect(screen.getByRole('button', { name: 'Rescan snapshot' })).toBeEnabled();
  });
});

describe('responsive repository discovery', () => {
  it('pages one row in short landscape and exposes the complete repository name before selection', async () => {
    vi.stubGlobal('innerWidth', 844);
    vi.stubGlobal('innerHeight', 390);
    const repositories: RepositorySummary[] = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: `project-${index}`, full_name: `owner/${'long-project-name-'.repeat(20)}${index}`, html_url: `https://github.com/owner/project-${index}`, language: 'TypeScript', private: true, default_branch: 'main', updated_at: '2026-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ repositories, pagination: { page: 1, perPage: 5 } }), { status: 200 })));
    const select = vi.fn();
    render(<RepositoryPicker onSelect={select} />);
    await screen.findByRole('button', { name: `Select ${repositories[0].full_name}` });
    expect(within(screen.getByRole('list', { name: 'GitHub repositories' })).getAllByRole('listitem')).toHaveLength(1);
    for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    fireEvent.click(screen.getByRole('button', { name: `Details for ${repositories[4].full_name}` }));
    expect(readAllText('Repository')).toBe(repositories[4].full_name);
    fireEvent.click(screen.getByRole('button', { name: 'Select this repository' }));
    expect(select).toHaveBeenCalledExactlyOnceWith(repositories[4]);
    expect(JSON.parse(window.sessionStorage.getItem('obsidian.selectedRepository')!)).toEqual(repositories[4]);
  });
});
