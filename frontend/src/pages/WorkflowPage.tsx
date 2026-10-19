import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  approveRecommendation,
  approveRepairItem,
  acknowledgeVersion2Diff,
  createEnhancementRun,
  createPullRequest,
  createRepairPlan,
  cancelVersion2,
  getVersion2State,
  getVersion2Diff,
  getEnhancementRun,
  getRepairPlan,
  preparePullRequest,
  publishRepairBranch,
  retryVersion2,
  startRepair,
  startVersion2,
  validateRepair,
  validateVersion2,
  type EnhancementRun,
  type RepairPlan,
  type WorkflowMutationContext,
  type WorkflowOperationInput,
} from '../api';

type WorkflowMode = 'repair' | 'enhance' | 'delivery';
type OperationDraft = WorkflowOperationInput;

function modeFor(pathname: string): WorkflowMode {
  if (pathname.includes('/enhance')) return 'enhance';
  if (pathname.includes('/delivery')) return 'delivery';
  return 'repair';
}

function operationFromDraft(draft: OperationDraft): WorkflowOperationInput {
  const path = draft.path.trim();
  if (!path) throw new Error('Enter a repository-relative file path before approving the change.');
  if (draft.kind !== 'delete' && !draft.content) throw new Error('Enter file content before approving an add or modify operation.');
  return draft.kind === 'delete' ? { kind: draft.kind, path } : { kind: draft.kind, path, content: draft.content ?? '' };
}

async function previewHash(operations: WorkflowOperationInput[]): Promise<string> {
  const canonical = await Promise.all(operations.map(async (operation) => {
    if (operation.kind === 'delete') return { kind: operation.kind, path: operation.path, contentHash: null, contentBytes: null };
    const content = operation.content ?? '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return { kind: operation.kind, path: operation.path, contentHash: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''), contentBytes: new TextEncoder().encode(content).byteLength };
  }));
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function OperationEditor({ id, draft, disabled, onChange }: { id: string; draft: OperationDraft; disabled: boolean; onChange: (draft: OperationDraft) => void }) {
  return (
    <div className="workflow-editor" aria-label="Approved file operation">
      <label htmlFor={`${id}-kind`}>Operation</label>
      <select id={`${id}-kind`} value={draft.kind} disabled={disabled} onChange={(event) => onChange({ ...draft, kind: event.target.value as OperationDraft['kind'], content: event.target.value === 'delete' ? '' : draft.content })}>
        <option value="modify">Modify file</option>
        <option value="add">Add file</option>
        <option value="delete">Delete file</option>
      </select>
      <label htmlFor={`${id}-path`}>Repository-relative path</label>
      <input id={`${id}-path`} value={draft.path} disabled={disabled} maxLength={1024} placeholder="src/example.ts" onChange={(event) => onChange({ ...draft, path: event.target.value })} />
      {draft.kind !== 'delete' ? <><label htmlFor={`${id}-content`}>Approved file content</label><textarea id={`${id}-content`} value={draft.content ?? ''} disabled={disabled} maxLength={1_048_576} rows={4} placeholder="Enter the exact approved file content" onChange={(event) => onChange({ ...draft, content: event.target.value })} /></> : null}
      <p className="muted workflow-editor-note">Only this explicit operation can be applied to the isolated change workspace.</p>
    </div>
  );
}

export function WorkflowPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = modeFor(location.pathname);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const baselineRunId = params.get('baselineRunId');
  const planId = params.get('planId');
  const enhancementRunId = params.get('runId');
  const version2RunId = params.get('version2RunId');
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [enhancement, setEnhancement] = useState<EnhancementRun | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; url?: string | null; revision?: number; previewAcknowledged?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    if (mode === 'repair' && planId) void getRepairPlan(planId, controller.signal).then((response) => setPlan(response.plan)).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Repair plan could not be loaded.'); });
    if (mode === 'enhance' && enhancementRunId) void getEnhancementRun(enhancementRunId, controller.signal).then((response) => setEnhancement(response.run)).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Enhancement run could not be loaded.'); });
    return () => controller.abort();
  }, [enhancementRunId, mode, planId]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'The workflow action could not be completed.'); } finally { setBusy(false); }
  };

  const repairStart = () => act(async () => {
    if (!baselineRunId) throw new Error('Open this phase from a completed baseline run.');
    const response = await createRepairPlan(baselineRunId, undefined, { revision: 0, idempotencyKey: `repair-create-${baselineRunId}` });
    setPlan(response.plan);
    navigate(`/project/repair?planId=${encodeURIComponent(response.plan.planId)}&baselineRunId=${encodeURIComponent(baselineRunId)}`, { replace: true });
  });

  const enhancementStart = () => act(async () => {
    if (!baselineRunId) throw new Error('Open this phase from a completed baseline run.');
    const response = await createEnhancementRun(baselineRunId, undefined, { revision: 0, idempotencyKey: `enhancement-create-${baselineRunId}` });
    setEnhancement(response.run);
    navigate(`/project/enhance?runId=${encodeURIComponent(response.run.enhancementRunId)}&baselineRunId=${encodeURIComponent(baselineRunId)}`, { replace: true });
  });

  return (
    <section className="page-layout workflow-layout" aria-labelledby="workflow-title">
      <div className="page-intro"><span className="eyebrow">Post-baseline workflow</span><h1 id="workflow-title">Review changes before they exist.</h1><p className="muted">Every repair, recommendation, and Version 2 operation stays owner-bound, reviewable, and tied to the original base commit.</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {mode === 'repair' ? <RepairPanel plan={plan} busy={busy} canStart={Boolean(baselineRunId)} onStart={repairStart} onUpdate={setPlan} onAction={act} /> : null}
      {mode === 'enhance' ? <EnhancementPanel run={enhancement} busy={busy} canStart={Boolean(baselineRunId)} onStart={enhancementStart} onUpdate={setEnhancement} onAction={act} onVersion2={(id) => navigate(`/project/delivery?version2RunId=${encodeURIComponent(id)}`)} /> : null}
      {mode === 'delivery' ? <RecoveryDeliveryPanel version2RunId={version2RunId} receipt={receipt} busy={busy} onAction={act} onReceipt={setReceipt} onError={setError} /> : null}
    </section>
  );
}

