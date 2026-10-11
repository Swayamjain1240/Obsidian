# Obsidian — Part 3 Duck Review

**Part:** Immutable repository snapshot and intake gate  
**Review trigger:** Duck  
**Review status:** Complete for the Part 3 scope  
**Date:** 2026-10-11  
**Implementation commits:** 10 meaningful commits after the Part 2 review

## Scope reviewed

Part 3 creates a safe, authenticated intake boundary for the selected repository. It resolves the selected branch to a verified Git commit SHA, downloads the exact commit archive through the approved GitHub integration, enforces an archive size limit while streaming, hashes the archive, stores it once in an immutable content-addressed directory, writes an immutable snapshot manifest, and returns only safe public metadata to the browser.

Part 3 does **not** claim to extract or execute repository code, detect the stack, classify completeness, run project tests, repair bugs, enhance code, call an AI provider, or create a pull request.

## External API declaration

```text
Provider: GitHub
Purpose: resolve branch commit metadata and download the selected commit archive
Credential: existing OAuth access token; no new API key
Environment: no new secret or variable
Backend: backend/src/github/client.ts, backend/src/intake
Frontend: frontend/src/api.ts and frontend/src/App.tsx through the backend intake route only
```

## Intake flow

```text
Authenticated repository selection
        ↓
Validate owner, name, and branch reference
        ↓
Resolve branch → verified 40-character commit SHA
        ↓
Download exact commit archive with bounded streaming
        ↓
SHA-256 archive hash
        ↓
Write archive once: <snapshot-root>/<snapshot-id>/repository.tar.gz
        ↓
Write manifest once: <snapshot-root>/<snapshot-id>/snapshot.json
        ↓
Return public snapshot metadata
        ↓
analysisStatus = not_started
```

No analysis or code execution starts in this part.

## Evidence checked

```text
npm run test
npm run typecheck
npm run build
npm audit --audit-level=high --omit=dev
Current-tree and Git-history secret-pattern scan
```

Results:

- Frontend tests: passed.
- Backend tests: passed.
- AI service tests: passed.
- TypeScript checks: passed for all workspaces.
- Builds: passed for all workspaces.
- Production dependency audit: 0 high-level vulnerabilities.
- Chunked archive over-limit behavior is tested and cancels the reader.
- Authenticated snapshot route is tested.
- Snapshot filesystem path is not exposed in the API response.
- `main` is pushed and synchronized.

## 25-point control review

| # | Result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | No new secret; GitHub access token remains server-side and snapshot responses omit filesystem paths. |
| 2 | Aligned | Snapshot root and byte limit are validated configuration values. |
| 3 | Aligned | Snapshot endpoint requires a signed GitHub session. |
| 4 | Aligned for scope | Existing OAuth App/session boundary is required; no new password auth is introduced. |
| 5 | Aligned | Intake is server-side and protected by `requireGithubSession`. |
| 6 | Aligned | Owner, repository, and branch are validated with bounded schemas. |
| 7 | Aligned | Snapshot metadata is rendered through React escaping; no archive HTML is rendered. |
| 8 | Aligned | Global rate limiting protects the intake endpoint. |
| 9 | Aligned | Invalid input and GitHub failures use the secure error envelope. |
| 10 | Aligned | Existing strict CORS allow list remains active. |
| 11 | Aligned | Existing Helmet headers remain active. |
| 12 | Aligned | Archive and snapshot errors do not expose stack traces or paths. |
| 13 | Aligned | No dependency upgrade was required; audit passed. |
| 14 | Aligned | No unused runtime dependency was added. |
| 15 | Aligned | Snapshot workspace is ignored; public response omits internal paths. |
| 16 | Aligned | MongoDB credentials remain environment-only; this part does not store them in manifests. |
| 17 | Aligned | No password handling exists. |
| 18 | Partial | Current tree and history pattern scan is clean except the intentional redaction fixture; dedicated scanner remains future hardening. |
| 19 | Aligned | Security audit and bounded archive review completed before close. |
| 20 | Aligned | Ten Part 3 commits follow the required test → diff → commit → push cadence. |
| 21 | Aligned | Size limits, auth, validation, path handling, and response minimization were added during intake. |
| 22 | Aligned | GitHub provider purpose and existing credentials are documented above. |
| 23 | Aligned | Snapshot identity, store, archive, service, route, and frontend handoff are tested. |
| 24 | Aligned | README and this review describe the real Part 3 behavior and remaining gaps. |
| 25 | Prepared | Intake remains a single focused screen with no page-level scrolling requirement; full detection/health screens are later. |

## Aligned items

- The selected branch is resolved to a verified commit SHA before download.
- The archive is downloaded using that commit SHA, not a mutable branch ref.
- Archive size is bounded both by declared length and streamed byte count.
- Oversized streams are cancelled instead of fully buffered.
- Snapshot identity is content-addressed by repository/ref and archive hash.
- Archive and manifest writes use exclusive creation semantics.
- Repeated identical saves reuse the same immutable snapshot identity.
- Manifest metadata records the commit SHA, archive hash, byte length, and capture time.
- The browser receives safe metadata only; internal absolute paths are omitted.
- Intake returns `analysisStatus: not_started` and does not execute repository code.
- No stack, completeness, baseline, repair, or enhancement claim is made.

## Gaps and next action

1. The local snapshot store is currently filesystem-backed and in-memory at the application metadata layer; a production multi-instance deployment needs durable metadata and a secure object/workspace store.
2. The archive is intentionally not extracted in Part 3. Extraction must be added with path-traversal protection, file-count limits, and a sandbox before analysis.
3. The next part must implement evidence-based stack detection from the immutable snapshot and keep unknown technologies as `Not detected`.
4. Full browser viewport testing remains pending until authenticated detection and confirmation screens are implemented.

## Verdict

**PASS for Part 3 scope.** The immutable snapshot and repository-intake gate align with the four control documents. Part 4 may begin with safe archive extraction and evidence-based project stack detection.
