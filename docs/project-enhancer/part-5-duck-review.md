# Obsidian — Part 5 Duck Review

**Part:** Completeness scanning and explicit scope selection
**Review trigger:** Duck
**Review status:** Complete for the Part 5 scope
**Date:** 2026-10-15
**Implementation commits:** 10 meaningful commits after the Part 4 review

## Review events

```text
DUCK_REVIEW_REQUESTED
DUCK_REVIEW_COMPLETED
```

This document records the requested review against the four control documents. The review trigger authorizes comparison and documentation; it does not authorize repository changes.

## Scope reviewed

Part 5 adds a bounded completeness scanner that runs only after authenticated stack confirmation, returns evidence references instead of source text, and requires an explicit scope choice before baseline testing. It adds lifecycle transitions, authenticated owner-bound routes, redacted completeness events, frontend polling and failure handling, responsive review/findings/scope screens, conservative static route-reference checks, and the `FULL` / `EXISTING_ONLY` gate.

Part 5 does **not** claim to execute repository code, discover every semantic route, run build/test/runtime/security commands, repair defects, enhance code, call an AI provider, create a branch, or create a pull request.

## External API declaration

```text
Provider: GitHub
Purpose: existing repository authentication, branch resolution, and immutable archive capture
Credential: existing GitHub OAuth access token; no new API key
Environment: no new external secret or provider variable
Backend: backend/src/auth, backend/src/github, backend/src/intake, backend/src/detection, backend/src/completeness
Frontend: frontend/src/api.ts through authenticated backend routes only
```

No repository code is executed. Completeness responses contain bounded repository-relative evidence references, safe summaries, statuses, and counters; they do not return raw source text, tokens, or internal workspace paths.

## Part 5 flow

```text
Authenticated repository selection
        ↓
Immutable snapshot and evidence-based stack detection
        ↓
User confirms the detected stack
        ↓
Start completeness review with the confirmed detection run
        ↓
Verify/reuse the immutable extraction and bounded file manifest
        ↓
Scan bounded text evidence without executing repository code
        ↓
Return area statuses, findings, evidence references, and explicit limits
        ↓
Await user scope selection
        ↓
FULL or EXISTING_ONLY
        ↓
BASELINE_TESTING is the next phase
```

The server checks detection ownership and confirmation state before starting a review. Completeness reads and mutations are owner-bound and protected by the existing GitHub session and same-origin policy. Cancellation is terminal for the run; the immutable snapshot remains available.

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

- Backend tests: passed — 27 test files, 174 tests.
- Frontend tests: passed — 12 test files, 36 tests, including the start → poll → findings → scope flow.
- AI service tests: passed — 1 test file, 2 tests.
- TypeScript checks: passed for all workspaces.
- Builds: passed for all workspaces. Vite retains the existing Three.js chunk-size warning (>500 kB); it does not fail the build.
- Production dependency audit: 0 high-level vulnerabilities.
- Playwright Chromium viewport flow: passed at 1440×900, 1024×768, and 390×844 for completeness and confirmation without document overflow.
- Diff whitespace check: passed.
- Secret-pattern checks: clean for the current tree and Git history.

## 25-point control review

