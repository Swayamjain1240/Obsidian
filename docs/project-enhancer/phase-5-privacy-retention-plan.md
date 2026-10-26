# Obsidian — Phase 5 Privacy, Retention, Deletion, Encryption Lifecycle & Governance Plan

**Status:** Corrective fixes implemented; current local verification is green; Docker/infrastructure and policy evidence remain unavailable; no production authorization; no commit or push authorized
**Phase:** 5 — Privacy, Retention, Deletion, Encryption Lifecycle & Governance
**Branch:** `feat/phase-5-privacy-retention`
**Starting checkpoint:** `15cd69487d02da4c55175e0bae4c246986afbd7d`
**Production authorization:** Not granted

## 1. Authority, boundaries, and acceptance

This is the Phase 5 source of truth. Review against:

- `docs/project-enhancer/01-architecture.md`
- `docs/project-enhancer/02-session-system-log.md`
- `docs/project-enhancer/03-master-product-spec.md`
- `docs/project-enhancer/04-system-design.md`
- `docs/project-enhancer/phase-2-workflow-correctness-plan.md`
- `docs/project-enhancer/phase-3-mongodb-durability-plan.md`
- `docs/project-enhancer/phase-4-api-security-audit-plan.md`

Phase 5 adds privacy minimization, configurable retention, owner-scoped deletion, cleanup recovery, audit/privacy compatibility, and application-level encryption lifecycle boundaries. It does not alter the original GitHub repository, merge, deploy, force-push, begin Phase 6, or claim production KMS, backup erasure, physical storage sanitization, or external-provider deletion without evidence.

Acceptance requires:

1. Sensitive data is inventoried by purpose, owner, storage, access boundary, retention trigger, cleanup mechanism, backup limitation, and verification method.
2. Secret and private-source minimization is centralized and tested at event, error, diagnostic, AI-context, and artifact boundaries.
3. Retention is configurable, durable, restart-safe, idempotent, owner-scoped, and does not rely only on MongoDB TTL indexes.
4. User-authorized deletion is authenticated, owner-scoped, idempotent, resumable, explicit about partial failure, and safe around active workflows, leases, snapshots, and audit evidence.
5. Audit records remain metadata-only, integrity-verifiable, and protected from ordinary deletion; deletion outcomes never copy deleted sensitive content.
6. Application encryption uses authenticated encryption, key identifiers, rotation-aware envelopes, safe missing-key behavior, and no plaintext fallback when required.
7. Snapshot, worker, generated-artifact, and temporary-file cleanup is bounded, path-safe, retryable, and tested across terminal states and restart boundaries.

## 2. Repository verification and Duck event record

Before implementation, the repository was verified on `feat/phase-5-privacy-retention`:

```text
HEAD: 15cd69487d02da4c55175e0bae4c246986afbd7d
Parent: e53e16df4642b64ab3a10febab3866a6ff69534d
Branch: feat/phase-5-privacy-retention
Initial working tree: clean
Phase 4 branch head: 15cd69487d02da4c55175e0bae4c246986afbd7d
```

The following structured review records are documentation-time Duck review entries because the current product has no separate repository session-log writer for planning-time Duck reviews. They are not claimed as runtime events persisted in MongoDB. Runtime Duck-event persistence remains a follow-up gap unless a product session invokes an event writer explicitly.

### DUCK_REVIEW_REQUESTED

```json
{
  "event_type": "DUCK_REVIEW_REQUESTED",
  "phase": "privacy-retention",
  "status": "requested",
  "base_commit": "15cd69487d02da4c55175e0bae4c246986afbd7d",
  "scope": ["P5-01", "P5-02", "P5-03", "P5-04", "P5-05", "P5-06", "P5-07", "P5-08", "P5-09", "P5-10", "P5-11"]
}
```

### DUCK_REVIEW_COMPLETED — Duck 5-A

```json
{
  "event_type": "DUCK_REVIEW_COMPLETED",
  "phase": "privacy-retention",
  "checkpoint": "5-A",
  "status": "completed",
  "verdict": "CONDITIONAL_PASS",
  "base_commit": "15cd69487d02da4c55175e0bae4c246986afbd7d",
  "evidence_checked": ["01-architecture.md", "02-session-system-log.md", "03-master-product-spec.md", "04-system-design.md", "phase-2-workflow-correctness-plan.md", "phase-3-mongodb-durability-plan.md", "phase-4-api-security-audit-plan.md", "backend/src/config.ts", "backend/src/db/models.ts", "backend/src/events.ts", "backend/src/intake/snapshot-store.ts", "backend/src/intake/extraction-store.ts", "backend/src/workflow/change-worker.ts", "backend/src/workflow/service.ts"],
  "aligned_items": ["original repository remains review-first", "private source is snapshot/workspace scoped", "Phase 4 audit is immutable and integrity-evident", "worker execution remains isolated", "MongoDB is authoritative for required state"],
  "gaps": ["no central retention policy or cleanup worker", "no owner-scoped deletion state machine", "worker change workspaces are not reclaimed by lifecycle", "audit redaction does not cover cookies/private keys comprehensively", "no application encryption key-id/rotation envelope", "no privacy status endpoint"],
  "decisions_needed": ["organization-approved retention durations", "production key-management provider and rotation ownership", "audit evidence retention and subject-erasure policy", "backup/replica erasure contract"],
  "next_corrective_action": "Implement configurable policy and durable cleanup/deletion primitives without weakening Phase 4 audit or worker controls."
}
```

**Duck 5-A verdict:** CONDITIONAL PASS. The design is aligned enough to proceed because the gaps are the Phase 5 scope, but retention durations, audit-subject erasure, KMS ownership, and backup erasure remain explicit policy/deployment decisions. Broad implementation must not claim those decisions are resolved by local code.

## 3. Repository-backed data inventory

