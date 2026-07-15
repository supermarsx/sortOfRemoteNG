---
title: Protocols
eyebrow: Use the app
description: A source-backed map of integrated session clients, context-dependent tools, partial implementations, and protocol scaffolding.
permalink: /protocols/
---

## How to read this matrix

<p>
  <span class="pill pill--ready">Integrated</span>
  means the saved connection reaches a dedicated frontend/runtime path.
  <span class="pill pill--partial">Partial</span>
  means useful implementation exists but the complete product flow is not wired or proven.
  <span class="pill pill--scaffold">Scaffold</span>
  means types or backend modules exist without a complete registered, interactive session path.
</p>

The matrix is intentionally conservative. Repository breadth includes protocol crates, management tools, import mappings, and integration panels; those are not all equivalent to a finished connection client.

## Primary session paths

| Surface               | Status                                           | Current product path                                                                                                                          |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| RDP                   | <span class="pill pill--ready">Integrated</span> | Dedicated RDP client, connection lifecycle, rendering/input pipeline, diagnostics, gateway/TCP options, and optional SSH-bastion Network Path |
| SSH                   | <span class="pill pill--ready">Integrated</span> | Web terminal backed by the SSH runtime, authentication/trust controls, terminal overrides, and the full supported Network Path matrix         |
| HTTP / HTTPS          | <span class="pill pill--ready">Integrated</span> | Embedded web session with navigation, TLS/trust handling, basic/custom-header authentication, bookmarks, and optional auto-login selectors    |
| VNC                   | <span class="pill pill--ready">Integrated</span> | Dedicated VNC client component and backend command surface                                                                                    |
| SFTP                  | <span class="pill pill--ready">Integrated</span> | Dedicated file-transfer session component; use this instead of assuming FTP/SCP direct tabs are complete                                      |
| AnyDesk / RustDesk    | <span class="pill pill--partial">Partial</span>  | Dedicated viewer components exist, but availability and external-runtime requirements vary by platform and setup                              |
| Telnet                | <span class="pill pill--partial">Partial</span>  | Telnet backend and terminal presentation exist; validate the current connection lifecycle against the target before depending on it           |
| FTP / SCP direct tabs | <span class="pill pill--partial">Partial</span>  | The session manager explicitly blocks direct frontend sessions and points users to SFTP until clients are wired                               |

## Explicit scaffolds and partial management surfaces

| Surface               | Status                                               | What is actually present                                                                                                                                       |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLogin                | <span class="pill pill--scaffold">Scaffold</span>    | Saved type, import mappings, terminal presentation, and a basic backend service exist; command registration is disabled and command sending is not implemented |
| RAW socket            | <span class="pill pill--scaffold">Scaffold</span>    | A basic backend module exists, but commands are unregistered, data sending is not implemented, and RAW is not a normal saved connection protocol               |
| PowerShell Remoting   | <span class="pill pill--partial">Partial</span>      | A substantial Rust WinRM/PowerShell command surface and typed frontend hook exist, but there is no complete end-user remoting session UI consuming that hook   |
| WinRM / Windows tools | <span class="pill pill--partial">Context tool</span> | Connection-scoped Windows management panels use WinRM/WMI settings; this is not the same as a full interactive PowerShell Remoting terminal                    |

<div class="callout callout--danger">
  <strong>Do not infer support from import compatibility.</strong>
  <p>Importers preserve recognizable protocol identity where possible. Vendor RAW entries may map to Telnet metadata. PowerShell conversion is currently path-dependent: the frontend import path maps PowerShell entries to SSH, while the Rust mRemoteNG converter maps PowerShell entries to WinRM. These compatibility conversions do not create a native RAW client, and neither PowerShell mapping creates a complete end-user PowerShell Remoting session.</p>
</div>

## Cloud and integration entries

Cloud connection types and `integration:*` descriptors open provider- or service-specific panels. They may use SSH, HTTPS, vendor APIs, or connection-scoped tools underneath, but they should be evaluated by their panel contract rather than counted as interchangeable terminal protocols.

## Choosing a path

- Use **RDP** for interactive desktop sessions and review the final SSH-bastion requirement when adding socket hops.
- Use **SSH** for terminal sessions and the broadest supported per-connection Network Path combinations.
- Use **SFTP** for the supported direct file-transfer session surface.
- Use **HTTPS** for managed web interfaces where trust and auto-login behavior are understood.
- Treat **RLogin**, **RAW**, and **PowerShell Remoting** according to the limitations above until their full product paths are registered and tested.

For routing compatibility, continue to [Network Paths]({{ '/network-paths/' | relative_url }}). For source boundaries and backend layering, see [Architecture]({{ '/architecture/' | relative_url }}).
