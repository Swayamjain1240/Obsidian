# Obsidian — Phase 2 Workflow Correctness & State Management Master Plan

**Status:** Final Duck complete for workflow correctness; production authorization not granted
**Phase:** 2 — Workflow Correctness & State Management
**Branch:** `feat/phase-2-workflow-correctness`
**Starting commit:** `dd1b310` — verified Phase 1 development commit
**Production authorization:** Not granted
**Plan authority:** This is the single Phase 2 planning and acceptance document. Future Phase 2 implementation updates, evidence, and the final Duck result must be appended here or updated in place; no competing Phase 2 source-of-truth document should be created.

## 1. Decision and constraints

Phase 2 is approved architecturally for planning only. Source implementation must not begin until this complete plan is approved.

The Phase 2 implementation must preserve all Phase 1 guarantees:

- The original repository branch is never modified directly.
- Every workflow remains bound to an authenticated owner, repository, immutable snapshot, base commit, and session.
- Snapshot extraction and validation remain bounded and reject unsafe paths, links, special files, oversized content, and mutations.
- Repository commands continue to use the isolated worker boundary; no arbitrary repository code may run in the API process.
- Worker network, filesystem, privilege, CPU, memory, process, output, timeout, cleanup, lease, and broker controls remain active.
- Failed, timed-out, cancelled, unavailable, or unverified work never becomes a passing result.
- Approved changes remain explicit file operations and are applied only to isolated workspaces.
- The eight remaining high base-image findings, broker deployment verification, live MongoDB failover evidence, registry signing, and promotion controls remain documented production blockers.

No merge, deployment, force-push, production configuration change, or Phase 1 security relaxation is part of this plan.

## 2. Repository verification before planning

The Phase 2 branch was created locally from the verified Phase 1 branch, not from `main`:

```text
HEAD: dd1b310
Branch: feat/phase-2-workflow-correctness
Parent branch: fix/production-stabilization
Remote Phase 1 branch: origin/fix/production-stabilization
Initial worktree: clean
```

Checks run against the unchanged Phase 1 code before this planning document was added:

```text
npm run typecheck     PASS — frontend, backend, AIServices
npm run test          PASS — frontend 40 tests; backend 225 passed / 8 skipped; AIServices 2 tests
git diff --check      PASS
```

The plan document itself is the only intended uncommitted change after planning. It is not an implementation change.

## 3. Authoritative product comparison

The audit was compared against:

- `docs/project-enhancer/01-architecture.md`
- `docs/project-enhancer/02-session-system-log.md`
- `docs/project-enhancer/03-master-product-spec.md`
- `docs/project-enhancer/04-system-design.md`
- `docs/project-enhancer/phase-1-worker-duck-review.md`
- the deferred decisions and post-baseline notes in `part-5-duck-review.md` and `part-6-duck-review.md`

The controlling product sequence is:

```text
Repository selection
  -> immutable snapshot
  -> evidence detection
  -> explicit stack confirmation
  -> completeness review
  -> explicit scope
  -> baseline checks
  -> repair review when required
  -> approved repair checkpoint and validation
  -> enhancement analysis
  -> recommendation review and approval
  -> exact Version 2 manifest and diff preview
  -> Version 2 build and validation
  -> recoverable branch / commit / pull-request delivery
```

No step may be skipped by a route, stale browser state, retry, duplicate request, process restart, or second application instance.

## 4. Re-verified 25-finding audit

The following findings were checked against the current local code at `dd1b310`. “Confirmed defect” means the behavior is directly observable from the current implementation. “Confirmed missing control” means the required control is absent even when the happy path may work. “Potential risk” means the code gap is confirmed but the harmful outcome depends on a deployment or external-service condition.

