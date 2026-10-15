# Obsidian — Part 4 Duck Review

**Part:** Safe extraction, evidence-based stack detection, and stack confirmation
**Review trigger:** Duck
**Review status:** Complete for the Part 4 scope
**Date:** 2026-10-15
**Implementation commits:** 10 meaningful commits after the Part 3 review

## Scope reviewed

Part 4 adds a bounded archive-extraction boundary, immutable extraction publication, evidence-based multi-language detection, authenticated detection lifecycle routes, explicit stack confirmation, rescan and cancellation, redacted lifecycle events, and the responsive review-first detection and confirmation screens.

Part 4 does **not** claim to execute repository code, classify completeness, run project build/test/runtime checks, repair defects, enhance code, call an AI provider, create a branch, or create a pull request.

## External API declaration

```text
Provider: GitHub
Purpose: resolve the selected branch commit and download the selected repository archive
Credential: existing GitHub OAuth access token; no new API key
Environment: no new external secret or variable
Backend: backend/src/github/client.ts, backend/src/intake, backend/src/detection
Frontend: frontend/src/api.ts through authenticated backend routes only
```

No repository code is executed and no source file contents are returned in detection results. Detection returns bounded evidence references, reasons, candidate metadata, and safe summaries only.

## Part 4 flow

```text
Authenticated repository selection
        ↓
Resolve branch → verified commit SHA and immutable archive
        ↓
Start detection with an owner-bound short-lived snapshot handle
        ↓
Verify archive hash and stream gzip/tar extraction
        ↓
Reject unsafe paths, links, special entries, collisions, and resource-limit violations
        ↓
Publish and re-verify an immutable extraction workspace and file manifest
        ↓
Parse bounded declarations and source-extension evidence
        ↓
Return candidates, evidence references, and Not detected for unknown/ambiguous results
        ↓
User confirms candidates or explicitly confirms Not detected
        ↓
Analysis-only confirmation; original repository remains unchanged
```

Every detection run is owned by the authenticated GitHub user. Run reads and mutations use the same ownership boundary, while mutating routes also require the configured frontend origin. Rescans create a new run against the same immutable snapshot; cancellation never changes the snapshot.

## Evidence checked

```text
npm run test
npm run typecheck
npm run build
npm audit --audit-level=high
npm run e2e --workspace frontend
git diff --check
Current-tree and Git-history secret-pattern scan
```

Results:

- Backend tests: passed, including extraction, manifest integrity, detector false-positive regressions, OAuth browser binding, route ownership, cancellation, confirmation, and audit-event forwarding.
- Frontend tests: passed, including API contracts, polling/cancellation race boundaries, confirmation actions, reduced-motion/WebGL fallback behavior, long-text pagination, and desktop/tablet/mobile viewport policy.
- AI service tests: passed.
- TypeScript checks: passed for all workspaces.
- Builds: passed for all workspaces.
- Production dependency audit: 0 high-level vulnerabilities.
- Playwright Chromium viewport flow: passed at 1440×900, 1024×768, and 390×844 with no document overflow.
- The scanner timeout path was verified after fixing the underlying file-stream AbortError cleanup.
- Snapshot and detection responses omit filesystem paths, tokens, raw source, and secret values.

## 25-point control review

