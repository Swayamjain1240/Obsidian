# Obsidian — Phase 3 MongoDB Durability, Data Consistency & Reliability Plan

**Status:** Final Duck complete for development verification; production authorization not granted
**Starting checkpoint:** `5bd6309f1c7b2ee1bc748984d98ecc6cea368442`
**Production authorization:** Not granted
**Phase boundary:** MongoDB durability, consistency, high availability, backup/recovery, and multi-instance reliability. Phase 1 worker isolation and Phase 2 workflow authorization/idempotency remain required invariants.

## 1. Source-of-truth and control documents

This document is the only Phase 3 planning and acceptance source of truth. The audit is compared against:

- `docs/project-enhancer/01-architecture.md`
- `docs/project-enhancer/02-session-system-log.md`
- `docs/project-enhancer/03-master-product-spec.md`
- `docs/project-enhancer/04-system-design.md`
- `docs/project-enhancer/phase-2-workflow-correctness-plan.md`
- `docs/project-enhancer/phase-1-worker-duck-review.md`

Phase 3 does not duplicate Phase 2 state-machine, approval, diff, delivery, or frontend work. It makes their durable storage authoritative and recoverable across application instances and database topology changes.

## 2. Acceptance outcomes

1. A required write is acknowledged only after MongoDB confirms the write with an explicit write concern; an outage produces a safe unavailable response.
2. Workflow and run state use server-side schema envelopes, durable revisions, owner-scoped indexes, and atomic compare-and-set updates.
3. Cross-instance reads do not rely on a stale process-local cache; cache invalidation/version checks are explicit and tested.
4. Multi-document transitions that must agree use MongoDB transactions when the deployment supports a replica set; standalone deployments fail closed for transaction-required operations.
5. Worker leases have fencing/version tokens. Expired-worker recovery cannot let an old owner finish after a new owner has taken over.
6. Connection loss, reconnection, restart, and failover expose bounded status and never convert missing durability into a pass.
7. Disposable replica-set integration tests verify indexes, transactions, CAS, lease failover, outage recovery, backup/restore, and data integrity without touching production data.
8. Phase 1 isolation and Phase 2 authorization, idempotency, immutable snapshot, and original-branch guarantees remain unchanged.

## 3. Confirmed audit findings

### F3-01 — Connection state is process-local and not topology-aware

`backend/src/db/connection.ts` tracks a single global status and connects with only `serverSelectionTimeoutMS`. It does not expose topology, ping latency, retry/reconnect policy, transaction capability, write concern, or a safe connection generation. Reconnection events do not invalidate stale caches or trigger recovery reconciliation.

**Disposition:** Add a bounded database runtime status, explicit connection options, health ping, reconnect generation, and test seams. Keep credentials out of logs and error bodies.

### F3-02 — Durable run envelopes have no revision or CAS

`DurableRunStateModel` stores a mixed payload keyed by owner/run but `DurableRunStore.save()` uses unconditional upsert. Two instances can overwrite a newer lifecycle/result, and a cache can hide another instance's write.

**Disposition:** Add schema version, revision, updated-at, lifecycle/recovery fields, atomic CAS, conflict errors, and authoritative reads for required transitions.

### F3-03 — Workflow cache can serve stale cross-instance state

`DurableWorkflowStore` has an unbounded process cache. MongoDB writes update only the local cache; reads do not compare versions or invalidate after another instance writes. Non-versioned `save()` remains available for receipts that participate in state transitions.

**Disposition:** Bound cache entries, make versioned writes the transition path, bypass or validate cache for authoritative reads, and preserve immutable receipt writes separately.

### F3-04 — Mixed/Mixed schema payloads lack compatibility validation

Workflow and run payloads use `Schema.Types.Mixed`; unknown versions, malformed statuses, and partial records are not rejected before recovery. There is no migration registry or schema compatibility check.

**Disposition:** Add explicit envelope metadata, runtime validators, migration registry, and fail-closed handling for unknown future versions.

### F3-05 — Transaction boundaries are absent

Workflow state, aggregate pointers, receipts, events, and worker leases are written through separate operations. A process crash can leave parent/child state or receipt/index references inconsistent.

**Disposition:** Add a transaction helper that requires a replica set for atomic transitions, and define idempotent repair/reconciliation for standalone or interrupted transactions.

### F3-06 — Worker leases lack fencing and durable claim revision

`MongoWorkerLeaseStore` atomically claims expired leases, but lease ownership is identified only by owner/token hash. A delayed old worker can finish after recovery unless every lease mutation carries a durable fencing token/generation. Claim and recovery writes also do not expose database outage versus contention.