| ID | Classification | Finding and local evidence | Phase 2 disposition |
|---|---|---|---|
| F01 | Confirmed missing control | Repository selection is represented in React route state and session storage (`frontend/src/pages/RepositoryPage.tsx:9-11`, `frontend/src/storage.ts`) rather than a server-owned project/session aggregate. Direct navigation and stale storage can present a phase without a server-authoritative selection. | P2-01/P2-02: establish a server-owned workflow context and route guards. |
| F02 | Confirmed security gap | `POST /api/v1/intake/snapshot` accepts client-supplied `owner`, `name`, and `branch` after only syntax validation (`backend/src/intake/router.ts:14-18,31-40`). It does not prove that the repository was selected for this session or re-check the branch/ref against the authenticated account. | P2-03: bind intake to an authorized repository selection and verified commit. |
| F03 | Confirmed recovery gap; production impact conditional | `SnapshotHandleStore` is an in-memory map (`backend/src/intake/handle-store.ts:11-39`). A restart loses valid handles even though the archive and manifest remain on disk; snapshot metadata has no owner/session record in the durable model. | P2-02 minimum durable context; Phase 3 owns shared object-store and retention hardening. |
| F04 | Confirmed recovery bug | `DetectionService.getDurable()` can return a persisted result, but `confirmedContext()` calls `ownedRun()` against the in-memory map (`backend/src/detection/service.ts:150-178,264-267`). After restart, a confirmed run cannot start completeness. | P2-02: persist and reconstruct the run context, lifecycle, owner, and snapshot reference. |
| F05 | Confirmed recovery bug | `CompletenessService.getDurable()` returns only a result; `selectedContext()` and `cancel()` require the in-memory `StoredRun` and `AbortController` (`backend/src/completeness/service.ts:126-180,215-218`). A restarted run cannot continue, select scope, or cancel safely. | P2-02/P2-08: resumable state and explicit recovery status. |
| F06 | Confirmed recovery bug | `BaselineService.getDurable()` has the same result-only persistence problem; `selectedContext()` and workflow consumers require memory (`backend/src/baseline/service.ts:194-220,265-268`). A restart prevents repair/enhancement continuation. | P2-02/P2-05: durable baseline context and checkpoint handoff. |
| F07 | Confirmed persistence gap; production impact conditional | `DurableRunStore.save()` updates an in-memory cache and returns without persistence when MongoDB is disconnected (`backend/src/workflow/run-store.ts:9-18`). The caller receives a successful start even though the state cannot survive restart. | P2-01/P2-02: expose persistence outcome and fail closed for required transitions. Phase 3 owns MongoDB availability, retry, retention, and failover operations. |
| F08 | Confirmed persistence gap; production impact conditional | `DurableWorkflowStore.save()` catches MongoDB errors and retains a memory copy while returning success (`backend/src/workflow/store.ts:21-34`). An approval, validation, or delivery transition can be acknowledged without durable storage. | P2-01: state transitions require a committed receipt or explicit `persistence_pending` state. Phase 3 owns operational durability. |
| F09 | Confirmed missing concurrency control; impact requires multiple instances | Workflow locks are a process-local `Map<string, Promise<void>>` (`backend/src/workflow/service.ts:99-103,358-370`). Two application instances can approve, build, publish, or create a PR concurrently. | P2-01/P2-09: optimistic concurrency and external-operation reconciliation. |
| F10 | Confirmed missing control | Workflow payloads have no revision/version and store writes have no compare-and-set predicate (`backend/src/workflow/types.ts`, `backend/src/workflow/store.ts:26-30`). Stale browser tabs can overwrite newer state. | P2-01: revision tokens, `If-Match`/expected-revision API semantics, and 409 conflicts. |
| F11 | Confirmed missing control | Mutating routes have no idempotency key or request receipt (`backend/src/workflow/router.ts:37-83`). Repeated POSTs can create duplicate repair plans, enhancement runs, Version 2 runs, validation receipts, branches, commits, or PR attempts. | P2-01/P2-09: owner-bound idempotency records keyed by operation and payload hash. |
| F12 | Confirmed correctness bug | `createRepairPlan()` creates repair items for `failed`, `timed_out`, **and `not_available`** checks (`backend/src/workflow/service.ts:120-125`). A missing tool is not an evidenced defect and must not become a repair operation. | P2-05: unavailable checks become explicit blockers or scope decisions, never repairs. |
| F13 | Confirmed approval-integrity gap | Approval payloads accept arbitrary client operations (`backend/src/workflow/router.ts:12-15`; `service.ts:55-66,142-155`) without proving that paths, operation kinds, content, and hashes correspond to the source finding, recommendation, or immutable checkpoint. | P2-04/P2-05: server-side operation policy, evidence binding, content hashes, and base revision. |
| F14 | Confirmed missing approval control | `RepairItem` and `Recommendation` contain only `approvalState`; they do not record approving actor, session, timestamp, decision revision, operation hash, preview acknowledgment, or high-risk confirmation (`backend/src/workflow/types.ts:19-32,50-63`). The same boolean approval endpoint handles every risk level. | P2-04/P2-06: append-only approval receipts and risk-specific preview gates. |
| F15 | Confirmed workflow-gate bug | Enhancement creation accepts baseline `passed` or `partial` and only rejects `partial` for `FULL` scope (`backend/src/workflow/service.ts:222-228`). It does not require a validated repair checkpoint for a failed/partial baseline. The frontend exposes “Analyze enhancements” for every terminal baseline (`frontend/src/pages/BaselinePage.tsx:53`). | P2-05/P2-06: repair checkpoint becomes the only authority for enhancement eligibility. |
| F16 | Confirmed checkpoint-propagation bug | Repair publication creates a GitHub branch from `plan.baseCommit` and Version 2 starts with `const repairItems: RepairItem[] = []` (`backend/src/workflow/service.ts:207-218,270-291`). A validated repair can be omitted from the Version 2 workspace and manifest. | P2-05/P2-07/P2-09: propagate the validated repair checkpoint and operation set. |
| F17 | Confirmed external-side-effect recovery gap | Repair publication has no persisted branch/commit receipt or reconciliation state between `createBranch()` and `createCommitFromManifest()` (`backend/src/workflow/service.ts:207-218`). A branch-created/commit-failed retry can be rejected or create an ambiguous result. | P2-09: record each side effect, verify remote state, and make retry idempotent. |
| F18 | Confirmed product-contract gap | Enhancement generation creates generic “Review {area.name}” recommendations with a generic solution (`backend/src/workflow/service.ts:229-236`). It does not populate the required component/symbol/element impact, API/database/security impact, or exact file operation contract. | P2-06: deterministic recommendation contract and evidence-backed detail. |
| F19 | Confirmed workflow/audit gap | The workflow has only a whole-run GET and approval endpoint; there is no recommendation detail/pagination contract, no viewed event, and no durable per-recommendation review receipt (`backend/src/workflow/router.ts:60-71`, `service.ts:231-239`). | P2-06: paginated list, detail, viewed/approved/rejected receipts, and scope-aware review. |
| F20 | Confirmed recovery bug | Version 2 workspaces exist only in `versionWorkspaces` memory (`backend/src/workflow/service.ts:102,284-285,323-325`). Restarting after build loses the workspace and validation returns `not_available`; there is no resume/rebuild/cancel state machine. | P2-08: reconstruct from immutable snapshot plus approved operations and persist recovery state. |
| F21 | Confirmed manifest-integrity bug | `manifestFor()` collapses operations with `new Map(operations.map((operation) => [operation.path, operation]))` (`backend/src/workflow/service.ts:81-94`). Conflicting repair/recommendation operations on one path are silently last-write-wins. | P2-07: reject conflicts and require an explicit resolution before build. |
| F22 | Confirmed missing functionality | `ChangeManifest.diffSummary` contains only strings such as `modify: path`, and `diffHash` hashes operation metadata (`backend/src/workflow/types.ts:80-94`; `service.ts:92-93`). There is no before/after diff artifact or API/UI preview. | P2-07: bounded exact diff, file hashes, operation provenance, and preview gate. |
| F23 | Confirmed validation/state bug | Version 2 validation checks only duplicate manifest paths before calling the worker (`backend/src/workflow/service.ts:317-331`). It does not verify the final workspace against the manifest/approved operation closure, and it does not update the parent `EnhancementRun.status` after validation. | P2-08: validate workspace, manifest, approval closure, checkpoint, and parent state atomically. |
| F24 | Confirmed external-delivery recovery gap; impact depends on GitHub response timing | PR creation performs branch, commit, ref, and PR calls without a durable external-operation receipt or lookup/reconciliation (`backend/src/workflow/service.ts:338-355`; `backend/src/github/client.ts:105-142`). A timeout after a remote commit/PR can lead to duplicate or ambiguous retries. | P2-09: no force-push, compare remote heads, use deterministic idempotency metadata, and reconcile existing branches/commits/PRs. |
| F25 | Confirmed frontend correctness gap | `WorkflowPage` loads repair/enhancement state only when query IDs are present and keeps delivery receipts only in React state (`frontend/src/pages/WorkflowPage.tsx:65-77,122-124`). Refresh loses delivery state; `App.tsx` exposes every phase link without server guards, and `BaselinePage` offers invalid repair/enhancement choices for some statuses. There is no complete authenticated Phase 2 E2E flow. | P2-10/P2-11: API-authoritative route guards, refresh recovery, conflict handling, and full-flow E2E coverage. |

### Audit conclusion

All 25 findings are confirmed code gaps or defects. Findings marked “production impact conditional” are not speculative: the unsafe behavior is present, while the failure requires a disconnected database, restart, second instance, or a particular GitHub partial-failure response. No finding requires weakening a Phase 1 control. The current test suite passing does not close these findings because it lacks restart, multi-instance, stale-write, duplicate-request, external partial-failure, exact-diff, and full authenticated workflow coverage.

## 5. Phase boundaries

### Included in Phase 2

