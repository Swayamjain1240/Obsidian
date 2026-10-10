# Obsidian — Part 2 Duck Review

**Part:** GitHub OAuth App authorization and repository selection  
**Review trigger:** Duck  
**Review status:** Complete for the Part 2 scope  
**Date:** 2026-10-10  
**Implementation commits:** 10 meaningful commits after the Part 1 review

## Scope reviewed

Part 2 adds the GitHub OAuth App boundary, environment configuration, state and PKCE protection, token exchange client, signed in-memory session boundary, authenticated repository listing API, paginated repository selection UI, and honest handoff to the future detection phase.

It does **not** claim to implement stack detection, completeness scanning, cloning, immutable snapshots, baseline testing, repair, enhancement, AI analysis, or pull-request creation.

## External API declaration

```text
Provider: GitHub
Purpose: OAuth App sign-in, current-user lookup, and authorized repository listing
Credential names: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
Environment variables: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL,
  GITHUB_OAUTH_SCOPES, AUTH_SESSION_SECRET
Backend location: backend/src/auth, backend/src/github
Frontend location: frontend/src/App.tsx, frontend/src/api.ts
```

No external AI API was added.

## Evidence checked

```text
npm run test
npm run typecheck
npm run build
npm audit --audit-level=high --omit=dev
git diff --check
Current-tree and Git-history secret-pattern scan
```

Results:

- Frontend tests: passed.
- Backend tests: passed.
- AI service tests: passed.
- TypeScript checks: passed.
- Builds: passed.
- Production dependency audit: 0 high-level vulnerabilities.
- No real secrets found. The only API-key pattern is an intentional redaction test fixture.
- `main` is pushed and synchronized.

## 25-point control review

| # | Result | Evidence / gap |
|---:|---|---|
| 1 | Aligned | OAuth secrets exist only as names in `.env.example`; tokens are not logged. |
| 2 | Aligned | OAuth configuration is rejected when required values are absent. |
| 3 | Aligned | Repository API is behind session middleware. |
| 4 | Aligned for Part 2 | GitHub OAuth App flow uses state, PKCE, callback validation, and an HttpOnly cookie boundary. |
| 5 | Aligned for Part 2 | Repository listing is server-side and requires a valid signed session. |
| 6 | Aligned for current inputs | Pagination is bounded and validated. |
| 7 | Aligned | Repository names are rendered through React escaping; no unsafe HTML is used. |
| 8 | Aligned | Global rate limiting remains active. |
| 9 | Aligned | Auth and GitHub failures use the secure error envelope. |
| 10 | Aligned | Strict configured-origin CORS remains active. |
| 11 | Aligned | Helmet remains active. |
| 12 | Aligned | OAuth failures do not return stack traces or secrets. |
| 13 | Aligned | Lockfile and audit were checked. |
| 14 | Aligned | GitHub integration uses the existing minimal dependency set. |
| 15 | Aligned | Cookie, env, and filename checks are clean. |
| 16 | Prepared | Mongo credentials remain environment-only; deployment hardening is later. |
| 17 | Aligned | No password storage was introduced. |
| 18 | Partial | Current tree/history scan is clean except the deliberate redaction fixture; a dedicated secret scanner remains future hardening. |
| 19 | Aligned | Security audit completed before Part 2 close. |
| 20 | Aligned | Ten Part 2 commits each followed test, diff inspection, commit, and push. |
| 21 | Aligned | OAuth security controls were added during the feature, not after it. |
| 22 | Aligned | GitHub API provider details are documented above; no AI API was added. |
| 23 | Aligned | OAuth, PKCE, token exchange, sessions, repository pagination, and UI handoff are tested. |
| 24 | Aligned | README and this Duck review describe actual scope and gaps. |
| 25 | Prepared | Repository selection and detection handoff fit the one-primary-task shell; full authenticated viewport testing remains for later screens. |

## Aligned items

- OAuth state is one-time and expires.
- PKCE S256 challenge is used.
- OAuth client secret is sent only to GitHub's token endpoint.
- Access tokens are held server-side in the current in-memory session boundary.
- Browser receives an HttpOnly, SameSite cookie; production adds Secure.
- Repository listing requires authentication.
- Repository pagination is bounded to 100 items per request.
- Empty and unavailable repository states are explicit.
- No fabricated repository data is rendered.
- Selecting a repository carries only verified GitHub metadata into the future detection screen.

## Gaps and next action

1. The session store is intentionally in-memory for local Part 2 and must move to a secure persistent session store before production or multi-instance deployment.
2. The OAuth callback should redirect to a configured frontend callback/error route rather than a hard-coded `/home` in a later deployment pass.
3. The next part must create the immutable repository snapshot boundary before any repository analysis or code execution.
4. Stack detection must use repository evidence and ask for user confirmation; it must not infer unsupported technologies.

## Verdict

**PASS for Part 2 scope.** The implementation is aligned with the four control documents and is safe to begin Part 3, provided Part 3 starts with the immutable snapshot and repository-intake gate.
