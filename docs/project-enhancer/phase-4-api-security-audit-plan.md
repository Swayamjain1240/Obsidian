# Obsidian — Phase 4 API Security, Authentication, Authorization & Audit Plan

**Status:** Implementation in progress; no production authorization
**Phase:** 4 — API Security, Authentication, Authorization & Audit Logging
**Branch:** `feat/phase-4-api-security-audit`
**Starting checkpoint:** `e53e16df4642b64ab3a10febab3866a6ff69534d`
**Production authorization:** Not granted

## 1. Authority and boundaries

This is the Phase 4 source of truth. Review against:

- `docs/project-enhancer/01-architecture.md`
- `docs/project-enhancer/02-session-system-log.md`
- `docs/project-enhancer/03-master-product-spec.md`
- `docs/project-enhancer/04-system-design.md`
- `docs/project-enhancer/phase-2-workflow-correctness-plan.md`
- `docs/project-enhancer/phase-3-mongodb-durability-plan.md`

Phase 4 hardens the API trust boundary, GitHub OAuth/session behavior, browser request security, ownership authorization, validation, abuse controls, broker authentication, and durable security audit events. It preserves the Phase 1 worker boundary and Phase 2/3 workflow, approval, idempotency, CAS, and MongoDB durability guarantees. Phase 5 privacy/retention/encryption lifecycle and production deployment authorization remain outside this phase.

## 2. Acceptance outcomes

1. Cookie-authenticated mutations reject cross-origin and originless browser requests while OAuth callback exceptions remain functional.
2. Session reads consult authoritative durable state when MongoDB is available; logout/revocation cannot be bypassed by a stale process-local cache.
3. OAuth state, PKCE, browser binding, expiration, replay protection, session fixation protection, secure cookies, and least-privilege scopes are explicit and tested.
4. Every API read and mutation remains owner/session/project/snapshot/workflow scoped, with stable safe errors for foreign resources.
5. Request IDs are server-generated or safely normalized; proxy trust, content types, body limits, pagination, and path/query schemas are bounded.
6. Security headers, rate limits, request timeouts, and broker authentication are explicit. Multi-instance rate-limit storage remains a deployment requirement unless a durable store is implemented and verified.
7. Required audit events are durable, append-only by schema policy, redacted, integrity-evident, request-correlated, and fail closed for security-critical mutations.
8. Adversarial tests cover authentication, CSRF/CORS, authorization, validation, rate limits, audit failures, broker failures, replay, and concurrency without real GitHub credentials or production resources.

## 3. Initial findings

| ID | Classification | Finding | Disposition |
|---|---|---|---|
| F4-01 | Confirmed vulnerability | `SessionStore.getAsync()` returns a process-local cached session before consulting MongoDB. A session revoked by another instance remains usable until cache expiry. | Make connected reads authoritative and evict revoked/expired records; retain only bounded disconnected development fallback. |
| F4-02 | Confirmed security gap | Cookie-authenticated mutation protection accepts requests with no `Origin` and no `Referer`. SameSite cookies reduce exposure but do not replace an explicit CSRF decision. | Require an allowed Origin or Referer for browser mutations; document an explicit non-browser authorization exception if needed. |
| F4-03 | Confirmed security gap | The app trusts one proxy hop unconditionally and accepts arbitrary client `x-request-id` values. | Make proxy trust configuration explicit and normalize/reject untrusted request IDs; never use them as security authority. |
| F4-04 | Confirmed defense gap | Helmet disables CSP globally and rate limiting uses the default process-local store. | Add a strict configurable CSP suitable for the current frontend, expose deployment-dependent distributed limiting, and add abuse tests. |
| F4-05 | Confirmed audit gap | Service event sinks are invoked fire-and-forget and errors are swallowed. Security-critical transitions can succeed without a required audit receipt. | Add required audit helpers/receipts for security-sensitive mutations and tests for persistence failure; preserve best-effort analysis events only where explicitly allowed. |
| F4-06 | Confirmed audit gap | Events lack request/correlation context and integrity evidence. | Add bounded request ID/correlation fields and deterministic integrity hashes without claiming database-level immutability. |
| F4-07 | Confirmed validation gap | Several route parameters and query values rely on generic string handling or numeric coercion, and content type is not enforced consistently. | Add shared bounded parameter/query/content-type validation and negative tests. |
| F4-08 | Deployment-dependent risk | Broker token authentication is bearer-only and has no replay/rotation metadata; remote broker deployment identity and Docker-daemon permissions are not locally verifiable. | Add constant-time token checks, bounded authenticated request metadata, rotation-compatible configuration, and retain deployment verification as a blocker. |