| # | Result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | No new secret, credential, or AI provider was added. GitHub remains the only external provider used by the flow. |
| 2 | Aligned | Completeness file, file-count, byte, finding, and timeout limits are validated configuration values with explicit defaults and hard ceilings. |
| 3 | Aligned | Completeness runs require the authenticated GitHub session and are bound to the confirmed detection owner. |
| 4 | Aligned for scope | Existing OAuth App/session architecture is reused; no password authentication was introduced. |
| 5 | Aligned | Start, read, scope, and cancel routes perform server-side ownership checks. |
| 6 | Aligned | Detection-run IDs, scope modes, and route parameters are bounded by schemas; scanning reuses verified manifests and safe file access. |
| 7 | Aligned | React renders escaped status and metadata; raw source is never returned or rendered as HTML. |
| 8 | Aligned | Existing rate limiting remains active, and extraction plus completeness scanning are bounded by files, bytes, file size, paths, and time. |
| 9 | Aligned | Completeness failures use the secure API error envelope with safe messages and request IDs. |
| 10 | Aligned | CORS remains an explicit frontend-origin allow list and mutating completeness routes enforce same-origin checks. |
| 11 | Aligned | Existing Helmet/security-header middleware remains active. |
| 12 | Aligned | Error responses do not expose source, workspace paths, stack traces, credentials, or tokens. |
| 13 | Aligned | `npm audit --audit-level=high` reports zero vulnerabilities. |
| 14 | Aligned | New completeness modules and existing GSAP/Three.js runtime dependencies are used by the implemented flow. |
| 15 | Aligned | Sensitive paths are skipped during scanning, snapshot workspaces remain outside source control, and public evidence uses repository-relative paths only. |
| 16 | Prepared | Run, session, and event coordination is still in memory; durable access-controlled storage remains required for multi-instance deployment. |
| 17 | Aligned | No password is accepted or stored. |
| 18 | Partial by design | Current-tree and history secret-pattern checks are clean, but a dedicated secret-scanner dependency is still future hardening. |
| 19 | Aligned | Dependency audit, bounded scanner review, route authorization tests, cancellation tests, and viewport checks were completed before close. |
| 20 | Aligned | Ten meaningful Part 5 commits follow the required test → inspect diff → commit → push cadence. |
| 21 | Aligned | Safety controls cover confirmed-stack gating, immutable snapshots, verified reads, limits, ownership, cancellation, and scope selection throughout the flow. |
| 22 | Aligned | The GitHub provider, purpose, credential boundary, and backend/frontend locations are declared above. |
| 23 | Aligned | Scanner heuristics, including conservative static route references, lifecycle transitions, authenticated routes, API contracts, polling, failure states, scope actions, and responsive screens are tested. |
| 24 | Aligned | README status and this review describe the implemented Part 5 behavior and deferred phases. |
| 25 | Aligned | Completeness and confirmation screens use tabs, bounded detail pagers, and mobile one-panel navigation; Playwright verifies desktop, tablet, and mobile dimensions without clipping or overflow. |

## Aligned items

- Completeness cannot start before a detection run is confirmed for the same authenticated owner.
- The scanner reads an immutable extraction manifest and verified files; it never executes repository code.
- File size, file count, byte count, finding count, and timeout limits stop or mark a review as limited rather than implying full coverage.
- TODO/FIXME, empty-file, placeholder, dummy-data, explicit unimplemented, broken-relative-import, missing-configuration, and absent-conventional-test evidence are represented with explicit status vocabulary.
- Sensitive paths and ignored paths are excluded from source evidence reads.
- Results contain evidence paths, optional line numbers, reasons, affected paths, counters, and policy version without source excerpts.
- Scope selection is explicit and limited to `FULL` and `EXISTING_ONLY`; it advances the lifecycle to `baseline_testing` without claiming baseline results.
- Completeness lifecycle events include scan start/completion, project status, scope selection, cancellation, and safe summaries.
- Owner-bound reads and mutations preserve the existing authorization and same-origin boundaries.
- The responsive UI makes review, findings, run details, and scope selection navigable without page-level overflow.

## Off-track items and missing controls

- Route checks are intentionally conservative: they compare static route references with static declarations and do not claim to discover every semantic route or framework convention.
- Missing tests are currently represented as a `not_available` tests area when no conventional test paths are found; baseline orchestration will later distinguish unavailable commands from failed execution.
- The implementation uses in-memory runs and event arrays, so restart recovery and multi-instance coordination are not yet available.
- The Duck review trigger is recorded in this review artifact; durable `DUCK_REVIEW_REQUESTED` / `DUCK_REVIEW_COMPLETED` persistence remains part of the later durable event integration.

## Unresolved decisions

1. Define the adapter-specific route and feature evidence contract before broadening route detection, so the scanner does not turn absent conventions into false findings.
2. Decide how baseline workers report available, skipped, failed, and not-available checks for each confirmed stack.
3. Replace in-memory completeness runs/events with durable, access-controlled storage and retention rules.
4. Decide whether `EXISTING_ONLY` scope should emit one exclusion event per area when baseline orchestration is implemented.

## Next corrective action

Implement the baseline-testing phase from the explicit `scope_selected` state. Preserve the same immutable snapshot and owner/session boundaries, discover safe adapter commands without executing them in the web process, record availability before execution, and block later repair/enhancement phases on validated baseline evidence.

## Verdict

**PASS for Part 5 scope.** Bounded completeness evidence, explicit status vocabulary, confirmed-stack gating, authenticated scope selection, safe lifecycle events, and responsive review screens align with the four control documents. Baseline execution, route-discovery semantics, durable coordination, repair, enhancement, and delivery remain intentionally deferred.
