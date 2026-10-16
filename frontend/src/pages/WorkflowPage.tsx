import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  approveRecommendation,
  approveRepairItem,
  createPullRequest,
  createEnhancementRun,
  createRepairPlan,
  getEnhancementRun,
  getRepairPlan,
  preparePullRequest,
  publishRepairBranch,
  startRepair,
  startVersion2,
  validateRepair,
  validateVersion2,
  type EnhancementRun,
  type RepairPlan,
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
  const [receipt, setReceipt] = useState<{ status: string; url?: string | null } | null>(null);
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
    const response = await createRepairPlan(baselineRunId);
    setPlan(response.plan);
    navigate(`/project/repair?planId=${encodeURIComponent(response.plan.planId)}&baselineRunId=${encodeURIComponent(baselineRunId)}`, { replace: true });
  });
  const enhancementStart = () => act(async () => {
    if (!baselineRunId) throw new Error('Open this phase from a completed baseline run.');
    const response = await createEnhancementRun(baselineRunId);
    setEnhancement(response.run);
    navigate(`/project/enhance?runId=${encodeURIComponent(response.run.enhancementRunId)}&baselineRunId=${encodeURIComponent(baselineRunId)}`, { replace: true });
  });

  return (
    <section className="page-layout workflow-layout" aria-labelledby="workflow-title">
      <div className="page-intro"><span className="eyebrow">Post-baseline workflow</span><h1 id="workflow-title">Review changes before they exist.</h1><p className="muted">Every repair, recommendation, and Version 2 operation stays owner-bound, reviewable, and tied to the original base commit.</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {mode === 'repair' ? <RepairPanel plan={plan} busy={busy} onStart={repairStart} onUpdate={setPlan} onAction={act} /> : null}
      {mode === 'enhance' ? <EnhancementPanel run={enhancement} busy={busy} onStart={enhancementStart} onUpdate={setEnhancement} onAction={act} onVersion2={(id) => navigate(`/project/delivery?version2RunId=${encodeURIComponent(id)}`)} /> : null}
      {mode === 'delivery' ? <DeliveryPanel version2RunId={version2RunId} receipt={receipt} busy={busy} onAction={act} onReceipt={setReceipt} /> : null}
    </section>
  );
}

function RepairPanel({ plan, busy, onStart, onUpdate, onAction }: { plan: RepairPlan | null; busy: boolean; onStart: () => void; onUpdate: (plan: RepairPlan) => void; onAction: (operation: () => Promise<void>) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, OperationDraft>>({});
  if (!plan) return <section className="panel next-step-panel"><h2>Build the repair review.</h2><p className="muted">Baseline failures and unavailable checks become explicit repair items. Nothing is changed automatically.</p><button className="primary-button" type="button" onClick={onStart} disabled={busy}>Create repair plan</button></section>;
  const draftFor = (id: string): OperationDraft => drafts[id] ?? { kind: 'modify', path: '', content: '' };
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Repair review</h2><span className="status-chip">{plan.status.replaceAll('_', ' ')}</span></div><p className="muted">Base commit: <code>{plan.baseCommit}</code>{plan.branchName ? ` · ${plan.branchName}` : ''}</p><div className="workflow-list">{plan.items.map((item) => <article className="workflow-item" key={item.id}><div><strong>{item.title}</strong><p className="muted">{item.reason}</p><span className="status-chip">{item.approvalState} · {item.workerStatus}</span><OperationEditor id={`repair-${item.id}`} draft={draftFor(item.id)} disabled={busy || item.approvalState !== 'awaiting_approval'} onChange={(draft) => setDrafts((current) => ({ ...current, [item.id]: draft }))} /></div><div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRepairItem(plan.planId, item.id, true, [operationFromDraft(draftFor(item.id))])).plan))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Approve operation</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRepairItem(plan.planId, item.id, false)).plan))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Reject</button></div></article>)}</div>{plan.warning ? <p className="inline-error">{plan.warning}</p> : null}<div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => onUpdate((await startRepair(plan.planId)).plan))} disabled={busy || plan.status !== 'approved'}>Start repair worker</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await validateRepair(plan.planId)).plan))} disabled={busy || plan.status !== 'running'}>Validate repairs</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await publishRepairBranch(plan.planId)).plan))} disabled={busy || plan.status !== 'validated'}>Publish repair branch</button><Link className="secondary-button" to={`/project/enhance?baselineRunId=${encodeURIComponent(plan.baselineRunId)}`}>Continue to enhancement review</Link></div></section>;
}

