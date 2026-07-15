---
title: Contributing
eyebrow: Project guide
description: Make focused changes, preserve architectural boundaries, run proportionate gates, and hand off evidence that another contributor can verify.
permalink: /contributing/
---

Contributions are most useful when they solve one coherent concern and make the relevant contract easier to verify. Begin by reproducing the current behavior from source, tests, or workflow logs; then change the smallest owning layer.

## Prepare the repository

- Use Node.js 20 and the committed npm lockfile.
- Use the Rust toolchain selected by the repository.
- On Windows, use the MSVC Rust host and the required Visual Studio build tools.
- Install the platform dependencies required by Tauri before treating a native build failure as a source regression.

The root [contributing guide on GitHub](https://github.com/supermarsx/sortOfRemoteNG/blob/main/contributing.md) remains the detailed toolchain and command reference.

## Work by contract

1. Identify the user-visible or CI-visible failure.
2. Locate the type, adapter, command, crate, or workflow that owns it.
3. Add or update the closest regression test.
4. Keep generated artifacts with the change that owns them.
5. Run focused checks, then the broader owning gate.
6. Review the final diff for unrelated files and secret material.

For protocol work, confirm all four layers that matter: saved type, frontend session route, registered backend commands, and executable tests. For documentation, distinguish source-backed capability from scaffolding and keep navigation links within the checked Pages routes.

## Common commands

```powershell
npm ci
npx.cmd tsc --noEmit --pretty false
npm run lint
npm run test:coverage
npm run format
node scripts/ci/check-docs-links.mjs
git diff --check
```

Native changes need the relevant Cargo checks described in [Testing]({{ '/testing/' | relative_url }}). Environment-specific E2E should use the declared tier rather than being added casually to the universal PR gate.

## Pull requests and handoff

- Explain the behavior change and its boundary, not just the files edited.
- List exact validation commands and results.
- Call out checks that could not run and the missing environment.
- Include screenshots only when they add UI evidence, and inspect them for sensitive data first.
- Keep unrelated worktree changes out of the commit.

Use [Architecture]({{ '/architecture/' | relative_url }}) for cross-boundary placement, [Security]({{ '/security-overview/' | relative_url }}) for secret-bearing features, and [Testing]({{ '/testing/' | relative_url }}) for gate selection.
