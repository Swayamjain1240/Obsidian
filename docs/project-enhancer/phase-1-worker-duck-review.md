# Obsidian — Phase 1 Isolated Worker Duck Review

**Review trigger:** Duck
**Review scope:** Secure Docker baseline worker continuation from Step 1.48
**Review date:** 2026-10-17
**Branch reviewed:** `fix/production-stabilization`

## Review events

This document records the Phase 1 worker comparison against the four v1.0 control documents. It does not authorize changes to a connected user repository.

```text
DUCK_REVIEW_REQUESTED
DUCK_REVIEW_COMPLETED
```

## Delivered worker boundary

- `infra/sandbox/Dockerfile` uses the Node 22.23.3 Bookworm Slim multi-architecture digest, refreshes available Debian security packages during the image build, and runs as the non-root `node` user.
- `infra/sandbox/baseline-runner.mjs` receives one structured job over stdin, validates the command shape again inside the container, copies the verified read-only snapshot into bounded scratch space, executes only approved offline Node commands with `shell: false`, and returns counters/statuses without raw output.
- `DockerExecutor` creates uniquely named, labelled containers with network disabled, a read-only root filesystem, read-only snapshot bind mounts, a bounded writable tmpfs, dropped capabilities, `no-new-privileges`, non-root UID, CPU/memory/PID limits, and a file-descriptor limit.
- Baseline service and change-worker validation use `DockerBrokerExecutor` by default. In production the API requires an authenticated broker URL/token; the broker service is the only process that should hold Docker-daemon authority. Development and tests may use the local broker subprocess fallback. Test doubles remain injectable for unit tests.
- Snapshot workspace inventory rejects symlinks, hard links, special entries, unsafe components, excessive depth, excessive files/directories, oversized files, and total-byte overflow. A post-run fingerprint detects mutation.
- Cleanup is attempted after create/start/command failures, timeout, cancellation, and normal completion. Cleanup failure prevents a clean result. Server shutdown stops/removes active worker containers.
- Container inventory records explicit job, owner, lease, and creation labels. Recovery removes only expired, stopped, sufficiently old containers that are not active in the current process; running containers are skipped. MongoDB-backed worker leases atomically claim, renew, finish, and transition expired jobs through recovery; an in-memory store is used only by local tests/fallbacks.
- Production configuration rejects disabling isolation, requires a digest-pinned worker image, and requires a separately configured broker URL/token.
- CI/local image builds request BuildKit provenance and SBOM attestations. `scripts/verify-worker-image.mjs` checks the base digest, non-root user, reviewed entrypoint, and content digest.

## Evidence checked

```text
npm run typecheck
npm run lint
npm run test
npm run audit
npm run build
npm run e2e --workspace frontend
docker buildx build --progress=plain --load --tag obsidian-sandbox:dev infra/sandbox
docker buildx build --progress=plain --provenance=true --sbom=true --output=type=oci,dest=obsidian-sandbox.oci.tar infra/sandbox
npm run verify:worker-image
OBSIDIAN_DOCKER_TESTS=1 npm run test --workspace backend -- --maxWorkers=1 src/workers src/baseline/docker-integration.test.ts src/workflow/change-worker-docker.integration.test.ts
docker scout cves --only-severity critical,high local://obsidian-sandbox:dev
docker scout cves --exit-code --only-severity critical local://obsidian-sandbox:dev
git diff --check
docker ps -a --filter label=com.obsidian.managed=true --filter label=com.obsidian.worker=baseline-smoke
```

The Docker-enabled suite now covers successful and failed JavaScript execution, successful and failed npm scripts, missing dependencies, timeout, cancellation, output limits, unsupported commands, registry-dependent rejection, invalid workspace boundaries, read-only snapshot preservation, concurrent jobs, cleanup, worker preflight, expired stopped-container recovery, authenticated remote-broker routing, and post-repair ChangeWorker validation. The latest Docker-enabled run passed 10 files and 36 tests, and the managed container inventory was empty afterward. The local Docker Scout scan found 0 critical and 8 high findings remaining in Essential/unpatched Debian base packages; this is recorded as a deployment blocker rather than a clean vulnerability result.

## Control-document comparison

### Aligned

- **Architecture:** repository commands no longer use the application host path in the default baseline/change-worker flow; the original snapshot is read-only and changes occur in scratch space.
- **Session/System Log:** structured results distinguish `passed`, `failed`, `not_available`, `timed_out`, and `cancelled`; raw command output is not persisted or returned.
- **Master Product Specification:** unsupported and unavailable capabilities are not fabricated as passing checks; failed validation remains a blocking result.
- **System Design:** the worker boundary has explicit resource, network, filesystem, privilege, and lifecycle controls; PR creation remains outside the worker.

### Partial or deployment-dependent

- A Docker daemon and the reviewed image must be present at runtime. If unavailable, the API reports `not_available` and readiness fails.
- The local authenticated broker-process test verifies the HTTP contract and token rejection, but a separately deployed OS/container identity with restricted Docker-daemon access has not been observed in this session.
- The local image is digest-pinned, BuildKit provenance/SBOM generation and metadata checks pass, and Docker Scout is available. Updating the bundled npm CLI removed the npm-origin findings; the latest scan found 0 critical and 8 high vulnerabilities remaining in Essential/unpatched Debian base packages (`util-linux`, `perl-base`, and `zlib1g`). The worker does not invoke the affected system utilities directly, has no network, runs as non-root with dropped capabilities, and the no-fix findings cannot be safely removed without changing the runtime base. Production admission remains blocked pending an approved base-image risk decision or a replacement runtime. Registry signature verification and promotion policy are not implemented.
- MongoDB lease code and atomic recovery transitions are implemented and unit-tested with the in-memory store, but a live multi-instance MongoDB failover test has not run because MongoDB infrastructure is unavailable locally.
- The CI workflow now builds the worker image with explicit Buildx provenance/SBOM loading and invokes the Docker integration suite on its Docker-enabled runner. Runs for commits `40155ec` and `3a435ad` reached the image-build step and failed there; the failure output was not exposed through the unauthenticated public log view. A new run is required after the Buildx/retry hardening.
- The image currently provides the verified Node/npm toolchain. Python, Go, Java, and other adapter commands remain `not_available` unless a corresponding worker image/toolchain is separately verified.

## Unresolved decisions

1. Select the production image registry, digest promotion, signature verification, and vulnerability-scanning policy; approve or replace the remaining unpatched Essential base-package findings.
2. Deploy the authenticated broker as a separately permissioned service and verify its Docker-daemon identity before public production exposure.
3. Run a live multi-instance MongoDB lease/failover test before enabling horizontal worker execution.
4. Define safe dependency provisioning for projects whose committed snapshot does not contain dependencies; registry access remains blocked by default.
5. Observe the new Docker-enabled release CI result and add deployment-specific accessibility/browser coverage.

## Verdict

**CONDITIONAL PASS for Phase 1 isolated-worker implementation.** The local Docker worker, default application integration, security controls, lifecycle cleanup, and negative tests are implemented and verified. Production rollout remains conditional on a separately permissioned worker broker/sidecar, a digest-pinned promoted image, durable multi-instance lease policy, and remote Docker CI evidence.

## Next corrective action

Deploy and verify the production worker boundary, remediate or approve the scanned image findings and add signature verification, run the live MongoDB lease/failover test, observe Docker integration in CI, and only then enable horizontal production execution.