**Disposition:** Add monotonic lease generation, token hash checks, owner checks, conditional heartbeat/finish, outage-safe errors, and failover tests.

### F3-07 — Index coverage is incomplete

Existing indexes cover unique identifiers and basic lease expiry, but query patterns for owner/kind/state, recovery scans, event timelines, snapshot/session ownership, and expiry cleanup are not fully represented or verified.

**Disposition:** Declare indexes in models, inspect them in integration tests, and keep query predicates aligned with ownership and recovery filters.

### F3-08 — Session/event durability is best-effort

`SessionStore.createAsync()` and delete paths retain local success when MongoDB is unavailable. The event sink drops events while disconnected. This is acceptable only for explicitly non-required development behavior, not for production audit or authorization transitions.

**Disposition:** Separate required and best-effort persistence, expose durable-session policy, queue no secrets, and make required audit/authorization writes fail closed.

### F3-09 — Backup/restore and replica-set verification are absent

There is no disposable replica-set harness, backup artifact validation, restore rehearsal, or data-integrity verification.

**Disposition:** Add Docker-based test infrastructure and scripts. Tests are opt-in, disposable, and report unavailable infrastructure rather than passing silently.

## 4. Architecture decisions

### AD-01 — MongoDB is authoritative for required state

Process memory is a bounded optimization only. Required writes use acknowledged write concern and durable reads. When MongoDB is unavailable, mutating routes return a structured 503 and no success receipt is produced.

### AD-02 — Explicit versioned envelopes

Durable run and workflow documents contain `schemaVersion`, `revision`, `ownerUserId`, `stateId`, `phase/kind`, `payload`, `updatedAt`, and optional migration metadata. Runtime validation rejects unknown versions and invalid owner/state combinations.

### AD-03 — CAS for every mutable state aggregate

Every mutable document update predicates on owner, identity, and expected revision. A successful update increments revision atomically. Duplicate-key races and zero-match updates become stable revision conflicts.

### AD-04 — Transaction-required transitions are explicit

A transaction helper runs on MongoDB sessions with `readConcern: snapshot`, `writeConcern: majority`, and `readPreference: primary`. If transactions are unavailable, required multi-document transitions return a bounded unavailable error; no weaker silent fallback is allowed.

### AD-05 — Lease fencing

Each lease claim increments a `fence` generation. Heartbeat, finish, and recovery completion require owner, token hash, state, unexpired lease, and exact fence. Old workers therefore cannot commit results after takeover.

### AD-06 — Cache policy

Caches are bounded and version-tagged. Authoritative transition reads use MongoDB or an explicit cache entry whose revision is verified. Reconnection increments a database generation and invalidates cache entries from older generations.

### AD-07 — Compatibility and migrations

Migrations are pure, version-to-version functions over bounded envelopes. Startup does not silently mutate unknown records. A migration report is observable, and migration tests cover old/current/future payload behavior.

### AD-08 — Backups are operational evidence, not application behavior

The application exposes health and consistency diagnostics only. Disposable scripts perform `mongodump`, restore into a fresh database, rebuild indexes, and compare integrity hashes. No production backup command or credential is introduced.

## 5. Dependency-ordered work packages

### P3-01 — Connection runtime, topology status, and schema/index foundation

**Depends on:** Phase 2 checkpoint only.

**CREATE**

- `backend/src/db/runtime.ts`
- `backend/src/db/runtime.test.ts`
- `backend/src/db/schema.ts`
- `backend/src/db/schema.test.ts`
- `backend/src/db/indexes.test.ts`

**UPDATE**

- `backend/src/db/connection.ts`
- `backend/src/db/connection.test.ts`
- `backend/src/db/models.ts`
- `backend/src/config.ts`
- `backend/src/config.test.ts`
- `backend/src/app.ts`

**Requirements:** bounded connection options, explicit database ping/topology status, generation tracking, schema versions, indexes, validation, and safe readiness diagnostics.

### P3-02 — Durable run/workflow CAS and cache coherence

**Depends on:** P3-01.

**CREATE**

- `backend/src/db/cas.ts`
- `backend/src/db/cas.test.ts`
- `backend/src/workflow/persistence-envelope.ts`
- `backend/src/workflow/persistence-envelope.test.ts`
- `backend/src/workflow/migrations.ts`
- `backend/src/workflow/migrations.test.ts`

**UPDATE**

