# Disposable MongoDB replica-set tests

Phase 3 integration tests use `npm run test:mongodb`. The harness creates three temporary `mongo:7.0` containers, initializes `rs0`, runs only the explicitly listed MongoDB/lease integration tests, and removes the containers and network on exit.

The test database name is `obsidian_phase3`. The harness refuses production-looking or unspecified URIs. Backup/restore verification additionally requires a separate `obsidian_phase3_restore` URI.

If Docker is unavailable, the harness exits with an unavailable-infrastructure status. That result must be recorded as unavailable evidence, never as a test pass.
