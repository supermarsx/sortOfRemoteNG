---
title: Security
eyebrow: Project guide
description: Understand sortOfRemoteNG’s trust boundaries, secret handling, transport defaults, update verification, and disclosure path.
permalink: /security-overview/
---

sortOfRemoteNG handles credentials and opens privileged remote sessions. Security therefore depends on more than encryption: transport verification, constrained IPC, safe diagnostics, release signatures, and explicit user decisions all form part of the boundary.

## Core expectations

| Area              | Default posture                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Secrets at rest   | Authenticated encryption with password-derived or OS-vault-backed key handling                           |
| Live secrets      | Kept out of general renderer state and logs where the backend contract permits                           |
| TLS               | Certificate chain and hostname verification enabled; insecure exceptions are explicit and per connection |
| Remote host trust | Host or certificate changes require a visible trust decision rather than silent downgrade                |
| Tauri IPC         | Commands accept validated, typed inputs and delegate privileged work to Rust                             |
| REST automation   | Disabled by default and loopback-oriented unless remote access is deliberately configured                |
| Updates           | Bundles must pass the updater’s pinned Ed25519/minisign verification                                     |

## At-rest threat model

The encryption design primarily protects against offline access to application data and backups. It does not protect plaintext already available to an attacker controlling the unlocked process or operating system account.

Read [Encryption at rest]({{ '/security/encryption-at-rest/' | relative_url }}) before changing the vault, artifact codecs, backup behavior, recordings, or key lifecycle. That document defines envelope formats, tamper expectations, unlock behavior, and explicit out-of-scope attackers.

## Operational hygiene

- Prefer references to saved credentials over copying secret values through UI components.
- Never include passwords, tokens, private keys, raw VPN configuration, or unredacted connection exports in an issue.
- Treat screenshots as data exports; inspect every visible hostname, username, tab, notification, and log line.
- Keep TLS and host verification enabled. If a lab exception is necessary, scope it to one connection and document why.
- Review credential inclusion before import, export, or database clone operations.
- Remove sensitive test fixtures after use and keep them outside version control.

## Updates and releases

The public key embedded in the application verifies updater artifacts. The corresponding private key belongs in the release secret store, never in the repository. Key rotation requires a bridge strategy because already-installed clients only trust keys shipped in builds they can verify.

See [Updater signing and feed setup]({{ '/release/updater-setup/' | relative_url }}) and [Releases]({{ '/releases/' | relative_url }}) for the operational flow.

## Report a vulnerability

Do not open a public issue containing exploit details or secrets. Follow the repository’s [security policy on GitHub](https://github.com/supermarsx/sortOfRemoteNG/blob/main/security.md) for the current private reporting channel, supported-version statement, and disclosure expectations.

For route-specific data handling, see [Network Paths]({{ '/network-paths/' | relative_url }}). For automation context and script validation, see [Behaviors]({{ '/behaviors/' | relative_url }}).
