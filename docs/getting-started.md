---
title: Getting started
eyebrow: Start here
description: Prepare a development environment, run the desktop stack, and save a first connection without guessing at the repository’s entry points.
permalink: /getting-started/
---

## What you need

- **Node.js 20** for the frontend and repository scripts. CI uses Node 20.
- **npm** with the committed lockfile; use `npm ci` for a reproducible install.
- **Rust stable** for Tauri and backend crates.
- Platform build dependencies required by Tauri. Windows contributors should use the MSVC Rust host rather than GNU.

Some protocol features need additional native tools or services. The default web development loop does not prove every Rust feature or live remote endpoint.

## Run the frontend

```powershell
npm ci
npm run dev
```

The development script owns the local Next.js startup contract. Use its output rather than assuming a fixed port when another process already occupies the default.

## Run the desktop app

```powershell
npm run tauri:dev
```

This starts the Tauri development path with the repository’s development feature selection. A production build exercises a larger native surface and should be treated as a separate gate.

## Create a first connection

<ol class="steps">
  <li><strong>Open the connection editor.</strong> Create a connection rather than a folder and choose a protocol that has a session path you can test.</li>
  <li><strong>Enter the target.</strong> Give it a useful name, hostname or IP address, port, and the protocol-specific authentication fields.</li>
  <li><strong>Review Protocol settings.</strong> RDP and SSH expose dedicated subtabs; SSH and RDP also expose the per-connection Network Path editor.</li>
  <li><strong>Organize before saving.</strong> Pick a parent folder, tags, icon, and optional color so the entry remains discoverable.</li>
  <li><strong>Save, reopen, then connect.</strong> Reopening is the quickest check that IDs and per-connection settings persisted as intended.</li>
</ol>

Continue with [Connections & Editor]({{ '/connections-editor/' | relative_url }}) for the complete editor model or [Protocols]({{ '/protocols/' | relative_url }}) before choosing a less common client.

## Fast checks before a change

```powershell
npx.cmd tsc --noEmit --pretty false
npm run test -- --run
npm run format
git diff --check
```

Use narrower tests while iterating, then expand validation in proportion to the change. Native protocol changes also need the relevant Cargo package or feature gate; see [Testing]({{ '/testing/' | relative_url }}).

## Common boundaries

<div class="callout callout--warning">
  <strong>A visible control is not proof of a complete runtime.</strong>
  <p>Check the protocol matrix, session routing, backend command registration, and focused tests before relying on a less common protocol in production.</p>
</div>

- A frontend-only run cannot validate Tauri commands.
- A successful compile cannot validate credentials or a live remote service.
- Import previews should be reviewed before applying data.
- Credentials and private key material should not be pasted into logs, issues, screenshots, or test snapshots.
