# Obsidian — Part 1 Duck Review

**Part:** Foundation and application boundaries  
**Review trigger:** Duck  
**Review status:** Complete for the Part 1 scope  
**Date:** 2026-10-10  
**Implementation commits:** 10 meaningful commits after the documentation baseline

## Scope reviewed

Part 1 delivers a local MERN-style foundation with exactly three application packages:

```text
frontend/
backend/
AIServices/
```

It includes the React shell, Express API foundation, MongoDB/Mongoose boundary, lifecycle state machine, append-only event model, provider-neutral disabled AI boundary, HTTP hardening, explicit intake capability states, tests, and documentation.

It does **not** claim to implement GitHub OAuth, repository discovery, stack detection, completeness scanning, repository execution, repair workers, enhancement workers, AI provider calls, or pull-request creation.

## Evidence checked

```text
npm run test
npm run typecheck
npm run build
npm audit --audit-level=high --omit=dev
git diff --check
Secret-pattern scan over the current tree
```

Observed results:

- Frontend tests: 2 passed.
- Backend tests: 21 passed.
- AI service tests: 4 passed.
- TypeScript checks: passed for all workspaces.
- Builds: passed for all workspaces.
- Production dependency audit: 0 high-level vulnerabilities.
- Secret-pattern scan: no matches for common key/token/private-key patterns.
- Working tree: clean after the Part 1 push.

## 25-point control review

| # | Part 1 result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | `.gitignore`, `.env.example`, redaction tests, and no committed secrets. |
| 2 | Aligned | Zod configuration validation rejects missing required environment variables. |
| 3 | Prepared | Route phases exist, but real private routes are deferred until authentication. |
| 4 | Prepared | `AuthContext` and authorization seam exist; GitHub OAuth is explicitly not implemented. |
| 5 | Prepared | `requirePermission` is server-side; no client-only authorization claim is made. |
| 6 | Prepared | `validateBody` exists; intake payload routes are not yet implemented. |
| 7 | Aligned for current scope | React escaping is used; no unsafe HTML renderer exists. |
| 8 | Aligned | Express rate limiting is configured from validated environment values. |
| 9 | Aligned | API errors use a request ID and secure error envelope. |
| 10 | Aligned | CORS allows only the configured frontend origin. |
| 11 | Aligned | Helmet security headers are enabled and tested. |
| 12 | Aligned | No production debug mode or stack trace is returned. |
| 13 | Aligned | Lockfile committed and production audit completed before Part 1 close. |
| 14 | Aligned | Dependency set is intentionally small; unused runtime packages were not added. |
| 15 | Aligned | Private filename and common secret-pattern checks are clean. |
| 16 | Prepared | MongoDB URI is environment-only; real least-privilege deployment is deferred. |
| 17 | Aligned | No password storage exists; future password auth must use Argon2/bcrypt. |
| 18 | Partial | Current tree scanned; repository history had only the controlled documentation baseline before Part 1. A dedicated history scanner remains a later hardening task. |
| 19 | Aligned for Part 1 | This Duck review includes a security audit section and audit evidence. |
| 20 | Aligned | Each of the 10 Part 1 commits was tested, diff-checked, committed, and pushed. |
| 21 | Aligned | Security controls were introduced during the foundation, not deferred to a final patch. |
| 22 | Aligned | No external GitHub or AI provider API was added. Provider details will be recorded before future use. |
| 23 | Aligned | Backend, frontend, and AI boundary tests run with each feature milestone. |
| 24 | Aligned | README and Part 1 documentation state the real implemented scope and explicit gaps. |
| 25 | Prepared | The shell uses a one-primary-task layout and responsive CSS; full authenticated-screen viewport testing is deferred until authentication and real screens exist. |

## Aligned items

- The requested `frontend`, `backend`, and `AIServices` application structure exists.
- The original repository is not connected to or modified by the foundation.
- The frontend does not fabricate GitHub repositories or analysis results.
- Backend readiness does not claim MongoDB is healthy before a connection exists.
- AI analysis returns `not_available` when disabled rather than invented output.
- Session transitions reject invalid jumps.
- System events redact secret-like values before persistence payload creation.
- CORS, Helmet, rate limiting, request IDs, and secure error responses are present.
- The UI has explicit “Not implemented yet” states for future phases.

## Off-track items

No Part 1 implementation is off-track. The following are intentionally deferred and must not be represented as complete in later work:

- GitHub login and OAuth scopes.
- Repository selection and immutable snapshot creation.
- Evidence-based stack detection and user confirmation.
- Completeness classification.
- Baseline orchestration against a user repository.
- Repair and enhancement workers.
- External AI provider calls.
- Pull request creation.

## Unresolved decisions

1. Which GitHub OAuth provider configuration and callback deployment model will be used?
2. Which MongoDB deployment and least-privilege account model will be used?
3. Which verified language adapters are included in the first user-facing release?
4. Which external AI provider, if any, will be approved for the first analysis flow?
5. Which browser/device matrix will provide automated viewport evidence?

## Next corrective action

Before Part 2 begins, decide and document the GitHub OAuth and MongoDB deployment boundaries. Part 2 should implement repository authorization and selection only after the provider, purpose, credential names, environment variables, and backend/frontend locations are recorded.