| # | Result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | No new secret or AI credential was added. GitHub remains the only external provider used by the flow. |
| 2 | Aligned | Extraction and evidence limits are validated configuration values with independent hard ceilings. |
| 3 | Aligned | Snapshot handles and detection routes require the signed GitHub session and bind records to the GitHub user. |
| 4 | Aligned for scope | Existing OAuth App/session architecture is used; no password authentication was introduced. |
| 5 | Aligned | Snapshot creation, detection reads, confirmation, rescans, and cancellation are server-side authorization checks. |
| 6 | Aligned | Repository, snapshot handle, candidate IDs, and confirmation payloads use bounded schemas. Archive and manifest paths receive independent safety validation. |
| 7 | Aligned | React renders escaped metadata; source contents are never placed in detection responses or rendered as HTML. |
| 8 | Aligned | Global rate limiting remains active, and detection operations are bounded by file, byte, path, and timeout limits. |
| 9 | Aligned | Detection failures and lifecycle route failures use the secure API error envelope. |
| 10 | Aligned | CORS remains an explicit frontend-origin allow list, and protected mutations enforce same-origin checks. |
| 11 | Aligned | Helmet security headers remain enabled. |
| 12 | Aligned | Errors return safe summaries; filesystem paths, stack traces, raw source, and credentials are not exposed. |
| 13 | Aligned | `npm audit --audit-level=high` reports zero vulnerabilities. |
| 14 | Aligned | `tar-stream`, `gsap`, `three`, and their type packages are used by the implemented extraction and UI flows. |
| 15 | Aligned | Snapshot workspaces and local environment files remain excluded from source control; public responses omit internal paths. |
| 16 | Prepared | MongoDB schemas remain the durable boundary, while Part 4 run/handle/event coordination is in-memory and requires durable multi-instance storage later. |
| 17 | Aligned | No password is accepted or stored. |
| 18 | Partial | Current-tree and history scans are clean apart from intentional test fixture words used to verify redaction; a dedicated secret scanner remains future hardening. |
| 19 | Aligned | Dependency audit, timeout cleanup, archive safety review, and route security tests were completed before close. |
| 20 | Aligned | Ten meaningful Part 4 commits follow the required test → diff → commit → push cadence. |
| 21 | Aligned | Safety controls cover archive verification, extraction, evidence reads, ownership, cancellation, and confirmation throughout the flow. |
| 22 | Aligned | The GitHub provider, purpose, credential boundary, and backend/frontend locations are declared above. |
| 23 | Aligned | Extraction, manifest publication, detection adapters, scanner limits, route lifecycle, frontend polling, confirmation, and fallbacks are tested. |
| 24 | Aligned | README status and this review describe the implemented Part 4 behavior and deferred phases. |
| 25 | Aligned | Authenticated detection/confirmation screens use bounded pagers, tabs, and mobile one-panel navigation; Playwright verifies desktop, tablet, and mobile viewport dimensions without clipping or overflow. |

## Aligned items

- A snapshot handle cannot be used by another authenticated GitHub user or after expiry.
- Extraction verifies the archive byte length and SHA-256 before reading entries.
- Absolute, drive-qualified, UNC-like, traversal, backslash, NUL, reserved-name, invalid-character, path-depth, path-length, duplicate, casefold, ancestor-collision, link, and special-entry cases are rejected.
- Gzip expansion, file count, directory count, single-file size, total extracted bytes, and extraction time are bounded.
- Published extraction records and file manifests are re-hashed and re-verified before reuse or detection.
- Detector adapters parse declarations rather than searching arbitrary prose; framework markers require supported dependency evidence.
- Unsupported or ambiguous results remain Not detected/analysis-only rather than being presented as facts.
- Every user-facing lifecycle state has an append-only redacted system event with session, project, run, phase, status, and base-commit metadata.
- Confirmation accepts only reported candidate IDs or an explicit Not detected choice.
- Cancellation is terminal at the user boundary; each permitted rescan creates a separate run and never mutates the original snapshot.
- GSAP and Three.js are real runtime dependencies with reduced-motion, missing-WebGL, context-loss, and static fallbacks.
- Long evidence paths, identifiers, and summaries use measured pagination instead of clipping.

## Deferred decisions and next action

1. Replace in-memory session, snapshot-handle, run, and event coordination with durable, access-controlled storage for multi-instance deployment.
2. Connect the event sink to the durable MongoDB event model once database connection and retention policy are enabled.
3. Part 5 may implement completeness scanning only after stack confirmation, preserving the same immutable snapshot and analysis-only boundaries.
4. Baseline checks, repair workers, enhancement workers, AI provider calls, branch creation, and pull-request delivery remain later parts.

## Verdict

**PASS for Part 4 scope.** The extraction, evidence detection, confirmation gate, audit lifecycle, and responsive UI align with the four control documents. The implementation is ready to begin Part 5 completeness scanning.