## 4. Threat-model and OWASP API mapping

| Risk | Actual surface | Control |
|---|---|---|
| BOLA/API1 | Run, snapshot, workflow, manifest, diff, recommendation, event, and worker identifiers | Durable owner/session/project/snapshot predicates and foreign-resource indistinguishable errors |
| Broken authentication/API2 | OAuth callback, session cookie, logout, `/auth/me` | PKCE/state/browser binding, authoritative session lookup, expiration/revocation, secure cookie policy |
| Property authorization/API3 | Approval operations, repository refs, pagination, preview hashes | Zod schemas, allowlisted fields/kinds, operation policy, bounded values |
| Unrestricted resource consumption/API4 | Repository listing, scans, baseline, worker jobs, JSON bodies | Rate limits, request/body/time limits, bounded pagination, worker leases and timeouts |
| Function authorization/API5 | Repair, approval, Version 2, PR, cancellation and recovery routes | Auth middleware plus action-specific workflow state/revision/approval checks |
| Business-flow abuse/API6 | OAuth replay, duplicate mutation, repeated delivery, cancellation | Single-use state, idempotency, expected revisions, durable receipts |
| SSRF/API7 | GitHub and broker URLs/configuration | URL schema/config validation and fixed GitHub API origins; no user URL fetch surface |
| Misconfiguration/API8 | CORS, headers, proxy trust, production config | Explicit origin allowlist, strict headers, production invariants, safe diagnostics |
| Inventory/API9 | Route surface and error behavior | Route inventory tests and stable safe error envelopes |
| Unsafe API consumption/API10 | GitHub/broker response parsing | Bounded schemas, response limits, no raw external error disclosure |

## 5. Dependency-ordered work packages

### P4-01 — Baseline, threat model, and configuration

Create this plan; inventory routes, trust boundaries, cookies, headers, proxy behavior, broker calls, and audit paths. Add explicit Phase 4 config for security behavior without weakening production isolation.

### P4-02 — OAuth and session authority

Harden session cache/revocation, cookie construction, OAuth scope validation, state replay/expiry, callback failure behavior, and multi-instance tests.

### P4-03 — CSRF, CORS, headers, and transport

Implement explicit mutation origin policy, strict CORS behavior, request-ID normalization, proxy trust configuration, CSP/security headers, and positive/negative browser-request tests.

### P4-04 — Authorization and input validation

Verify action-specific ownership and workflow gates; centralize bounded route/query/body schemas; add foreign-owner, foreign-session, malformed, oversized, and invalid-transition tests.

### P4-05 — Abuse protection and broker security

Harden rate-limit identity and error handling, expensive-route limits, request timeouts, constant-time broker token verification, request bounds, and deployment-dependent controls.

### P4-06 — Durable audit integrity

Add request/correlation context, event taxonomy coverage, redaction, integrity hash, duplicate semantics, and required persistence behavior for security-sensitive operations.

### P4-07 — Adversarial security regression

Run unauthenticated, expired/revoked, CSRF, BOLA, input, rate-limit, audit-failure, broker-auth, replay, and concurrent authorization tests with disposable fixtures.

### P4-08 — Full release gate and documentation

Run Phase 1–3 regression plus Phase 4 security suites, MongoDB/Docker/browser checks, build/typecheck/lint/audit/secret checks, then complete Duck 4-C and record all blockers.

## 6. Duck checkpoints

### Duck 4-A — after P4-04

Verify OAuth/session authority, CSRF/CORS, browser security, input validation, ownership, RBAC/action authorization, and workflow gates against all control documents.

### Duck 4-B — after P4-06

Verify rate limiting, security headers, broker authentication/authorization, durable audit integrity, redaction, duplicate behavior, and failure semantics. Production deployment controls remain conditional unless real evidence exists.

### Duck 4-C — final closeout

