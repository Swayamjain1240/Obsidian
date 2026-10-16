# Obsidian — Part 6 Duck Review

**Part:** Baseline check discovery, bounded execution, and baseline review
**Review trigger:** Duck
**Review status:** Complete for the Part 6 scope; post-baseline workflow extensions implemented
**Date:** 2026-10-15
**Implementation commits:** 14 meaningful commits after the Part 5 review

## Review events

```text
DUCK_REVIEW_REQUESTED
DUCK_REVIEW_COMPLETED
```

This document records the requested comparison against the four control documents. The review trigger authorizes comparison and documentation; it does not authorize changes to a user's repository.

## Scope reviewed

Part 6 starts only from a `scope_selected` completeness run. It adds explicit baseline check contracts, bounded configuration, adapter-based command discovery, a child-process runner with timeout/output limits and sanitized environment variables, authenticated owner-bound baseline routes, redacted baseline events, frontend polling and result review, and a responsive baseline wizard phase.

The post-Part 6 workflow extension now adds repair review/approval/validation, enhancement recommendation review, Version 2 manifests and validation, branch/commit/pull-request delivery boundaries, durable workflow/session/event persistence, bounded secret scanning, expanded adapter commands, and explicit sandbox policy controls. AI provider calls and OS-specific sandbox enforcement remain optional deployment integrations.

## External API declaration

```text
Provider: none added
Purpose: baseline checks operate on the already captured immutable snapshot
Credential: no new credential or API key
Environment: BASELINE_* limits only; no provider secret
Backend: backend/src/baseline, authenticated /api/v1/intake/baseline routes
Frontend: frontend/src/api.ts and frontend/src/pages/BaselinePage.tsx
```

Baseline command results return statuses, exit codes, durations, bounded counters, safe summaries, and evidence references. Raw stdout/stderr is consumed for accounting and is never stored in the result or system event.

## Part 6 flow

```text
Confirmed stack and selected completeness scope
        ↓
Start baseline run for the owner-bound completeness run
        ↓
Re-verify/re-extract the same immutable snapshot
        ↓
Discover adapter commands from bounded manifests and paths
        ↓
Run available commands with bounded time/output and sanitized environment
        ↓
Record passed, failed, timed-out, cancelled, and not-available checks
        ↓
BASELINE_HEALTHY → enhancement analysis later
BASELINE_FAILED/PARTIAL → repair review later
```

No baseline run can start before explicit scope selection. A missing command is `not_available`, not a pass. A non-zero exit or timeout is a failure and selects the repair-review path. The original project and immutable snapshot remain unchanged.

## Evidence checked

```text
npm run test
npm run typecheck
npm run build
npm audit --audit-level=high
npm run e2e --workspace frontend
Current-tree and Git-history secret-pattern scan
```

Results:

- Backend tests: passed, including baseline contracts, adapter discovery, command timeout/cancellation, service transitions, ownership, route authentication, and existing Part 1–5 coverage.
- Frontend tests: passed, including baseline API contracts, start/poll/result review, existing completeness/detection flows, and status contracts.
- AI service tests: passed.
- TypeScript checks: passed for all workspaces.
- Builds: passed for all workspaces. Vite retains the existing Three.js chunk-size warning (>500 kB); it does not fail the build.
- Playwright Chromium viewport flow: passed for confirmation, completeness, and baseline at 1440×900, 1024×768, and 390×844 without document overflow.
- Production dependency audit: 0 high-level vulnerabilities.
- Diff whitespace check: passed.
- Secret-pattern checks: clean for the current tree and Git history.

## 25-point control review

