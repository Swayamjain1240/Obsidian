# Obsidian

> Safely analyze, repair, and enhance existing software projects into a reviewable Version 2.

Obsidian is a review-first, multi-language project enhancement platform. It connects to a GitHub repository, captures an immutable snapshot, detects the stack from evidence, checks completeness, validates the baseline, and prepares carefully scoped repair and enhancement work without silently changing the original project.

![Status](https://img.shields.io/badge/status-Phase%202%20workflow%20correctness%20complete-2ea44f)
![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-3c873a)
![License](https://img.shields.io/badge/license-TBD-lightgrey)

## Contents

- [What is implemented](#what-is-implemented)
- [Quick start](#quick-start)
- [Environment files](#environment-files)
- [Development commands](#development-commands)
- [Service URLs](#service-urls)
- [GitHub OAuth setup](#github-oauth-setup)
- [Architecture](#architecture)
- [Product flow](#product-flow)
- [Safety model](#safety-model)
- [Testing and verification](#testing-and-verification)
- [Troubleshooting](#troubleshooting)
- [Project documentation](#project-documentation)
- [Current delivery boundary](#current-delivery-boundary)

## What is implemented

Parts 1–6 and Phase 2 workflow correctness are complete for the current scope. The feature branch is not production-authorized:

- GitHub OAuth session boundary and authenticated repository selection.
- Branch/commit resolution and immutable repository snapshots.
- Safe bounded archive extraction and verified extraction manifests.
- Evidence-based multi-language stack detection with explicit confirmation.
- Completeness scanning for partial, placeholder, unimplemented, broken-import, configuration, test, and conservative static route-reference evidence.
- Explicit `FULL` and `EXISTING_ONLY` scope selection.
- Adapter-based baseline check discovery and bounded execution.
- Explicit baseline outcomes: passed, failed, timed out, cancelled, partial, and not available.
- Owner-bound lifecycle routes, safe system events, polling, cancellation, review screens, and responsive desktop/tablet/mobile layouts.
- Repair plans with approval, isolated change workspaces, repair validation receipts, enhancement recommendations, recommendation approval, Version 2 manifests, rollback references, validation, branch/commit delivery, and pull-request creation boundaries.
- Durable MongoDB-backed workflow state and event persistence, verified command allowlists, bounded change workers, secret-pattern scanning, and expanded language-adapter coverage.
- Server-authoritative repository/branch selection, durable snapshot handles, versioned workflow state, compare-and-set revisions, owner-bound idempotency receipts, approval ledgers, bounded exact diff previews, repair checkpoints, recovery states, and delivery reconciliation.
- Version 2 exact-diff acknowledgement, explicit rebuild/cancel recovery, durable branch/commit/ref/pull-request receipts, remote tree reconciliation, recommendation viewed/decision receipts, and API-authoritative recovery guards.

AI provider calls and richer adapter-specific commands remain optional integrations. Production baseline execution fails closed unless a verified OS/container worker is provided; the local bounded runner is intended for development and tests.

## Quick start

### Requirements

- Node.js `22.19.0` or newer.
- npm bundled with Node.js.
- MongoDB available at the URI configured in `backend/.env`.
- A GitHub OAuth App if you want to use authenticated repository flows.

### Install

```bash
npm install
```

### Create local environment files

macOS/Linux:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Windows PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Edit `backend/.env` with your local MongoDB and GitHub OAuth values. The frontend template can remain unchanged for local development because Vite proxies `/api` and `/auth` to the backend.

### Start both services

```bash
npm run dev
```

This single command starts the Vite frontend and Express backend together. Their logs are prefixed with `[frontend]` and `[backend]`; press `Ctrl+C` once to stop both processes.

## Environment files

Configuration is intentionally split by service:

| File | Purpose | Commit it? |
|---|---|---:|
| `backend/.env.example` | Safe backend configuration template | Yes |
| `backend/.env` | Local backend values and secrets | No |
| `frontend/.env.example` | Safe browser/Vite configuration template | Yes |
| `frontend/.env` | Local frontend values | No |

### Backend configuration

Required values:

| Variable | Example | Description |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/obsidian` | MongoDB connection URI. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed browser origin. |

Common local values:

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `4000` | Backend HTTP port. |
| `AI_PROVIDER` | `disabled` | AI remains disabled until explicitly configured. |
| `GITHUB_OAUTH_SCOPES` | `read:user,repo` | GitHub permissions requested by OAuth. |
| `SNAPSHOT_ROOT` | `.obsidian-workspaces` | Local immutable snapshot workspace. |
| `BASELINE_MAX_CHECKS` | `12` | Maximum checks in one baseline plan. |
| `BASELINE_CHECK_TIMEOUT_MS` | `120000` | Maximum runtime of one check. |
| `BASELINE_MAX_OUTPUT_BYTES` | `65536` | Output accounting limit; raw output is not returned. |

Optional secrets are commented out in the template so copying it does not create invalid empty secret values. Uncomment and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, and `AUTH_SESSION_SECRET` when enabling GitHub OAuth.

### Frontend configuration

| Variable | Local value | Description |
|---|---|---|
| `VITE_API_BASE_URL` | empty | Uses the Vite proxy for `/api` and `/auth`. Set an absolute backend URL only when the frontend is hosted separately. |

Only `VITE_*` values are exposed to browser code. Never place credentials, tokens, or private keys in `frontend/.env`.

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start frontend and backend together. |
| `npm run dev:frontend` | Start only the Vite frontend. |
| `npm run dev:backend` | Start only the Express backend. |
| `npm run test` | Run all workspace unit/integration tests. |
| `npm run typecheck` | Typecheck frontend, backend, and AI services. |
| `npm run build` | Build all workspaces. |
| `npm run audit` | Run the high-severity npm audit. |
| `npm run test:mongodb` | Start disposable MongoDB replica-set containers and run Phase 3 durability tests. |
| `npm run test:mongodb:backup` | Verify a disposable MongoDB backup and restore using explicit test URIs. |
| `npm run e2e --workspace frontend` | Run Chromium viewport and workflow browser tests. |
| `npm run e2e --workspace frontend -- e2e/phase2-workflow.spec.ts e2e/phase2-workflow-failures.spec.ts` | Run the Phase 2 workflow browser checks only. |
| `npm run lint` | Run the configured TypeScript lint checks. |

Workspace-specific commands can be run with npm's workspace flag, for example `npm run test --workspace backend`.

## Service URLs

When using the default development configuration:

| Service | URL |
|---|---|
| Frontend | <http://localhost:5173> |
| Backend live health | <http://localhost:4000/health/live> |
| Backend readiness | <http://localhost:4000/health/ready> |
| Backend API status | <http://localhost:4000/api/v1/status> |
| GitHub OAuth callback | <http://localhost:4000/auth/github/callback> |

The readiness endpoint reports whether runtime dependencies are connected. The live endpoint only confirms that the backend process is responding.

## GitHub OAuth setup

1. Create or open a GitHub OAuth App.
2. Set the authorization callback URL to `http://localhost:4000/auth/github/callback`.
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `backend/.env`.
4. Set a random `AUTH_SESSION_SECRET` with at least 32 characters.
5. Restart `npm run dev`.

GitHub remains the only external provider in the implemented flow. No AI provider is required for local startup.

## Architecture

```text
Browser / React + Vite (frontend :5173)
        │  /api and /auth proxy
        ▼
Express API (backend :4000)
        │
        ├── GitHub OAuth and repository intake
        ├── Immutable snapshot and verified extraction
        ├── Evidence-based stack detection
        ├── Completeness and scope review
        └── Bounded baseline discovery/execution
        │
        ├── MongoDB connection boundary
        └── Local immutable workspace (.obsidian-workspaces/)
```

The `AIServices` workspace is present for the future provider boundary and currently keeps AI disabled by default.

Important source locations:

- `frontend/src/App.tsx` — routes and wizard navigation.
- `frontend/src/api.ts` — typed browser API client.
- `frontend/src/pages/` — repository, detection, confirmation, completeness, baseline, repair, enhancement, and Version 2 phases.
- `backend/src/app.ts` — Express middleware and route mounting.
- `backend/src/intake/` — repository snapshot and extraction boundaries.
- `backend/src/detection/` — stack evidence detection.
- `backend/src/completeness/` — completeness findings and scope selection.
- `backend/src/baseline/` — adapter discovery, bounded runner, sandbox policy, orchestration, and routes.
- `backend/src/workflow/` — repair plans, approvals, change workspaces, recommendations, manifests, validation, and delivery.
- `backend/src/security/secret-scanner.ts` — bounded secret-pattern scanning without returning secret values.
- `scripts/dev.mjs` — cross-platform two-service development launcher.

## Product flow

```text
GitHub Login
    ↓
Repository Selection → Immutable Snapshot
    ↓
Evidence-Based Stack Detection → User Confirmation
    ↓
Completeness Review → FULL or EXISTING_ONLY Scope
    ↓
Baseline Check Discovery and Execution
    ↓
Repair Review → Approval → Repair Validation
    ↓
Enhancement Analysis → Recommendation Approval
    ↓
Version 2 Change Workspace → Manifest Validation → Branch / Commit → Pull Request
```

Obsidian distinguishes `Working`, `Working with issues`, `Broken`, `Partial`, `Placeholder`, `Not implemented`, and `Not available`. It never turns an absent command or unknown technology into a false pass or guessed fact.

## Safety model

- The original repository is never silently changed.
- Analysis reads an immutable snapshot and verified extraction manifest.
- Repository code is not executed during detection or completeness scanning.
- Baseline commands run in the pinned `obsidian-sandbox` Docker worker with no network, a read-only original snapshot mount, a bounded writable scratch tmpfs, a non-root UID, dropped capabilities, `no-new-privileges`, CPU/memory/PID limits, and bounded output/time.
- API keys, OAuth tokens, passwords, source excerpts, and raw command output stay out of responses and logs.
- Protected routes enforce server-side ownership; mutating routes enforce the configured frontend origin.
- Unknown or ambiguous technologies remain explicitly not detected.
- Missing checks and unsupported or registry-dependent worker capabilities are reported as `Not available`, not as failures or passes.

## Testing and verification

The repository's delivery checks are:

```bash
npm run test
npm run typecheck
npm run build
npm run audit
npm run e2e --workspace frontend
git diff --check
```

The isolated-worker integration suite is opt-in because it requires Docker Desktop with the Linux engine and the local worker image:

```bash
docker buildx build --progress=plain --load --tag obsidian-sandbox:dev infra/sandbox
docker buildx build --progress=plain --provenance=true --sbom=true --output=type=oci,dest=obsidian-sandbox.oci.tar infra/sandbox
npm run verify:worker-image
OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
```

For production, run `npm run worker-broker --workspace backend` as a separately permissioned service with access to the Docker daemon, then configure `BASELINE_WORKER_BROKER_URL` and a 32-character-or-longer `BASELINE_WORKER_BROKER_TOKEN` in the API. Development and tests may use the local broker subprocess fallback.

Authenticated screens follow a one-viewport policy. The Playwright suite checks confirmation, completeness, and baseline screens at desktop, tablet, and mobile sizes for horizontal and vertical overflow.

## Troubleshooting

### `npm run dev` exits immediately

Run `npm install` from the repository root and make sure Node.js is at least `22.19.0`. The launcher starts `npm run dev` inside both `frontend/` and `backend/`.

### Backend reports invalid configuration

Confirm that `backend/.env` contains non-empty `MONGODB_URI` and `FRONTEND_ORIGIN`. Optional OAuth variables should be omitted until configured rather than left as empty assignments.

### The browser cannot reach the API

For local development, keep `VITE_API_BASE_URL` empty and use the Vite proxy. Confirm the backend is running on port 4000 and that `FRONTEND_ORIGIN=http://localhost:5173` matches the browser URL exactly.

### Port 4000 or 5173 is already in use

Stop the existing process or change `PORT` in `backend/.env`. The frontend development server is configured for port 5173 and uses strict port binding.

### GitHub sign-in is unavailable

Configure the OAuth values in `backend/.env`, register the exact callback URL, restart the backend, and check `/health/live`.

## Project documentation

The four control documents define the product and security boundaries:

- [Architecture](docs/project-enhancer/01-architecture.md)
- [Session / System Log](docs/project-enhancer/02-session-system-log.md)
- [Master Product Specification](docs/project-enhancer/03-master-product-spec.md)
- [System Design](docs/project-enhancer/04-system-design.md)

Duck reviews record evidence and deferred decisions for each completed part:

- [Part 1](docs/project-enhancer/part-1-duck-review.md)
- [Part 2](docs/project-enhancer/part-2-duck-review.md)
- [Part 3](docs/project-enhancer/part-3-duck-review.md)
- [Part 4](docs/project-enhancer/part-4-duck-review.md)
- [Part 5](docs/project-enhancer/part-5-duck-review.md)
- [Part 6](docs/project-enhancer/part-6-duck-review.md)
- [Phase 1 isolated worker](docs/project-enhancer/phase-1-worker-duck-review.md)
- [Phase 2 workflow correctness plan](docs/project-enhancer/phase-2-workflow-correctness-plan.md)

## Current delivery boundary

The post-baseline workflow is implemented behind authenticated routes under `/api/v1/workflow`:

- Repair plan creation, item approval/rejection, isolated workspace application, and validation receipts.
- Enhancement analysis from existing completeness areas, recommendation approval, and Version 2 start.
- Version 2 change manifests, rollback references, structural/command validation, pull-request preparation, and GitHub branch/commit/pull-request delivery.
- Workflow state and system events persist through the MongoDB boundary while retaining a bounded in-memory read-through cache.

Phase 2 is complete for workflow correctness and remains not production-authorized. Current evidence covers root typecheck, lint, unit/integration tests, build, audit, Docker worker integration, worker-image policy verification, Docker Scout scanning, and browser workflow checks. The Phase 2 master plan records the final Duck result and the remaining production boundaries.

Phase 3 MongoDB durability work is in progress on `feat/phase-3-mongodb-durability`. The current implementation adds revisioned persistence, topology-aware readiness, transaction boundaries, and fenced worker leases. Disposable replica-set and backup/restore checks require Docker and must not be reported as passed when that infrastructure is unavailable.

The worker policy accepts only reviewed command shapes, keeps commands inside a copied scratch workspace, strips inherited environment variables, disables network-dependent package-manager behavior, and enforces file-count, directory-depth, byte, time, output, CPU, memory, PID, and tmpfs limits. The original extraction is mounted read-only and is fingerprint-checked after execution. Containers carry explicit ownership and lease labels, are removed after every job, and only expired stopped containers are eligible for orphan recovery.

Production deployments must set `BASELINE_REQUIRE_ISOLATION=true` or rely on its production default, configure `BASELINE_WORKER_IMAGE` with a reviewed `@sha256:` digest, and provide `BASELINE_WORKER_BROKER_URL` plus `BASELINE_WORKER_BROKER_TOKEN`. The API talks to the authenticated broker rather than holding Docker-daemon authority when deployed with the broker as a separate service. Readiness checks require both MongoDB and a successful worker preflight. Registry-dependent checks remain unavailable until a separately reviewed network policy is enabled. CI runs install, typecheck, lint, tests, audit, build, Chromium E2E, digest/entrypoint/npm-runtime policy checks, Docker Scout scanning when available, Docker worker integration tests, and whitespace checks through `.github/workflows/ci.yml`. The current local Docker Scout scan found zero critical and eight high findings in Essential/unpatched Debian base packages; the image is not production-admissible until those findings receive an evidence-based risk decision or the runtime base is replaced.

## License

License to be decided.