| Category | Purpose and sensitivity | Storage / owner | Access boundary | Retention trigger and default | Cleanup / backup limitation | Verification and residual risk |
|---|---|---|---|---|---|---|
| GitHub OAuth access token | Perform authorized GitHub API calls; credential and personal data | `AuthSessionModel` encrypted fields; `SessionStore` process cache; auth session owner | Authenticated server code only; never ordinary API response | Existing session expiry, default 8 hours; configurable `AUTH_SESSION_TTL_MS` | Durable delete on logout/deletion; MongoDB backups/replicas are outside app control | AES-GCM envelope tests; production key source/rotation remains deployment-dependent |
| Signed session identifier | Authenticate browser session; bearer-like secret | HttpOnly cookie and bounded in-memory session map | Same-site secure cookie and server verification | Existing session expiry; deletion invalidates durable/cache state | Cookie clearing and durable record deletion; old backups may retain historical ciphertext | Session tests; cookie/browser storage is outside server deletion once issued |
| Repository selection metadata | Bind owner/session to repository and branch | Workflow state `repository_selection` | Owner/session scoped | Workflow terminal retention default 30 days | Durable cleanup; remote GitHub repository is never deleted | Owner predicates and deletion tests; remote metadata can remain on GitHub |
| Repository snapshot archive/manifest | Immutable analysis input; private source and possible credentials | `SNAPSHOT_ROOT/<snapshotId>` archive, manifest, extraction workspace | Owner/session through handles and workflow context; workers receive derived path | Active workflow protected; terminal 7 days; abandoned 24 hours | Filesystem cleanup plus durable status; storage snapshots/backups not erased by app | Path/hash/lease tests; physical/media erasure cannot be claimed |
| Extraction workspace and manifest | Safe analysis workspace; private source | Snapshot `extraction/` directory | Worker and analysis services only | Tied to snapshot; terminal 24 hours after snapshot cleanup eligibility | Recursive bounded removal; interrupted cleanup retried | Path containment and cleanup tests; open handles/platform deletion can delay cleanup |
| Detection/completeness/baseline results | Evidence and summaries; may include private paths and personal metadata | Durable run envelopes and in-memory result caches | Owner/session scoped; public serializers omit raw content | Terminal 30 days; abandoned 7 days | Owner-scoped record cleanup; TTL is supplemental | Retention worker tests; MongoDB backup copies remain deployment concern |
| AI context/model diagnostics | Optional provider context; potentially private source | No current AI execution path; config only | Must be provider-scoped and minimized before future use | Default 24 hours if persisted; no raw source by default | Central minimizer and cleanup policy | Exclusion/redaction tests; external provider retention is unverified |
| Workflow approvals/manifests/diffs | Reviewable changes and approval evidence; source-derived | Workflow state, diff records, change workspaces | Owner/session/workflow scoped | Active workflow protected; terminal 30 days; preview 24 hours | Delete source-derived artifacts while preserving minimal audit metadata | Hash/ownership tests; user exports/backups may retain copies |
| Generated Version 2 workspace/artifacts | Isolated approved changes; private source | `SNAPSHOT_ROOT/workflow-changes` and workflow state | Worker/workflow owner only | Success/failure/cancel cleanup after 24 hours; recovery state retained until resolved | Safe recursive cleanup and retry state | Cleanup/restart tests; no remote branch deletion |
| Worker scratch/container output | Execute checks; may contain private source and command output | Docker tmpfs/container and bounded result summaries | Worker broker/lease owner | Cleanup on success/failure/cancel/timeout; recovery until verified | Broker cleanup and lease recovery; Docker volumes/media outside app guarantee | Docker tests when available; host/Docker forensic remnants are deployment risk |
| Security audit events | Trace sensitive actions without raw source/secrets | `SystemEventModel` immutable fields and integrity hash | Authorized operational/audit readers only | Default 365 days; deletion events retained as metadata | Ordinary deletion cannot remove/rewrites; archival/backup policy pending | Integrity verification and redaction tests; subject erasure conflicts require policy |
| Logs/errors | Operational diagnosis | Process/host logging; current app emits bounded summaries | Operators/runtime only | Deployment-defined; app policy caps diagnostic content | Central redaction before emission; host log rotation outside app | Log capture tests; current process logger integration remains limited |
| MongoDB backups/replicas | Durability and recovery | Operational MongoDB/backup infrastructure | Database operators | Outside app; must follow approved retention | App cannot verify physical or backup erasure | Document dependency; disposable backup tests do not prove production erasure |

## 4. Privacy threat model and decisions

| Threat | Local evidence | Mitigation | Residual risk |
|---|---|---|---|
| Token or cookie in diagnostics | `app.ts` and server error paths emit only request-safe summaries, but redaction is narrow | Central redaction covers authorization, cookies, private keys, common tokens, and bounded diagnostics | Pattern detection cannot identify every opaque secret |
| Raw source duplicated in results/prompts | Snapshot/workspace and operation content are separate from public serializers | Context minimizer excludes sensitive paths and bounds source excerpts; audit stores metadata only | Future providers may retain data outside this service |
| Orphaned snapshot/workspace | `SnapshotStore` and `ChangeWorker` create durable filesystem trees without lifecycle cleanup | Durable cleanup jobs track resource references and retry failures | Process crash during deletion can leave filesystem residue until retry |
| Cross-owner deletion | Existing stores have owner predicates but no deletion API | New deletion requests use owner/session/workflow predicates and generic not-found responses | Operational scripts must use the same owner-safe API |
| Audit deletion invalidates evidence | Phase 4 event schema is immutable and hash-verified | Audit records are protected; deletion records contain only metadata and references | Approved subject-erasure policy may require cryptographic erasure or restricted access |
| Plaintext fallback after key loss | Existing session encryption derives one key from `AUTH_SESSION_SECRET` without key IDs | New envelope requires key ID and authenticated decryption; required fields fail closed | Production KMS and rotation infrastructure are not available locally |

Policy decisions intentionally left configurable or deployment-dependent:

- Organization must approve retention durations and audit evidence access/erasure policy.
- Production must supply a managed key source and rotation process; local code only validates boundaries and supports key IDs.
- Backup, replica, external provider, filesystem-media, and Docker storage erasure cannot be claimed from this repository.

## 5. Planned implementation packages

### P5-01 / P5-02 / P5-03 — inventory, minimization, and redaction

Create `privacy/redaction.ts`, `privacy/context.ts`, and tests. Use deterministic redaction before event hashing, diagnostic persistence, and future AI/provider context construction. Never place raw source or tokens in audit metadata.

### P5-04 — central retention policy and durable cleanup

Create `privacy/retention.ts`, `privacy/cleanup.ts`, policy configuration, cleanup receipts, and model indexes. Cleanup is idempotent, owner-scoped, reference-aware, and fails visibly. TTL indexes are supplemental rather than the only enforcement.

### P5-05 / P5-09 — deletion lifecycle and privacy status

Create durable `deletion_request` state with `requested`, `blocked_active`, `running`, `partial`, `completed`, and `failed` states. Add owner-scoped authenticated request/status routes. Active leases/workflows block or require cancellation; no remote GitHub mutation is performed.

### P5-06 — audit compatibility

Protect immutable Phase 4 audit rows from ordinary deletion, add metadata-only deletion events, and verify integrity after cleanup. Retention cleanup must not rewrite existing event payloads or hashes.

### P5-07 — encryption lifecycle

