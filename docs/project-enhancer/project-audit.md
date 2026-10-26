# Obsidian — Project-Wide Audit and Review

**Review date:** 2026-10-26
**Review trigger:** Duck
**Repository:** `Swayamjain1240/Obsidian`
**Branch:** `feat/phase-5-privacy-retention`
**HEAD:** `15cd69487d02da4c55175e0bae4c246986afbd7d`
**Scope:** Entire repository, with Phase 5 completion work limited to local application controls
**Verdict:** **CONDITIONAL PASS — READY FOR USER CHECKPOINT REVIEW; NOT READY FOR PRODUCTION OR INFRASTRUCTURE SIGN-OFF**

## Executive summary

Obsidian is a review-first platform with React/Vite frontend, Express/TypeScript backend, MongoDB persistence boundaries, GitHub OAuth intake, immutable repository snapshots, evidence-based detection, bounded completeness scanning, isolated baseline execution, repair/enhancement workflow state, and a disabled-by-default AI boundary.

The audit confirmed that the existing Part 1–6 product surfaces and Phase 2 workflow correctness controls remain aligned with the four authoritative design documents. Phase 5 adds redaction, source-context minimization, authenticated encryption envelopes, configurable retention, fail-closed filesystem cleanup, owner-scoped deletion, protected audit evidence, and durable cleanup/restart behavior.

One local Phase 5 privacy gap was found and fixed during this review: account/workflow deletion removed `WorkflowState` records but did not remove durable detection/completeness/baseline run envelopes. `DurableRunStore` now supports owner-scoped listing and deletion, deletion blocks active durable runs, and retention removes expired terminal run envelopes within the configured batch bound.

Production approval remains blocked by unavailable Docker/MongoDB infrastructure, unresolved policy decisions, production key custody, worker-image findings and admission controls, backup/replica erasure, external-provider retention, and other deployment responsibilities outside local code.

## Audit method

Reviewed:

- `README.md`, root/workspace manifests, lockfile, `.gitignore`, environment templates, and CI workflow.
- `docs/project-enhancer/01-architecture.md` through `04-system-design.md`.
- Parts 1–6 Duck reviews, Phase 1 worker review, and Phase 2–4 plans.
- Backend auth, intake, detection, completeness, baseline, workers, workflow, events, database, security, and privacy modules.
- Frontend routes, API client, authenticated flow hooks/pages, unit tests, and Playwright tests.
- AI service boundary and tests.
- Current working-tree status, dependency audit, typecheck, lint, build, unit/integration tests, browser tests, whitespace checks, and Docker-dependent commands where available.

The review distinguishes local evidence from unavailable infrastructure and deployment evidence. Historical failures remain in the Phase 5 plan; fresh results in this document describe the current tree only.

## System inventory

