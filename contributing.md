# Contributing to sortOfRemoteNG

Thanks for your interest! This file covers the minimum you need to get a
dev environment running and pass CI. Architecture, security model, and the
full feature matrix live in [`architecture.md`](architecture.md) and
[`security.md`](security.md).

## Toolchain requirements

- **Rust**: pinned via [`rust-toolchain.toml`](rust-toolchain.toml). `rustup`
  auto-installs the right channel on first `cargo` invocation. Do NOT
  override it with `+nightly` unless a PR explicitly opts in.
- **Node.js**: v18+ (v20 LTS recommended — matches CI).
- **Platform build tools**:
  - **Windows**: MSVC Build Tools with the "Desktop development with C++"
    workload, Windows 10/11 SDK. **MSVC host is mandatory** (see below).
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `gcc`, `pkg-config`, `libssl-dev`, `libgtk-3-dev`,
    `libwebkit2gtk-4.1-dev`, `cmake`, and `build-essential`.

### Windows: pin MSVC host

The GNU host triggers `LNK1189: export ordinal too large` link errors in
several crates in this workspace (`ironrdp-*`, `sspi-rs`).
Run the following once per Windows dev box:

```powershell
# Install MSVC Build Tools first:
#   https://visualstudio.microsoft.com/visual-cpp-build-tools/
rustup set default-host x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
rustup component add rustfmt clippy

# Sanity check — the `Host:` line should read x86_64-pc-windows-msvc:
rustc -vV
```

CI enforces this explicitly in `.github/workflows/ci.yml`
(`rust-check-windows` job).

## Dev loop

Native browser builds reuse a locally registered patched CEF engine or download
the target-specific release pinned by this checkout. They do not compile
Chromium. See [Reusable patched CEF builds](docs/cef-runtime-ci.md) for engine
publication, verified downloads, offline caching, and first-release prerequisites.

```bash
# Install frontend deps
npm install

# Prepare the local E2E env file once
cp e2e/.env.example e2e/.env

# Run the Tauri app in dev mode
npm run tauri:dev

# Frontend unit tests
npm test

# Lint + changed-file format (frontend)
npm run lint
npm run format

# Rust workspace checks
cd src-tauri
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Required E2E smoke gate (same scope as the new PR smoke workflow)
cd ..
npm run e2e:smoke:up
npm run e2e:smoke:required
npm run e2e:smoke:down
```

## CI expectations

Every PR must pass:

- `format` — `npm run format` (Prettier on changed files).
- `lint` — `npm run lint` (ESLint).
- `test` — `npm test -- --run --coverage`.
- `e2e-smoke` — Docker-backed SSH + SFTP smoke tests only.
- `rust-check-linux` — `cargo check --workspace`.
- `rust-check-windows` — `cargo check --workspace`
  on an MSVC host.

Broader E2E remains opt-in or nightly. See `docs/testing/e2e-runbook.md`
for the tier model and environment expectations. Run the same required
commands locally before opening a PR to avoid round-trips.

## Commits & PRs

- Direct commits to `main` are the project's current convention; prefer
  small, reviewable commits with prefixes that explain scope
  (e.g. `fix(vpn/softether): …`, `test(…): …`, `t3-e1: …` for planned
  orchestration work).
- Keep diffs tight. If a change touches multiple unrelated areas, split it.
- Never skip pre-commit hooks (`--no-verify`) or bypass signing unless a
  maintainer explicitly says so.

## Reporting issues

Open a GitHub issue with:

1. Platform + `rustc -vV` output.
2. Repro steps.
3. Relevant log output (the app emits structured logs; set
   `RUST_LOG=debug` for verbose).

Security issues: see [`security.md`](security.md) for the disclosure
process — please email the maintainers rather than filing a public issue.