Create an AES-256-GCM envelope with key IDs and injectable key resolver. Missing/invalid keys fail closed; rotation is explicit re-encryption, never silent plaintext fallback. Existing session encryption remains compatible until a configured keyring is supplied.

### P5-08 — snapshot/worker/artifact cleanup

Add safe path-contained filesystem removal, resource references, cleanup retries, and ChangeWorker cleanup hooks for success, failure, cancellation, and timeout. Never remove the immutable base snapshot while active references remain.

## 6. Duck 5-B and Duck 5-C gates

### Duck 5-B — after retention, deletion, audit, encryption, and cleanup implementation

Verify policy enforcement, active-workflow races, owner boundaries, partial failures, retry/restart behavior, audit integrity, missing-key fail-closed behavior, and worker/snapshot cleanup. Verdict must remain conditional if production key management, backups, or external provider erasure lacks evidence.

### Duck 5-C — final closeout

Compare implementation and exact test receipts against all four authoritative documents and Phase 2–4 plans. Record changed-file scope, skipped infrastructure, secrets scan, unresolved privacy/security/production blockers, and checkpoint readiness. This is not commit, push, merge, deployment, or Phase 6 authorization.

## 7. Evidence ledger

Implementation evidence, test commands, exact counts, skip explanations, and final Duck verdict will be appended here after each package. No result is marked passed until the command has executed on this branch.

## 8. Implementation receipts — P5-01 through P5-09

### Inventory, minimization, and redaction

- Added `backend/src/privacy/redaction.ts` as the shared boundary for authorization headers, cookies, bearer values, common provider tokens, JWT-shaped values, private-key blocks, secret assignments, sensitive object fields, and bounded diagnostics.
- `backend/src/events.ts` now uses the shared redactor before calculating the Phase 4 integrity hash, so raw secret material is not embedded in the hash input.
- Added `backend/src/privacy/context.ts` to exclude sensitive paths and bound source excerpts before any future AI/provider context construction. The repository currently has no enabled AI execution path; the boundary is implemented and tested for future callers.
- Public workflow serializers continue to remove operation content. New privacy APIs expose only status, counts, request/target identifiers, and bounded failure codes; internal owner and session identifiers are not returned.

### Retention and cleanup

- Added configurable retention durations for snapshots, workspaces, run state, previews, AI context, and audit records. Defaults are documented conservative development defaults pending organization approval.
- Added `PrivacyRetentionService` with durable `privacy_cleanup` tasks, due-time enforcement, restart-safe task reads, bounded due-task batches ordered by due time, idempotent filesystem cleanup, active-workflow protection, and retryable failure state. MongoDB TTL is supplemental; explicit cleanup is the enforcement path.
- Snapshot creation schedules a bounded snapshot cleanup task. Change-worker terminal paths clean generated workspaces after validation failure, cancellation, and repair validation; pull-request preparation can safely release the Version 2 workspace after the review receipt is persisted.
- Added a TTL index for durable authentication sessions. It is supplementary to explicit logout/account deletion and does not claim backup erasure.

### User-authorized deletion and privacy status

- Added `PrivacyDeletionService` and `/api/v1/privacy/status`, `/api/v1/privacy/deletions`, `/api/v1/privacy/deletions/:requestId`, and retry endpoints.
- Deletion request identifiers are deterministic owner/scope/target hashes, so repeated requests are idempotent across process retries. Durable creation uses revision-zero CAS semantics where available.
- Account and workflow deletion are owner/session scoped. Active workflow references block deletion. The configured `cancel` policy fails closed with `PRIVACY_CANCELLATION_REQUIRES_WORKFLOW_COORDINATION` rather than deleting active data without coordinated cancellation.
- Deletion removes owner-scoped workflow records and known snapshot/cleanup filesystem resources, clears durable authentication sessions for account deletion, and records only metadata-oriented deletion events. Audit records are never deleted by this workflow.
- Partial filesystem/database failures produce `partial` status and a retryable failure code. Recoverable persistence failures produce `failed` with `PRIVACY_RECOVERY_REQUIRED`; requested/running records are reconciled on retry and backend startup. No response claims complete deletion when a cleanup step failed.

### Audit compatibility and encryption lifecycle

- Added explicit `DurableEventStore.purgeBefore(cutoff, policyApproved)`; ordinary deletion cannot call it, and an approved policy flag is required before any audit purge. Existing immutable event rows and integrity hashes are unchanged by privacy deletion.
- Added AES-256-GCM envelopes with key identifiers, injectable keyring resolution, authenticated tamper detection, explicit rotation, missing-key fail-closed behavior, and configured parsing from `AUTH_TOKEN_ENCRYPTION_KEYS` plus `AUTH_TOKEN_ENCRYPTION_CURRENT_KEY_ID`.
- Privacy-only audit events use the required `baseCommit` field value `not_applicable` because account deletion has no trustworthy repository snapshot/base commit; no synthetic SHA is fabricated. Redaction-before-hashing and immutable event persistence remain unchanged.
- GitHub access-token persistence now records an optional encryption key ID and uses the configured keyring when supplied. Legacy `AUTH_SESSION_SECRET` encryption remains compatible for existing deployments without a configured keyring; no plaintext fallback exists when a key ID is present.
- Production KMS, key custody, rotation scheduling, database encryption-at-rest, backup/replica erasure, external-provider retention, and physical-media sanitization remain deployment dependencies and are not claimed here.

## 9. Duck 5-B — retention/deletion/encryption/cleanup review

**Review status:** CONDITIONAL PASS for local implementation evidence; production privacy authorization remains denied.

Evidence checked:

- Central redaction/context/encryption/retention/cleanup/deletion modules and tests.
- Workflow store owner-scoped list/delete operations and deterministic deletion request identity.
- Snapshot route scheduling, ChangeWorker cleanup, Version 2 cancellation/failure cleanup, session encryption key ID support, auth-session TTL index, and protected Phase 4 event storage.
- Focused command before final review fixes: `npm run test --workspace backend -- --maxWorkers=1 src/privacy src/app.test.ts src/events.test.ts src/events-store.test.ts src/auth/session-store.test.ts src/db/indexes.test.ts` — **12 test files passed, 26 tests passed, 0 failed**.
- Final privacy-only focused command: `npm run test --workspace backend -- --maxWorkers=1 src/privacy` — **7 test files passed, 14 tests passed, 0 failed**.
- Backend typecheck and lint both passed after the implementation.
- Full backend regression before final review fixes: **84 test files passed, 8 skipped; 319 passed, 14 skipped, 0 failed**.
- Final full backend regression before corrective fixes: **84 test files passed, 8 skipped; 321 passed, 14 skipped, 0 failed**.