| Area | Current implementation | Boundary / residual risk |
|---|---|---|
| Frontend | React, React Router, Vite, typed API client, responsive review screens, polling/cancellation lifecycle | Browser deployment, CSP integration, and provider configuration remain deployment concerns |
| Backend API | Express routes with request IDs, Helmet, CORS, same-origin mutation checks, JSON limits, validation, rate limits, secure errors | Distributed rate limiting and reverse-proxy trust require production design |
| Authentication | GitHub OAuth, signed HttpOnly session cookie, durable session model, token encryption compatibility and key-ID envelope | Production OAuth secrets, KMS/key custody, cookie domain/proxy configuration remain open |
| Intake | Owner-bound repository selection, GitHub branch resolution, immutable archive capture, bounded tar extraction and manifests | GitHub availability and remote data retention remain external dependencies |
| Detection | Confirmed-stack gating, bounded evidence scan, immutable snapshot identity, durable run envelope | Semantic route discovery remains intentionally conservative |
| Completeness | Bounded non-executing scanner for implementation/configuration/tests/routes and explicit scope selection | Heuristic evidence is not semantic completeness proof |
| Baseline | Adapter discovery, command allowlists, sanitized environment, bounded child-process results, isolated worker boundary | Docker/broker availability, OS isolation, registry admission, and network policy require deployment evidence |
| Workflow | Owner-bound repair/enhancement/Version 2 state, revisions, idempotency, approvals, diffs, validation, delivery reconciliation | GitHub branch/PR side effects need production credentials and operational controls |
| Persistence | MongoDB models, majority/journaled writes where required, CAS revisions, transaction helpers, worker leases, bounded caches | Live replica-set, failover, backup/restore, and multi-instance evidence unavailable locally |
| Events | Redacted metadata-only events, integrity hashes, required durable sink implementation | Workflow callers currently swallow asynchronous sink rejection; policy decision remains unresolved |
| Privacy | Retention policy, durable cleanup claims/leases/retries, owner-scoped deletion, active-workflow/run protection, audit purge approval, AES-GCM key IDs | KMS, backups, host/Docker storage, external providers, physical media, and governance remain outside code |
| AI services | Disabled-by-default provider boundary and explicit unavailable behavior | No provider retention or runtime persistence evidence exists |

## Phase status

| Phase / part | Result | Evidence and open boundary |
|---|---|---|
| Part 1 foundation | Complete for scope | Application boundaries, validation, HTTP hardening, event redaction, and disabled AI boundary |
| Part 2 intake/authentication | Complete for scope | OAuth/session/repository selection and immutable snapshot flow |
| Part 3 durability | Conditional | Local persistence/CAS/transactions/leases; live MongoDB and backup evidence unavailable |
| Part 4 API security | Conditional | Auth, browser security, ownership, rate limits, broker authorization, and audit controls; deployment controls remain |
| Part 5 completeness | Complete for scope | Bounded non-executing scan and explicit `FULL`/`EXISTING_ONLY` scope gate |
| Part 6 baseline/workflow | Conditional | Bounded adapter execution and workflow correctness; worker image, Docker integration, and production admission remain |
| Phase 5 privacy | Conditional pass | Local controls implemented and tested; audit persistence policy and production privacy governance remain open |
| Phase 6 | Not started | No Phase 6 work was begun during this review |

## Phase 5 completion record

Implemented and verified locally:

- Central redaction before event hashing and bounded diagnostic persistence.
- Privacy-safe context minimization that excludes sensitive paths and bounds excerpts.
- AES-256-GCM envelopes with key IDs, tamper detection, explicit rotation, duplicate-key rejection, and fail-closed missing-key handling.
- Configurable retention values exposed through configuration and privacy status.
- Durable filesystem cleanup with containment, canonical identity checks, symlink rejection, claims, leases, retries, exact configured batch limits, restart recovery, and active-resource protection.
- Owner/session-scoped account and workflow deletion with deterministic idempotency, partial/failure states, retry, startup reconciliation, protected audit evidence, and metadata-only deletion events.
- Durable detection/completeness/baseline run-envelope deletion during account/workflow deletion.
- Expired terminal durable-run cleanup during retention processing, bounded by `PRIVACY_CLEANUP_BATCH_SIZE`; active runs are retained.
- Frontend initial-route/start-request lifecycle fix and regression coverage for start ordering, route replacement, and unmount cancellation.
- Audit-event success/rejection regression coverage without changing the unresolved persistence semantics.

### Phase 5 decisions intentionally not made

- Required audit persistence: fail closed, pause/recover, or durable outbox/retry.
- Organization-approved retention durations and audit access/subject-erasure policy.
- Production KMS/key custody/rotation scheduling and database encryption-at-rest.
- Backup/replica erasure, external AI-provider retention/deletion, host log rotation, Docker storage cleanup, and physical-media sanitization.
- Automatic cancellation coordination for active workflows during account deletion.

## Security and privacy findings

### Resolved locally

