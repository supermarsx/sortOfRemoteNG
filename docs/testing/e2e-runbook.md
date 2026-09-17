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

- `npm run e2e:build` builds the isolated e2e binary
- `npm run e2e:isolation:selftest` proves a binary's profile isolation
- `npm run e2e`

Note: the full WDIO suite is **not** currently part of the required PR smoke
gate.

## Concurrent WDIO Runs

### Prerequisite: the native driver

`tauri-driver` needs msedgedriver on Windows and exits immediately with
`can not find binary msedgedriver.exe in the PATH` / `CannotFindBinaryPath` when
it cannot find one. It is generally **not** on `PATH` and not in the WinGet
cache, so set `TAURI_NATIVE_DRIVER_PATH` (or `EDGE_DRIVER_PATH`) to the full
path of the executable before running any WDIO suite. A cold run without it
fails at driver startup with no obvious cause.

### Port allocation

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

### Profile isolation

Local WDIO only launches a build whose compiled identity is isolated from the
production profile. Nothing about that identity comes from the environment, so
no variable can point a build at another profile.

- **Compiled identifier.** `npm run e2e:build` compiles with
  `src-tauri/tauri.e2e.conf.json`, so the binary's identifier is
  `com.sortofremote.ng.e2e`. Tauri derives the app data, local data, config,
  cache and log directories from it (`%APPDATA%\com.sortofremote.ng.e2e`,
  `%LOCALAPPDATA%\com.sortofremote.ng.e2e`). The binary carries a
  `SORNG_PROFILE_MARKER_V1[identifier=<id>]` marker that the harness scans
  before it launches anything; a binary without one predates isolation and is
  never launched.
- **Keychain namespace.** A non-production build stores every keychain service
  as `<service>@<identifier>`, for example
  `com.sortofremoteng.vault@com.sortofremote.ng.e2e/master-dek`. It cannot read,
  rotate or delete the real vault DEK or any other production credential.
  Production service names are unchanged.
- **Per-run WebView2 folder.** Each run gets
  `%LOCALAPPDATA%\sorng-e2e-runs\<run id>\webview2`. The harness passes it both
  as `WEBVIEW2_USER_DATA_FOLDER` and as the app flag
  `--sorng-webview2-user-data-folder=<folder>`, so localStorage, IndexedDB and
  caches never reach `%LOCALAPPDATA%\com.sortofremote.ng\EBWebView`, and not
  the identifier default folder either. Set `SORNG_E2E_RUN_ROOT` to move the
  runs root; keep it short, because Chromium profile paths are deep. The run
  dir is removed after the run unless `SORNG_E2E_KEEP_RUN_DIR=1`, and the next
  preflight removes run dirs that no live run owns.
- **SSH home.** Isolated builds resolve the default `known_hosts`, default SSH
  key discovery and opkssh's `~/.opk` and `~/.ssh` state under
  `<app data>\ssh-home`, for example
  `%APPDATA%\com.sortofremote.ng.e2e\ssh-home\.ssh\known_hosts`. Every run
  starts with it absent. The real `~/.ssh` is never read or written by the app;
  the harness still hashes the real `known_hosts` before and after each run.
  External OpenSSH tools and the SSH agent stay shared.
- **In-app guard** (`src-tauri/src/app_profile.rs`). Before tracing, TLS or
  Tauri start, an isolated build exits with code 78 when
  `SORNG_EXPECT_ISOLATED_PROFILE` differs from its identifier, when a harness
  launch names no WebView2 folder, or when the WebView2 folder is inside the
  production profile or the flag and the environment disagree. A production
  build refuses every harness-only input. `--sorng-profile-probe` prints the
  resolved profile as JSON and exits 0 without creating anything; exit code 70
  means the identity could not be installed.
- **Harness preflight** (`scripts/lib/e2e-profile-isolation.mjs`, run by
  `e2e/helpers/tauri-service.ts` before `tauri-driver` starts). It checks the
  marker and build manifest, that no WebView2 `UserDataFolder` policy override
  applies and no production-identifier process runs. It then takes the run
  lock, creates the run dir and probes the binary with the exact launch inputs.
  Only then does it wipe the probe-asserted e2e roots, the
  `@com.sortofremote.ng.e2e` credentials and the e2e autostart value, and hash
  `known_hosts`. Each WDIO worker compares the app's resolved directories with
  the probe and requires WebView2 to use the run folder before any spec touches
  the app. Teardown repeats the wipe and releases the lock.

`scripts/readme-screenshot.mjs` uses the same guard with the identifier
`com.sortofremote.ng.readme-capture`. It pins one run id, run dir and run lock
for its seed and capture phases, and wipes the capture profile (Roaming and
LocalData), keychain namespace and autostart value before seeding and after
capturing.

All runs of one identifier share its profile, so the run lock
(`%TEMP%\sorng-e2e-<identifier>.lock`) serialises them: a second run refuses
with `LOCK_HELD`. Only the driver ports and the WebView2 folder are per run.

#### Refusal codes

A refusal prints `e2e refused to run [<code>]` with the reason and the fix, and
the run exits before `tauri-driver` starts (worker refusals abort the run).