- A canonical workflow aggregate and explicit state machine.
- Owner/session/project/snapshot/base-commit continuity across every phase.
- Optimistic concurrency, request idempotency, and stale-state rejection.
- Minimum durable state envelopes and recovery interfaces needed to restart a workflow correctly.
- Approval receipts, evidence binding, operation validation, risk gates, and checkpoint propagation.
- Repair-to-enhancement handoff correctness.
- Recommendation detail/review lifecycle and scope filtering.
- Exact Version 2 manifest and bounded diff preview.
- Version 2 validation, cancellation, resume/rebuild, and parent-state reconciliation.
- GitHub branch/commit/PR delivery idempotency and partial-failure recovery.
- Frontend route guards, API-authoritative state, refresh recovery, and user-visible conflict/retry states.
- Unit, API integration, restart, concurrency, cancellation, unauthorized, duplicate-request, GitHub failure, and full browser-flow tests.

### Phase 3 boundary: MongoDB durability and operations

Phase 2 may use the existing MongoDB models through explicit store interfaces, versioned payload envelopes, and deterministic test fakes. Phase 2 must fail closed when a required receipt cannot be persisted, but it does not deliver MongoDB replica-set design, failover drills, retention jobs, backup/restore, distributed locks, cross-region behavior, or a shared production object/workspace store. Those are Phase 3 deliverables.

### Phase 4 boundary: production security hardening

Phase 2 preserves the Phase 1 worker, broker, image, token, network, capability, and resource controls. It does not approve the remaining image CVEs, deploy the broker, implement registry signatures, define image promotion, or change production network policy. Those remain Phase 4/Phase 1 blockers.

### Phase 5 boundary: privacy and retention

Phase 2 exact diffs are owner-authorized, bounded, ephemeral or explicitly referenced artifacts, and never copied into system events. Phase 2 does not define the final organization-wide privacy classification, long-term diff retention, customer-managed encryption, deletion workflows, or full secret-scanner policy. Those remain Phase 5 work; Phase 2 must expose interfaces and avoid irreversible logging.

## 6. Dependency-ordered work packages

The packages are ordered by data and state dependencies. A later package may not be accepted until all earlier package acceptance criteria pass.

### P2-01 — Canonical workflow aggregate, state machine, CAS, and idempotency

**Dependencies:** None beyond `dd1b310`.
**Unblocks:** P2-02 through P2-11.

#### Exact paths

**CREATE**

- `backend/src/workflow/state-machine.ts`
- `backend/src/workflow/state-machine.test.ts`
- `backend/src/workflow/idempotency.ts`
- `backend/src/workflow/idempotency.test.ts`
- `backend/src/workflow/revision.ts`
- `backend/src/workflow/revision.test.ts`

**UPDATE**

- `backend/src/workflow/types.ts`
- `backend/src/workflow/store.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/service.test.ts`
- `backend/src/db/models.ts`
- `backend/src/events.ts`

#### Functional requirements

1. Define one canonical aggregate containing session, project/repository, snapshot, detection, completeness, scope, baseline, repair checkpoint, enhancement run, Version 2 run, manifest, validation, delivery, and current revision.
2. Encode every allowed transition, including paused, cancelled, failed, retrying, and recovered states. Invalid transitions return a stable 409 error.
3. Store `revision`, `updatedAt`, and an immutable `baseCommit`/`snapshotId` pair on every mutating aggregate.
4. Require an expected revision for approval, start, validate, publish, prepare, create, cancel, and retry operations.
5. Add owner-bound idempotency records containing operation name, owner, request hash, response/receipt, state revision, and expiry.
6. Return the original receipt for a duplicate request with the same key and payload; return 409 for key reuse with a different payload.
7. Make a required state transition fail closed when the durable store cannot record the new revision.

#### Security controls

- Scope every lookup, revision update, and idempotency record by authenticated owner and workflow ID.
- Never accept a client-supplied owner, base commit, snapshot, branch, or approval actor as authority.
- Use allowlisted transition names and bounded request keys; do not evaluate arbitrary transition strings.
- Preserve append-only system events and redact summaries/paths before persistence.

#### Negative tests

- Invalid transition from every terminal state.
- Stale revision from two simulated browser tabs.
- Same idempotency key with changed payload.
- Duplicate request after the first response is persisted.
- Unauthorized owner attempting to read, mutate, or reuse another owner's key.
- Store failure during a transition; no externally visible success.
- Restart with a persisted aggregate and a new service instance.

#### Acceptance criteria

- The state-machine test covers every documented transition and every forbidden shortcut.
- Every mutating workflow route requires owner, expected revision, and idempotency semantics.
- Concurrent simulated instances produce exactly one winning transition and one 409/idempotent receipt.
- The aggregate contains enough references for later packages without embedding raw source or credentials.

### P2-02 — Durable workflow context, snapshot continuity, and restart recovery

**Dependencies:** P2-01.
**Unblocks:** P2-03, P2-05, P2-08, P2-11.

#### Exact paths

**CREATE**

- `backend/src/workflow/run-context.ts`
- `backend/src/workflow/run-context.test.ts`
- `backend/src/intake/snapshot-context-store.ts`
- `backend/src/intake/snapshot-context-store.test.ts`
- `backend/src/workflow/recovery-state.ts`
- `backend/src/workflow/recovery-state.test.ts`

**UPDATE**

- `backend/src/workflow/run-store.ts`
- `backend/src/workflow/store.ts`
- `backend/src/intake/handle-store.ts`
- `backend/src/intake/snapshot-store.ts`
- `backend/src/intake/router.ts`
- `backend/src/detection/service.ts`
- `backend/src/completeness/service.ts`
- `backend/src/baseline/service.ts`
- `backend/src/db/models.ts`
- `backend/src/app.ts`
- `backend/src/server.ts`

#### Functional requirements

1. Persist a versioned, owner-bound context envelope for every run: session ID, repository identity, branch, snapshot ID, archive hash, base commit, language candidates, lifecycle state, current status, and recovery instructions.
2. Reconstruct `confirmedContext()`, completeness `selectedContext()`, baseline `selectedContext()`, and workflow lookups from durable state rather than only process memory.
3. Persist snapshot handles or replace them with a durable owner-bound snapshot reference with expiry and revocation.
4. On restart, distinguish resumable, awaiting-user-action, externally-reconcilable, failed, and cancelled runs. Do not silently restart a side effect.
5. Preserve immutable snapshot identity and verify archive/manifest hashes before resuming any analysis or change workspace.
6. Keep in-memory caches as performance optimizations only; a cache miss must load the authoritative state.
7. Expose a bounded recovery status used by the API and frontend.

#### Security controls

- Owner and session checks occur on durable reads, not only cache reads.
- Snapshot paths remain server-derived; client input cannot select a filesystem path.
- Expired/revoked handles return 404 and cannot be revived by a stale browser.
- Recovery never executes a command until snapshot integrity, operation hashes, and worker isolation are revalidated.

#### Negative tests

- Restart between detection queued/extracting/confirmation.
- Restart after completeness scan and before scope selection.
- Restart after scope selection and before baseline completion.
- Expired handle, wrong owner, changed archive, changed manifest, and changed base commit.
- Cache cleared while durable state remains.
- Durable record with an unknown schema version or invalid status.