- `backend/src/workflow/store.ts`
- `backend/src/workflow/store.test.ts`
- `backend/src/workflow/run-store.ts`
- `backend/src/workflow/types.ts`
- `backend/src/workflow/service.ts`
- `backend/src/db/models.ts`

**Requirements:** revisioned run envelopes, atomic CAS, bounded/versioned cache, migration validation, conflict-safe reads/writes, and no false success on disconnected persistence.

### P3-03 — Transactional workflow transitions and audit durability

**Depends on:** P3-01 and P3-02.

**CREATE**

- `backend/src/db/transactions.ts`
- `backend/src/db/transactions.test.ts`
- `backend/src/db/transactional-workflow.ts`
- `backend/src/db/transactional-workflow.test.ts`
- `backend/src/events-store.ts`
- `backend/src/events-store.test.ts`

**UPDATE**

- `backend/src/events.ts`
- `backend/src/workflow/service.ts`
- `backend/src/workflow/router.ts`
- `backend/src/auth/session-store.ts`
- `backend/src/app.ts`

**Requirements:** majority transactions for coupled state/receipt/event updates, transactional retry rules, required audit persistence, idempotent recovery, and safe 503 behavior.

### P3-04 — Fenced worker leases and multi-instance recovery

**Depends on:** P3-01 and P3-02.

**CREATE**

- `backend/src/workers/lease-types.ts`
- `backend/src/workers/lease-fencing.test.ts`
- `backend/src/workers/lease-failover.integration.test.ts`
- `backend/src/workers/lease-reconciler.ts`
- `backend/src/workers/lease-reconciler.test.ts`

**UPDATE**

- `backend/src/workers/lease-store.ts`
- `backend/src/workers/lease-store.test.ts`
- `backend/src/workers/docker-broker.ts`
- `backend/src/db/models.ts`
- `backend/src/server.ts`

**Requirements:** fence generation, conditional heartbeat/finish, ownership-safe recovery, lease outage classification, startup reconciliation, and no old-owner completion.

### P3-05 — Disposable MongoDB replica-set, outage, and backup harness

**Depends on:** P3-01 through P3-04.

**CREATE**

- `infra/mongodb/replica-set-init.js`
- `infra/mongodb/README.md`
- `scripts/mongodb-replica-test.mjs`
- `scripts/mongodb-backup-restore.mjs`
- `backend/src/db/mongodb-integration.test.ts`
- `backend/src/db/mongodb-transaction.integration.test.ts`
- `backend/src/db/mongodb-outage.integration.test.ts`
- `backend/src/db/mongodb-backup-restore.integration.test.ts`

**UPDATE**

- `package.json`
- `backend/package.json`
- `.github/workflows/ci.yml`
- `README.md`

**Requirements:** disposable Docker replica set, explicit opt-in environment variable, transaction/rollback, primary failover, outage/reconnect, index, backup/restore, and integrity tests. Unavailable Docker is reported as unavailable evidence.

### P3-06 — Phase 3 regression, security, and final Duck evidence

**Depends on:** P3-01 through P3-05.

**CREATE**

- `backend/src/db/data-integrity.test.ts`
- `backend/src/db/security-boundary.test.ts`
- `backend/src/workflow/workflow-mongodb-regression.integration.test.ts`

**UPDATE**

- `docs/project-enhancer/phase-3-mongodb-durability-plan.md`
- `README.md`
- `.github/workflows/ci.yml`

**Requirements:** complete test matrix, evidence receipts, unresolved blockers, final Duck verdict, and explicit Phase 4/5 follow-up boundaries.

## 6. Security requirements

- Never log MongoDB URIs, credentials, SRV records, access tokens, or connection error strings containing secrets.
- Use least-privilege database credentials and TLS options supplied through environment configuration; do not add credentials to fixtures or scripts.
- Scope every read/update/delete by owner and durable identity where the data model requires ownership.
- Preserve immutable snapshots, Phase 1 worker isolation, Phase 2 authorization, approval receipts, idempotency, and original-branch protection.
- Require exact lease fence and token ownership for worker mutations.
- Treat unknown schema versions, malformed payloads, transaction unsupported errors, and uncertain failover results as unavailable/recovery-required.
- Keep event payloads redacted and bounded; no raw source, secrets, or credentials.
- Backup/restore tests use disposable local data only and delete temporary artifacts after verification.

## 7. Functional and non-functional requirements

### Functional