1. Owner predicates and session binding are enforced by server routes and service stores.
2. Public deletion responses omit internal owner and session identifiers.
3. Active workflow and active durable-run references block deletion rather than deleting live state.
4. Successful filesystem cleanup removes its durable cleanup-task metadata; failed work remains retryable.
5. Cleanup rejects traversal, symlink components, target replacement, root replacement, and observed identity changes.
6. Audit records are immutable in ordinary deletion; explicit purge requires an approved policy flag.
7. Secrets and private-source excerpts are redacted or excluded before event hashing and future provider context construction.

### Open or deployment-dependent

1. Workflow operations may report success when an asynchronous required audit sink rejects. This is tested and documented, but no product/security decision authorizes changing it.
2. Filesystem cleanup cannot provide a completely race-free guarantee with portable Node.js path APIs; production permissions must prevent hostile concurrent mutation of the cleanup root.
3. Docker worker execution and image policy cannot be validated without a running Linux Engine and image.
4. Local code cannot prove deletion from MongoDB backups, replicas, host logs, Docker storage, external providers, or physical media.

## Fresh local verification

The current tree was checked with:

```text
npm run test
  PASS — frontend: 17 files, 47 tests
  PASS — backend: 84 files passed, 8 skipped; 338 tests passed, 14 skipped
  PASS — AIServices: 1 file, 2 tests
  Aggregate: 387 passed / 14 skipped / 0 failed

npm run test --workspace backend -- --maxWorkers=1 src/privacy/retention.test.ts src/privacy/deletion.test.ts
  PASS — 2 files, 14 tests

npm run typecheck --workspace backend
  PASS
```

Complete verification refresh:

```text
npm run typecheck
  PASS — all workspaces

npm run lint
  PASS — all workspaces

npm run build
  PASS — all workspaces; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

npm run e2e --workspace frontend
  PASS — 5 browser tests

git diff --check
  PASS — expected Windows line-ending warnings only
```

## Infrastructure evidence boundary

The Docker Linux Engine was unavailable at `npipe:////./pipe/dockerDesktopLinuxEngine` during the review. Therefore the following are **not passed**:

```text
docker version
  EXIT 1 — Docker CLI 29.8.2 is present; Linux Engine pipe is unavailable

npm run test:mongodb
  EXIT 2 — Docker daemon is not running

npm run test:mongodb:backup
  EXIT 2 — disposable MongoDB test authorization/URI not provided

npm run verify:worker-image
  EXIT 1 — Docker API/image inspection unavailable
```

- MongoDB replica-set durability tests.
- Disposable backup/restore verification.
- Worker image build, digest/entrypoint policy, provenance/SBOM, and Docker Scout scan.
- Docker worker and ChangeWorker integration tests.
- Live MongoDB HA/failover/backup/retention evidence.

The historical Phase 1/Phase 4 records preserve the prior scan result of zero critical and eight high base-image findings; no new scan is claimed here.

## Documentation map

- Product and security authorities: `docs/project-enhancer/01-architecture.md`, `02-session-system-log.md`, `03-master-product-spec.md`, `04-system-design.md`.
- Completed part reviews: `part-1-duck-review.md` through `part-6-duck-review.md`.
- Infrastructure worker review: `phase-1-worker-duck-review.md`.
- Workflow correctness: `phase-2-workflow-correctness-plan.md`.
- Phase 5 source of truth: `phase-5-privacy-retention-plan.md`.
- This project-wide audit: `project-audit.md`.

## Final verdict and next corrective action

**CONDITIONAL PASS — READY FOR USER CHECKPOINT REVIEW; NOT READY FOR PRODUCTION OR INFRASTRUCTURE SIGN-OFF.**

The next decisions are product/security approval of required audit persistence semantics and organization approval of privacy retention/erasure policy. Infrastructure verification should be rerun only after Docker/MongoDB prerequisites are available. No commit, staging, push, merge, deployment, or Phase 6 work occurred.
