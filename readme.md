# sortOfRemoteNG

[![CI Status](https://img.shields.io/github/actions/workflow/status/supermarsx/sortOfRemoteNG/ci.yml?label=CI&logo=github)](https://github.com/supermarsx/sortOfRemoteNG/actions)
[![Coverage](https://img.shields.io/badge/coverage-34.73%25-red)](https://github.com/supermarsx/sortOfRemoteNG/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/supermarsx/sortOfRemoteNG/total)](https://github.com/supermarsx/sortOfRemoteNG/releases)
[![Stars](https://img.shields.io/github/stars/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/stargazers)
[![Forks](https://img.shields.io/github/forks/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/network/members)
[![Watchers](https://img.shields.io/github/watchers/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/watchers)
[![Open Issues](https://img.shields.io/github/issues/supermarsx/sortOfRemoteNG)](https://github.com/supermarsx/sortOfRemoteNG/issues)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/supermarsx/sortOfRemoteNG)](https://github.com/supermarsx/sortOfRemoteNG/commits)
[![License](https://img.shields.io/github/license/supermarsx/sortOfRemoteNG)](license.md)

A comprehensive remote connectivity and management desktop application built with Tauri and Rust. This application provides a unified interface for managing various types of remote connections including SSH, RDP, VNC, databases, FTP, and network services.

## Features

- **Multi-protocol remote connectivity**: SSH, RDP, VNC, databases, FTP
- **Secure credential storage** with encryption
- **Connection chaining** and proxy routing
- **Network discovery** and scanning
- **User authentication** and access control
- **File transfer** capabilities
- **Script execution** and automation
- **VPN management** (OpenVPN, WireGuard, ZeroTier, Tailscale)
- **Cross-platform** desktop application (Windows, macOS, Linux)

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://rustup.rs/) (latest stable)
- For Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- For macOS: Xcode Command Line Tools
- For Linux: GCC and development libraries

### Install Dependencies

```bash
npm install
```

### Development

To run the application in development mode:

```bash
npm run tauri:dev
```

This will start the Vite development server and launch the Tauri application.

### Building

To build the application for production:

```bash
npm run tauri:build
```

This will create platform-specific installers in `src-tauri/target/release/bundle/`.

## Testing

To run the unit tests:

```bash
npm test
```

## Linting

To check code style:

```bash
npm run lint
```

All code should pass ESLint before committing.

## Language Switching

The interface is translated into multiple languages. Use the language selector in the top bar or the settings dialog to switch between English, Spanish, French, German and Portuguese (Portugal). Translation files are loaded on demand to keep the initial bundle small.

## Authentication

The application uses a secure user store with bcrypt-hashed passwords and JWT tokens for API authentication.

1. Users are defined in a JSON file (`users.json` by default) containing objects with `username` and `passwordHash` fields:

   ```json
   [{ "username": "admin", "passwordHash": "<bcrypt-hash>" }]
   ```

   Generate hashes with:

   ```bash
   node -e "require('bcryptjs').hash('password',10).then(console.log)"
   ```

2. Authentication is handled through the Tauri backend with secure token management.

3. An API key can be supplied via the `X-API-Key` header.

Environment variables:

- `API_KEY` – optional API key (defaults to none).
- `JWT_SECRET` – secret for signing JWTs (defaults to `defaultsecret`).
- `USER_STORE_PATH` – path to the users file (defaults to `users.json`).
- `USER_STORE_SECRET` – passphrase used to encrypt the user store with AES-GCM.
  Plaintext stores are automatically migrated on first load when this is set.
- `PBKDF2_ITERATIONS` – overrides key derivation iterations (defaults to `150000`).

## Appearance

The interface supports selectable color schemes (blue, green, purple, red, orange and teal). Use the settings dialog to choose your preferred scheme.

## Data Storage and Migration

sortOfRemoteNG now stores all persistent data in IndexedDB. When the application
starts, it checks for any `mremote-` keys in `localStorage` and moves them into
IndexedDB. After migration these keys are removed from `localStorage`.
Ensure your browser supports IndexedDB so settings and collections can be
preserved across sessions.

## Script Engine

The application features a powerful, sandboxed script execution engine powered by **Tauri** and **QuickJS** (via `rquickjs`) on the Rust backend. This architecture ensures high performance and improved security by isolating script execution from the main UI thread.

Supported features:
- **JavaScript Execution**: Run custom automation scripts directly in the backend.
- **TypeScript Support**: TypeScript is automatically transpiled before execution.
- **Context Awareness**: Scripts have access to connection and session details.
- **Safe API**: A restricted set of APIs (HTTP, SSH, Logging) is exposed to scripts.

### Aborting Scripts

Custom scripts executed through the `ScriptEngine` can be cancelled using an
`AbortSignal`. Create an `AbortController` and pass its signal to
`executeScript`. Any pending `http`, `ssh`, or `sleep` calls will reject with an
`AbortError` when the signal is triggered:

```ts
const controller = new AbortController();
const promise = engine.executeScript(script, context, controller.signal);
controller.abort(); // script stops immediately
```

This allows external callers to stop long running scripts and network requests
cleanly.

## License

Distributed under the MIT License. See [license.md](license.md) for details.
