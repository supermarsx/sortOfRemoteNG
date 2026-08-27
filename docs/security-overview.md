---
title: Security
eyebrow: Project guide
description: Understand sortOfRemoteNG’s trust boundaries, secret handling, transport defaults, update verification, and disclosure path.
permalink: /security-overview/
---

sortOfRemoteNG handles credentials and opens privileged remote sessions. Security therefore depends on more than encryption: transport verification, constrained IPC, safe diagnostics, release signatures, and explicit user decisions all form part of the boundary.

## Core expectations

| Area              | Default posture                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets at rest   | Authenticated encryption with password-derived or OS-vault-backed key handling                                                                       |
| Live secrets      | Kept out of general renderer state and logs where the backend contract permits                                                                       |
| TLS               | Certificate chain and hostname verification enabled; insecure exceptions are explicit and per connection                                             |
| Remote host trust | Host or certificate changes require a visible trust decision rather than silent downgrade, and the decision is stored with the database that made it |
| Tauri IPC         | Commands accept validated, typed inputs and delegate privileged work to Rust                                                                         |
| REST automation   | Disabled by default and loopback-oriented unless remote access is deliberately configured                                                            |
| Updates           | Bundles must pass the updater’s pinned Ed25519/minisign verification                                                                                 |

## Trust decisions are database state

Every host key and server certificate you approve is a Trust Center record, and each record belongs to one user database. The store lives beside that database's payload:

```
<app_data>/databases/<id>.json         connections
<app_data>/databases/<id>.trust.json   trust records for that database
```

- **Same durability ladder.** The trust file carries the same `SDBF` preamble, checksum, and `.tmp`/`.bak` write-and-read ladder as the connection payload, so a torn write recovers the previous generation instead of losing every memorized identity.
- **Same encryption.** With master encryption configured and unlocked, the file is an authenticated envelope under its own artifact sub-key. Without encryption configured it is JSON under the preamble. Configured but locked, trust reads and writes **fail closed**: no plaintext downgrade, and no silent "accept anything" fallback.
- **Same portability.** Export, import, clone, and backup carry the records while the "Trusted hosts & certificates" inclusion stays on (the default). Records hold fingerprints and public certificates only — never secrets — so they are safe to move with a credential-free export.
- **Scoped deliberately.** A host trusted in one database is unknown in another, switching databases switches the trust context, and with no database open the verifiers have nothing to consult and refuse rather than accept. Use the Trust Center's Export JSON / Import JSON buttons to copy decisions between databases on purpose.
- **Deleting a database deletes its trust.** Removing a database removes `<id>.trust.json` and its ladder siblings with the rest of that database's data.

### Migrating from the pre-26.28 sidecars

Earlier builds kept one global `trust_store.json` beside the application data plus a separate `rdp-cert-trust.json` for RDP server certificates — both plaintext, both shared by every database. The first time each database is opened, its trust file is seeded from those files: global records always, connection-scoped records only for connections that database actually owns, and RDP pins as ordinary `rdp` records. **The legacy files are read-only inputs and are never modified.** Settings → Trust Center reports what they still hold and offers a one-click delete, which stays disabled until every database has been opened at least once, so the cleanup cannot strand a database that was never unlocked.

### SSH host keys and `known_hosts`

Accepted SSH, SFTP, and SCP host keys are Trust Center records too, keyed by `host:port`, so one accepted key covers the terminal, the file browser, and SCP for the same endpoint. OpenSSH's `known_hosts` becomes an import source rather than the authority: a key already listed there is adopted into the Trust Center and accepted instead of re-prompting, and Settings → Trust Center can import the whole file on demand (hashed `|1|…` entries are skipped, because their host names are unrecoverable, and an endpoint already recorded is never overwritten). By default an accepted key is still appended to `known_hosts` so other tools sharing that file keep working; the per-connection `also_write_known_hosts` option — present on SSH, SFTP, and SCP connections and on by default — turns that dual write off and keeps the decision inside the database only.

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

## Cloud and Lights-Out credentials

Cloud provider settings contain only non-secret resource context. The provider
credential uses the protected saved-connection password boundary; OVHcloud's
application key, application secret, and consumer key are one credential bundle
inside that boundary. Public cloud status DTOs and Lights-Out safe-config DTOs
exclude credentials. Internal iDRAC, iLO, Lenovo, and Supermicro configuration
serialization also skips password material.

Legacy `cloudProvider` records are normalized when opened and saved without
copying secret fields into provider settings or runtime handles. A malformed
OVHcloud bundle is never rendered raw: the editor keeps it masked and requires
all three replacement fields. Operational and rollback details are in
[Cloud & Lights-Out Connections]({{ '/cloud-and-lights-out/' | relative_url }}).

## Updates and releases

The public key embedded in the application verifies updater artifacts. The corresponding private key belongs in the release secret store, never in the repository. Key rotation requires a bridge strategy because already-installed clients only trust keys shipped in builds they can verify.

See [Updater signing and feed setup]({{ '/release/updater-setup/' | relative_url }}) and [Releases]({{ '/releases/' | relative_url }}) for the operational flow.

## Report a vulnerability

Do not open a public issue containing exploit details or secrets. Follow the repository’s [security policy on GitHub](https://github.com/supermarsx/sortOfRemoteNG/blob/main/security.md) for the current private reporting channel, supported-version statement, and disclosure expectations.

For route-specific data handling, see [Network Paths]({{ '/network-paths/' | relative_url }}). For automation context and script validation, see [Behaviors]({{ '/behaviors/' | relative_url }}).