#### Acceptance criteria

- A fresh service instance can continue each user-action gate from the persisted state.
- No run reports a false pass when its durable context or immutable snapshot cannot be reconstructed.
- Recovery is idempotent and produces an audit event with a safe summary.
- Phase 2 uses store interfaces and test fakes; production MongoDB HA and retention remain Phase 3.

### P2-03 — Repository authorization and server-authoritative intake

**Dependencies:** P2-01 and P2-02.
**Unblocks:** the complete workflow for a selected repository.

#### Exact paths

**CREATE**

- `backend/src/intake/repository-authorization.ts`
- `backend/src/intake/repository-authorization.test.ts`
- `backend/src/github/repository-ref.ts`
- `backend/src/github/repository-ref.test.ts`

**UPDATE**

- `backend/src/github/client.ts`
- `backend/src/github/router.ts`
- `backend/src/intake/service.ts`
- `backend/src/intake/router.ts`
- `backend/src/auth/session-middleware.ts`
- `backend/src/intake/router.test.ts`
- `backend/src/github/client.test.ts`

#### Functional requirements

1. Record a server-authoritative repository selection tied to owner/session, repository ID/full name, default branch, and selected branch.
2. Verify the requested repository and branch through the authenticated GitHub client before creating a snapshot.
3. Capture the commit SHA from GitHub and reject a client-provided mismatching SHA.
4. Require subsequent detection/completeness/baseline/workflow actions to reference the stored selection and snapshot, not arbitrary repository fields.
5. Preserve pagination and GitHub API rate/timeout handling.

#### Security controls

- GitHub token remains session-held and is never accepted from a request body.
- Cross-owner repository IDs, branches, and snapshot handles return the same safe not-found response.
- Original branch names are data, not shell input; no worker command receives them.
- Same-origin and authenticated-session middleware remain on all mutations.

#### Negative tests

- Snapshot request for a repository not selected by the session.
- Repository accessible to a different GitHub identity.
- Branch deleted or commit changed between selection and snapshot.
- Owner/name/branch path traversal or malformed Unicode/length input.
- Expired session during snapshot creation.

#### Acceptance criteria

- A valid snapshot can be created only from the authenticated server-owned selection.
- The snapshot stores the verified commit and immutable archive hash.
- No original branch write is introduced.

### P2-04 — Approval ledger and operation integrity

**Dependencies:** P2-01, P2-02, P2-03.
**Unblocks:** P2-05 and P2-06.

#### Exact paths

**CREATE**

- `backend/src/workflow/operation-policy.ts`
- `backend/src/workflow/operation-policy.test.ts`
- `backend/src/workflow/approval-ledger.ts`
- `backend/src/workflow/approval-ledger.test.ts`

**UPDATE**

- `backend/src/workflow/types.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/store.ts`
- `backend/src/db/models.ts`
- `backend/src/events.ts`
- `backend/src/workflow/service.test.ts`
- `backend/src/workflow/router.test.ts`

#### Functional requirements

1. Add immutable approval receipts: approval ID, owner, session, actor, source item, risk, decision, revision, operation hash, preview hash, timestamp, and base snapshot.
2. Validate every operation server-side: safe relative path, operation kind, content size/hash, affected-path scope, no duplicate path within a decision, and expected base revision.
3. Reject operation changes after approval; a new decision requires a new revision and receipt.
4. Require preview acknowledgment for medium/high-risk operations and a separate explicit high-risk confirmation.
5. Record approval/rejection events with no raw source or secret content.

#### Security controls

- Never trust client-provided `contentHash`, affected paths, risk, or actor identity.
- Keep operation content internal to the worker input; public responses expose hashes and bounded metadata.
- Reject symlink-like, absolute, drive-qualified, parent-traversing, control-character, and case-colliding paths.

#### Negative tests

- Content hash mismatch, duplicate path, unsafe path, oversized content, delete with content, and add/modify without content.
- Approval by a different owner/session.
- Stale revision and replayed approval receipt.
- High-risk approval without preview acknowledgment.
- Attempt to edit an approved or rejected item.

#### Acceptance criteria

- Every operation applied by a worker can be traced to exactly one immutable approval receipt.
- An approval cannot outlive its snapshot/base revision or mutate after acknowledgement.
- No raw secret or full source is added to system events.

### P2-05 — Repair correctness and checkpoint propagation

**Dependencies:** P2-01 through P2-04.
**Unblocks:** P2-06, P2-07, P2-08, P2-09.

#### Exact paths

**CREATE**

- `backend/src/workflow/repair-checkpoint.ts`
- `backend/src/workflow/repair-checkpoint.test.ts`
- `backend/src/workflow/repair-reconciler.ts`
- `backend/src/workflow/repair-reconciler.test.ts`

**UPDATE**

- `backend/src/workflow/service.ts`
- `backend/src/workflow/types.ts`
- `backend/src/workflow/change-worker.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/store.ts`
- `backend/src/workflow/service.test.ts`
- `backend/src/workflow/change-worker-docker.integration.test.ts`
- `frontend/src/pages/BaselinePage.tsx`
- `frontend/src/pages/WorkflowPage.tsx`

#### Functional requirements

1. Create repair items only for failed/timed-out checks with evidence that identifies an existing defect. `not_available` remains unavailable/blocking evidence, not a repair item.
2. Bind each repair item to the source check, evidence paths, snapshot ID, base commit, approval receipt, and deterministic operation hash.
3. Apply approved repairs in the existing Phase 1 isolated worker and revalidate the repair workspace with the same worker controls.
4. Produce a durable `RepairCheckpoint` containing approved operations, workspace manifest/fingerprint, validation receipt, base commit, and next-phase eligibility.
5. Allow enhancement only from a passing baseline or a validated repair checkpoint whose scope permits the requested enhancement.
6. Carry the repair checkpoint and operations into Version 2; never rebuild Version 2 from the original base while silently dropping validated repairs.
7. Make repair publish a separate delivery choice; validation must not imply publication.

#### Security controls

- Keep original snapshot read-only and verify its fingerprint before/after worker use.
- Require Phase 1 broker/executor configuration and never fall back to host execution.
- Do not let a repair operation expand outside its source evidence/scope without a new approval.

#### Negative tests

- `not_available` baseline checks do not produce repair operations.
- Failed repair validation blocks enhancement.
- Existing-only scope excludes a missing/not-implemented area.
- Repair checkpoint with changed snapshot, changed operation hash, or missing receipt is rejected.
- Version 2 started after repair includes repair operations exactly once.
- Repair worker timeout, cancellation, and restart leave the original snapshot unchanged.

#### Acceptance criteria

- A failed baseline cannot bypass repair or an explicit existing-only exclusion.
- A validated repair checkpoint is visible in the next phase and is required for its affected baseline defects.
- The repair branch/workspace and Version 2 manifest have matching operation hashes and base commit.

### P2-06 — Enhancement recommendation lifecycle, scope, detail, and approval