function RepairPanel({ plan, busy, canStart, onStart, onUpdate, onAction }: { plan: RepairPlan | null; busy: boolean; canStart: boolean; onStart: () => void; onUpdate: (plan: RepairPlan) => void; onAction: (operation: () => Promise<void>) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, OperationDraft>>({});
  if (!plan && !canStart) return <section className="panel next-step-panel"><h2>Complete the baseline first.</h2><p className="muted">Repair review opens from a server-authorized baseline result.</p><Link className="primary-button" to="/project/baseline">Open baseline review</Link></section>;
  if (!plan) return <section className="panel next-step-panel"><h2>Build the repair review.</h2><p className="muted">Baseline failures and unavailable checks become explicit repair items. Nothing is changed automatically.</p><button className="primary-button" type="button" onClick={onStart} disabled={busy}>Create repair plan</button></section>;
  const draftFor = (id: string): OperationDraft => drafts[id] ?? { kind: 'modify', path: '', content: '' };
  const approve = (itemId: string, itemRisk: 'low' | 'medium' | 'high') => onAction(async () => {
    const operations = [operationFromDraft(draftFor(itemId))];
    const mutation: WorkflowMutationContext = { revision: plan.revision ?? 1, idempotencyKey: `repair-approval-${plan.planId}-${itemId}-${plan.revision ?? 1}`, previewHash: itemRisk === 'low' ? undefined : await previewHash(operations), highRiskConfirmed: itemRisk === 'high' };
    onUpdate((await approveRepairItem(plan.planId, itemId, true, operations, undefined, mutation)).plan);
  });
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Repair review</h2><span className="status-chip">{plan.status.replaceAll('_', ' ')}</span></div><p className="muted">Base commit: <code>{plan.baseCommit}</code>{plan.branchName ? ` · ${plan.branchName}` : ''}</p><div className="workflow-list">{plan.items.map((item) => <article className="workflow-item" key={item.id}><div><strong>{item.title}</strong><p className="muted">{item.reason}</p><span className="status-chip">{item.approvalState} · {item.workerStatus}</span><OperationEditor id={`repair-${item.id}`} draft={draftFor(item.id)} disabled={busy || item.approvalState !== 'awaiting_approval'} onChange={(draft) => setDrafts((current) => ({ ...current, [item.id]: draft }))} /></div><div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void approve(item.id, item.risk)} disabled={busy || item.approvalState !== 'awaiting_approval'}>Approve operation</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRepairItem(plan.planId, item.id, false, undefined, undefined, { revision: plan.revision ?? 1, idempotencyKey: `repair-rejection-${plan.planId}-${item.id}-${plan.revision ?? 1}` })).plan))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Reject</button></div></article>)}</div>{plan.warning ? <p className="inline-error">{plan.warning}</p> : null}<div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => onUpdate((await startRepair(plan.planId, undefined, { revision: plan.revision ?? 1, idempotencyKey: `repair-start-${plan.planId}-${plan.revision ?? 1}` })).plan))} disabled={busy || plan.status !== 'approved'}>Start repair worker</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await validateRepair(plan.planId, undefined, { revision: plan.revision ?? 1, idempotencyKey: `repair-validate-${plan.planId}-${plan.revision ?? 1}` })).plan))} disabled={busy || plan.status !== 'running'}>Validate repairs</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await publishRepairBranch(plan.planId, undefined, { revision: plan.revision ?? 1, idempotencyKey: `repair-publish-${plan.planId}-${plan.revision ?? 1}` })).plan))} disabled={busy || plan.status !== 'validated'}>Publish repair branch</button></div></section>;
}