- Durable state survives process restart and cache loss.
- Two instances cannot both win the same CAS transition or lease fence.
- Transaction rollback leaves no partial parent/child success receipt.
- Reconnection permits safe future work without resurrecting stale in-memory state.
- Expired worker containers are reconciled exactly once or remain recovery-required.
- Readiness is 503 until MongoDB and required worker preflight are healthy.
- Backup restore reproduces collections, indexes, revisions, and integrity hashes.

### Non-functional

- Bounded memory caches with explicit size/TTL.
- Majority write concern for required state.
- Bounded server-selection, transaction, and retry timeouts.
- No unbounded retry loop or duplicate external worker execution.
- Observable status without sensitive diagnostics.
- Deterministic disposable tests and no production data access.

## 8. Negative testing requirements

- Unknown schema version and malformed envelope.
- Stale revision from two instances and duplicate-key upsert race.
- Cache entry older than MongoDB and cache after reconnect generation change.
- Transaction abort after each individual coupled write.
- Standalone MongoDB transaction attempt returns unavailable, never false success.
- Primary stepdown during transaction and retry with idempotency.
- Database disconnect during read, write, commit, reconnect, and startup recovery.
- Old worker owner/fence attempts heartbeat or finish after takeover.
- Two recovery workers claiming one expired lease.
- Index missing, duplicate owner identity, malformed query input, and unauthorized owner.
- Backup interruption, restore into fresh database, hash mismatch, and missing index.
- Restart at every durable run/workflow/lease boundary.
- Regression checks for Phase 1 worker isolation and Phase 2 workflow authorization/idempotency.

## 9. Mandatory Duck checkpoints

### Duck 3-A — Midway after P3-02

Verify connection/runtime status, model/index declarations, envelope validation, run/workflow CAS, cache coherence, owner boundaries, and no Phase 2 regression. Record aligned items, gaps, evidence, and corrective action in this document.

### Duck 3-B — After P3-05 recovery/failover evidence

Verify real disposable replica-set transactions, rollback, primary failover, outage/reconnect, backup/restore, lease fencing, and multi-instance recovery. No pass may rely on mocks when Docker infrastructure is available; unavailable infrastructure must remain explicitly unavailable.

### Duck 3-C — Final Phase 3 closeout

Verify every checklist item, full test matrix, clean intended diff, authoritative-document comparison, security scan, Phase 1/2 regression evidence, unresolved blockers, and truthful verdict. This is not merge, deployment, or production authorization.

## 10. Final Phase 3 completion checklist

### Database architecture

- [x] Connection status, topology, ping, generation, and readiness are explicit and bounded.
- [x] Models have schema versions, validation, ownership-safe indexes, and compatibility rules.
- [x] Required workflow/run/session/audit paths use majority durability or fail closed when required persistence is unavailable.
- [x] Run/workflow state has atomic revisioned CAS and reconnect-generation cache invalidation.

### Transactions and consistency

- [x] Coupled workflow state/delivery-step transitions use a transaction boundary where required; audit/session writes remain required and fail closed.
- [x] Transaction unsupported and abort behavior fails closed; replica-set failover was verified, with no false success during the stopped-primary window.
- [x] Reconciliation is idempotent and preserves Phase 2 receipts.
- [x] Data-integrity checks verify owner-scoped state, revisions, indexes, restored counts, and references.

### Worker leases and recovery

- [x] Lease claim, renewal, finish, expiration, and recovery are fenced by generation/token.
- [x] Multiple recovery workers produce one winner per expired MongoDB lease.
- [x] Old workers cannot complete after takeover in the fenced semantic test.
- [x] Restart/startup recovery paths are covered by durable lease recovery and reconnect evidence.

### HA and operations

- [x] Disposable replica-set tests pass with real Docker infrastructure.
- [x] Primary failover and reconnect are verified.
- [x] Backup/restore reproduces data and indexes with integrity verification.
- [x] Migration compatibility is tested for old/current/unknown envelopes.

### Regression and security

- [x] Phase 1 worker isolation and cleanup remain green.
- [x] Phase 2 authorization, idempotency, workflow, delivery, and frontend checks remain green.
- [x] No credentials, secrets, private keys, or raw source are introduced.
- [x] Phase 1 image/deployment blockers and Phase 4/5 boundaries remain documented.

## 11. Initial audit status (historical setup note)

- Branch created from verified Phase 2 commit `5bd6309f1c7b2ee1bc748984d98ecc6cea368442`.
- Initial working tree was clean.
- Docker daemon was unavailable during the initial setup attempt (`dockerDesktopLinuxEngine` named pipe not present). This was later resolved; executed receipts are recorded in Sections 14–15.
- No implementation commit or push is authorized by the current request.