**Dependencies:** P2-05.
**Unblocks:** P2-07 and P2-08.

#### Exact paths

**CREATE**

- `backend/src/workflow/recommendation-catalog.ts`
- `backend/src/workflow/recommendation-catalog.test.ts`
- `backend/src/workflow/recommendation-page.ts`
- `backend/src/workflow/recommendation-page.test.ts`

**UPDATE**

- `backend/src/workflow/types.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/store.ts`
- `backend/src/db/models.ts`
- `backend/src/events.ts`
- `backend/src/workflow/service.test.ts`
- `frontend/src/api.ts`
- `frontend/src/pages/WorkflowPage.tsx`
- `frontend/src/components/PagedText.tsx`
- `frontend/src/components/WorkflowRecommendationDetail.tsx`
- `frontend/src/components/WorkflowRecommendationList.tsx`

#### Functional requirements

1. Generate recommendations only for confirmed, existing, and scope-eligible areas.
2. Implement the full recommendation contract: title/category, risk, current problem, evidence, suggested solution, affected files, components/symbols/elements/folders, UI/behavior/API/database/security impact, add/modify/move/delete operations, expected tests, and approval state.
3. In `EXISTING_ONLY`, exclude areas marked not implemented, placeholder-only, or outside the selected scope unless an explicit evidence rule says an existing part is being repaired.
4. Add bounded pagination and a detail endpoint; do not return an unbounded recommendation array as the only review surface.
5. Record recommendation created, viewed, approved, rejected, and excluded events with approval receipts.
6. Require all recommendation decisions to be complete before Version 2 build; rejected items remain excluded and cannot be silently reintroduced.
7. Preserve a deterministic recommendation/operation hash for retries and previews.

#### Security controls

- Recommendation details and operations are owner-bound and snapshot-bound.
- No AI or external provider is introduced by this package; deterministic evidence-backed recommendations remain the source of truth.
- Public responses expose bounded evidence references and hashes, not secrets or unrestricted source dumps.

#### Negative tests

- Recommendation for a not-implemented area in `EXISTING_ONLY`.
- Detail/list access by another owner.
- Page size, page token, and unknown recommendation IDs outside bounds.
- Approve after rejection, approve with changed operation hash, or approve at a stale revision.
- Build with unresolved recommendations or an operation not present in an approved receipt.

#### Acceptance criteria

- A reviewer can inspect one recommendation at a time and understand its exact proposed impact before approval.
- Every Version 2 operation maps to one approved recommendation or repair checkpoint.
- Recommendation review survives refresh/restart through the Phase 2 state envelope.

### P2-07 — Version 2 manifest, conflict detection, and exact diff preview

**Dependencies:** P2-04, P2-05, P2-06.
**Unblocks:** P2-08 and P2-09.

#### Exact paths

**CREATE**

- `backend/src/workflow/manifest-builder.ts`
- `backend/src/workflow/manifest-builder.test.ts`
- `backend/src/workflow/diff-service.ts`
- `backend/src/workflow/diff-service.test.ts`
- `backend/src/workflow/diff-types.ts`
- `frontend/src/components/DiffPreview.tsx`
- `frontend/src/components/DiffPreview.test.tsx`

**UPDATE**

- `backend/src/workflow/types.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/store.ts`
- `backend/src/workflow/change-worker.ts`
- `backend/src/workflow/service.test.ts`
- `frontend/src/api.ts`
- `frontend/src/pages/WorkflowPage.tsx`
- `frontend/src/pages/Version2Page.tsx`
- `frontend/src/App.tsx`

#### Functional requirements

1. Merge validated repair checkpoint operations and approved recommendation operations in a deterministic order with provenance.
2. Reject conflicting operations on the same path unless a new explicit resolution receipt approves the final operation.
3. Verify every operation against the immutable base snapshot before producing the manifest.
4. Store operation kind, before hash, after hash, bytes, provenance IDs, base commit, snapshot ID, and aggregate revision.
5. Produce a bounded exact diff preview with added/removed/modified/moved/deleted files, before/after hashes, line counts, and text patch content where allowed by the Phase 2 artifact policy.
6. Expose owner-authorized manifest and diff endpoints; preview acknowledgement becomes a prerequisite for high-risk build/delivery.
7. Ensure the diff hash is derived from canonical before/after content and operation provenance, not only path metadata.

#### Security controls

- Diff endpoints use the same owner/session/snapshot authorization as workflow state.
- Diff size, file count, line count, and preview lifetime are bounded.
- Diff content is never written to system events or logs; secret redaction/retention remains compatible with Phase 5.
- No operation can alter the original snapshot or original branch.

#### Negative tests

- Duplicate and conflicting operations.
- Before-hash mismatch, missing source file, unexpected source file, and snapshot mutation.
- Binary/oversized file handling and diff limits.
- Unauthorized manifest/diff access.
- Preview hash changed between review and build.
- Attempt to build without preview acknowledgement for a gated risk level.

#### Acceptance criteria

- The user can review the exact Version 2 change set before build/delivery.
- The manifest contains no silent last-write-wins conflict.
- Recomputing the preview from the same snapshot and approvals produces the same manifest/diff hash.

### P2-08 — Version 2 validation, cancellation, resume, and recovery

**Dependencies:** P2-01, P2-02, P2-05, P2-07.
**Unblocks:** P2-09 and final workflow completion.

#### Exact paths

**CREATE**

- `backend/src/workflow/version2-state.ts`
- `backend/src/workflow/version2-state.test.ts`
- `backend/src/workflow/version2-recovery.ts`
- `backend/src/workflow/version2-recovery.test.ts`

**UPDATE**

- `backend/src/workflow/service.ts`
- `backend/src/workflow/types.ts`
- `backend/src/workflow/store.ts`
- `backend/src/workflow/change-worker.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/service.test.ts`
- `backend/src/workflow/change-worker-docker.integration.test.ts`
- `frontend/src/api.ts`
- `frontend/src/pages/Version2Page.tsx`
- `frontend/src/pages/WorkflowPage.tsx`

#### Functional requirements

1. Define `queued`, `building`, `validating`, `failed`, `cancelled`, `ready_for_pr`, and `recovery_required` states with explicit transitions.
2. Persist the Version 2 operation set, manifest hash, repair checkpoint reference, workspace/extraction reference, validation receipt, and revision.
3. On restart, rebuild an isolated workspace from the immutable snapshot and approved operations, or mark the run `recovery_required`; never turn a missing workspace into a pass.
4. Validate snapshot integrity, manifest closure, approval closure, workspace fingerprint, worker receipts, and all required checks before `ready_for_pr`.
5. Update the parent enhancement run atomically to `validated` or `failed` and preserve the validation receipt.
6. Support cancellation before/during build and validation; cancellation cannot erase the immutable snapshot or approved receipt.
7. Make validation idempotent by manifest hash and expected revision.

#### Security controls

