---
title: Testing
eyebrow: Project guide
description: Select the narrowest useful check while preserving the required frontend, Rust, desktop, and release gates.
permalink: /testing/
---

The repository uses layered verification because a React unit test, a Rust crate test, and a live desktop protocol check answer different questions. Run focused checks while iterating, then expand to the owning gate before handoff.

## Gate map

| Change                  | Fast feedback                                       | Owning validation                                           |
| ----------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Type or component logic | focused Vitest, `npx tsc --noEmit --pretty false`   | `npm run lint`, `npm run test:coverage`, format gate        |
| Rust domain crate       | `cargo test -p <crate>` or `cargo check -p <crate>` | relevant workspace/feature check on supported platforms     |
| Connection persistence  | focused hook/store tests                            | create, save, reopen, and session-start E2E path            |
| Protocol runtime        | adapter/crate tests                                 | Docker-backed or environment-specific E2E for that protocol |
| Documentation           | `node scripts/ci/check-docs-links.mjs`              | Pages build plus responsive browser review                  |
| Release metadata        | focused scripts under `scripts/ci/`                 | version, artifact, updater-feed, and release workflow gates |

## Frontend loop

```powershell
npx.cmd tsc --noEmit --pretty false
npm run lint
npm run test:coverage
npm run format
```

Use a focused Vitest file during development, but do not present it as proof of unrelated frontend surfaces.

## Rust loop

The workspace has optional native dependencies and platform-specific features. Start with the crate that owns the change, then use the workspace command documented for your platform. Kafka is opt-in, and Windows contributors must use the MSVC host toolchain.

```powershell
Set-Location src-tauri
cargo check --workspace --exclude sorng-kafka
cargo test --workspace --exclude sorng-kafka
```

## E2E tiers

E2E tests are classified as **required**, **opt-in**, **nightly**, or **lab-only**. Only deterministic hosted-runner coverage belongs in the universal PR gate. Vendor services, real updater installation, discovery, multi-window behavior, and other environment-heavy flows need their declared environment.

- [E2E runbook]({{ '/testing/e2e-runbook/' | relative_url }}) explains setup, execution, cleanup, and promotion criteria.
- [E2E tier map]({{ '/testing/e2e-tier-map/' | relative_url }}) lists the current file-by-file classification.

The required Docker-backed protocol smoke path covers the repository’s SSH and SFTP golden paths:

```powershell
npm run e2e:smoke:up
npm run e2e:smoke:required
npm run e2e:smoke:down
```

Always run cleanup, including after a failed test. Report an unavailable Docker daemon or vendor environment as a blocked gate rather than silently replacing it with a compile check.

## Evidence in a handoff

Record the exact command, whether it passed, and any environment limitation. For UI work, include the viewport or platform exercised. For protocol work, distinguish mock coverage, Docker-backed coverage, and a live target. A clean `git diff --check` is useful hygiene, not behavior validation.

See [Contributing]({{ '/contributing/' | relative_url }}) for the full contributor loop.