function EnhancementPanel({ run, busy, canStart, onStart, onUpdate, onAction, onVersion2 }: { run: EnhancementRun | null; busy: boolean; canStart: boolean; onStart: () => void; onUpdate: (run: EnhancementRun) => void; onAction: (operation: () => Promise<void>) => Promise<void>; onVersion2: (id: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, OperationDraft>>({});
  if (!run && !canStart) return <section className="panel next-step-panel"><h2>Complete the baseline first.</h2><p className="muted">Enhancement review opens from a server-authorized baseline result.</p><Link className="primary-button" to="/project/baseline">Open baseline review</Link></section>;
  if (!run) return <section className="panel next-step-panel"><h2>Analyze existing areas.</h2><p className="muted">Recommendations are generated only for areas present in the confirmed snapshot and baseline evidence.</p><button className="primary-button" type="button" onClick={onStart} disabled={busy}>Create enhancement review</button></section>;
  const draftFor = (id: string): OperationDraft => drafts[id] ?? { kind: 'modify', path: '', content: '' };
  const approve = (recommendationId: string, risk: 'low' | 'medium' | 'high') => onAction(async () => {
    const operations = [operationFromDraft(draftFor(recommendationId))];
    const mutation: WorkflowMutationContext = { revision: run.revision ?? 1, idempotencyKey: `recommendation-approval-${run.enhancementRunId}-${recommendationId}-${run.revision ?? 1}`, previewHash: risk === 'low' ? undefined : await previewHash(operations), highRiskConfirmed: risk === 'high' };
    onUpdate((await approveRecommendation(run.enhancementRunId, recommendationId, true, operations, undefined, mutation)).run);
  });
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Enhancement recommendations</h2><span className="status-chip">{run.status.replaceAll('_', ' ')}</span></div><p className="muted">Base commit: <code>{run.baseCommit}</code> · Scope: {run.scopeMode === 'FULL' ? 'Complete project first' : 'Existing parts only'}</p><div className="workflow-list">{run.recommendations.map((item) => <article className="workflow-item" key={item.id}><div><strong>{item.title}</strong><p className="muted">{item.suggestedSolution}</p><span className="status-chip">{item.category} · {item.approvalState}</span>{item.evidenceRefs?.length ? <p className="muted">Evidence: {item.evidenceRefs.map((ref) => ref.path).join(', ')}</p> : null}<OperationEditor id={`recommendation-${item.id}`} draft={draftFor(item.id)} disabled={busy || item.approvalState !== 'awaiting_approval'} onChange={(draft) => setDrafts((current) => ({ ...current, [item.id]: draft }))} /></div><div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void approve(item.id, item.risk)} disabled={busy || item.approvalState !== 'awaiting_approval'}>Approve operation</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRecommendation(run.enhancementRunId, item.id, false, undefined, undefined, { revision: run.revision ?? 1, idempotencyKey: `recommendation-rejection-${run.enhancementRunId}-${item.id}-${run.revision ?? 1}` })).run))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Reject</button></div></article>)}</div>{run.warning ? <p className="inline-error">{run.warning}</p> : null}<div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await startVersion2(run.enhancementRunId, undefined, { revision: run.revision ?? 1, idempotencyKey: `version2-start-${run.enhancementRunId}-${run.revision ?? 1}` }); onVersion2(response.version2RunId); })} disabled={busy || run.status !== 'approved'}>Build Version 2</button></div></section>;
}