Aligned controls:

- Original repository and immutable base snapshots remain untouched.
- Active workflow references protect retention cleanup and deletion; cleanup refuses path escape and symbolic links.
- Phase 4 audit persistence, redaction-before-hashing, integrity verification, and fail-closed required sinks remain active.
- Missing encryption keys and invalid ciphertext fail closed; configured key rotation is explicit.

Open decisions and blockers:

- Organization approval is still required for retention durations, audit evidence access/erasure, subject-erasure protocol, production KMS ownership, and backup/replica deletion contracts.
- The application cannot verify erasure from MongoDB backups, replicas, host logs, Docker storage, external AI providers, or physical media.
- Account deletion currently blocks active workflows rather than automatically coordinating cancellation; this is intentional fail-closed behavior.

### Final review corrections

- Retention cleanup now checks all owner-scoped active workflow-state kinds, not only `workflow_aggregate`, before removing a due resource.
- Successful privacy deletion removes completed `privacy_cleanup` task metadata instead of leaving filesystem target paths behind.
- Configured encryption keyrings reject duplicate key IDs rather than silently using the last duplicate.
- Workflow mutations invoked through the idempotency boundary now fail with a stable 409 while an account/resource deletion is durably in `requested` or `running` state, closing the local deletion-versus-new-mutation race.
- Cleanup now resolves canonical filesystem paths, rejects symlink roots/components/targets, recursively deletes only validated non-symlink trees, and preserves outside-root sentinels in parent/target/child-link regression tests.
- Deletion recovery now reconciles `requested` and `running` records after recoverable persistence failures and on backend startup; retry remains owner-scoped and idempotent.
- Cleanup batching now honors `PRIVACY_CLEANUP_BATCH_SIZE` and processes remaining due tasks on later runs.
- Privacy deletion responses omit internal `ownerUserId` and `sessionId` fields.

## Historical appendix — superseded verification and review receipts

The sections below preserve earlier Phase 5 review evidence, including transient failures and superseded implementation descriptions. They are retained for traceability and must not be used as the current verification summary. The authoritative current summary is in Section 15.

## 10. Final Duck 5-C — historical closeout

**Review status:** CONDITIONAL PASS for local privacy/security implementation and available regression evidence; production privacy authorization remains denied.

### Final verification receipts

```text
npm run test
  PASS — frontend: 41 passed; backend: 328 passed / 14 skipped; AIServices: 2 passed
  Aggregate: 371 passed / 14 skipped / 0 failed

npm run typecheck
  PASS — frontend, backend, AIServices

npm run lint
  PASS — frontend, backend, AIServices

npm run build
  PASS — frontend, backend, AIServices; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run test:mongodb
  UNAVAILABLE — Docker CLI 29.8.2, context desktop-linux; Docker server endpoint
  npipe:////./pipe/dockerDesktopLinuxEngine was unavailable. No disposable MongoDB evidence claimed.

OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
  NOT PASSED — 8 tests failed, 30 passed, 2 skipped. Each failed path was Docker-dependent and reported the unavailable Docker API/image; these failures are not declared harmless or converted into skips.

npm run verify:worker-image
  UNAVAILABLE — Docker API unavailable at npipe:////./pipe/dockerDesktopLinuxEngine; no worker-image policy/provenance result claimed

docker scout cves --only-severity critical,high local://obsidian-sandbox:dev
  UNAVAILABLE — local worker image could not be inspected because Docker was unavailable; no current Scout result claimed

git diff --check
  PASS — Windows line-ending warnings only
```

An earlier pre-correction full workspace invocation failed one timing-sensitive frontend `completeness-flow.test.tsx` case. The isolated test then passed **1/1**, and the complete pre-correction workspace rerun passed **364/364 executed tests** with **14 skipped**. The corrective full workspace rerun passed **371/371 executed tests** with **14 skipped**. The Docker-dependent attempt remains a failed infrastructure attempt, not successful validation.

### Privacy and security evidence

- Final focused Phase 5 command before corrective fixes: **7 test files, 14 tests passed, 0 failed**. The corrective focused command now passes **7 test files, 21 tests**, and the broader privacy-plus-regression command now passes **12 test files, 36 tests**.
- Coverage includes redaction of headers/cookies/tokens/private keys, source-context minimization, encryption round-trip/tampering/wrong-key/rotation behavior, contained cleanup, retention expiry and active-workflow protection, deterministic owner-scoped deletion, deletion retry/idempotency, privacy routes, audit purge approval, auth-session TTL indexing, and Phase 4 event regressions.
- Backend final regression after corrective fixes: **84 test files passed, 8 skipped; 328 tests passed, 14 skipped, 0 failed**.
- Secret review found no changed/untracked `.env`, credential, private-key, token-pattern, cache, build-output, or coverage artifact. No staged files exist.
- `git diff --check` passed with only expected Windows line-ending warnings.

### Changed-file scope

The final working tree contains **30 files**:

- **14 modified files:** app wiring, auth/session encryption lifecycle, config, database models/indexes, event retention, intake retention scheduling, server startup cleanup, workflow cleanup, and workflow-store listing/deletion support.
- **15 new privacy module/test files:** redaction, AI-context minimization, encryption, retention, cleanup, deletion, privacy routes, and their tests.
- **1 new plan:** `docs/project-enhancer/phase-5-privacy-retention-plan.md`.

No unrelated files, secrets, local environment files, caches, generated build output, or raw datasets are included.

### Remaining blockers and residual risks

- Organization policy approval is still required for the exact retention durations, audit evidence access/erasure protocol, subject-erasure strategy, and governance ownership.
- Production-managed encryption keys/KMS, key custody, rotation scheduling, database encryption-at-rest, backup/replica deletion, external AI-provider retention, host-log rotation, Docker storage cleanup, and physical-media sanitization remain deployment-dependent.
- Docker was unavailable during this review: CLI 29.8.2/context `desktop-linux` was present, but the Linux Engine server pipe was absent. Disposable MongoDB, worker integration, worker-image policy, provenance/SBOM, and Docker Scout evidence therefore could not be executed on this branch.
- The existing 8 high Docker Scout base-image findings remain unresolved from the Phase 4 checkpoint; no current scan was possible because the image was unavailable.
- Production broker deployment/admission, reverse-proxy trust, distributed rate-limit storage/edge enforcement, registry signing/promotion, and live MongoDB HA/backup/retention operations remain unresolved.
- Account deletion blocks active workflows instead of silently cancelling them; explicit cancellation coordination remains required before deleting active data.
- Audit retention purge requires an explicit approved policy flag and is not part of ordinary user deletion. Existing audit rows remain protected.

