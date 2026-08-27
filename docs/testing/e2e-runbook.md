---
title: E2E runbook
description: Operational guidance for required, opt-in, nightly, and lab-only end-to-end testing.
permalink: /testing/e2e-runbook/
hide_page_header: true
---

# E2E Runbook

## Purpose

This repository uses a tiered end-to-end testing model.

We do **not** gate every environment-sensitive E2E flow on every commit or PR.
Only deterministic, hosted-CI-safe coverage belongs in required PR checks.
Broader desktop, vendor, and specialty environments stay opt-in, nightly, or
lab-only.

This document is the operational companion to
`docs/plans/e2e-coverage-improvement-plan.md`.

The current file-by-file tier map lives in
`docs/testing/e2e-tier-map.md`.

## Current Tiers

### `required`

Purpose:

- Fast, deterministic PR signal
- Must run on standard hosted CI runners without special hardware or private environments

Current contents:

- Rust Docker-backed SSH golden path
- Rust Docker-backed SFTP golden path

Workflow:

- `.github/workflows/e2e-smoke.yml`

Local commands:

```bash
cp e2e/.env.example e2e/.env
npm run e2e:smoke:up
npm run e2e:smoke:required
npm run e2e:smoke:down
```

### `opt-in`

Purpose:

- Broader pre-merge coverage when a PR is risky
- Still reproducible, but slower or less suitable as a universal PR gate

Current contents:

- The broader Docker-backed Rust protocol workflow in `.github/workflows/e2e.yml`

Triggers:

- PR label `e2e`
- `workflow_dispatch`

Typical local commands:

```bash
cp e2e/.env.example e2e/.env
npm run e2e:docker:extended:up
# run selected cargo or WDIO suites
npm run e2e:docker:extended:down
```

### `nightly`

Purpose:

- Catch wider regressions without blocking routine PR flow

Current contents:

- `.github/workflows/e2e.yml` on its nightly schedule

### `lab-only`

Purpose:

- Exercise flows that need richer desktop environments, vendor appliances,
  real updater feeds, or other specialty infrastructure

Examples:

- Full WDIO desktop coverage until its runner model is proven stable in CI
- Vendor appliance integrations
- Real updater install/restart flows against signed staged feeds
- Other OS-sensitive desktop scenarios

These are intentionally not required PR gates.

## Why The Required Gate Is Small

The repo already contains much more E2E surface area than the required gate.
That is deliberate.

The required gate must remain:

- deterministic
- reproducible on hosted CI
- fast enough to keep PR feedback usable
- free from private or specialty environment assumptions

As more flows become reliable in hosted CI, they can be promoted into the
required or nightly tiers.

## Environment Setup

Create a local env file before running Docker-backed E2E locally:

```bash
cp e2e/.env.example e2e/.env
```

The template includes:

- SSH / SFTP
- VNC
- MySQL (`test-mysql`, host port 13306) and MariaDB (`test-mariadb`, host port 13307 — reuses the `MYSQL_*` values)
- MongoDB (`test-mongo`, host port 27117; `MONGO_ROOT_*` for the container root, `MONGO_USER`/`MONGO_PASSWORD` for the seeded app user, auth database `admin`)
- FTP
- SMB
- SoftEther

The base compose file is `e2e/docker-compose.yml`.
The database fixtures are seeded on first start from `e2e/fixtures/db/mysql/01-seed.sql` (shared by MySQL and MariaDB: table `people`, a view and a stored procedure) and `e2e/fixtures/db/mongo/01-seed.js` (`testdb.people`, index `city_1`, the `testuser` login). Their compose healthchecks only report `healthy` after the init scripts have run, and `waitForContainer("test-…")` in `e2e/helpers/docker.ts` waits for that health state before falling back to a TCP probe.
The overlay that adds SMB and SoftEther is `docker/compose.e2e.yml`.

## Package Scripts

### Required smoke tier

- `npm run e2e:smoke:up`
- `npm run e2e:smoke:required`
- `npm run e2e:smoke:down`

### Base Docker fixtures

- `npm run e2e:docker:up`
- `npm run e2e:docker:down`

### Extended Docker fixtures

- `npm run e2e:docker:extended:up`
- `npm run e2e:docker:extended:down`

### WDIO desktop suite

- `npm run e2e`

Note: the full WDIO suite is **not** currently part of the required PR smoke
gate.

## Concurrent WDIO Runs

More than one WDIO run can share a machine. Each run allocates its own driver
ports at config load time in `e2e/helpers/driver-ports.ts`:

- `--port` — the `tauri-driver` intermediary port (default would be 4444)
- `--native-port` — the native WebDriver underneath it, msedgedriver on
  Windows (default would be 4445)

Both are taken from the ephemeral range by binding `:0`, reading the assigned
port and releasing it; the pair is bound simultaneously so the two ports always
differ, and re-checked immediately before `tauri-driver` is spawned in case
something claimed one in between. Without the per-run `--native-port`, a second
run silently attaches to the first run's msedgedriver and both produce bogus
results.

The resolved ports are published back into `TAURI_DRIVER_PORT` and
`TAURI_NATIVE_DRIVER_PORT` because WDIO workers re-parse the config file in
their own processes and must reuse the launcher's values.

Set either variable to pin that port — useful for a fixed CI mapping, or when a
wrapper needs to know the port up front. `scripts/readme-screenshot.mjs` does
exactly that: it pins a free pair so its seed and capture phases share one port
and it can wait for that port to close between them. A pinned port that is
already busy fails the run instead of being silently replaced.

### Cleanup

`e2e/helpers/tauri-service.ts` tears down its whole driver process tree —
`tauri-driver`, the native WebDriver and the application under test — on
`onComplete` and on `exit`/`SIGINT`/`SIGTERM`/`SIGHUP`/`SIGBREAK`, so a crashed
or interrupted run does not leave an orphan holding a port. Teardown is scoped
to that run's own PID tree (`taskkill /T` on Windows, a process-group signal
elsewhere) and never kills drivers by image name, which would take out a
concurrent run.

If a driver does survive (for example after a forced kill of the whole console),
the next run's port re-check simply allocates around it, but the stray process
and its app window are worth killing by PID.

## CI Workflows

### `.github/workflows/e2e-smoke.yml`

Required PR-safe smoke workflow.

Scope:

- brings up only the SSH fixture
- runs the SSH golden path
- runs the SFTP golden path
- uploads logs on failure

GitHub ruleset / branch-protection target:

- Workflow: `E2E Smoke`
- Status check: `SSH/SFTP smoke`

This repository can define the workflow, but the actual required-check setting
still has to be applied in GitHub repository settings.

### `.github/workflows/e2e.yml`

Broader Docker E2E workflow.

Scope:

- SSH / SFTP
- SMB
- RDP
- VNC
- SoftEther

Trigger model:

- nightly
- manual dispatch
- PRs explicitly labeled `e2e`

## Promotion Rules

A test or suite should only move into the required gate when:

- the environment is reproducible on hosted CI
- the test has explicit assertions instead of silent optional passes
- fixed sleeps have been replaced by deterministic waits where practical
- runtime remains compatible with normal PR feedback loops
- failures produce useful diagnostics

## Near-Term Follow-Up

The next implementation slices after the smoke deployment and tier mapping are:

1. Refactor the worst `browser.pause(...)` and silent early-return patterns in the first promotable WDIO slice.
2. Split WDIO usage into explicit suite manifests or tiered configs.
3. Add emulator-backed coverage for shallow areas like updater Settings, marketplace, and cloud sync.