function DeliveryPanel({ version2RunId, receipt, busy, onAction, onReceipt }: { version2RunId: string | null; receipt: { status: string; url?: string | null; revision?: number } | null; busy: boolean; onAction: (operation: () => Promise<void>) => Promise<void>; onReceipt: (receipt: { status: string; url?: string | null; revision?: number }) => void }) {
  const [diff, setDiff] = useState<Array<{ path: string; kind: string; beforeSha256: string | null; afterSha256: string | null }> | null>(null);
  useEffect(() => {
    if (!version2RunId) return;
    const controller = new AbortController();
    void getVersion2State(version2RunId, controller.signal).then(({ version2 }) => onReceipt({ status: version2.receipt?.status ?? version2.deliveryStep ?? version2.status, url: version2.receipt?.url, revision: version2.revision })).catch(() => undefined);
    return () => controller.abort();
  }, [onReceipt, version2RunId]);
  useEffect(() => {
    if (!version2RunId) return;
    const controller = new AbortController();
    void getVersion2Diff(version2RunId, controller.signal).then(({ diff: result }) => setDiff(result.entries)).catch(() => undefined);
    return () => controller.abort();
  }, [version2RunId]);
  if (!version2RunId) return <section className="panel empty-page"><h2>No Version 2 run selected.</h2><p className="muted">Build Version 2 from an approved enhancement review first.</p><Link className="primary-button" to="/project/enhance">Open enhancement review</Link></section>;
  const revision = receipt?.revision ?? 1;
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Version 2 delivery</h2><span className="status-chip">{receipt?.status ?? 'building'}</span></div><p className="muted">The change manifest stays tied to the immutable base commit. Validation checks manifest integrity before pull-request preparation.</p>{diff ? <div className="workflow-list" aria-label="Exact Version 2 diff preview">{diff.map((entry) => <div className="workflow-item" key={`${entry.kind}:${entry.path}`}><strong>{entry.kind} · {entry.path}</strong><span className="muted">Before: {entry.beforeSha256 ?? 'absent'} · After: {entry.afterSha256 ?? 'absent'}</span></div>)}</div> : null}<div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await validateVersion2(version2RunId, undefined, { revision }); onReceipt({ status: response.status, revision: response.receipt.revision ?? revision + 1 }); })} disabled={busy || Boolean(receipt)}>Validate Version 2</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await preparePullRequest(version2RunId, undefined, { revision }); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url, revision: response.pullRequest.revision ?? revision + 1 }); })} disabled={busy || receipt?.status !== 'ready_for_pr'}>Prepare pull request</button><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await createPullRequest(version2RunId, undefined, { revision }); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url, revision: response.pullRequest.revision ?? revision + 1 }); })} disabled={busy || receipt?.status !== 'prepared'}>Create pull request</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await cancelVersion2(version2RunId, undefined, { revision }); onReceipt({ status: response.version2.status, revision: response.version2.revision }); })} disabled={busy || ['cancelled', 'created'].includes(receipt?.status ?? '')}>Cancel Version 2</button></div>{receipt?.url ? <a className="primary-button" href={receipt.url} target="_blank" rel="noreferrer">Open pull request</a> : null}</section>;
}

