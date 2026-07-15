---
title: Remote work, one clear workspace
eyebrow: sortOfRemoteNG documentation
description: Learn how connections, protocol clients, network paths, automations, import tools, and the desktop runtime fit together.
permalink: /
---

sortOfRemoteNG is a cross-platform desktop workspace for organizing remote systems and opening protocol-aware sessions. The interface combines a searchable connection tree, a per-connection editor, detachable sessions, Windows management tools, secure storage boundaries, and a broad set of operational integrations.

<div class="callout">
  <strong>Documentation promise</strong>
  <p>These pages distinguish shipping session paths from partial or scaffolded surfaces. A type, crate, or importer mapping by itself is not presented as a complete end-user protocol.</p>
</div>

## Choose a route

<div class="link-grid">
  <a class="link-card" href="{{ '/getting-started/' | relative_url }}">
    <strong>Start locally</strong>
    <span>Install prerequisites, run the app, and create a first saved connection.</span>
  </a>
  <a class="link-card" href="{{ '/connections-editor/' | relative_url }}">
    <strong>Shape your workspace</strong>
    <span>Understand folders, editor tabs, searchable settings, tags, and saved values.</span>
  </a>
  <a class="link-card" href="{{ '/protocols/' | relative_url }}">
    <strong>Check protocol status</strong>
    <span>See which paths are integrated, partial, or still scaffolding.</span>
  </a>
  <a class="link-card" href="{{ '/network-paths/' | relative_url }}">
    <strong>Route through layers</strong>
    <span>Compose VPN, proxy, tunnel, and SSH-hop sources deterministically.</span>
  </a>
  <a class="link-card" href="{{ '/behaviors/' | relative_url }}">
    <strong>Automate lifecycle events</strong>
    <span>Run ordered, validated actions when sessions connect, fail, reconnect, or close.</span>
  </a>
  <a class="link-card" href="{{ '/import-export-clone/' | relative_url }}">
    <strong>Move existing data</strong>
    <span>Review native and vendor import compatibility before applying changes.</span>
  </a>
</div>

## Mental model

<div class="feature-grid">
  <div class="feature-card">
    <strong>Connections are durable configuration</strong>
    <p>Saved records hold protocol settings, organization metadata, optional network-path references, and behavior rules.</p>
  </div>
  <div class="feature-card">
    <strong>Sessions are runtime state</strong>
    <p>Opening a connection creates a session tab or tool surface. Detached windows retain only the minimum safe dependency snapshot.</p>
  </div>
  <div class="feature-card">
    <strong>Backends own privileged work</strong>
    <p>Tauri commands cross into Rust crates for networking, storage, platform APIs, and protocol engines.</p>
  </div>
  <div class="feature-card">
    <strong>Validation should fail closed</strong>
    <p>Unsupported path layers, missing references, unsafe release metadata, and broken docs links are intended to stop at explicit gates.</p>
  </div>
</div>

## Project depth

The main guides stay task-oriented. For implementation details, continue to [Architecture]({{ '/architecture/' | relative_url }}), [Security]({{ '/security-overview/' | relative_url }}), [Testing]({{ '/testing/' | relative_url }}), or [Releases]({{ '/releases/' | relative_url }}). Detailed lowercase documents remain linked from those hubs instead of being duplicated.
