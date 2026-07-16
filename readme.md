# sortOfRemoteNG

[![CI](https://img.shields.io/github/actions/workflow/status/supermarsx/sortOfRemoteNG/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-26.1-2563eb?style=flat-square)](version.json)
[![Downloads](https://img.shields.io/github/downloads/supermarsx/sortOfRemoteNG/total?style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG/releases)
[![Stars](https://img.shields.io/github/stars/supermarsx/sortOfRemoteNG?style=flat-square)](https://github.com/supermarsx/sortOfRemoteNG)
[![License](https://img.shields.io/github/license/supermarsx/sortOfRemoteNG?style=flat-square)](license.md)

A desktop workspace for remote connections, infrastructure tools, and day-to-day administration. sortOfRemoteNG combines a Tauri and Rust backend with a Next.js and React interface, so connections and supporting tools can live in one organized application.

[![sortOfRemoteNG showing a Prototype SSH session](docs/assets/readme-screenshot.png)](docs/assets/readme-screenshot.png)

_The real application running the seeded Prototype SSH connection._

## Contents

- [Overview](#overview)
- [What works today](#what-works-today)
- [Quick start](#quick-start)
- [Security](#security)
- [Releases](#releases)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Overview

sortOfRemoteNG is built for people who manage more than one machine or service and want a single place to:

- save, group, tag, search, import, and export connection definitions;
- open remote sessions in tabs, layouts, or detached windows;
- keep connection-specific settings and credentials together;
- use diagnostics, discovery, Wake-on-LAN, recordings, scripts, and administration tools without switching applications; and
- automate session and window lifecycle events with per-connection behavior rules.

The project is under active development. Features that depend on an external service, native client, VPN provider, or host package still require that dependency to be installed and configured.

## What works today

| Area            | Current capability                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote sessions | Embedded SSH, RDP, ARD, PowerShell Remoting, Telnet, Raw Socket, RLogin, Serial, HTTP/HTTPS, MySQL, and SMB clients; constrained VNC; installed-client handoffs for AnyDesk and RustDesk |
| Files           | Native SFTP, passive FTP/FTPS, and SCP sessions with saved authentication, directory browsing, and direct file operations                                                                |
| Workspace       | Collections, folders, tags, favorites, tab groups, tiled layouts, detached windows, and connection search                                                                                |
| Portability     | Guided import, export, and connection cloning workflows, including mRemoteNG-oriented migration support                                                                                  |
| Operations      | Network discovery, connection diagnostics, Wake-on-LAN, status checks, SSH utilities, and Windows management panels                                                                      |
| Automation      | Saved scripts, macros, recordings, reconnect policies, notifications, and connection behavior rules                                                                                      |
| Extensibility   | Integration panels, optional AI providers, and an opt-in local REST API for controlled automation                                                                                        |

### Capability boundaries

The saved-session matrix is source-backed and tested, but “supported” still has a precise meaning:

- **Raw Socket**, **RLogin**, **PowerShell Remoting**, **ARD**, **Telnet**, and **Serial** now have dedicated interactive clients. Raw Socket supplies exact binary TCP/UDP payload I/O rather than a shell; Telnet and RLogin are plaintext; and Serial depends on a local device, its driver, and operating-system permissions.
- Embedded **ARD** uses a remote Mac account or dedicated VNC password. Apple Account mode is a macOS-only handoff to Screen Sharing.app; sortOfRemoteNG does not collect or send the Apple Account password.
- **FTP/FTPS**, **SFTP**, **SCP**, **MySQL/MariaDB**, and **SMB** connect from saved settings before their file or query surfaces load. FTP and SCP currently support direct targets only; the current MySQL backend is process-wide, so independent concurrent MySQL tabs are not yet isolated.
- **VNC** requires a WebSocket-capable endpoint or trusted WebSocket proxy because the app does not provide a raw-TCP RFB bridge.
- **AnyDesk** and **RustDesk** are installed-client handoffs. The app launches and monitors the native client; it does not embed either product's framebuffer.
- **FTP/FTPS** supports passive PASV/EPSV sessions; active mode, routes, queue execution, resume, and live progress are not exposed. **SCP** enforces its host-key policy and known_hosts path, while routes, interactive host-key prompts, cancellation/progress, resume, and agent authentication remain unavailable. Both fail closed for configured proxy/VPN/tunnel routes.
- Automated tests verify application contracts and local simulated transports. A real connection still requires a reachable target, valid credentials, and any applicable native client, driver, or server configuration.
- An entry in an import format, backend crate, or settings screen does not by itself prove a complete session path. The maintained [protocol matrix](docs/protocols.md) is the authority.

These boundaries are intentional: this page describes usable application paths, not every protocol or experimental module present in the source tree.

## Quick start

### Install a published release

Published installers and application bundles appear on [GitHub Releases](https://github.com/supermarsx/sortOfRemoteNG/releases). If a bundle is available for your platform, download it, launch the application, and create or import your first connection. If no bundle has been published for the current source version, use the source workflow below.

Public bundles are unsigned at the operating-system level by default. Windows SmartScreen or macOS Gatekeeper may therefore show an unknown-publisher warning on first launch. Update downloads are separately verified against the updater key embedded in the application.

### Run from source

You need Node.js 18 or newer, the Rust toolchain pinned by [rust-toolchain.toml](rust-toolchain.toml), and your platform's Tauri build dependencies. Node.js 20 LTS is recommended because it matches CI. Windows builds require the MSVC host toolchain.

```bash
git clone https://github.com/supermarsx/sortOfRemoteNG.git
cd sortOfRemoteNG
npm install
npm run tauri:dev
```

Build an installer or application bundle for the current platform with:

```bash
npm run tauri:build
```

Build output is written under `src-tauri/target/release/bundle/`. See the [contributing guide](contributing.md) for platform packages, the Windows MSVC setup, tests, linting, and the Rust workspace commands.

## Security

sortOfRemoteNG handles credentials and privileged remote operations, so its security controls and current limitations should both be explicit:

- connection storage supports authenticated encryption at rest and refuses a plaintext downgrade after encrypted production state is installed, but application settings can remain in plaintext until encryption is initialized and unlocked;
- password-based unlock uses Argon2id, while supported systems can use the OS credential vault;
- TLS certificate and hostname verification are enabled by default, but users can override trust verification globally or per connection, and warning/acceptance UX is not universal;
- privileged work crosses a validated Tauri IPC boundary into Rust;
- the REST API is off by default and binds to loopback unless remote access is deliberately enabled; and
- application updates require a valid Ed25519/minisign signature from the key pinned in the app.

Read the [security policy](security.md) for vulnerability reporting and the [encryption design](docs/security.md) for the at-rest threat model. Never publish credentials, private keys, tokens, or unredacted logs in an issue.

## Releases

Public releases use the rolling `YY.N` format:

- `YY` is the two-digit release year.
- `N` is that year's release sequence, starting at 1.
- The current source version is **26.1**.

Package managers and native manifests use the machine-readable SemVer projection `26.1.0`, while the application and release title show `26.1`. The root [version.json](version.json) file is the source of truth, and CI verifies that every projection remains synchronized.

The release workflow builds bundles for Windows, macOS, and Linux. See the [release guide](docs/releases.md) for the publication path and the [updater setup](docs/release/updater-setup.md) for signature and feed details.

## Documentation

- [Documentation home](docs/index.md) and [getting started](docs/getting-started.md)
- [Connections and editor](docs/connections-editor.md), [protocol status](docs/protocols.md), [network paths](docs/network-paths.md), [behaviors](docs/behaviors.md), and [import, export, and clone](docs/import-export-clone.md)
- [Architecture](docs/architecture.md), [security](docs/security-overview.md), [testing](docs/testing.md), [releases](docs/releases.md), and [contributing](docs/contributing.md)
- [Vulnerability reporting policy](security.md), [encryption-at-rest design](docs/security.md), and [license](license.md)

## Contributing

Issues, focused fixes, tests, documentation improvements, and well-scoped features are welcome. Before opening a pull request, run the checks that apply to your change:

```bash
npm test
npm run lint
npm run format
```

The required Docker-backed SSH/SFTP smoke commands and Rust workspace checks are documented in [contributing.md](contributing.md). Report security issues through the private process in [security.md](security.md), not through a public issue.

## License

sortOfRemoteNG is available under the [MIT License](license.md).
