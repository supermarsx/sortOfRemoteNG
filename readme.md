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
- **Remote Desktop**: RDP, VNC, and RustDesk integration (RustDesk backend wired; final invoke-handler registration lands with the wiring aggregator).
- **Shell & Terminal**: Full-featured SSH client and Web Terminal.
- **File Transfer**: FTP and SFTP (backend implemented; invoke-handler registration in progress). SMB/CIFS support is transitioning from a placeholder UI to a real `pavao`-backed Rust crate — treat as beta until the aggregator lands.
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
- **Access Control**: User authentication system with bcrypt password hashing.

### 🚀 Advanced Capabilities
- **Script Engine**: Automate tasks using a sandboxed TypeScript/JavaScript engine powered by `rquickjs` (frontend wiring is being re-enabled; track via `sorng-ssh`'s `script-engine` feature).
- **VPN Management**: Integrations for OpenVPN, WireGuard, ZeroTier, and Tailscale. IKEv2, IPsec, SSTP, L2TP, and PPTP ship behind a native Rust VPN crate; SoftEther support is in progress.
- **AI Agent**: Chat, agentic workflows, and code-assist dispatch through real LLM providers (OpenAI, Anthropic, Google, Ollama, local). Provider wiring is being finalised — configure providers in-app before use.
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

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
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
    Start the Vite dev server and the Tauri application window:
    ```bash
    npm run tauri:dev
    ```

### Building for Production

Create an optimized executable/installer for your current OS:

```bash
npm run tauri:build
```
Artifacts will be generated in `src-tauri/target/release/bundle/`.

## ⚙️ Configuration & Auth

The application supports local user authentication. By default, it looks for a `users.json` file.

**Example `users.json` structure:**
```json
[
  { 
    "username": "admin", 
    "passwordHash": "$2a$10$..." 
  }
]
```
*Note: Passwords must be bcrypt hashes.*

Environment variables for advanced configuration:
- `API_KEY`: Optional API key for external access.
- `JWT_SECRET`: Secret for signing internal tokens.
- `USER_STORE_PATH`: Custom path to `users.json`.

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