Verify every Phase 4 acceptance item, full regression, exact counts, skipped-test explanations, secret scan, clean intended diff, unresolved findings, production blockers, and Phase 5 boundary. This is not commit, push, merge, deployment, or production authorization.

## 7. Security invariants

- No credentials, cookies, access tokens, private source, or secrets in responses, logs, events, fixtures, or documentation.
- No cross-user or cross-session resource access.
- No direct original-branch mutation, host execution, privileged worker, or Docker socket exposure to untrusted code.
- No success receipt when required persistence or security audit recording fails.
- No weakening of Phase 1 isolation, Phase 2 approval/idempotency, or Phase 3 durable CAS/transaction/lease guarantees.
- Eight high Docker Scout findings, production broker deployment/admission, registry signing/promotion, and live MongoDB operational HA/backup remain tracked release blockers.

## 8. Implementation receipts

### P4-01 through P4-04 — baseline, authentication, browser security, authorization, and validation

- Created the Phase 4 branch from the verified Phase 3 checkpoint `e53e16df4642b64ab3a10febab3866a6ff69534d`.
- Added explicit proxy-hop, security-audit, and authentication rate-limit configuration with production invariants.
- Connected MongoDB session reads now bypass the process-local cache, so another instance's revocation or expiration is observed before authorization succeeds.
- OAuth scope parsing rejects administrative, destructive, and write-capable scopes outside the Phase 4 least-privilege policy. PKCE, state single-use, expiration, browser binding, callback validation, encrypted token storage, and secure-cookie behavior remain active.
- Cookie-authenticated mutations require a configured frontend Origin or matching Referer; originless requests are rejected. CORS remains an allowlist and does not serve as the CSRF control.
- Request IDs are normalized to a bounded server-safe format, proxy trust is explicit, JSON mutation content types are enforced, strict response headers/CSP are enabled, body limits remain bounded, and global API rate limiting returns a stable 429 envelope.
- Workflow identifiers are bounded before service authorization logic; existing owner/session/revision/idempotency gates remain authoritative.

### Duck 4-A — authentication, browser security, authorization, and validation

**Review status:** PASS for implemented local controls; production deployment controls remain conditional.

Evidence:

- Focused security suite: **18 passed, 0 failed** across OAuth configuration, session revocation, callback/logout protection, request headers, CSRF origin handling, content type rejection, rate limiting, and malformed workflow identifiers.
- Existing Phase 2 tests continue to cover cross-owner resource access, session binding, approval gates, stale revisions, idempotency conflicts, and workflow state authorization.
- No Phase 1 worker isolation or Phase 3 durability control was removed.

Remaining risks:

- Distributed rate-limit storage is not locally verified; production multi-instance deployments must provide a shared limiter store or explicit edge enforcement.
- Live GitHub OAuth permissions and production reverse-proxy behavior remain deployment evidence, not local test evidence.

### P4-05 through P4-06 — abuse protection, broker boundary, and durable security audit

- Added a required security-audit middleware for authenticated mutation surfaces. It records a deterministic, idempotency-aware pre-mutation event with request/correlation context and fails closed with 503 when required persistence is unavailable.
- Added event integrity hashes, immutable request/correlation metadata, duplicate-event integrity conflict detection, secret redaction coverage, and production-only enforcement that security audit persistence cannot be disabled.
- Added authenticated broker content-type enforcement and bounded validation of run/recovery requests, worker IDs, command arguments, lease data, and request size. Constant-time bearer-token comparison remains in place; broker deployment identity and Docker-daemon permissions remain deployment blockers.

### Duck 4-B — rate limits, broker authorization, and audit controls

**Review status:** PASS for local implementation and adversarial unit/API evidence; production deployment verification remains conditional.

Evidence:

- Focused security suite: **17 passed, 0 failed** covering deterministic audit identity, required/best-effort audit failure semantics, integrity hashes, rate limiting, broker content-type/auth boundary, workflow parameter validation, and existing auth controls.
- Required audit middleware runs before API mutations in production mode and no longer permits a required persistence failure to become a successful mutation response.
- Audit events use `$setOnInsert` plus post-write integrity verification; repeated idempotent requests reuse the same event identity, while conflicting event contents fail closed.

Remaining risks:

- Database-level immutability and production broker network/identity restrictions require deployment evidence and are not claimed from local tests.