### Final verdict and checkpoint readiness

- Duck 5-A: **CONDITIONAL PASS** — inventory/threat model/design aligned; policy and deployment decisions explicitly open.
- Duck 5-B: **CONDITIONAL PASS** — local retention, deletion, cleanup, audit compatibility, redaction, and encryption controls implemented and tested; production dependencies remain.
- Duck 5-C: **CONDITIONAL PASS** — final available local checks pass, the Docker-dependent suite is honestly recorded as 30 passed / 8 failed / 2 skipped due to the unavailable engine, and all residual blockers are documented.
- Phase 5 checkpoint recommendation: **READY FOR USER CHECKPOINT REVIEW, NOT PRODUCTION READY**, subject to the corrective-fix receipts below.
- Current branch remains uncommitted and unpublished. No merge into `main`, force-push, deployment, or Phase 6 work occurred.

## 11. Final infrastructure verification attempt — October 21, 2026

### Repository state at review start

```text
Branch: feat/phase-5-privacy-retention
HEAD: 15cd69487d02da4c55175e0bae4c246986afbd7d
Working tree: uncommitted Phase 5 changes preserved
Staged files: none
```

### Docker Desktop/Linux Engine result

Docker CLI was present:

```text
Docker CLI: 29.8.2
Context: desktop-linux
```

`docker desktop status` could not retrieve a status and reported that Docker Desktop was not running. `docker version` and `docker info` both failed to connect to:

```text
npipe:////./pipe/dockerDesktopLinuxEngine
```

Per the review rule, all infrastructure-dependent commands were stopped after this check. No Docker-dependent result from this attempt is marked passed.

The configured CI infrastructure checks remain:

- `npm run test:mongodb`
- BuildKit worker image build from `infra/sandbox`
- `docker buildx build --provenance=true --sbom=true ...`
- `npm run verify:worker-image`
- Docker Scout critical/high scan and critical-threshold exit-code scan
- Docker worker integration suite with `OBSIDIAN_DOCKER_TESTS=1`

The latest prior Docker-enabled attempt remains recorded as **30 passed, 8 failed, 2 skipped**, with all 8 failures reporting unavailable Docker API/image access. Those failures are not declared harmless. A successful Docker Engine run is still required before infrastructure verification can be marked complete.

### Final non-Docker verification receipts

```text
npm run test
  PASS on corrective final rerun — frontend: 41; backend: 328 passed / 14 skipped; AIServices: 2
  Aggregate: 371 passed / 14 skipped / 0 failed

  One earlier invocation in this review hit the known timing-sensitive frontend completeness-flow test:
  40 passed / 1 failed. The isolated test then passed 1/1, and the complete workspace rerun passed.

npm run test --workspace frontend -- src/completeness-flow.test.tsx
  PASS — 1 passed

npm run test --workspace backend -- --maxWorkers=1 src/privacy
  PASS — 7 files, 21 tests

npm run typecheck
  PASS — all workspaces

npm run lint
  PASS — all workspaces

npm run build
  PASS — all workspaces; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

npm run e2e --workspace frontend
  PASS — 5 tests

git diff --check
  PASS — expected Windows line-ending warnings only
```

### Final privacy/control review

- Deletion requests remain deterministic, owner-scoped, session-authenticated, and protected against cross-owner lookup.
- Workflow mutations are rejected with a stable conflict while account/resource deletion is `requested` or `running`.
- Retention cleanup checks all relevant active workflow-state kinds before removing due resources.
- Cleanup is path-contained, symlink-rejecting, idempotent, retryable, and removes successful cleanup-task metadata during account deletion.
- Audit events remain immutable and integrity-protected; ordinary deletion does not purge audit evidence.
- Redaction covers authorization headers, cookies, bearer tokens, common provider tokens, JWT-shaped values, private-key blocks, secret assignments, sensitive object fields, and bounded diagnostics.
- Encryption uses authenticated AES-256-GCM envelopes, key IDs, explicit rotation, duplicate-key rejection, tamper detection, and fail-closed missing-key handling.
- Retention remains configurable and active-workflow aware; MongoDB TTL is supplemental rather than the sole cleanup mechanism.

### Updated final verdict

- Duck 5-A: **CONDITIONAL PASS**.
- Duck 5-B: **CONDITIONAL PASS**.
- Duck 5-C: **CONDITIONAL PASS** for available local evidence, with Docker infrastructure verification incomplete.
- Checkpoint readiness: **READY FOR USER CHECKPOINT REVIEW; NOT READY FOR PRODUCTION OR INFRASTRUCTURE SIGN-OFF**.
- No commit, push, merge, force-push, deployment, or Phase 6 work occurred.

## 12. Corrective fixes after NOT READY review

### Fix status

- Filesystem cleanup containment: **FIXED locally**. Canonical containment, symlink-component rejection, no-follow recursive deletion, and outside-root sentinel tests were added. Residual OS-level TOCTOU risk remains deployment-dependent; the implementation uses canonical target paths and revalidates directories before traversal.
- Deletion recovery after persistence failures: **FIXED locally**. Recoverable processing failures persist a truthful `failed` state when possible; `requested`/`running` requests are retryable and reconciled on backend startup. Tests cover temporary list and running-state persistence failures plus restart reconciliation.
- Cleanup batching: **FIXED locally**. Due tasks are ordered and limited by `PRIVACY_CLEANUP_BATCH_SIZE`; later runs continue the backlog.
- Privacy API output minimization: **FIXED locally**. Public deletion DTOs omit internal owner/session identifiers; route tests assert the omission.
- Privacy deletion audit-event contract: **FIXED locally**. Privacy-only events use documented `baseCommit: "not_applicable"` rather than an empty value or fabricated SHA; deletion-event regression coverage asserts this value.
- Duck runtime-event distinction: **DOCUMENTED GAP**. The plan distinguishes documentation-time Duck records from runtime-persisted events. The current product has no dedicated planning-time Duck event writer, so no runtime persistence is claimed.

### Corrective-fix verification receipts

```text
npm run test --workspace backend -- --maxWorkers=1 src/privacy
  PASS — 7 test files, 21 tests, 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/privacy src/app.test.ts src/events.test.ts src/events-store.test.ts src/auth/session-store.test.ts src/db/indexes.test.ts
  PASS — 12 test files, 36 tests, 0 failed

npm run typecheck --workspace backend
  PASS

npm run lint --workspace backend
  PASS

npm run test
  PASS — frontend: 41 passed; backend: 328 passed / 14 skipped; AIServices: 2 passed
  Aggregate: 371 passed / 14 skipped / 0 failed

npm run typecheck
  PASS — all workspaces

npm run lint
  PASS — all workspaces

npm run build
  PASS — all workspaces; existing Vite chunk-size warning only

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run audit
  PASS — 0 vulnerabilities

git diff --check
  PASS — Windows line-ending warnings only
```