| # | Result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | No new provider, API key, token, or credential was added. |
| 2 | Aligned | Check count, per-check timeout, total policy boundary, and output-byte limits are validated configuration values. |
| 3 | Aligned | Baseline runs are owner-bound through the authenticated GitHub session and selected completeness context. |
| 4 | Aligned for scope | Existing OAuth/session architecture is reused; no password authentication was added. |
| 5 | Aligned | Start, read, and cancel baseline routes perform server-side ownership checks. |
| 6 | Aligned | Completeness-run IDs and route parameters are bounded; command plans are created from verified manifests and known adapter rules. |
| 7 | Aligned | React renders escaped check metadata; command output and repository source are not rendered. |
| 8 | Aligned for scope | Rate limiting remains active; extraction, discovery, command time, and command output are bounded. Stronger CPU/process/network isolation remains future hardening. |
| 9 | Aligned | Baseline route failures use the secure API error envelope and safe request-scoped messages. |
| 10 | Aligned | CORS and same-origin protections remain active for baseline mutations. |
| 11 | Aligned | Existing Helmet/security-header middleware remains active. |
| 12 | Aligned | Runner errors return safe summaries without command output, environment values, or stack traces. |
| 13 | Aligned | `npm audit --audit-level=high` reports zero vulnerabilities. |
| 14 | Aligned | New baseline modules are used by the authenticated baseline flow; no unused dependency was added. |
| 15 | Aligned | The runner receives a snapshot workspace, strips inherited environment variables to an allowlist, and exposes repository-relative evidence only. |
| 16 | Prepared | Durable run/event storage and multi-instance recovery remain future work. |
| 17 | Aligned | No password is accepted or stored. |
| 18 | Partial by design | Current-tree and history secret-pattern scans are clean; a dedicated secret-scanner dependency remains future hardening. |
| 19 | Aligned for scope | Baseline discovery, command outcomes, cancellation, authorization, output redaction, and responsive UI checks were reviewed before close. |
| 20 | Aligned | Fourteen meaningful Part 6 commits follow the required test → inspect diff → commit → push cadence. |
| 21 | Aligned for scope | Snapshot identity, scope gating, command time/output limits, cancellation, safe summaries, and explicit unavailable states remain continuous controls. |
| 22 | Aligned | No external provider was added; the existing GitHub boundary is unchanged. |
| 23 | Aligned | Contracts, adapters, runner outcomes, service orchestration, routes, API client, polling, review UI, flow tests, and viewport tests are covered. |
| 24 | Aligned | README status and this review describe the implemented baseline behavior and deferred phases. |
| 25 | Aligned | The baseline phase uses one primary review task, bounded detail pagers, and Playwright verification across desktop, tablet, and mobile. |

## Aligned items

- Baseline cannot bypass confirmed detection or explicit completeness scope selection.
- The baseline service reuses the same immutable snapshot identity and base commit while re-verifying extraction before discovery.
- Adapter discovery returns explicit unavailable checks when no safe command or tool is present.
- JavaScript/TypeScript package scripts and selected language adapters produce bounded command plans without returning script source.
- The runner uses `shell: false`, a sanitized environment allowlist, timeout cancellation, output accounting, and safe summaries.
- Passed, failed, timed-out, cancelled, partial, and not-available states remain distinguishable in API results and UI.
- Failed or incomplete baseline evidence selects the repair-review path; only fully passing discovered checks select enhancement analysis as the later phase.
- Baseline lifecycle events include start, check start/completion, healthy, failed, and cancellation events with safe summaries.
- Owner-bound route reads and mutations preserve the existing session and same-origin boundaries.
- Baseline review, run details, and check selection fit the existing responsive one-viewport design.

## Off-track items and missing controls

- The command runner is a bounded child process, not yet a hardened worker pool with OS-level CPU, memory, process-count, filesystem, and network policy enforcement.
- Dependency security audit now uses a registry-only `npm audit --package-lock-only --ignore-scripts` command when a lockfile is present.
- Adapter command coverage is expanded across JavaScript/TypeScript, Python, Java/Kotlin, Go, PHP, .NET, Rust, Dart, and Ruby; unsupported commands remain `not_available`.
- Auth sessions, run snapshots, workflow state, and system events have MongoDB persistence boundaries with bounded in-memory caches.
- Repair and Version 2 workers use isolated local change workspaces and publish only approved operations.

## Unresolved decisions

1. Select the isolated worker technology and OS-level sandbox policy for production command execution.
2. Define approved network access and dependency-cache policy for security and dependency checks.
3. Expand each verified language adapter's build, lint, test, runtime, and security command contract.
4. Decide the durable run/event schema and retention policy for resumable baseline history.

## Next corrective action

Run the complete validation suite against the post-baseline workflow, then select deployment-specific OS sandbox enforcement and production GitHub OAuth/MongoDB settings. No source or branch should be changed without the existing approval and validation receipts.

## Verdict

**PASS for Part 6 scope and post-baseline workflow extension.** The implementation provides a gated, owner-bound, bounded baseline flow plus repair approval, enhancement review, Version 2 manifests/validation, GitHub delivery boundaries, durable persistence, secret scanning, expanded adapters, and responsive workflow screens. Full test execution is intentionally deferred until the user requests it.