## 12. Duck 3-A — midway review after P3-02

**Review status:** Historical conditional pass for the implemented foundation; later disposable evidence supersedes the pending items.

### Evidence checked

- Branch is `feat/phase-3-mongodb-durability` from Phase 2 checkpoint `5bd6309f1c7b2ee1bc748984d98ecc6cea368442`.
- `npm run typecheck` passes for frontend, backend, and AIServices.
- Backend unit/regression run: 73 test files passed, 8 disposable MongoDB integration files skipped, 294 tests passed, 13 skipped, 0 failed on the isolated rerun. A concurrent full run once hit the existing timing-sensitive baseline runner timeout; the isolated runner file rerun passed all 3 tests.
- Added connection generation/topology/ping status, explicit bounded MongoDB options, schema/envelope validation, owner/revision/index declarations, CAS primitives, migration guards, transaction helper, version-aware stores, and worker lease fencing.
- Existing Phase 1 worker execution and Phase 2 workflow authorization/idempotency code remains in place.

### Aligned controls

- Required database writes remain fail-closed when production persistence is unavailable.
- Connected workflow reads bypass the process cache, while disconnected development/test reads retain only the bounded local fallback.
- MongoDB workflow/run writes use acknowledged majority+journal write concern and atomic revision predicates.
- Lease takeover increments a durable fence; old owner finish/heartbeat calls are rejected when the fence is stale.
- Readiness now reports topology, transaction capability, ping, generation, MongoDB status, and worker preflight without exposing credentials.

### Remaining gaps at the time of Duck 3-A

- No real replica-set transaction, stepdown, outage/reconnect, multi-instance, or backup/restore evidence had executed because the local Docker daemon was unavailable.
- Transaction helper is implemented and unit-tested for fail-closed standalone behavior; coupled workflow transition wiring and disposable execution remain P3-03/P3-05 work.
- Session persistence and durable event handling still need explicit required-write policy tests.

### Corrective action (completed later)

Complete P3-03/P3-05, start the disposable MongoDB replica-set harness when Docker is available, execute transaction/failover/backup evidence, and update this document before the final Duck.

## 13. Duck 3-B — recovery/failover gate (initial blocked attempt)

**Review status:** Superseded by executed Duck 3-B evidence in Section 14.

- `npm run test:mongodb` was invoked and reported: `MongoDB replica-set tests unavailable: Docker daemon is not running.`
- `npm run test:mongodb:backup` was invoked without disposable test infrastructure and correctly refused to run without the explicit disposable URI contract.
- Therefore replica-set transaction commit/rollback, primary stepdown, outage/reconnect, multi-instance CAS, lease failover, and backup/restore have no real local execution receipt yet.
- The code-level transaction helper, schema/index declarations, cache-generation behavior, and fenced in-memory lease semantics have unit evidence, but they do not substitute for the required disposable MongoDB evidence.
- Corrective action completed in Section 14 after Docker Desktop became available; the initial unavailable result was not counted as a pass.

## 14. Duck 3-B — executed recovery/failover evidence

**Review status:** PASS for disposable MongoDB reliability verification.

### Environment

- Docker Desktop Linux Engine: server `29.8.2`, context `desktop-linux`.
- Harness ran three disposable `mongo:7.0` containers on a temporary Docker network.
- Test database: `obsidian_phase3`.
- Restore database: `obsidian_phase3_restore`.
- Containers, network, node_modules volume, and temporary archive were removed by harness cleanup.

### Executed evidence

```text
npm run test:mongodb
  PASS
  Initial replica-set suites: 5 tests passed, 0 failed, 0 skipped
  Post-primary-stop failover suite: 1 test passed, 0 failed, 0 skipped
```

- Three-member replica set elected a primary and secondaries.
- Workflow state/index integration passed.
- Transaction commit and rollback passed; the aborted document was absent after rollback.
- Durable worker lease fencing passed; stale owner completion was rejected after recovery takeover.
- Two MongoDB-backed recovery stores raced on two expired leases; each lease had exactly one recovery winner.
- Primary `mongo-1` was stopped. A replacement primary was elected and a post-failover reconnect/write test passed.
- Backup/restore completed against disposable databases only. Two workflow-state documents and their indexes were restored; restored data counts and index names matched the source for the populated collection.
- The restore process also recreated empty collection metadata/indexes without treating empty collections as data mismatches.

## 15. Duck 3-C — final Phase 3 closeout