Docker remains unavailable: `docker version` could not connect to `npipe:////./pipe/dockerDesktopLinuxEngine`, and `docker desktop status` reported that Docker Desktop was not running. The prior 30 passed / 8 failed / 2 skipped attempt remains explicitly classified as a failed attempt caused by unavailable Docker infrastructure, not successful infrastructure validation. MongoDB, Docker worker integration, image policy, provenance/SBOM, and Scout evidence remain unavailable.

## 13. Final corrective work — October 21, 2026

### Cleanup root replacement race

- `backend/src/privacy/cleanup.ts` now validates every ancestor component from the filesystem root through the permitted root and target, rejecting symlinks before canonicalization.
- Root identity is captured with device/inode metadata, canonical root identity is checked, and the root is rechecked after target resolution. A changed root identity fails closed before deletion.
- Target identity is compared between the requested path and canonical path. Recursive deletion revalidates directory identity before reading and after reading entries, rejects symlinks at every level, and deletes the canonical target only after validation.
- Added a deterministic test hook used only by regression tests to replace the permitted root with an outside junction between root validation and target resolution. The cleanup returns `failed` and preserves the outside sentinel.
- `src/privacy/cleanup.test.ts` passed **5/5 tests in four consecutive executions**.

Residual limitation: without OS directory handles/openat-style no-follow primitives exposed portably by the supported Node runtime, a hostile actor with concurrent filesystem mutation rights can still create a final narrow race after the last identity check. The implementation fails closed on all observed identity changes and never follows the replaced root path during deletion; production filesystem permissions must prevent untrusted concurrent mutation of the cleanup root.

### Storage-level cleanup pagination — historical receipt

- Earlier implementation receipt: `WorkflowStore.listCleanupTasksPage(ownerUserId, dueAt, limit, cursor)` was introduced with a `limit + 1` query and continuation cursor.
- That implementation description is superseded. The current MongoDB query uses exactly the bounded configured limit and does not fetch an extra record.
- Added a workflow-state index for `ownerUserId`, `kind`, `payload.dueAt`, `payload.createdAt`, and `stateId`.
- Added `listCleanupTaskOwners(dueAt)` so startup cleanup does not materialize every cleanup task merely to discover owners.
- The in-memory fallback applies the same ordering, limit, and cursor semantics.
- The current `PrivacyRetentionService` requests one bounded storage page per run. Durable task state, revisioned claims, claim leases, retry timing, and exclusion of completed tasks advance the backlog across runs and restarts.
- The historical cursor assertions remain evidence for the earlier implementation only.

Residual limitation: the current bounded page has no extra-record lookahead. Durable task state remains the source of truth; a failed or protected task can require later retry scans, and filesystem cleanup retains the documented OS-level TOCTOU limitation.

### Backend baseline runner investigation and fix

The previous failure was reproduced in the full workspace run as:

```text
src/baseline/runner.test.ts
Expected: failed
Received: timed_out
```

The isolated test passed on rerun. The cause was identified in `backend/src/baseline/runner.ts`: the timeout started immediately after `spawn()`, so Windows process startup time could consume the command timeout under workspace load before a quick `process.exit(3)` command reported its exit code.

The timeout now starts on the child's `spawn` event, measuring command execution after process creation. No assertion was weakened and no test was skipped.

Receipts:

```text
npm run test --workspace backend -- --maxWorkers=1 src/baseline/runner.test.ts
  PASS — 1 test file, 3 tests, 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/baseline/runner.test.ts src/privacy
  PASS — 8 test files, 26 tests, 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/baseline src/privacy
  PASS — 12 test files, 33 tests, 1 skipped
```

### Current final verification receipts

```text
npm run test --workspace backend -- --maxWorkers=1 src/privacy
  PASS — 7 test files, 23 tests, 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/privacy src/app.test.ts src/events.test.ts src/events-store.test.ts src/auth/session-store.test.ts src/db/indexes.test.ts src/baseline/runner.test.ts
  PASS — 13 test files, 42 tests, 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/privacy/cleanup.test.ts
  PASS — 5 tests, repeated 4 times, 0 failed

npm run test --workspace backend -- --maxWorkers=1
  PASS in the latest workspace portion — 84 test files, 331 tests passed, 14 skipped, 0 failed

npm run test
  NOT GREEN in the latest two full workspace attempts:
  - Attempt A: frontend 40 passed / 1 failed (`src/baseline-flow.test.tsx`); backend 331 passed / 14 skipped; AIServices 2 passed.
  - Attempt B: frontend 40 passed / 1 failed (`src/completeness-flow.test.tsx`); backend 331 passed / 14 skipped; AIServices 2 passed.
  The frontend failures are timing-sensitive fetch/polling test failures. Isolated `baseline-flow.test.tsx` runs were mixed: 2 passed and 2 failed. No frontend assertion was weakened.

npm run typecheck
  PASS — all workspaces

npm run lint
  PASS — all workspaces

npm run build
  PASS — all workspaces; existing Vite chunk-size warning only

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run audit
  PASS — 0 vulnerabilities

git diff --check
  PASS — Windows line-ending warnings only
```

Docker remains unavailable. The prior Docker-dependent attempt remains **30 passed / 8 failed / 2 skipped**, explicitly an unsuccessful attempt caused by unavailable Docker infrastructure, not successful infrastructure validation. MongoDB replica-set, Docker worker, image policy, provenance/SBOM, and Scout evidence remain unavailable.

### Updated local verdict

- Cleanup root replacement race: **FIXED LOCALLY with a documented residual OS-level race limitation**.
- Storage-level cleanup pagination: **FIXED LOCALLY**; bounded query/page/cursor behavior is implemented and tested.
- Backend baseline runner failure: **FIXED LOCALLY**; focused and backend regression tests pass.
- Full workspace verification: **NOT GREEN** because the frontend suite remains timing-sensitive and failed in two separate full attempts.
- Phase 5 checkpoint recommendation: **NOT READY** pending a green full workspace verification and a decision on the remaining filesystem/cursor operational limitations.

### Current working-tree scope after final corrective work

The current uncommitted working tree contains **31 files**:

- **15 modified tracked files:** application wiring, auth/session encryption lifecycle, baseline runner timing, config, database models/indexes, event retention, intake retention scheduling, startup reconciliation, workflow cleanup, workflow service, and workflow-store pagination support.
- **15 new privacy module/test files:** redaction, AI-context minimization, encryption, retention, cleanup, deletion, privacy routes, and tests.
- **1 Phase 5 plan:** this document.