function EnhancementPanel({ run, busy, onStart, onUpdate, onAction, onVersion2 }: { run: EnhancementRun | null; busy: boolean; onStart: () => void; onUpdate: (run: EnhancementRun) => void; onAction: (operation: () => Promise<void>) => Promise<void>; onVersion2: (id: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, OperationDraft>>({});
  if (!run) return <section className="panel next-step-panel"><h2>Analyze existing areas.</h2><p className="muted">Recommendations are generated only for areas present in the confirmed snapshot and baseline evidence.</p><button className="primary-button" type="button" onClick={onStart} disabled={busy}>Create enhancement review</button></section>;
  const draftFor = (id: string): OperationDraft => drafts[id] ?? { kind: 'modify', path: '', content: '' };
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Enhancement recommendations</h2><span className="status-chip">{run.status.replaceAll('_', ' ')}</span></div><p className="muted">Base commit: <code>{run.baseCommit}</code> · Scope: {run.scopeMode === 'FULL' ? 'Complete project first' : 'Existing parts only'}</p><div className="workflow-list">{run.recommendations.map((item) => <article className="workflow-item" key={item.id}><div><strong>{item.title}</strong><p className="muted">{item.suggestedSolution}</p><span className="status-chip">{item.category} · {item.approvalState}</span><OperationEditor id={`recommendation-${item.id}`} draft={draftFor(item.id)} disabled={busy || item.approvalState !== 'awaiting_approval'} onChange={(draft) => setDrafts((current) => ({ ...current, [item.id]: draft }))} /></div><div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRecommendation(run.enhancementRunId, item.id, true, [operationFromDraft(draftFor(item.id))])).run))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Approve operation</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => onUpdate((await approveRecommendation(run.enhancementRunId, item.id, false)).run))} disabled={busy || item.approvalState !== 'awaiting_approval'}>Reject</button></div></article>)}</div>{run.warning ? <p className="inline-error">{run.warning}</p> : null}<div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await startVersion2(run.enhancementRunId); onVersion2(response.version2RunId); })} disabled={busy || run.status !== 'approved'}>Build Version 2</button></div></section>;
}

function DeliveryPanel({ version2RunId, receipt, busy, onAction, onReceipt }: { version2RunId: string | null; receipt: { status: string; url?: string | null } | null; busy: boolean; onAction: (operation: () => Promise<void>) => Promise<void>; onReceipt: (receipt: { status: string; url?: string | null }) => void }) {
  if (!version2RunId) return <section className="panel empty-page"><h2>No Version 2 run selected.</h2><p className="muted">Build Version 2 from an approved enhancement review first.</p><Link className="primary-button" to="/project/enhance">Open enhancement review</Link></section>;
  return <section className="panel workflow-panel"><div className="panel-heading"><h2>Version 2 delivery</h2><span className="status-chip">{receipt?.status ?? 'building'}</span></div><p className="muted">The change manifest stays tied to the immutable base commit. Validation checks manifest integrity before pull-request preparation.</p><div className="workflow-actions"><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await validateVersion2(version2RunId); onReceipt({ status: response.status }); })} disabled={busy || Boolean(receipt)}>Validate Version 2</button><button className="secondary-button" type="button" onClick={() => void onAction(async () => { const response = await preparePullRequest(version2RunId); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url }); })} disabled={busy || receipt?.status !== 'ready_for_pr' && receipt?.status !== 'passed'}>Prepare pull request</button><button className="primary-button" type="button" onClick={() => void onAction(async () => { const response = await createPullRequest(version2RunId); onReceipt({ status: response.pullRequest.status, url: response.pullRequest.url }); })} disabled={busy || receipt?.status !== 'prepared'}>Create pull request</button></div>{receipt?.url ? <a className="primary-button" href={receipt.url} target="_blank" rel="noreferrer">Open pull request</a> : null}</section>;
}