function RecoveryDeliveryPanel({ version2RunId, receipt, busy, onAction, onReceipt, onError }: { version2RunId: string | null; receipt: { status: string; url?: string | null; revision?: number; previewAcknowledged?: boolean } | null; busy: boolean; onAction: (operation: () => Promise<void>) => Promise<void>; onReceipt: (receipt: { status: string; url?: string | null; revision?: number; previewAcknowledged?: boolean }) => void; onError: (message: string) => void }) {
  const [diff, setDiff] = useState<Array<{ path: string; kind: string; beforeSha256: string | null; afterSha256: string | null }> | null>(null);
  const [diffHash, setDiffHash] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!version2RunId) return;
    const controller = new AbortController();
    void getVersion2State(version2RunId, controller.signal).then(({ version2 }) => { setLoaded(true); onReceipt({ status: version2.receipt?.status ?? version2.deliveryStep ?? version2.status, url: version2.receipt?.url, revision: version2.revision, previewAcknowledged: Boolean(version2.previewAcknowledgedHash) }); }).catch((reason: unknown) => { if (controller.signal.aborted) return; const message = reason instanceof Error ? reason.message : 'Version 2 state could not be loaded.'; setLoadError(message); onError(message); });
    return () => controller.abort();
  }, [onError, onReceipt, version2RunId]);
  useEffect(() => {
    if (!version2RunId) return;
    const controller = new AbortController();
    void getVersion2Diff(version2RunId, controller.signal).then(({ diff: result }) => { setDiff(result.entries); setDiffHash(result.diffHash); }).catch(() => undefined);
    return () => controller.abort();
  }, [version2RunId]);
  if (!version2RunId) return <section className="panel empty-page"><h2>No Version 2 run selected.</h2><p className="muted">Build Version 2 from an approved enhancement review first.</p><Link className="primary-button" to="/project/enhance">Open enhancement review</Link></section>;
  if (!loaded && !loadError) return <section className="panel next-step-panel" aria-live="polite"><h2>Loading Version 2 state…</h2><p className="muted">The server-authoritative delivery state is being restored.</p></section>;
  if (loadError) return <section className="panel next-step-panel"><h2>Version 2 state unavailable.</h2><p className="inline-error" role="alert">{loadError}</p><Link className="primary-button" to="/project/enhance">Return to enhancement review</Link></section>;
  const status = receipt?.status ?? 'building';
  const revision = receipt?.revision ?? 1;
  const canValidate = status === 'building' && Boolean(receipt?.previewAcknowledged);
  const canRetry = status === 'failed' || status === 'recovery_required';
  const canCancel = status === 'queued' || status === 'building' || status === 'validating' || canRetry;
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Version 2 delivery</h2><span className="status-chip">{status}</span></div><p className="muted">The change manifest stays tied to the immutable base commit. Validation checks manifest integrity before pull-request preparation.</p>{diff ? <div className="workflow-list" aria-label="Exact Version 2 diff preview">{diff.map((entry) => <div className="workflow-item" key={`${entry.kind}:${entry.path}`}><strong>{entry.kind} · {entry.path}</strong><span className="muted">Before: {entry.beforeSha256 ?? 'absent'} · After: {entry.afterSha256 ?? 'absent'}</span></div>)}</div> : null}<div className="workflow-actions"><button className="secondary-button" type="button" onClick={() => void onAction(async () => { if (!diffHash) throw new Error('The exact Version 2 diff is still loading.'); const response = await acknowledgeVersion2Diff(version2RunId, diffHash, undefined, { revision, idempotencyKey: `version2-preview-acknowledge-${version2RunId}-${revision}` }); onReceipt({ status, revision: response.version2.revision, previewAcknowledged: true }); })} disabled={busy || !diffHash || Boolean(receipt?.previewAcknowledged) || status !== 'building'}>Acknowledge exact diff</button><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await validateVersion2(version2RunId, undefined, { revision }); onReceipt({ status: response.status, revision: response.receipt.revision ?? revision + 1, previewAcknowledged: receipt?.previewAcknowledged }); })} disabled={busy || !canValidate}>Validate Version 2</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await retryVersion2(version2RunId, undefined, { revision }); onReceipt({ status: response.version2.status, revision: response.version2.revision, previewAcknowledged: false }); })} disabled={busy || !canRetry}>Rebuild Version 2</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await preparePullRequest(version2RunId, undefined, { revision }); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url, revision: response.pullRequest.revision ?? revision + 1, previewAcknowledged: receipt?.previewAcknowledged }); })} disabled={busy || status !== 'ready_for_pr'}>Prepare pull request</button><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await createPullRequest(version2RunId, undefined, { revision }); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url, revision: response.pullRequest.revision ?? revision + 1, previewAcknowledged: receipt?.previewAcknowledged }); })} disabled={busy || status !== 'prepared'}>Create pull request</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await cancelVersion2(version2RunId, undefined, { revision }); onReceipt({ status: response.version2.status, revision: response.version2.revision, previewAcknowledged: receipt?.previewAcknowledged }); })} disabled={busy || !canCancel}>Cancel</button></div>{receipt?.url ? <p className="success-message"><a href={receipt.url} target="_blank" rel="noreferrer">Open pull request</a></p> : null}</section>;
}