No secrets, environment files, caches, generated build output, coverage artifacts, or raw datasets are included.

Current Docker check on this branch:

```text
docker version
  Docker CLI 29.8.2, context desktop-linux
  FAILED — Docker Linux Engine unavailable at npipe:////./pipe/dockerDesktopLinuxEngine

docker desktop status
  UNAVAILABLE — Docker Desktop status could not be retrieved
```

## 14. Final verification refresh — October 26, 2026

This section supersedes the earlier timing-failure receipts and the earlier `limit + 1` pagination description where they conflict with the current working tree.

### Corrective fixes completed

- Frontend completeness and baseline hooks now publish the run identifier to the route only after the initial start request and polling operation has produced a current result. This prevents the route effect from aborting or replacing the active start operation while its first poll is still in flight.
- Temporary diagnostic logging added during the timing investigation was removed from `useCompletenessRun.ts`.
- Cleanup storage queries now use exactly the configured bounded limit (`PRIVACY_CLEANUP_BATCH_SIZE`) rather than fetching one extra record. The retention service processes one due page per run; completed records are excluded on later runs, so the backlog advances without requiring a process-local continuation cursor.
- The lockfile was refreshed to patched dependency versions: `body-parser` 2.4.0, `ip-address` 10.7.5, `undici` 8.12.3, and `zod` 4.6.7.

### Current verification receipts

```text
npm run test
  PASS — frontend: 16 files, 41 tests
  PASS — backend: 84 files, 334 tests; 8 files and 14 tests skipped
  PASS — AIServices: 1 file, 2 tests
  Aggregate: 377 passed / 14 skipped / 0 failed

npm run test
  PASS on a second post-fix workspace run with the same counts

npm run typecheck
  PASS — frontend, backend, AIServices

npm run lint
  PASS — frontend, backend, AIServices

npm run build
  PASS — frontend, backend, AIServices; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run test --workspace backend -- --maxWorkers=1 src/privacy src/baseline/runner.test.ts src/workflow/store.test.ts
  PASS — 9 files, 30 tests

git diff --check
  PASS — expected Windows line-ending warnings only
```

The previously observed frontend failures are resolved locally: the completeness flow now passes in isolation and in the full frontend/workspace runs, and the baseline flow passes in the same runs. No assertion was weakened and no test was skipped.

### Dependency audit correction

The first post-fix audit run found four advisories in the installed lockfile: three high and one moderate. The dependency graph was updated without adding a new package or changing application dependency declarations. A subsequent `npm audit --audit-level=high` reports **0 vulnerabilities**.

### Infrastructure results still unavailable

```text
npm run test:mongodb
  UNAVAILABLE — Docker daemon is not running

npm run test:mongodb:backup
  BLOCKED — requires OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS=1 and a disposable obsidian_phase3 URI

npm run verify:worker-image
  FAILED/UNAVAILABLE — Docker API missing at npipe:////./pipe/dockerDesktopLinuxEngine

docker version
  Docker CLI 29.8.2 is installed; Docker Linux Engine is unavailable at npipe:////./pipe/dockerDesktopLinuxEngine
```

No MongoDB replica-set, backup/restore, Docker worker integration, worker-image policy, provenance/SBOM, or Docker Scout result is claimed as passed. The prior Docker-dependent attempt remains recorded as 30 passed / 8 failed / 2 skipped due to unavailable Docker infrastructure.

### Current working-tree scope

The current uncommitted working tree contains **34 paths**:

- **18 modified tracked files:** application wiring, auth/session encryption lifecycle, baseline runner timing, config, database models/indexes, event retention, intake retention scheduling, startup reconciliation, workflow cleanup/store support, frontend run hooks, and `package-lock.json`.
- **15 new privacy module/test files:** redaction, AI-context minimization, encryption, retention, cleanup, deletion, privacy routes, and tests.
- **1 Phase 5 plan:** this document.

No files are staged. No commit, push, merge, deployment, or Phase 6 work occurred.

### Updated verdict

- Duck 5-A: **CONDITIONAL PASS**.
- Duck 5-B: **CONDITIONAL PASS** for local retention, deletion, cleanup, audit compatibility, redaction, encryption, and minimization evidence.
- Duck 5-C: **CONDITIONAL PASS** for available local application evidence; infrastructure verification remains incomplete.
- Phase 5 checkpoint recommendation: **READY FOR USER CHECKPOINT REVIEW; NOT READY FOR PRODUCTION OR INFRASTRUCTURE SIGN-OFF**.
- Remaining production blockers are unchanged: organization retention/erasure policy, production KMS/key custody/rotation, database encryption-at-rest, backup/replica erasure, external-provider retention, host/Docker/physical-media cleanup, broker/admission controls, distributed edge rate limiting, registry signing/promotion, and live MongoDB HA/backup operations.

## 15. Authoritative current verification summary — October 26, 2026

This section is the current Phase 5 evidence record. The historical appendix above preserves earlier receipts but does not override this section.

### Current implementation state

- Frontend run hooks now distinguish first route initialization from later route changes. The previous implementation treated the first `runId === null` effect as a route change and aborted a start operation triggered during commit/layout timing; initial route reads still execute, while an initial start is preserved. Regression tests cover click-before-passive-mount, superseded route results, and unmount cancellation.
- Cleanup storage queries use exactly `PRIVACY_CLEANUP_BATCH_SIZE`; they do not use `limit + 1`.
- Cleanup progression is durable: tasks carry status, revision, attempts, retry timing, and claim-expiry state. Claims use revision checks, running claims recover after lease expiry, failed work receives retry timing, and completed work is excluded from later bounded scans.
- Restart recovery relies on durable task state and startup processing; no process-local cursor is required for correctness.
- Filesystem cleanup validates containment, rejects symlink components and targets, compares filesystem identity before deletion, rechecks the root after canonicalization and target resolution, and fails closed on observed identity changes. A complete race-free guarantee is not claimed because a final OS-level TOCTOU window remains.
- Deletion is authenticated, owner-scoped, idempotent, retryable, active-workflow aware, and explicit about partial/failure states. Audit records are protected from ordinary deletion.
- Account/workflow deletion now includes durable detection, completeness, and baseline run envelopes; active durable runs block deletion, and expired terminal run envelopes are removed by the configured bounded retention sweep.
- Encryption uses authenticated AES-256-GCM envelopes with key IDs, explicit rotation, duplicate-key rejection, and fail-closed missing-key behavior. Production KMS and key custody are not verified.
- Durable run envelopes are included in owner/workflow deletion and terminal run retention; active run envelopes block deletion and expired terminal envelopes are removed within the configured cleanup batch bound.

