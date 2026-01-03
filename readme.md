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
- **Remote Desktop**: RDP, VNC, and **RustDesk** integration.
- **Shell & Terminal**: Full-featured SSH client and Web Terminal.
- **File Transfer**: FTP, SFTP, and **SMB/CIFS** support.
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
- **Script Engine**: Automate tasks using a sandboxed TypeScript/JavaScript engine powered by `rquickjs`.
- **VPN Management**: Integrations for OpenVPN, WireGuard, ZeroTier, and Tailscale.
- **Connection Chaining**: Route connections through proxies or other hosts.
- **Customization**: Themed interface with flexible tab layouts and tagging.

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

## 📄 License

Distributed under the MIT License. See [license.md](license.md) for details.