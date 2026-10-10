# Obsidian

> Safely analyze, repair, and enhance existing software projects into a reviewable Version 2.

Obsidian is a review-first, multi-language project enhancement platform. A developer connects a GitHub repository, confirms the detected technology stack, checks whether the project is complete, validates the existing baseline, reviews repair suggestions, and then approves carefully scoped enhancements.

## Core promise

**The user's original project is never silently changed.** Obsidian works from an immutable snapshot and creates separate repair or enhancement branches. Every file, folder, component, button, and behavior change is explained, reviewable, reversible, and approved by the user before it is applied.

## Product flow

```text
GitHub Login
    ↓
Home and Repository Selection
    ↓
Evidence-Based Stack Detection
    ↓
User Stack Confirmation
    ↓
Project Completeness Check
    ↓
Choose: Complete Project First | Enhance Existing Parts Only
    ↓
Baseline Build, Test, Runtime, and Security Checks
    ↓
Approved Repair Plan and Repair Validation
    ↓
Enhancement Recommendations
    ↓
Exact File / Component / UI / Folder Review
    ↓
User Approval
    ↓
Enhanced Version 2 Branch
    ↓
Validation, Diff, and Pull Request
```

## Incomplete-project handling

Obsidian distinguishes between:

- **Working** — relevant checks pass.
- **Working with issues** — implemented and testable, but defective.
- **Broken** — implemented behavior fails.
- **Partial** — some implementation exists.
- **Placeholder** — a visible shell or dummy content exists.
- **Not implemented** — required code or behavior is absent.
- **Not available** — no suitable check or tool exists.

If a project is incomplete, the user chooses one of two modes:

### Complete Project First

Pause enhancement and create a completion plan for missing features. Obsidian does not pretend placeholder or absent functionality is complete.

### Enhance Existing Parts Only

Analyze, repair, and improve only areas that already exist. This may include existing UI, bugs, errors, imports, naming, folder organization, tests, and documentation. Missing product features are excluded rather than invented.

## Multi-language support

The core platform is language-neutral and uses verified adapters for project-specific evidence and commands. Initial adapter targets include JavaScript/TypeScript, Python, Java, Go, PHP, C#/.NET, Rust, Dart/Flutter, and Ruby. Unknown or ambiguous technologies remain **Not detected**; Obsidian never guesses.

## Safety and security commitments

1. API keys, tokens, passwords, and secrets stay out of source control and logs.
2. Required environment variables are validated without exposing their values.
3. Private-route architecture is reviewed and preserved.
4. Authentication architecture is explicit and prepared for secure implementation.
5. Server-side authorization is separated from client-side visibility.
6. Forms and inputs are validated and sanitized.
7. Unsafe HTML rendering and XSS risks are blocked.
8. Rate limiting is planned or implemented at appropriate boundaries.
9. APIs use a consistent secure response and error format.
10. CORS uses a strict allow list.
11. Security headers are configured.
12. Production debug mode is disabled.
13. Dependencies are security-checked before upgrades.
14. Unused packages are removed only after verification.
15. Exposed and private files are checked.
16. Database credentials and configuration remain secure.
17. Passwords must use Argon2 or bcrypt, never plaintext.
18. The current Git tree and history are scanned for leaked secrets.
19. A security audit is performed before each coherent delivery part is finished.
20. Every coherent feature or roughly 300 meaningful lines follows: test → inspect diff → commit → push.
21. Security is continuous, not a final patch.
22. Any new external API requires provider, purpose, API-key name, environment variable, and backend/frontend location to be documented before use.
23. Every feature is tested after implementation.
24. README and project documentation stay synchronized with real behavior.
25. Authenticated application screens obey the one-viewport rule.

## One-viewport rule

Authenticated screens must fit in one viewport without page-level vertical scrolling. This is not achieved by clipping content with `overflow: hidden`.

- Long forms become multi-step wizards.
- Long lists and tables use pagination.
- Many sections use tabs or routes.
- Many charts use switchable tabs.
- Mobile shows one primary panel at a time.
- Desktop, tablet, and mobile must be tested.
- An intentionally designed marketing landing page may scroll.

## Development discipline

The project is divided into six implementation parts. After each part, a **Duck review** compares the implementation against the four control documents in `docs/project-enhancer/` and records aligned items, off-track items, missing controls, evidence, unresolved decisions, and the next corrective action.

The target is a meaningful commit history across the complete project, not artificial commit spam. No part is considered complete until its tests, diff, security review, documentation, and Duck review are complete.

## Control documents

- [Architecture](docs/project-enhancer/01-architecture.md)
- [Session / System Log](docs/project-enhancer/02-session-system-log.md)
- [Master Product Specification](docs/project-enhancer/03-master-product-spec.md)
- [System Design](docs/project-enhancer/04-system-design.md)
- [Architecture PDF](docs/project-enhancer/pdf/architecture.pdf)
- [Session / System Log PDF](docs/project-enhancer/pdf/session-system-log.pdf)
- [Master Product Specification PDF](docs/project-enhancer/pdf/master-product-spec.pdf)
- [System Design PDF](docs/project-enhancer/pdf/system-design.pdf)

## Status

This repository currently contains the product-control documentation and design baseline. Implementation will begin only after the documentation baseline is accepted.

## License

License to be decided.