### Audit-event failure semantics review

`WorkflowService.recordEvent()` currently creates the event and appends it to the service-local event list, invokes the configured event sink without awaiting it, and catches sink rejection. The required durable sink therefore rejects on unavailable persistence, but the surrounding workflow operation continues and may return success without confirmed durable audit persistence. This behavior is shared by workflow repair-plan creation, enhancement-run creation, and recommendation viewing; the detection, completeness, and baseline services use the same fire-and-forget pattern.

Focused regression tests now cover both paths:

- Successful workflow event sink invocation while the workflow operation completes.
- Rejected workflow event sink invocation while the workflow operation still completes and retains the local event.

This is an explicit unresolved product/security decision, not a hidden guarantee: the repository must decide whether required audit persistence failure should fail or pause the enclosing workflow operation, or remain asynchronous with a recovery state. No behavior was changed in this follow-up because choosing either policy would alter workflow semantics without an approved product/security decision.

### Audit-event policy options

These options are documented for product/security authorization; none is selected by this follow-up:

| Option | Failure mode and data-loss risk | Consistency guarantee | Operational complexity | Compatibility |
|---|---|---|---|---|
| Fail closed | The initiating workflow request returns an error when required audit persistence rejects. The workflow state may already have been changed unless event persistence is moved before the mutation or the mutation is transactionally coupled; otherwise the risk shifts from silent audit loss to a partially completed operation. | Strongest user-facing signal, but only fully atomic if event and workflow state share a transaction or a durable pre-commit protocol. | Moderate to high; requires defining retries, idempotency, and rollback/recovery for state changes after event failure. | Changes current successful responses and may require route/client recovery handling. |
| Pause and recover | Sensitive progress stops at an explicit recovery state until the audit sink is available. A failed event is visible and retryable rather than silently ignored. | Strong workflow/audit coupling after the pause boundary; already-completed prior mutations still need reconciliation. | High; requires recovery states, retry ownership, operator visibility, and clear user messaging. | Preserves safety but changes workflow state machines and UI contracts. |
| Durable outbox/retry | The workflow writes an event to a durable outbox and dispatches it asynchronously. The operation can proceed after the outbox write, while delivery retries and is reconciled. | Durable intent is guaranteed if the outbox write is atomically committed with the workflow mutation; delivery becomes eventually consistent. | Highest; requires an outbox model, dispatcher, retry/lease state, deduplication, monitoring, and retention. | Best fit for the existing asynchronous architecture, but requires new durable storage and operational components. |

Safest compatible recommendation for a future approved design: a durable outbox transactionally coupled to the relevant workflow mutation, with fail-closed behavior when the outbox itself cannot be written. This remains a recommendation only; no product/security authorization exists to implement it here.

### Current local verification receipts

```text
npm run test --workspace backend -- --maxWorkers=1 src/events-store.test.ts src/workflow/service.test.ts
  PASS — 2 files, 14 tests, exit 0

npm run test --workspace backend -- --maxWorkers=1 src/events-store.test.ts src/workflow/service.test.ts src/privacy
  PASS — 9 files, 40 tests, exit 0

npm run test --workspace backend -- --maxWorkers=1 src/privacy
  PASS — 7 files, 26 tests, exit 0

npm run test --workspace backend -- --maxWorkers=1 src/privacy/retention.test.ts src/privacy/deletion.test.ts
  PASS — 2 files, 14 tests, exit 0

npm run test
  PASS — exit 0
  frontend: 17 files passed; 47 tests passed
  backend: 84 files passed, 8 skipped; 338 tests passed, 14 skipped
  AIServices: 1 file passed; 2 tests passed
  Aggregate: 387 passed / 14 skipped / 0 failed

npm run test (three consecutive post-fix runs)
  PASS — prior three post-fix runs exit 0; latest run also exits 0 with the updated durable-run coverage

npm run test --workspace frontend -- src/completeness-flow.test.tsx
  PASS — 1 file, 1 test, exit 0

npm run test --workspace frontend -- src/baseline-flow.test.tsx
  PASS — 1 file, 1 test, exit 0

npm run test --workspace frontend -- src/run-initialization.test.tsx src/completeness-flow.test.tsx src/baseline-flow.test.tsx
  PASS — 3 files, 8 tests, exit 0

npm run test --workspace frontend
  PASS — 17 files, 47 tests, exit 0

npm run typecheck
  PASS — all workspaces, exit 0

npm run lint
  PASS — all workspaces, exit 0

npm run build
  PASS — all workspaces, exit 0; existing Vite chunk-size warning only

npm run e2e --workspace frontend
  PASS — 5 browser tests, exit 0

npm run audit
  PASS — 0 vulnerabilities, exit 0

git diff --check
  PASS — expected Windows line-ending warnings only
```

The previous full-workspace timing failure was reproduced with an abort stack pointing to the first route-reset effect in `useCompletenessRun.ts`. After the initialization fix, the complete frontend suite passed with 17 files and 47 tests, and three consecutive complete workspace runs passed. The earlier failed workspace invocation remains historical evidence and is not erased.

### Infrastructure and production limitations

Docker, MongoDB replica-set, disposable backup/restore, worker-image, provenance/SBOM, Docker Scout, and live MongoDB HA evidence remain unavailable unless their commands actually execute successfully. Production KMS/key custody, database encryption-at-rest, backup and replica erasure, external-provider retention/deletion, host and physical-media cleanup, organization retention durations, audit erasure policy, and governance approvals remain unresolved.

### Current working-tree scope

The follow-up adds the approved audit-event tests, frontend initialization regression coverage, retention-order and durable-run privacy corrections, environment/documentation updates, and the project-wide audit. The current tree contains **40 changed paths**: 22 modified tracked files, 17 new module/test/documentation files (15 privacy files, `frontend/src/run-initialization.test.tsx`, and `project-audit.md`), and the Phase 5 plan. No files are staged, and no generated files, credentials, private keys, caches, or raw datasets are included.

### Current decision

- Duck 5-A: **CONDITIONAL PASS**.
- Duck 5-B: **CONDITIONAL PASS** for locally implemented privacy controls and available local evidence.
- Duck 5-C: **CONDITIONAL PASS** for the approved follow-up corrections; local workspace verification is green, while infrastructure plus the audit-failure policy decision remain open.
- Phase 5 status: **READY FOR USER CHECKPOINT REVIEW; NOT READY FOR PRODUCTION OR INFRASTRUCTURE SIGN-OFF**.
- No commit, staging, push, merge, deployment, or Phase 6 work is authorized by this document.
