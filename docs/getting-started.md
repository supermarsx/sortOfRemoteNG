---
title: Getting started
eyebrow: Start here
description: Install the desktop app, choose a database, and make your first connection. No development tools required.
permalink: /getting-started/
mermaid: true
---

## Install the app

Open [Downloads & updates]({{ '/releases/' | relative_url }}) and choose the operating system, processor, and package for the computer where you will install sortOfRemoteNG. Browser detection is only a suggestion; you can change every choice.

- **Windows:** run the `.exe` or `.msi` installer. For installer-free delivery, extract the complete portable ZIP before starting the app.
- **macOS:** choose ARM64 for Apple silicon or x64 for Intel, open the `.dmg`, and install the app.
- **Linux:** choose an AppImage or the local `.deb`, `.rpm`, or `.flatpak` package appropriate for your distribution. The download page explains the differences.

You do not need Node.js, Rust, or this repository to use a published desktop release. Keep the download's processor and package format consistent when updating.

## Set up your workspace

Open the app and create or open a connection database. A database holds saved connections; it is not a remote database server. Give it a name you will recognize, especially if you separate personal, work, or test systems.

Review [Security & your data]({{ '/security-overview/' | relative_url }}) before choosing protection. Global native artifact encryption and an individual database's inner protection are different layers. Configuring a key alone does not prove that every existing file has been encrypted; use the inspected artifact status in Security settings.

<figure class="diagram-frame">
<pre class="mermaid">
flowchart LR
  A[Install desktop app] --> B[Create or open a database]
  B --> C[Save a connection]
  C --> D[Review the remote identity]
  D --> E[Start a session]
</pre>
<figcaption>First use: install the app, choose where connections are saved, then review the destination before connecting.</figcaption>
</figure>

## Create a first connection

<ol class="steps">
  <li><strong>Open the connection editor.</strong> Create a connection rather than a folder and choose the protocol your remote system supports.</li>
  <li><strong>Enter the target.</strong> Give it a useful name, hostname or IP address, port, and the protocol-specific authentication fields.</li>
  <li><strong>Review Protocol settings.</strong> RDP and SSH expose dedicated subtabs; SSH and RDP also expose the per-connection Network Path editor.</li>
  <li><strong>Organize before saving.</strong> Pick a parent folder, tags, icon, and optional color so the entry remains discoverable.</li>
  <li><strong>Save, then connect.</strong> Review any host-key or certificate prompt against a fingerprint obtained through a trusted channel. A reachable endpoint is not by itself a trusted identity.</li>
</ol>

Continue with [Connections & Editor]({{ '/connections-editor/' | relative_url }}) for editor details or [Protocols]({{ '/protocols/' | relative_url }}) for protocol-specific requirements and limitations.

## Bring existing connections with you

Use [Import & export]({{ '/import-export-clone/' | relative_url }}) to review supported formats and preview incoming records. Keep an independent backup before a large import or a protection change. Do not put credentials, private keys, or recovery material in screenshots or support reports.

## If a connection does not open

Check the hostname, port, credentials, and selected protocol first. If the destination requires a proxy, VPN, or jump host, review [Network paths]({{ '/network-paths/' | relative_url }}). A successful network diagnostic does not necessarily mean that application authentication or identity verification has succeeded.

Features also depend on the native components included in your build. Preserve the error text without secrets when reporting a problem; do not disable identity verification just to dismiss a warning.

## For developers

The following instructions are for changing the app, not installing it.

<details class="developer-notes" markdown="1">
<summary>Build and run from source</summary>

### What you need

- **Node.js** matching the repository's `.node-version` for the frontend and repository scripts. CI reads that file too.
- **npm** with the committed lockfile; use `npm ci` for a reproducible install.
- **Rust stable** for Tauri and backend crates.
- Platform build dependencies required by Tauri. Windows contributors should use the MSVC Rust host rather than GNU.

Some protocol features need additional native tools or services. The default web development loop does not prove every Rust feature or live remote endpoint.

### Run the frontend

```powershell
npm ci
npm run dev
```

The development script owns the local Next.js startup contract. Use its output rather than assuming a fixed port when another process already occupies the default.

### Run the desktop app

```powershell
npm run tauri:dev
```

This starts the Tauri development path with the repository’s development feature selection. A production build exercises a larger native surface and should be treated as a separate gate.

### Fast checks before a change

```powershell
npx.cmd tsc --noEmit --pretty false
npm run test -- --run
npm run format
git diff --check
```

Use narrower tests while iterating, then expand validation in proportion to the change. Native protocol changes also need the relevant Cargo package or feature gate; see [Testing]({{ '/testing/' | relative_url }}).

### Common boundaries

<div class="callout callout--warning">
  <strong>A visible control is not proof of a complete runtime.</strong>
  <p>Check the protocol matrix, session routing, backend command registration, and focused tests before relying on a less common protocol in production.</p>
</div>

- A frontend-only run cannot validate Tauri commands.
- A successful compile cannot validate credentials or a live remote service.
- Import previews should be reviewed before applying data.
- Credentials and private key material should not be pasted into logs, issues, screenshots, or test snapshots.

</details>
