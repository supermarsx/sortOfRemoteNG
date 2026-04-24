# E2E Coverage Improvement Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Planning Constraints](#2-planning-constraints)
3. [Current State Summary](#3-current-state-summary)
4. [Target Test Tier Model](#4-target-test-tier-model)
5. [Workstream 1: Tiered CI Gating](#5-workstream-1-tiered-ci-gating)
6. [Workstream 2: Raise Signal Quality of Existing Tests](#6-workstream-2-raise-signal-quality-of-existing-tests)
7. [Workstream 3: Expand Coverage by Capability](#7-workstream-3-expand-coverage-by-capability)
8. [Workstream 4: Environment Standardization and Documentation](#8-workstream-4-environment-standardization-and-documentation)
9. [Proposed File and Workflow Changes](#9-proposed-file-and-workflow-changes)
10. [Phased Rollout](#10-phased-rollout)
11. [Success Metrics](#11-success-metrics)
12. [Open Decisions](#12-open-decisions)

---

## 1. Executive Summary

The repository already has a broad E2E footprint:

- A large WebdriverIO + Tauri desktop UI suite under `e2e/specs/`
- Docker-backed protocol fixtures in `e2e/docker-compose.yml`
- Additional SMB and SoftEther services in `docker/compose.e2e.yml`
- Rust golden-path integration tests for SSH, SFTP, SMB, RDP, VNC, and SoftEther

The problem is not lack of tests on disk. The problem is that the current E2E estate is unevenly wired, unevenly trusted, and unevenly gateable:

- The broad WDIO suite is not part of regular CI gating.
- A meaningful slice of the suite relies on fixed sleeps and optional-pass branches.
- The full environment needed to exercise every feature does not exist in a reliable form on every CI runner.
- Several feature areas are tested as panel/render checks rather than true end-to-end behavior.

This plan improves E2E coverage without making the repository harder to ship. The key principle is:

**Do not treat all E2E as one gate.**

Instead, split the estate into tiers:

- `Required` on every PR only when the environment is deterministic and reproducible on hosted CI.
- `Opt-in` on PRs when the environment is available but expensive, slower, or less stable.
- `Nightly` or `self-hosted lab` for flows that require specialized OS integration, long-lived services, vendor appliances, or richer desktop environments.

This plan also explicitly includes the three immediate actions identified in the E2E review:

1. Put a small smoke subset into CI.
2. Replace sleeps and silent optional passes with stronger assertions.
3. Normalize feature gating, fixtures, and runbooks.

---

## 2. Planning Constraints

### 2.1 Non-negotiable constraint

We should **not** gate all E2E on every commit or every PR if the needed environment is not guaranteed to exist in CI.

That means:

- No assumption that every hosted runner can run the full Tauri desktop suite reliably.
- No assumption that vendor integration targets exist in CI.
- No assumption that every OS-specific capability is reproducible on Linux-hosted runners.
- No assumption that real cloud sync, updater, marketplace, or appliance environments should be mandatory in merge gates.

### 2.2 What this plan optimizes for

- Higher regression signal from the tests you already have
- Better separation between deterministic CI checks and specialty environments
- Better local reproducibility
- A clearer path to expanding coverage without creating a fragile release process

### 2.3 What this plan does not assume

- That the full WDIO suite should become a required check immediately
- That all current placeholder UI tests should stay in the E2E bucket
- That nightly coverage and required PR gating should use the same runners, same scripts, or same expectations

---

## 3. Current State Summary

### 3.1 What exists today

- `package.json` exposes `npm run e2e` for the WDIO desktop suite.
- `e2e/wdio.conf.ts` targets all specs under `e2e/specs/**/*.spec.ts`.
- `e2e/docker-compose.yml` provisions SSH, RDP, VNC, HTTP, MySQL, and FTP fixtures.
- `docker/compose.e2e.yml` adds SMB and SoftEther.
- `.github/workflows/e2e.yml` runs the Rust Docker-backed protocol tests nightly, on manual dispatch, or on PRs labeled `e2e`.

### 3.2 Where the current setup is strong

- Backend protocol smokes exist and are already wired to Docker-backed fixtures.
- The UI suite covers a lot of product surface area on paper.
- The repo already has a working pattern for opt-in E2E via label/manual/schedule.

### 3.3 Where the current setup is weak

- The UI suite is not a normal CI signal yet.
- Many specs use `browser.pause(...)` instead of deterministic waits.
- Some specs return early or skip assertions when the feature state is absent, which weakens regression detection.
- Environment setup is split across package scripts, compose overlays, and specialty docs.
- Feature gating is inconsistent across Rust E2E crates and docs.

### 3.4 Coverage shape today

Current coverage can be grouped into four buckets:

| Bucket | Current state | Trust level |
|---|---|---|
| Rust protocol golden paths | Real and useful | High |
| WDIO core app + local flows | Broad but not CI-gated | Medium |
| WDIO Docker-backed protocol UI flows | Useful but timing-heavy | Medium |
| Extended product surfaces (updater, marketplace, cloud sync, vendor panels) | Broad but shallow | Low to Medium |

---

## 4. Target Test Tier Model

The future E2E estate should be organized into explicit tiers.

### 4.1 Tier A: Required PR gate

Purpose:

- Fast, deterministic signal on every PR
- Only uses environments we fully control in hosted CI

Candidate contents:

- Rust protocol smoke tests for the most stable Docker-backed backends
- A very small UI smoke set if Tauri runner stability is proven
- Startup, app-shell readiness, collection create/open, connection CRUD smoke, settings persistence smoke, encryption persistence smoke

Rules:

- No silent optional passes
- No real vendor appliance dependencies
- No external cloud accounts
- No OS-specific specialty hardware
- Runtime target: 10 to 15 minutes total

### 4.2 Tier B: Opt-in PR E2E

Purpose:

- Broader validation when a change is risky
- Useful before merge, but not mandatory for every change

Trigger:

- PR label such as `e2e`
- Manual dispatch

Candidate contents:

- Full Docker-backed backend protocol matrix
- Larger WDIO protocol suite against Docker services
- Expanded settings, import/export, multi-window, session, and SSH flow coverage

Rules:

- May be slower
- May rely on richer desktop dependencies
- Still must run in a documented reproducible environment

### 4.3 Tier C: Nightly hosted CI

Purpose:

- Catch regressions across a broader matrix without blocking routine PR flow

Candidate contents:

- Extended protocol matrix
- Long-running reconnection and stability scenarios
- Compatibility matrix across feature flags
- Broader WDIO slices once stabilized

### 4.4 Tier D: Lab-only or self-hosted

Purpose:

- Exercise flows that need real OS integration, specialty network topologies, or vendor-like environments

Candidate contents:

- Detached windows and multi-window synchronization in richer desktop environments
- Real updater end-to-end against staging feeds
- Real marketplace install/uninstall against registry emulators or staging sources
- Vendor panel contract tests against simulated appliances or dedicated test rigs
- Certificate trust dialogs, credential-manager integrations, and other environment-sensitive OS flows

Rules:

- Never required on every PR by default
- Documented as compatibility or certification coverage, not merge gating

---

## 5. Workstream 1: Tiered CI Gating

This workstream implements item `1` from the review: put a small smoke subset into CI, but only where the environment is known-good.

### 5.1 Define the suites explicitly

Create four named suites:

- `smoke-required`
- `docker-extended`
- `nightly-extended`
- `lab-only`

These should be represented in a way that is easy to route in CI:

- Separate WDIO config files, or
- Spec manifests, or
- Directory conventions, or
- Metadata comments plus filtering

Recommended approach:

- Split by config or manifest instead of relying on ad hoc include globs.
- Keep `smoke-required` intentionally tiny.
- Avoid one monolithic `e2e/wdio.conf.ts` being responsible for every use case.

### 5.2 Required PR gate contents

Initial `required` gate should include only checks that are proven reproducible on hosted CI.

Recommended initial scope:

- Rust Docker golden paths for SSH and SFTP
- Optionally SMB, RDP, and VNC only if their current nightly stability proves strong enough
- A WDIO startup + collection + connection CRUD smoke set only after it is demonstrated to be stable on hosted CI runners

Important rule:

**Do not make the full WDIO suite required just because it exists.**

Promotion criteria for WDIO `required` status:

- Stable runner provisioning documented
- Flake rate below agreed threshold
- No silent early-return patterns
- Runtime kept small

### 5.3 Opt-in PR suite

Expand the current labeled/manual E2E model instead of removing it.

This suite should include:

- Broader Docker-backed Rust tests
- WDIO Docker protocol flows
- Expanded regression flows around sessions, SSH, RDP, FTP, HTTP, MySQL, and import/export

Recommended trigger model:

- Keep `pull_request` + `e2e` label
- Keep `workflow_dispatch`
- Allow maintainers to trigger it selectively when a PR touches risky areas

### 5.4 Nightly suite

Nightly should run the widest hosted-CI-reproducible matrix.

Nightly objectives:

- Surface drift early without blocking every PR
- Catch timing-sensitive breakage from dependency or environment changes
- Collect diagnostics artifacts on failure

### 5.5 Lab-only suite

Some coverage should stay outside required hosted CI entirely.

Examples:

- Real updater install/rollback flows
- Marketplace ecosystem compatibility
- Vendor appliance behaviors
- OS-native dialogs and desktop edge cases

These should be framed as:

- certification coverage
- compatibility coverage
- pre-release coverage

Not as required commit or PR gates.

### 5.6 Deliverables for Workstream 1

- New CI suite map document
- New workflow split between required, opt-in, and nightly
- Explicit suite ownership and trigger rules
- Promotion criteria document for moving tests between tiers

---

## 6. Workstream 2: Raise Signal Quality of Existing Tests

This workstream implements item `2` from the review: replace sleeps and silent optional passes with deterministic behavior.

### 6.1 Replace `browser.pause(...)` with wait helpers

Introduce shared helpers for common conditions:

- `waitForSessionTab(name)`
- `waitForTerminalReady()`
- `waitForProtocolClientReady(kind)`
- `waitForStatusText(selector, matcher)`
- `waitForWindowCount(expected)`
- `waitForConnectionTreeItem(name)`

Rules:

- Fixed sleeps should become a temporary exception, not the default pattern.
- If a protocol backend needs polling, centralize the polling logic in helpers.
- If a UI flow requires backend settle time, assert on observable state rather than time.

### 6.2 Eliminate optional-pass branches in gated suites

Current anti-pattern:

- If the feature is absent, return without asserting
- If a control is missing, do nothing and still pass

Target behavior:

- If a feature is required for the suite, fail clearly.
- If a feature is intentionally optional, use explicit skip semantics with a reason.
- If a capability check is needed, run that check in suite setup and record the decision.

This change alone will make the existing suite much more trustworthy.

### 6.3 Separate contract tests from render-only tests

Many current specs validate that a panel exists. Those should be reclassified unless they prove behavior.

Recommended split:

- `smoke-required`: only behavior-centric end-to-end tests
- `ui-surface`: panel presence, tabs, layout, and visibility checks

The second group is still useful, but it should not be confused with strong E2E coverage.

### 6.4 Add common assertion patterns

Standardize outcome assertions for protocol flows:

- Connection opened and terminal/canvas/viewer is visible
- Expected remote content is rendered
- Disconnect closes or transitions the session cleanly
- Reconnect re-establishes a usable state
- Auth failure produces a specific failure surface

### 6.5 Improve failure diagnostics

For WDIO failures, collect:

- Screenshots
- Browser logs if available
- App logs if available
- Container logs for Docker-backed specs
- A summary of the suite tier and preconditions

### 6.6 Deliverables for Workstream 2

- New `e2e/helpers/waits.ts` or equivalent
- Removal of high-value `browser.pause(...)` hotspots first
- Elimination of silent early returns in required suites
- Diagnostics artifact standardization

---

## 7. Workstream 3: Expand Coverage by Capability

This workstream implements item `3` from the review: expand coverage intentionally, but only in environments that make sense.

### 7.1 Priority order

Coverage should expand by business value and reproducibility, not by surface count.

Recommended priority:

1. Core app and data safety flows
2. Stable protocol flows with Docker fixtures
3. Feature areas that can be backed by local emulators or mock servers
4. Vendor and specialty integrations

### 7.2 Core app and data safety

Add or strengthen tests for:

- App startup and recovery
- Collection create/open/switch/delete
- Connection CRUD and persistence across reload
- Settings persistence across reload
- Encryption round-trip and plaintext absence
- Import/export round-trip with deterministic fixtures
- Search, favorites, templates, and bulk edit flows

These are excellent candidates for `smoke-required` or the first expansion beyond it.

### 7.3 Stable Docker-backed protocol UI coverage

Expand deterministic protocol coverage where Docker can provide the backend.

Targets:

- SSH: connect, auth success/failure, host key trust, command execution, disconnect, reconnect
- SFTP: upload/download/listing round-trip
- FTP: connect, list, upload/download with deterministic fixture verification
- HTTP: auth success/failure against a known test site
- MySQL: connect and deterministic query/metadata assertions
- RDP and VNC: connect, disconnect, minimal rendering sanity, reconnect

Preferred approach:

- Keep a small subset in `required` only when runner stability is demonstrated
- Keep the larger matrix in `opt-in` or `nightly`

### 7.4 Emulated or mocked feature environments

Some feature areas need stronger behavior coverage, but not real external systems.

Build test doubles for:

- Updater: local mock update manifest/feed server
- Marketplace: local plugin registry or fixture-based catalog
- Cloud sync: MinIO, WebDAV, or local object-store emulator
- DDNS: local HTTP mock that records provider requests
- Vendor APIs: contract-style fake servers for Synology, iDRAC, and Proxmox

This is the most important path for improving coverage in shallow areas without requiring real production services.

### 7.5 Specialty/lab coverage

Reserve the following for `lab-only` or pre-release validation:

- Detached window lifecycle and cross-window synchronization in a richer desktop environment
- OS-specific credential manager and certificate trust flows
- Real updater install, rollback, and state preservation
- Vendor appliance compatibility against controlled hardware or appliance simulators

### 7.6 Reclassify shallow specs

Feature areas that are currently mostly panel checks should be converted into one of three things:

- Real E2E backed by emulators or fixtures
- Contract/integration tests below the full UI layer
- UI surface tests with clearer naming and lower gating expectations

Recommended first conversions:

- Updater
- Marketplace
- Cloud Sync
- Synology
- iDRAC
- Proxmox
- Multi-window detach/reattach

### 7.7 Deliverables for Workstream 3

- Coverage matrix mapping feature area to suite tier
- Mock service plan for updater/marketplace/cloud-sync/DDNS/vendor APIs
- Promotion list of shallow tests to real behavior tests

---

## 8. Workstream 4: Environment Standardization and Documentation

This workstream makes the E2E estate maintainable.

### 8.1 Normalize environment setup

The repo should expose one documented way to run each tier.

Recommended scripts:

- `e2e:smoke:required`
- `e2e:docker:extended`
- `e2e:nightly:local`
- `e2e:lab`

If the compose overlay is needed for SMB and SoftEther, local scripts should reflect that instead of only bringing up the base file.

### 8.2 Expand `e2e/.env.example`

Document all variables used across the full test stack:

- SSH
- VNC
- MySQL
- FTP
- SMB
- SoftEther

The local template should match the actual CI environment shape as closely as possible.

### 8.3 Normalize feature-gate naming

Unify around one naming convention for feature-gated Docker E2E.

Current target:

- Use `docker-e2e` consistently in code, docs, and workflow examples

This should include:

- Rust crate docs/comments
- specialty docs such as the SoftEther guide
- workflow comments
- local runbooks

### 8.4 Create a single E2E runbook

Add one primary document that explains:

- Which suite exists
- When to run it
- Which environment it needs
- Whether it is `required`, `opt-in`, `nightly`, or `lab-only`
- How to interpret failures

This should supersede the current need to infer behavior from scripts and workflow files.

### 8.5 Track flake status explicitly

Add a lightweight quarantine or flake-tracking policy:

- known flaky test list
- owner per flaky test
- remediation deadline
- promotion criteria back into gated suites

### 8.6 Deliverables for Workstream 4

- Unified runbook
- Updated env example
- Updated package scripts
- Normalized feature-gate docs
- Flake policy

---

## 9. Proposed File and Workflow Changes

This section is the practical map from the plan to the repo.

### 9.1 CI and scripts

- Update `package.json`
  - Add tiered E2E scripts
  - Stop treating `npm run e2e` as the only entry point

- Add `.github/workflows/e2e-smoke.yml`
  - Required PR gate
  - Only deterministic hosted-CI tests

- Update `.github/workflows/e2e.yml`
  - Keep as broader opt-in/nightly workflow
  - Make the intent of each step clearer

- Optionally add `.github/workflows/e2e-lab.yml`
  - Manual or self-hosted only

### 9.2 WDIO layout

- Split `e2e/wdio.conf.ts` into tier-aware configs or manifests
- Add `e2e/helpers/waits.ts`
- Add `e2e/helpers/capabilities.ts`
- Add `e2e/helpers/artifacts.ts` if needed for richer diagnostics

### 9.3 Spec cleanup

- Refactor high-value specs first:
  - `e2e/specs/06-ssh/*`
  - `e2e/specs/07-rdp/*`
  - `e2e/specs/08-protocols/*`
  - `e2e/specs/09-sessions/*`
  - `e2e/specs/10-settings/*`
  - `e2e/specs/17-marketplace/*`
  - `e2e/specs/18-updater/*`
  - `e2e/specs/19-multi-window/*`
  - `e2e/specs/24-cloud-sync/*`
  - `e2e/specs/26-synology/*`
  - `e2e/specs/27-idrac/*`
  - `e2e/specs/28-proxmox/*`

### 9.4 Environment docs

- Update `e2e/.env.example`
- Add `docs/testing/e2e-runbook.md` or similar
- Update `docs/cedar-reference/SE-7-TEST-GUIDE.md`

---

## 10. Phased Rollout

### Phase 0: Baseline and suite classification

Goal:

- Freeze the current estate into an explicit matrix

Tasks:

- Classify every E2E spec/test into a tier
- Identify every silent optional pass in gated candidates
- Identify every high-value fixed sleep in gated candidates
- Decide which current nightly checks are stable enough to stay hosted

Exit criteria:

- Written suite matrix
- Agreed `required` candidate list

### Phase 1: Introduce the required smoke gate

Goal:

- Land a small, trustworthy gate without destabilizing PR flow

Tasks:

- Add required workflow
- Add tiered package scripts
- Keep scope minimal
- Keep broader suite opt-in/nightly

Exit criteria:

- Required E2E gate is fast and green
- No specialized environment dependency leaked into required PR checks

### Phase 2: Strengthen existing tests

Goal:

- Improve the signal quality of the tests already present

Tasks:

- Replace the worst timing hotspots
- Remove silent early returns from gated candidates
- Improve shared helpers and diagnostics

Exit criteria:

- Gated suite has explicit preconditions and deterministic waits
- Flake rate materially reduced

### Phase 3: Expand behavior coverage

Goal:

- Turn shallow feature-area coverage into meaningful E2E or emulator-backed integration

Tasks:

- Add mock services for updater, marketplace, cloud sync, DDNS, vendor APIs
- Promote high-value feature areas from panel checks to behavior tests
- Expand Docker-backed UI and backend paths where stable

Exit criteria:

- Coverage grows in the weakest current areas without forcing real external dependencies into PR gates

### Phase 4: Promotion and quarantine discipline

Goal:

- Continuously move reliable tests upward and unstable tests downward

Tasks:

- Promote proven tests into required or nightly tiers
- Quarantine unstable tests with owners and deadlines
- Review suite runtime and flake budget monthly

Exit criteria:

- Test tiers reflect reality, not hope

---

## 11. Success Metrics

This plan is successful when the repository can answer these questions clearly.

### 11.1 Coverage metrics

- Every critical feature area has at least one meaningful behavior test path.
- Every specialty feature area is explicitly mapped to `required`, `opt-in`, `nightly`, or `lab-only`.
- Shallow panel/render tests are no longer mistaken for strong E2E coverage.

### 11.2 Reliability metrics

- Required E2E suite runtime stays within the target budget.
- Hard sleeps in required suites are reduced by at least 80%.
- Silent optional-pass branches are eliminated from required suites.
- Flake rate in required suites stays below the agreed threshold.

### 11.3 Operability metrics

- A new contributor can tell exactly which E2E tier to run locally.
- The env template matches the documented stack.
- Feature-gate naming is consistent across code, docs, and workflows.

---

## 12. Open Decisions

These need explicit answers before implementation starts.

1. Should any WDIO suite become `required` on hosted CI immediately, or should WDIO start as `opt-in` until runner stability is proven?
2. Which current Rust protocol tests are stable enough to remain required versus nightly only?
3. Do we want mock servers for vendor integrations inside this repo, or in a separate test-fixture workspace?
4. Which self-hosted environments are available for lab-only coverage, if any?
5. What is the acceptable runtime budget for required PR E2E checks?

---

## Recommended Immediate Next Actions

If this plan is approved, the first implementation slice should be:

1. Classify the current suite into `required`, `opt-in`, `nightly`, and `lab-only`.
2. Add a minimal `e2e-smoke` workflow that only uses deterministic hosted-CI checks.
3. Refactor the worst `browser.pause(...)` hotspots and silent early-return tests in the first gated slice.
4. Expand `e2e/.env.example` and add a single E2E runbook.
5. Keep full specialty E2E out of mandatory commit/PR gates until the environment is proven and documented.