## 9. Duck 4-C — final Phase 4 closeout

**Review status:** PASS for local development/security verification; production authorization remains denied.

### Final verification receipts

```text
npm run test
  PASS — frontend: 41; backend: 305 passed / 14 skipped; AIServices: 2
  Aggregate: 348 passed, 14 skipped, 0 failed

npm run typecheck
  PASS — frontend, backend, AIServices

npm run lint
  PASS — frontend, backend, AIServices

npm run build
  PASS — frontend, backend, AIServices; existing Vite chunk-size warning only

npm run audit
  PASS — 0 vulnerabilities

npm run test:mongodb
  PASS — 6 real disposable MongoDB tests; 0 skipped, 0 failed

OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
  PASS — 38 passed, 2 skipped, 0 failed; skipped MongoDB lease-failover cases are covered by test:mongodb

npm run e2e --workspace frontend
  PASS — 5 browser tests

npm run verify:worker-image
  PASS — digest b7a51b8f5f090cc96e502428a631daf003b94a2e38ebe75ef16be04810cef411; npm 11.21.1

docker scout cves --only-severity critical,high local://obsidian-sandbox:dev
  0 critical, 8 high findings

git diff --check
  PASS — Windows line-ending warnings only
```

### Security evidence

- Combined Phase 4 security regression command: **13 test files, 29 tests passed, 0 failed**. This includes OAuth/session, CSRF/CORS/header/content-type/rate-limit, workflow parameter validation, broker authorization/content-type, event integrity, and durable audit failure semantics.
- Durable audit tests include deterministic idempotency-aware event identity, request/correlation context, integrity hashes, required persistence fail-closed behavior, and explicitly best-effort development behavior.
- Authorization/input tests: existing Phase 2 owner/session/revision/idempotency suites remain green; malformed workflow identifiers are rejected before service authorization logic.
- Broker security tests: authenticated broker boundary remains green, constant-time bearer comparison remains active, and authenticated non-JSON requests are rejected with 415. Broker request size and field validation are bounded.
- Secret scan found no staged/untracked credential, private-key, `.env`, or token-pattern artifact. Local `.env` files remain ignored and are not part of the change set.

### Remaining findings and blockers

- **High:** 8 Docker Scout base-image findings remain unresolved and are release blockers.
- **Deployment-dependent:** distributed rate-limit storage/edge enforcement, production reverse-proxy trust configuration, broker network identity and Docker-daemon permissions, image signing/promotion, and live MongoDB HA/backup/retention operations remain unverified.
- **Phase 5 boundary:** long-term privacy classification, source/log retention and deletion, customer-managed encryption lifecycle, and governance remain separate work.

### Final acceptance checklist

- [x] P4-01 threat model and API trust-boundary mapping recorded.
- [x] P4-02 OAuth PKCE/state/browser binding, authoritative session revocation, secure cookie policy, and least-privilege scope checks verified.
- [x] P4-03 CSRF origin policy, CORS allowlist, strict headers/CSP, request IDs, JSON limits, and safe error envelopes verified.
- [x] P4-04 owner/session/workflow authorization and bounded route validation preserved and adversarially tested.
- [x] P4-05 rate limiting, request limits, timeout boundaries, and broker request authentication/validation verified.
- [x] P4-06 durable security audit middleware, redaction, deterministic duplicate behavior, and integrity evidence implemented.
- [x] P4-07 adversarial security regression and Phase 1–3 regression suites green.
- [x] P4-08 full local release-gate checks green with mandatory disposable MongoDB/Docker/browser tests executed when infrastructure was available.
- [x] P4-09 through P4-11 evidence and Duck records completed in this document.

### Branch and readiness

- Branch: `feat/phase-4-api-security-audit`.
- Starting Phase 3 checkpoint preserved; no commit, push, merge, deployment, or production resource change performed.
- Working tree contains only the intended Phase 4 implementation, tests, CI configuration, harness correction, and source-of-truth documentation changes; final status must remain uncommitted until separately authorized.
- Final Phase 4 verdict: **PASS for local development and security verification; production authorization not granted**.
- Phase 5 readiness: **not started**. Phase 4 must be reviewed and explicitly authorized before Phase 5 or production work begins.