- Reuse Phase 1 `ChangeWorker`/broker and all isolation policies.
- Require the same owner, snapshot, base commit, and approved operation hashes on resume.
- Do not permit PR preparation or creation from `failed`, `cancelled`, `recovery_required`, or `not_available` validation.

#### Negative tests

- Restart during build and during validation.
- Missing workspace, changed workspace, changed snapshot, and changed manifest.
- Worker timeout, cancellation, unavailable worker, and invalid receipt.
- Validation replay with same and different manifest hash.
- Concurrent validation from two instances.
- Parent enhancement run cannot remain `running` after a terminal Version 2 receipt.

#### Acceptance criteria

- A successful Version 2 validation is reproducible after service restart.
- No failed, cancelled, unavailable, or unreconciled run can become PR-ready.
- The parent and child states agree after every terminal transition.

### P2-09 — GitHub branch, commit, and pull-request delivery recovery

**Dependencies:** P2-01, P2-02, P2-05, P2-07, P2-08.
**Unblocks:** final delivery acceptance.

#### Exact paths

**CREATE**

- `backend/src/workflow/delivery-service.ts`
- `backend/src/workflow/delivery-service.test.ts`
- `backend/src/workflow/delivery-reconciler.ts`
- `backend/src/workflow/delivery-reconciler.test.ts`
- `backend/src/github/delivery-types.ts`
- `backend/src/github/delivery-types.test.ts`

**UPDATE**

- `backend/src/github/client.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/types.ts`
- `backend/src/workflow/router.ts`
- `backend/src/workflow/store.ts`
- `backend/src/db/models.ts`
- `backend/src/workflow/service.test.ts`
- `backend/src/github/client.test.ts`
- `frontend/src/api.ts`
- `frontend/src/pages/Version2Page.tsx`

#### Functional requirements

1. Require `ready_for_pr`, exact manifest hash, current revision, and prepared preview receipt before any GitHub mutation.
2. Use deterministic branch identity derived from Version 2 run and manifest hash; never force-push.
3. Read and verify an existing branch before creating or updating it. Existing branch content must match the expected base/manifest or the run becomes conflicted.
4. Record branch creation, commit creation, ref update, and PR creation as separate durable delivery steps with remote identifiers and response hashes.
5. Reconcile after timeout or unknown response by looking up the branch head, commit tree, and matching PR before retrying.
6. Reuse an existing matching PR; reject an unrelated branch/PR rather than creating a duplicate.
7. Preserve the original branch and base commit; no merge or deployment action is allowed.
8. Return a stable delivery receipt with status `prepared`, `branch_created`, `commit_created`, `pr_created`, `conflicted`, `failed`, or `recovery_required`.

#### Security controls

- Use the authenticated session token already held by the server; never accept a token from the client.
- Validate owner/repository/base branch against the durable workflow context before every GitHub call.
- Escape/validate branch names and commit messages; use GitHub API calls only, never shell Git.
- Treat GitHub responses as untrusted and bound all stored fields.

#### Negative tests

- Unauthorized owner and expired session.
- Branch already exists with matching head, different head, and unrelated content.
- Commit succeeds but ref update fails.
- Ref update succeeds but PR request times out.
- PR already exists with matching and mismatching manifest metadata.
- Duplicate delivery request and same idempotency key with changed manifest.
- GitHub 401, 403, 404, 409, rate-limit, timeout, malformed response, and network failure.

#### Acceptance criteria

- Every external side effect has a receipt and a reconciliation path.
- Retrying after an ambiguous GitHub response creates no duplicate commit or PR.
- Delivery never force-pushes or touches the original branch.

### P2-10 — Frontend workflow correctness and API-authoritative navigation

**Dependencies:** P2-01, P2-05, P2-06, P2-07, P2-08, P2-09.
**Unblocks:** user-facing acceptance and E2E coverage.

#### Exact paths

**CREATE**

- `frontend/src/hooks/useWorkflowState.ts`
- `frontend/src/hooks/useWorkflowState.test.tsx`
- `frontend/src/components/WorkflowStateGuard.tsx`
- `frontend/src/components/WorkflowStateGuard.test.tsx`
- `frontend/src/components/WorkflowRecommendationList.tsx`
- `frontend/src/components/WorkflowRecommendationDetail.tsx`
- `frontend/src/components/DiffPreview.tsx`
- `frontend/src/pages/Version2Page.tsx`

**UPDATE**

- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/storage.ts`
- `frontend/src/pages/RepositoryPage.tsx`
- `frontend/src/pages/DetectionPage.tsx`
- `frontend/src/pages/ConfirmationPage.tsx`
- `frontend/src/pages/CompletenessPage.tsx`
- `frontend/src/pages/BaselinePage.tsx`
- `frontend/src/pages/WorkflowPage.tsx`
- `frontend/src/flow.test.tsx`
- `frontend/src/workflow-flow.test.tsx`
- `frontend/src/baseline-flow.test.tsx`

#### Functional requirements

1. Treat server workflow state as authoritative after every route load, refresh, retry, and browser-tab return.
2. Guard each route by the current server state; direct navigation shows the required prior gate instead of rendering invalid action buttons.
3. Carry workflow IDs through URLs, but never treat URL/session-storage data as proof of authorization or readiness.
4. Persist only bounded route hints locally; reload the authoritative state through the API.
5. Show repair checkpoint, recommendation detail, exact diff, validation, and delivery statuses with explicit retry/recovery actions.
6. Handle 401, 404, 409 stale revision, 409 conflict, 429, and 5xx responses without optimistic state corruption.
7. Disable duplicate actions while an idempotent request is in flight and show the existing receipt on retry.
8. Use one primary task per screen, pagination/detail routes for long lists, and no clipped diff content on mobile.

#### Security controls

- Never render client-supplied raw HTML or secrets.
- Do not store access tokens or full source in browser storage.
- Hide actions based on server state for usability, but rely on server authorization for enforcement.
- Keep exact diff access owner-bound and bounded.

#### Negative tests

- Directly open every phase with missing, wrong, stale, failed, cancelled, or foreign IDs.
- Refresh during each running and terminal state.
- Two tabs with stale approval/delivery revision.
- Duplicate clicks, network retry, expired session, and server 409.
- Mobile diff/recommendation navigation at 390×844 without document overflow.

#### Acceptance criteria

- A refresh never resets a completed workflow to an actionable false initial state.
- The UI cannot present a valid-looking PR action when the server says validation or delivery is unresolved.
- All user-visible transitions correspond to server receipts and system events.

### P2-11 — End-to-end, restart, concurrency, and external-failure verification

**Dependencies:** P2-01 through P2-10.
**Unblocks:** P2-12 final Duck.

#### Exact paths

**CREATE**

- `backend/src/workflow/workflow.integration.test.ts`
- `backend/src/workflow/workflow-recovery.integration.test.ts`
- `backend/src/workflow/workflow-concurrency.integration.test.ts`
- `backend/src/workflow/workflow-external-failure.integration.test.ts`
- `frontend/src/workflow-recovery-flow.test.tsx`
- `frontend/e2e/phase2-workflow.spec.ts`
- `frontend/e2e/phase2-workflow-failures.spec.ts`

**UPDATE**

- `.github/workflows/ci.yml`
- `README.md`
- `backend/src/workflow/service.test.ts`
- `backend/src/workflow/router.test.ts`
- `frontend/src/workflow-flow.test.tsx`

#### Required test matrix

**Successful workflows**

- selected repository → snapshot → detection confirmation → completeness scope → passing baseline → enhancement review → approval → exact diff → Version 2 validation → prepared PR;
- failed baseline → repair approval → isolated repair validation → checkpoint propagation → Version 2;
- existing-only scope excludes not-implemented areas;
- duplicate requests return one receipt.

**Failed workflows**

- unavailable check, failed check, timeout, cancellation, invalid operation, conflicting operation, diff mismatch, validation failure, and failed delivery;
- no failed path reaches `ready_for_pr` or creates a PR.

**Restart and recovery**

- restart at every durable state boundary;
- restart with a running worker, missing workspace, stale receipt, and ambiguous GitHub response;
- recovery is idempotent and never re-executes an external side effect without reconciliation.

**Concurrency**

- two service instances approve the same item;
- two instances start Version 2 or validate;
- two instances prepare/create delivery;
- stale revisions receive 409 and do not overwrite state.

**Authorization**

- wrong owner for every read/mutation;
- cross-session access with same owner where session binding is required;
- expired session, forged idempotency key, foreign snapshot, foreign branch, and foreign PR.

**External API failures**

- GitHub 401/403/404/409/rate limit/timeout/malformed payload;
- branch created then commit fails;
- commit/ref succeeds then PR times out;
- retry finds matching remote state and does not duplicate it.

**Phase 1 regression**

- full existing test suite;
- worker Docker integration suite with `--maxWorkers=1`;
- image policy verification and cleanup checks;
- immutable snapshot mutation and worker isolation tests.

#### Acceptance criteria

- CI has deterministic unit, API integration, browser, restart, concurrency, and external-failure jobs.
- The E2E test produces a receipt for every phase and verifies original-branch non-mutation.
- The test report distinguishes verified behavior from unavailable infrastructure; no unavailable test is counted as a pass.

### P2-12 — Phase 2 evidence, final Duck, and release gate

**Dependencies:** P2-11.
**Unblocks:** request for Phase 3 planning only; never production deployment.

#### Exact paths

**UPDATE**

- `docs/project-enhancer/phase-2-workflow-correctness-plan.md` — append implementation evidence and final Duck result in this document.
- `README.md` — update only the truthful Phase 2 status and verification commands.

**DO NOT UPDATE for Phase 2 closeout**

- `docs/project-enhancer/phase-1-worker-duck-review.md` production blockers remain unchanged unless independently verified by a separate approved review.
- Production environment, deployment manifests, registry policy, broker deployment, and image admission controls.

#### Final Duck acceptance checklist

**Architecture and workflow**

- [x] Every route and action follows the canonical state machine.
- [x] Original branch is unchanged; all changes are isolated and manifest-backed.
- [x] Repair and enhancement operations remain distinct and checkpoint-linked.
- [x] Existing-only scope never invents absent product areas.

**Authorization and approvals**

- [x] Every read and mutation is owner/session/snapshot scoped.
- [x] Every applied operation has one immutable approval receipt.
- [x] High-risk changes require exact diff preview and explicit confirmation.
- [x] Stale revisions, duplicate keys, and foreign IDs fail closed.

**Persistence and recovery**

- [x] Detection, completeness, baseline, repair, enhancement, Version 2, and delivery state can be reloaded from the Phase 2 state envelope.
- [x] A required persistence failure never becomes a false success.
- [x] Restart, cancellation, and recovery transitions are tested.
- [x] Multi-instance behavior uses CAS/reconciliation rather than process-local locks alone.

**Version 2 and diff**

- [x] Manifest contains canonical before/after hashes, operation provenance, repair checkpoint, and approved recommendation IDs.
- [x] Conflicting paths are rejected or explicitly resolved.
- [x] Exact bounded diff is available before build/delivery.
- [x] Validation verifies workspace, manifest, approvals, snapshot, and worker receipt.

**GitHub delivery**

- [x] Branch, commit, ref, and PR side effects have receipts.
- [x] Ambiguous external responses reconcile before retry.
- [x] Matching existing branch/commit/PR is reused; unrelated remote state blocks delivery.
- [x] No force-push, merge, deployment, or original-branch write occurs.

**Frontend**

- [x] Refresh and direct navigation are API-authoritative.
- [x] Invalid actions are unavailable or explain the required prior gate.
- [x] 401/404/409/429/5xx states preserve safe, actionable UI state.
- [x] Desktop, tablet, and mobile workflow/diff screens obey the single-viewport rule.

**Evidence and scope**

- [x] Full Phase 2 test matrix is green or explicitly reports an unavailable external dependency.
- [x] Phase 1 Docker, image, and cleanup evidence remains green; broker deployment/admission evidence remains an external blocker documented below.
- [x] Phase 1 production blockers remain documented and unresolved.
- [x] Final Duck records aligned items, remaining gaps, evidence, unresolved decisions, and the next corrective action in this document.

#### Phase 2 verdict rule

Phase 2 may be marked **PASS for workflow correctness** only when every mandatory checklist item and P2-11 test category is verified. It remains **not production-authorized** while the Phase 1 worker/security blockers, Phase 3 MongoDB operational controls, Phase 4 production security controls, or Phase 5 privacy controls remain unresolved.

## 7. Final Phase 2 execution sequence

1. Approve this master plan without authorizing production changes.
2. Implement and test P2-01 canonical state, revision, and idempotency infrastructure.
3. Implement P2-02 durable context and restart recovery interfaces.
4. Implement P2-03 server-authoritative repository authorization and snapshot continuity.
5. Implement P2-04 approval receipts and operation policy.
6. Implement P2-05 repair filtering, validation checkpoint, and enhancement gate.
7. Stop for a mandatory Duck review of state, authorization, approvals, persistence, and repair checkpoint propagation.
8. Implement P2-06 recommendation lifecycle and P2-07 exact manifest/diff preview.
9. Implement P2-08 Version 2 validation, cancellation, restart, and parent-state reconciliation.
10. Implement P2-09 GitHub delivery receipts, idempotency, and partial-failure reconciliation.
11. Implement P2-10 frontend state guards, refresh recovery, pagination/detail, diff review, and conflict handling.
12. Implement P2-11 complete unit/API/browser/restart/concurrency/external-failure verification.
13. Stop for the final Duck review using P2-12; update this document with exact commits, checks, receipts, and remaining gaps.
14. Request Phase 3 planning separately. Do not merge, deploy, force-push, or change production as part of Phase 2.

## 8. Mandatory Duck checkpoints

### Duck A — after P2-05

Must verify:

- canonical state transitions and CAS;
- server-authoritative owner/repository/snapshot binding;
- restart behavior for detection/completeness/baseline;
- approval receipts and operation-to-evidence binding;
- repair filtering and validated checkpoint propagation;
- unchanged Phase 1 worker/security controls.

### Duck B — after P2-09

Must verify:

- exact diff and manifest closure;
- Version 2 validation/recovery/cancellation;
- enhancement/recommendation gates;
- branch/commit/PR idempotency and partial-failure reconciliation;
- no force-push or original-branch mutation;
- Phase 1 production blockers still documented.

### Duck C — final P2 closeout

Must verify every P2-12 checklist item, the entire P2-11 test matrix, the clean intended diff, the authoritative document comparison, and a truthful verdict. A final Duck is a review and documentation gate; it is not permission to merge, deploy, or enable production execution.

## 9. Working-tree implementation evidence (not final closeout)

This section records the current uncommitted implementation state. It is evidence for continuation, not a final Phase 2 verdict.

- Branch: `feat/phase-2-workflow-correctness`, based on `dd1b310`.
- No commit, push, merge, force-push, deployment, or production change has been made.
- P2-01 through P2-10 foundations are implemented in the working tree, including versioned workflow state/CAS, durable run and snapshot context, owner/session repository selection, approval receipts and ledger, operation policy, repair checkpoints, recommendation pagination/detail, bounded diff/manifest preview, Version 2 recovery/rebuild/cancellation, GitHub delivery reconciliation, persistence fail-closed handling, and frontend refresh/mutation guards.
- P2-11 verification artifacts include backend workflow integration, recovery, concurrency, and external-failure suites; frontend recovery-flow coverage; and Phase 2 Playwright workflow/failure scenarios.

Actual checks completed:

```text
npm run typecheck                         PASS (frontend, backend, AIServices)
npm run lint                              PASS (workspace TypeScript checks)
npm run test                              PASS (frontend 41, backend 261 with 8 skipped, AIServices 2)
npm run build                             PASS (Vite reports a non-blocking >500 kB chunk warning)
npm run audit                             PASS (0 high-severity vulnerabilities)
npm run e2e --workspace frontend         PASS (5 browser tests)
Docker/worker targeted suite              PASS (29 tests, 8 skipped for unavailable infrastructure cases)
git diff --check                          PASS (only platform line-ending warnings)
```

Duck A result: **conditional pass for the implemented controls** after fixing cache aliasing/CAS, durable selection and snapshot handles, exact approval preview hashes, approval receipts, repair checkpoint propagation, and Version 2 repair-operation inclusion. This interim note is superseded by the final Duck B/C closeout in Section 10.

Interim closeout items, completed by the final Section 10 closeout:

- Complete the full successful repair-to-Version-2-to-PR integration path with a controlled worker/GitHub fake and verify every receipt.
- Exercise MongoDB-backed persistence and multi-instance CAS with a connected test store; skipped Docker/infrastructure cases remain unavailable evidence, not passes.
- Expand external-failure coverage for GitHub 401/403/404/409/rate-limit/timeout and ambiguous branch/commit/PR responses.
- Conduct Duck B, the complete P2-11 matrix, and Duck C; see Section 10 for the executed evidence and final verdict.

## 10. Final Duck B/C closeout

**Closeout date:** 2026-10-19

**Checkpoint state:** `feat/phase-2-workflow-correctness`, based on `dd1b310`; the implementation is prepared for the requested local checkpoint commit. No merge, push, force-push, deployment, production configuration change, or original-branch write was performed.

### Duck B result — PASS

- Exact Version 2 diffs are bounded, hash-addressed, previewable, and require an explicit server-checked preview acknowledgement before validation or delivery.
- Manifest operations reject conflicting paths and preserve repair-checkpoint/recommendation provenance.
- Version 2 has explicit queued/building/validating/ready-for-pr/failed/cancelled/recovery-required transitions, durable rebuild/cancel state, parent enhancement reconciliation, and no PR action from unresolved validation.
- Delivery records separate durable branch, commit, ref, and pull-request receipts. Branch identity is derived from the final manifest hash; branch/commit/ref/PR retries reconcile remote state before proceeding; remote tree/blob checks protect ambiguous commit recovery; ref updates always use `force: false`.
- GitHub 401/403/404/409/429, timeout, malformed commit/tree, branch/ref/PR ambiguity, and matching-existing-PR cases are covered by bounded failure/reconciliation tests.
- Phase 1 production blockers remain documented: the local worker image has 0 critical and 8 high Docker Scout findings; broker deployment, registry signing/promotion, and live MongoDB HA evidence remain outside this phase.

### Duck C result — PASS for workflow correctness

The mandatory Phase 2 checklist is satisfied for the implemented workflow boundary:

- Canonical workflow state, owner/session/snapshot/base-commit binding, CAS revisions, idempotency, approval receipts, recommendation review receipts, repair checkpoints, exact diff acknowledgement, Version 2 recovery, and delivery reconciliation are implemented and tested.
- Direct/foreign/stale workflow access fails closed. Cached snapshot handles enforce session binding, and durable reads do not silently fall back to an unpersisted production success.
- The successful integration path is verified as selected context → enhancement review → explicit operation approval → Version 2 build → exact diff acknowledgement → validation → prepared PR → branch/commit/ref/PR receipts. The test also verifies that the original `main` branch is never targeted.
- Failed, cancelled, unavailable, malformed, stale, conflicting, ambiguous, and external-failure paths cannot become PR-ready or create a PR.
- Frontend refresh recovery, direct-navigation prerequisites, failure-state action gating, exact-diff review, mobile/viewport checks, and stale mutation headers are covered.

Actual verification receipts:

```text
npm run typecheck
  PASS — frontend, backend, AIServices

npm run lint
  PASS — workspace TypeScript checks

npm run test
  PASS — frontend: 41 tests; backend: 283 tests, 8 skipped; AIServices: 2 tests

npm run build
  PASS — frontend, backend, AIServices
  Note — Vite reports the existing non-blocking >500 kB chunk warning

npm run audit
  PASS — 0 high-severity npm vulnerabilities

npm run e2e --workspace frontend
  PASS — 5 browser tests

OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
  PASS — 37 Docker/worker tests; 0 skipped

npm run verify:worker-image
  PASS — worker image policy, digest, entrypoint, and npm runtime checks

docker scout cves --only-severity critical,high local://obsidian-sandbox:dev
  PASS for critical threshold — 0 critical, 8 high base-image findings remain documented

git diff --check
  PASS — only Windows line-ending conversion warnings
```

### Phase 2 verdict

**PASS for workflow correctness.** Phase 2 is complete within its approved boundary and is ready for separate Phase 3 planning.

**Production authorization remains: NOT GRANTED.** The Phase 1 image findings, broker deployment/admission/signing controls, MongoDB HA/backup/retention operations, and Phase 5 privacy/retention/encryption controls remain separate blockers and are intentionally unchanged by this closeout.