| Code                           | Meaning                                                                     | What to do                                                          |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `INVALID_IDENTIFIER`           | The harness is configured with a non-isolation identifier.                  | Use `E2E_IDENTIFIER` (or `README_CAPTURE_IDENTIFIER`).              |
| `INVALID_OPTIONS`              | The driver service options or the WebView2 launch arguments are incomplete. | Fix the WDIO config.                                                |
| `BINARY_NOT_CONFIGURED`        | Not exactly one `tauri:options.application`.                                | Set `TAURI_BINARY_PATH`.                                            |
| `BINARY_MISSING`               | The application is not a regular file at a canonical path.                  | Use the path `npm run e2e:build` printed.                           |
| `BINARY_IN_SHARED_TARGET`      | The application is under a `src-tauri/target`.                              | Build with `npm run e2e:build`.                                     |
| `BINARY_CHANGED`               | The file changed after its identity was verified.                           | Wait for the build writing it, then rerun.                          |
| `MARKER_MISSING`               | A pre-isolation binary that would open the real profile.                    | Never launch it; rebuild.                                           |
| `MARKER_PRODUCTION`            | Compiled with the production identifier.                                    | Rebuild with `npm run e2e:build`.                                   |
| `MARKER_MISMATCH`              | Compiled for another isolation identifier.                                  | Use the matching binary.                                            |
| `MARKER_AMBIGUOUS`             | More than one identity marker.                                              | Rebuild from a clean e2e target.                                    |
| `MANIFEST_INVALID`             | `e2e-build-manifest.json` is unreadable or malformed.                       | Rebuild.                                                            |
| `MANIFEST_MISMATCH`            | Hash, size, file name or identifier differ from the manifest.               | Rebuild; never edit `.artifacts/e2e/bin/`.                          |
| `PRODUCTION_PROCESS_RUNNING`   | The installed app, `app.exe` from another build or `tauri dev` is running.  | Wait for it; see "Running next to production".                      |
| `PROCESS_CHECK_FAILED`         | Running processes could not be listed.                                      | Make `powershell.exe` (or `ps`) work.                               |
| `E2E_BINARY_RUNNING`           | The e2e binary is already running.                                          | Wait, or end that orphaned tree by PID.                             |
| `LOCK_HELD`                    | Another run of this identifier holds the lock.                              | Wait; a lock is stale only when its process exited.                 |
| `LOCK_UNREADABLE`              | The lock file cannot be parsed.                                             | Confirm no run is active, then delete the named lock.               |
| `PROBE_FAILED`                 | The probe did not exit 0 in time.                                           | Rebuild.                                                            |
| `PROBE_INVALID`                | The probe output breaks the `sorng-profile-probe/v1` contract.              | Rebuild so the harness and the binary agree.                        |
| `PROBE_PRODUCTION_PATH`        | A reported directory is or overlaps the production profile.                 | Do not run; report the probe output.                                |
| `WIPE_TARGET_UNSAFE`           | A wipe target is not provably an e2e root; nothing was deleted.             | Inspect it; never delete it by hand.                                |
| `WIPE_FAILED`                  | The e2e profile could not be removed.                                       | Close the e2e app holding files, then rerun.                        |
| `KEYCHAIN_TARGET_UNSAFE`       | Cleanup selected a non-e2e credential; nothing was deleted.                 | Report it.                                                          |
| `KEYCHAIN_CLEANUP_FAILED`      | E2e credentials could not be listed or removed.                             | Retry, or remove the `@<identifier>` entries.                       |
| `AUTOSTART_NAME_UNSAFE`        | The autostart value is not the exact e2e name.                              | Rebuild.                                                            |
| `AUTOSTART_CLEANUP_FAILED`     | The e2e autostart Run value could not be removed.                           | Remove the named value.                                             |
| `PREFLIGHT_MISSING`            | A worker has no proof of a live preflight.                                  | Start through the WDIO launcher.                                    |
| `RUN_ABORTED`                  | An earlier worker found the app outside its profile.                        | Read the first refusal; do not rerun.                               |
| `WORKER_PROFILE_MISMATCH`      | The app resolved other directories than the probe.                          | Do not rerun; report them.                                          |
| `RUN_DIR_UNSAFE`               | The run dir or runs root is not provably harness-owned.                     | Unset run overrides, or set a short long-name `SORNG_E2E_RUN_ROOT`. |
| `WEBVIEW2_POLICY_OVERRIDE`     | A WebView2 `UserDataFolder` policy applies to the app.                      | Remove the named policy value.                                      |
| `WEBVIEW2_POLICY_CHECK_FAILED` | The policy keys could not be read.                                          | Make `reg.exe` work.                                                |
| `WEBVIEW2_EVIDENCE_MISSING`    | WebView2 did not use the run folder.                                        | Do not rerun; report the folders.                                   |
| `KNOWN_HOSTS_CHANGED`          | The real `~/.ssh/known_hosts` changed while no production app ran.          | Do not rerun; inspect the change.                                   |

#### Running next to production

By default a production-identifier process (the installed app, an `app.exe`
other than the verified e2e binary, or a `tauri dev` launcher) refuses the run
with `PRODUCTION_PROCESS_RUNNING`. Never stop someone else's `tauri dev`; wait
for it to exit.