**Review status:** PASS for Phase 3 development/reliability correctness; production authorization remains not granted.

### Final verification receipts

```text
npm run typecheck
  PASS — frontend, backend, AIServices

npm run lint
  PASS — frontend, backend, AIServices

npm run test
  PASS — frontend: 41; backend: 296 passed / 14 skipped; AIServices: 2
  Aggregate: 339 passed, 14 skipped, 0 failed

npm run test:mongodb
  PASS — 6 real disposable replica-set/failover tests; 0 skipped

OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
  PASS — 38 passed, 2 skipped; the two skipped tests are the MongoDB lease-failover cases, executed separately by `npm run test:mongodb`

npm run verify:worker-image
  PASS — digest b7a51b8f5f090cc96e502428a631daf003b94a2e38ebe75ef16be04810cef411; npm 11.21.1

docker scout cves --only-severity critical,high local://obsidian-sandbox:dev
  0 critical, 8 high findings remain documented

docker scout cves --exit-code --only-severity critical local://obsidian-sandbox:dev
  PASS — no critical findings

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run build
  PASS — frontend, backend, AIServices; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

git diff --check
  PASS — Windows line-ending warnings only
```

### Final aligned controls

- MongoDB connection generation, topology, ping, readiness, majority/journal write concern, schema metadata, indexes, CAS, migrations, transactions, cache invalidation, session persistence, event persistence, and worker lease fencing are implemented.
- Real disposable replica-set transaction, rollback, backup/restore, index, primary-stop failover, reconnect, and lease-fencing evidence is now recorded.
- Phase 1 Docker isolation and worker policy checks remain green.
- Phase 2 authorization, idempotency, workflow, delivery, frontend, and browser regression checks remain green.
- No production MongoDB, Atlas SRV URI, user data, merge, deployment, commit, or push was used.

### Remaining blockers

- Docker Scout still reports 8 high base-image findings, though the critical threshold is clear with 0 critical findings.
- Broker deployment/admission, registry signing/promotion, live production MongoDB HA/backup/retention operations, and Phase 5 privacy/encryption controls remain outside Phase 3 and unresolved.
- The working tree remains uncommitted by instruction.

## 16. GitHub checkpoint and final Duck 3-C receipt

- Checkpoint commit: `202b2061e65cb714563af4855b0a72da23f24904` (`feat: complete Phase 3 MongoDB durability and recovery`).
- Branch pushed without force to `origin/feat/phase-3-mongodb-durability`.
- GitHub Actions run: https://github.com/Swayamjain1240/Obsidian/actions/runs/39434426699
- GitHub Actions status: **success** (`Obsidian CI`, run #13; one `verify` job, all required steps completed successfully).
- CI directly executed the MongoDB replica-set durability step, browser suites, BuildKit worker image/provenance steps, worker-image policy verification, Docker worker integration tests, audit, build, typecheck, lint, and whitespace checks. The MongoDB step was not skipped or marked unavailable.
- Local exact test receipt for the pushed commit: frontend **41 passed**; backend **296 passed / 14 skipped**; AIServices **2 passed**; aggregate **339 passed / 14 skipped / 0 failed**. The skipped default-suite tests are infrastructure-gated cases; all mandatory MongoDB cases were executed separately below.
- Disposable MongoDB receipt: **6 passed / 0 skipped / 0 failed** across transactions/rollback, owner-scoped persistence/indexes, primary-stop failover/reconnect, backup/restore integrity, durable lease fencing, and concurrent recovery races.
- Docker worker receipt: **38 passed / 2 skipped / 0 failed**. The two skipped entries were MongoDB lease-failover cases and passed in the disposable MongoDB receipt above. Browser E2E receipt: **5 passed / 0 failed**.
- Backup/restore verified two populated workflow-state documents and matching index names, while recreating empty collection metadata/indexes without data mismatches. Primary `mongo-1` was stopped, a replacement primary was elected, and a post-failover write/reconnect succeeded.
- Security receipt: npm audit found **0 vulnerabilities**; Docker Scout found **0 critical and 8 high** base-image findings. The 8 high findings remain release blockers.
- Working tree after the checkpoint push: clean on `feat/phase-3-mongodb-durability`.
- Final Phase 3 verdict: **PASS for development and CI reliability verification; production authorization remains denied**.
- Phase 4 readiness: **not authorized to begin**. Wait for Phase 3 review/authorization; retain the 8 high Docker findings and production broker deployment/admission, registry signing/promotion, privacy/encryption, and operational MongoDB HA/backup/retention requirements as release blockers.
