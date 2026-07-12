# sortOfRemoteNG

[![CI Status](https://img.shields.io/github/actions/workflow/status/supermarsx/sortOfRemoteNG/ci.yml?label=CI&logo=github&style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/actions)
[![Coverage](https://img.shields.io/badge/coverage-34.73%25-red?style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/supermarsx/sortOfRemoteNG/total?style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/releases)
[![Stars](https://img.shields.io/github/stars/supermarsx/sortOfRemoteNG?style=social&style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/stargazers)
[![Forks](https://img.shields.io/github/forks/supermarsx/sortOfRemoteNG?style=social&style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/network/members)
[![License](https://img.shields.io/github/license/supermarsx/sortOfRemoteNG?style=flat-square)](license.md)

**sortOfRemoteNG** is a powerful, next-generation remote connection manager and utility suite for system administrators and developers. Built on the **Tauri** framework, it leverages **Rust** for a secure, high-performance backend and **React** for a responsive, modern frontend.

This project aims to provide a unified interface for all your remote management needs, replacing multiple disparate tools with a single, extensible application.

## ✨ Key Features

### 🔌 Multi-Protocol Connectivity

- **Remote Desktop**: RDP, VNC, and RustDesk integration (all wired end-to-end, including invoke-handler registration).
- **Shell & Terminal**: Full-featured SSH client and Web Terminal.
- **File Transfer**: FTP and SFTP (backend and invoke-handler registration shipped). SMB/CIFS support is provided by the native `sorng-smb` crate, which uses platform-native backends (Windows UNC / `net use`, Unix `smbclient`).
- **Web**: Integrated browser for HTTP/HTTPS management interfaces.
- **Databases**: Built-in MySQL client.

### 🛠️ Network Utilities

- **Network Discovery**: Scan local networks to automatically find and add hosts.
- **Wake-on-LAN (WoL)**: Wake devices on demand or set up **scheduled wake tasks**.
- **Port Monitoring**: Check status and availability of services.

### 🔒 Security & Authentication

- **Secure Storage**: AES-256 encryption for all stored credentials.
- **TOTP Manager**: Integrated Time-based One-Time Password generator for 2FA.
- **SSH Key Management**: Manage and use SSH keys effortlessly.
- **Access Control**: User authentication system with Argon2id password hashing (bcrypt hashes from older builds are verified and transparently upgraded).

### 🚀 Advanced Capabilities

- **Script Engine**: Automate tasks using a sandboxed TypeScript/JavaScript engine powered by `rquickjs`, enabled via `sorng-ssh`'s `script-engine` feature flag.
- **VPN Management**: Integrations for OpenVPN, WireGuard, ZeroTier, and Tailscale. IKEv2, IPsec, SSTP, L2TP, and PPTP ship behind a native Rust VPN crate; SoftEther is fully ported behind the `vpn-softether` feature flag (live-tunnel validation is host-gated).
- **AI Agent**: Chat, agentic workflows, and code-assist dispatch through real LLM providers (OpenAI, Anthropic, Google, Ollama, local). Providers are wired end-to-end — configure them in-app or via environment variables before use.
- **Connection Chaining**: Route connections through proxies or other hosts.
- **Customization**: Themed interface with flexible tab layouts and tagging.

### 📨 Kafka support (opt-in)

Apache Kafka integration (topic admin, producer/consumer, ACLs, consumer groups, Schema Registry, Kafka Connect) is **off by default**. The backend crate `sorng-kafka` depends on `rdkafka`, which links against the C library `librdkafka`.

**Runtime requirement (v1.0):** `librdkafka ≥ 2.x` must be installed on the host. Release artifacts dynamic-link against the system library — at service-init time a `dlopen` probe surfaces a typed `LibraryMissing` error with a per-OS install hint (apt / dnf / pacman / brew / vcpkg / winget / MSYS2) if it is absent.

Build flags:

- `--features kafka` (v1.0 default) — dynamic-link against a system-installed librdkafka. Install via `apt install librdkafka-dev`, `dnf install librdkafka-devel`, `pacman -S librdkafka`, `brew install librdkafka`, `vcpkg install librdkafka:x64-windows`, or `winget install librdkafka`.
- `--features kafka-dynamic` — explicit alias of `--features kafka` (kept for CI compatibility).
- `--features kafka-static` — compiles librdkafka from source via CMake. Developer/CI only; fails on Windows/MSYS64 due to a known cmake path-mangling issue.

Example:

```bash
# v1.0 default (install librdkafka first — see per-OS commands above):
cargo build --features kafka

# No Kafka — default dev loop:
cargo check --workspace --exclude sorng-kafka
```

Full platform install instructions, the runtime-probe diagnostic flow, and the MSYS64 cmake workaround live in [`src-tauri/crates/sorng-kafka/README.md`](src-tauri/crates/sorng-kafka/README.md).

## 💻 Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri
- **Data Storage**: IndexedDB (Frontend), SQLite/JSON (Backend configurations)

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (Stable)
- **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload)
- **macOS**: Xcode Command Line Tools
- **Linux**: GCC and development libraries (gtk3, webkit2gtk, etc.)

### Toolchain

The workspace pins its Rust toolchain via [`rust-toolchain.toml`](rust-toolchain.toml)
at the repo root. `rustup` picks this up automatically: `channel = "stable"`
with `rustfmt` and `clippy` components, plus the `x86_64-pc-windows-msvc`
target.

**Windows contributors MUST use the MSVC host toolchain.** The GNU host
triggers `LNK1189: export ordinal too large` link errors in several crates
in this workspace (`rdkafka-sys`, `ironrdp-*`, `sspi-rs`). To switch:

```powershell
# One-time: install MSVC Build Tools with the "Desktop development with C++"
# workload (ships the MSVC linker and Windows 10/11 SDK):
#   https://visualstudio.microsoft.com/visual-cpp-build-tools/

# Pin rustup's default host to MSVC and install the matching stable:
rustup set default-host x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
rustup component add rustfmt clippy

# Sanity check — `Host: x86_64-pc-windows-msvc` should appear:
rustc -vV
```

macOS and Linux developers get the normal host-matched `stable` toolchain —
no extra steps.

CI enforces the Windows MSVC host explicitly in the `rust-check-windows`
job (see `.github/workflows/ci.yml`). See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for the full dev-loop.

### Installation

1.  **Clone the repository**

    ```bash
    git clone https://github.com/supermarsx/sortOfRemoteNG.git
    cd sortOfRemoteNG
    ```

2.  **Install dependencies**

    ```bash
    npm install
    ```

3.  **Run in Development Mode**
    Start the Next.js dev server and the Tauri application window:
    ```bash
    npm run tauri:dev
    ```

### Building for Production

Create an optimized executable/installer for your current OS:

```bash
npm run tauri:build
```

Artifacts will be generated in `src-tauri/target/release/bundle/`.

### 🔓 Releases are unsigned (open-source)

sortOfRemoteNG is an open-source project and ships **unsigned** release
artifacts — there is no paid Apple Developer ID or Windows Authenticode code-
signing identity. Because of this, the OS will show an "unknown / unidentified
publisher" warning the **first** time you launch a downloaded build. This is
**normal and expected** for unsigned open-source desktop apps; it does not
indicate the build is unsafe and does not affect functionality.

How to run a release build:

- **macOS (Gatekeeper):** right-click (or Control-click) the app and choose
  **Open**, then confirm in the dialog. Alternatively, clear the quarantine
  flag from a terminal: `xattr -dr com.apple.quarantine /path/to/sortOfRemoteNG.app`.
- **Windows (SmartScreen):** on the "Windows protected your PC" prompt, click
  **More info → Run anyway**.

**Auto-updates are still integrity-verified.** Although the OS bundles are not
code-signed, the auto-updater verifies every downloaded update against a free
[minisign](https://jedisct1.github.io/minisign/) (Ed25519) signature whose
public key is embedded in the app. This is a separate mechanism from OS code-
signing: dropping paid code-signing does **not** weaken update integrity — a
tampered or corrupted update is rejected before it is installed.

## ⚙️ Configuration & Auth

The application supports local user authentication backed by a file-based user
store (`users.json`). Passwords are hashed with **Argon2id**; legacy bcrypt
hashes from older builds are still verified and transparently re-hashed to
Argon2id on the next successful login.

**Example `users.json` structure:**

```json
[
  {
    "username": "admin",
    "passwordHash": "$argon2id$v=19$m=19456,t=2,p=1$...",
    "role": "admin"
  }
]
```

By default the store lives at `users.json` under the app-data directory; set
`USER_STORE_PATH` (see below) to relocate it.

## 🌐 REST API (opt-in, off by default)

sortOfRemoteNG ships an embedded REST API for **remote control and automation**
of the connection manager (open/list sessions, run curated operations, query
status). It is a control surface for your own devices, so it is treated
accordingly:

- **Off by default.** The API server does **not** run until you enable it in
  **Settings → API** (or via the environment, below). Nothing is exposed on a
  fresh install.
- **Loopback-only unless you opt in.** When enabled it binds `127.0.0.1` only.
  It binds a routable address (`0.0.0.0`) **only** when you explicitly turn on
  *Allow remote connections*.
- **Authentication is forced when remote.** With *Allow remote connections* on,
  authentication cannot be turned off — the server refuses to start without a
  resolvable API key (fail-closed).

### Authentication

Every route requires authentication **except** `GET /health` (liveness probe)
and `POST /auth/login`. A request authenticates with **either**:

- `X-API-Key: <key>` — a static key for external callers / automation, or
- `Authorization: Bearer <jwt>` — a short-lived token from an interactive login.

`POST /auth/login` takes a username/password from the user store and returns a
short-lived **HS256 JWT**:

```json
{ "token": "<jwt>", "expires_at": "2026-07-12T14:30:00Z", "role": "admin" }
```

- `POST /auth/logout` revokes the presented token.
- `GET  /auth/whoami` echoes the authenticated principal and role (diagnostics).

**Roles:** `admin` has full access; `readonly` may call read/status routes but
mutating requests are rejected. The role is carried as a claim in the JWT.

### Configuration & environment variables

Settings you configure in **Settings → API** are the source of truth. The
following environment variables **override** the stored settings when present —
useful for headless/automation deployments and first-run bootstrap:

- `API_KEY` — static bearer key accepted via `X-API-Key` for external callers.
- `JWT_SECRET` — HS256 signing secret for issued tokens (must be ≥ 256-bit /
  32 bytes). **Auto-generated on first enable if unset.**
- `USER_STORE_PATH` — path to the `users.json` auth store (default:
  `users.json` under the app-data directory).

**Precedence:** stored Settings JSON is the baseline; a present environment
variable overrides it; if neither supplies a secret, the API key and
`JWT_SECRET` are **auto-generated on first enable** so the server never comes up
with an empty credential.

### TLS

TLS is governed by the SSL settings in **Settings → API**:

- **Manual** — supply certificate and private-key file paths.
- **Self-signed** — a certificate is auto-generated (clearly labeled as
  self-signed; browsers/clients will warn on the untrusted chain).
- **Let's Encrypt** — scaffolded but host-gated and currently **deferred**; live
  ACME issuance is not enabled in this release. Use manual or self-signed for
  now.

### Rate limiting & CORS

Request rate limiting (per client, `0` = off) and CORS are configurable in
**Settings → API**. Rate limiting plus account lockout also defend
`POST /auth/login` against brute force.

### Security note

The API never returns stored credentials, private keys, or secrets from any
endpoint — there is no credential-read or export route by design. Audit logs
record request metadata (method, path, principal, client IP, status, latency)
with secrets and credential-bearing bodies redacted; the API key and JWTs are
never logged.

## 🤝 Contributing

Contributions are welcome! Please ensure you run tests and linting before submitting a PR.

```bash
# Run tests
npm test

# Lint code
npm run lint
```

For end-to-end coverage, the repository now uses a tiered model instead of
trying to gate every environment-sensitive test on every change. The required
PR gate is a narrow Docker-backed SSH/SFTP smoke suite; broader Docker, WDIO,
and specialty integration coverage stays opt-in, nightly, or lab-only.

See [`docs/testing/e2e-runbook.md`](docs/testing/e2e-runbook.md) for the
current E2E tiers, local commands, and CI expectations.

## 📄 License

Distributed under the MIT License. See [license.md](license.md) for details.