`SORNG_E2E_ALLOW_RUNNING_PRODUCTION=1` (exactly `1`) turns that refusal into a
warning that names the processes. Set it only for a binary whose isolation
self-test (below) has passed. It relaxes nothing else: marker, manifest, probe,
lock and wipe refusals still apply. A changed `known_hosts` then becomes a
warning, because the running production app may have written it.

### Dev and packaged profiles

`npm run tauri dev` uses the production identifier `com.sortofremote.ng`. It
shares the Rust profile (`%APPDATA%\com.sortofremote.ng`), the keychain DEK and
the WebView2 folder with the installed app. WebView storage is separated only by
origin: `http://localhost:<port>` in dev, `tauri.localhost` in the packaged app.
Running both at once uses one profile. The launcher prints a `dev profile:`
banner line that names the profile, its folders and the origin.

`npm run tauri dev -- --isolated-profile` switches dev to
`com.sortofremote.ng.dev`: a separate, initially empty profile with its own
keychain namespace and WebView2 folder. Switching rebuilds the app crate.
`--isolated-profile=<suffix>` selects `com.sortofremote.ng.<suffix>`; `e2e` and
`readme-capture` are reserved because the harness wipes those profiles.

### Safe run procedure

1. **Build.** Run `npm run e2e:build`.
   - Cargo writes to `.artifacts/e2e/target`. Set `SORNG_E2E_CARGO_TARGET_DIR`
     to move it; anything inside `src-tauri`, including `src-tauri/target`, is
     refused.
   - The verified copy and its `e2e-build-manifest.json` land in
     `.artifacts/e2e/bin/<UTC>-<sha>/`, and the script prints
     `TAURI_BINARY_PATH=<path>`.
   - Add `-- --reuse-frontend` only when `out/` already holds the current
     frontend (run `npm run build` first after frontend changes). Without it the
     build runs `npm run build`, which a browser `npm run dev` holding
     `.next/dev/lock` refuses; the managed `tauri dev` uses `.next-tauri-dev` and
     does not conflict.
   - The e2e overlay does not stage the opkssh vendor bundle or the file viewer
     host. If the build reports missing resources, stage them once with
     `npm run stage:opkssh-vendor -- --release --enable` and
     `npm run stage:file-viewer -- --release`.
2. **Prove isolation once per binary.** Run
   `npm run e2e:isolation:selftest -- --binary <path>`. It automates the
   first-launch checklist and stops at the first unexpected result:
   - static identity (manifest SHA-256, markers exactly
     `[com.sortofremote.ng.e2e]`), the WebView2 policy check, production
     processes and the run lock;
   - a metadata-only production snapshot. It records names, sizes and mtimes of
     `%APPDATA%\com.sortofremote.ng`, the top level of
     `%LOCALAPPDATA%\com.sortofremote.ng` and the mtimes of its `EBWebView`
     storage directories, the `~/.ssh` and `~/.opk` listings, the SHA-256 of
     `known_hosts`, Credential Manager target names with their last-written
     time, and HKCU Run value names. It never reads file contents or credential
     secrets;
   - the probe, before and after wiping the e2e profile, which must create
     nothing;
   - four refusal controls that must exit 78 and create nothing: an identifier
     mismatch, a harness launch without a WebView2 folder, the WebView2 flag
     naming the production `EBWebView`, and a flag that disagrees with
     `WEBVIEW2_USER_DATA_FOLDER`;
   - one direct launch that must create `%APPDATA%\com.sortofremote.ng.e2e`,
     populate `<run dir>\webview2\EBWebView`, never create
     `%LOCALAPPDATA%\com.sortofremote.ng.e2e\EBWebView`, and bootstrap
     `com.sortofremoteng.vault@com.sortofremote.ng.e2e/master-dek`. It is then
     stopped by PID tree;
   - an unchanged production snapshot after every launch, and a teardown that
     wipes only e2e state and releases the lock.

   It writes `.artifacts/e2e/selftest-<UTC>.json` and a `.txt` summary (choose
   the path with `--report`). With `--wdio` (groups `startup`, `mutating`,
   `ssh`, `dsm` or `all`) a passing self-test continues with those WDIO specs;
   the `ssh` group needs `npm run e2e:smoke:up`.

   A production change while no production process runs is a hard failure:
   stop, report it and delete nothing in production. If the identifier-default
   `EBWebView` appears instead of the run folder, WebView2 ignored the override;
   report it rather than relaxing the check.

3. **Run WDIO** with that binary:
   `TAURI_BINARY_PATH=<path> npm run e2e -- --spec <spec>` (PowerShell:
   `$env:TAURI_BINARY_PATH = '<path>'` first). The preflight logs its nine
   steps; any refusal exits before `tauri-driver` starts.
4. **Never** point `TAURI_BINARY_PATH` at `src-tauri/target/debug/app.exe` or at
   a binary without a marker. The harness refuses both
   (`BINARY_IN_SHARED_TARGET`, `MARKER_MISSING`) because such a binary opens the
   real profile.

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
