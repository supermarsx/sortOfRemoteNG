---
title: Encryption at rest
description: Design choices and threat model for sortOfRemoteNG's encrypted application data and artifacts.
permalink: /security/encryption-at-rest/
hide_page_header: true
---

# Encryption-at-rest — design & threat model

This document captures the design choices behind sortOfRemoteNG's
encryption-at-rest layer, the threats it defends against, and what
it explicitly does **not** protect. Future contributors: read this
before touching any file under `src-tauri/crates/sorng-encryption`
or the artifact codecs.

## Threat model

### In scope

1. **Offline disk attacker.** The attacker has read (or read+write)
   access to the application data directory and any configured
   backup destinations, but does not have access to the OS user
   account or the process memory. Example: a stolen laptop with the
   user logged out, or a malicious actor who copied
   `%APPDATA%/sortOfRemoteNG/` off a workstation.
2. **Cold-storage backup attacker.** The attacker has a copy of an
   exported backup `.json` or `.gz` file. Equivalent threat surface
   to #1 from the artifact's perspective.
3. **Downgrade attacker.** Read+write access to disk. Attempts to
   trick the reader into accepting plaintext where v2 envelopes are
   expected.
4. **Tampering / swap attacker.** Read+write access to disk.
   Attempts to swap one ciphertext chunk for another (e.g. replay
   the first chunk over the third) within a single recording media
   file.

### Out of scope

- **Live memory attacker.** After unlock, the master DEK, every
  sub-key, and every decrypted artifact's plaintext live in process
  memory. A debugger / `ptrace` attacker on the running process can
  read everything. The auto-lock and "Lock now" affordances exist
  to shrink this window; they do not eliminate it.
- **OS keychain compromise.** Vault mode trusts the OS keychain
  (Windows Credential Manager + DPAPI / macOS Keychain / Linux
  Secret Service). An attacker who has compromised the keychain
  service has the master DEK.
- **Side-channels on shared hardware.** No timing-attack hardening
  beyond what `aes-gcm` and `argon2` provide by default.
- **Connection passwords in transit.** Wrapped by their respective
  protocol layers (SSH, TLS, RDP). This document covers data at
  rest only.

## Key hierarchy

```text
 OS vault entry              ┌─ MasterDek (32 random bytes, Zeroizing)
  master-dek (vault mode)   ─┤
  wrapped-dek (pw / hybrid) ─┘   │
                                 │ HKDF-SHA256(ikm=master, info="sorng-v1::<artifact>")
                                 ▼
                             SubKey (32 bytes) — AES-256-GCM key per artifact.
```

- **MasterDek.** 32 bytes of OS-RNG randomness. Generated at first
  setup via `MasterDek::generate()`. Stored in process memory in a
  `Zeroizing` buffer so leaks at lock / process exit clear cleanly.
- **HKDF labels.** `sorng-v1::<artifact>` — see `ArtifactKind::label()`.
  Stable on disk; renaming a variant breaks every encrypted file of
  that kind. To rotate, add a new variant and migrate; never rename.
- **Sub-key domain separation.** Each artifact's ciphertext is
  decryptable only with the sub-key derived under that artifact's
  HKDF label. A settings ciphertext fed to the connections sub-key
  fails GCM auth. Test:
  `crate::artifacts::connections::tests::settings_subkey_cannot_decrypt_connections`.

### Key storage modes

| Mode                 | Where the master DEK lives                                          | When chosen                                                                |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Vault**            | OS keychain entry. Transparent unlock on app start.                 | Default when the keychain is reachable.                                    |
| **Password**         | `dek.enc` — Argon2id-wrapped (OWASP 64 MiB / 3 / 4).                | Vault unreachable; user enters password at every start.                    |
| **Vault + password** | Both — keychain holds plaintext DEK, `dek.enc` holds Argon2id wrap. | User wants vault transparency plus a password fallback for vault eviction. |

`MasterKeyStorage` is recorded in every v2 envelope's 64-byte
preamble at offset 7 so the unlock screen knows which prompt to
render before any sub-key is derived.

## On-disk artifacts

| Artifact           | Codec                        | Filename pattern                               | Format                            |
| ------------------ | ---------------------------- | ---------------------------------------------- | --------------------------------- |
| Connections        | `artifacts::connections`     | `storage.json` (despite the name, v2 envelope) | whole-file envelope, JSON object  |
| Settings           | `artifacts::settings`        | `settings.enc`                                 | whole-file envelope, JSON object  |
| Recording metadata | `artifacts::recording_meta`  | `<recordings>/recordings/<id>.json.enc`        | whole-file envelope, JSON object  |
| Recording media    | `artifacts::recording_media` | `<recordings>/recordings/<id>.media.enc`       | chunked stream (see below)        |
| Backups            | `artifacts::backups`         | `<destination>/backup_*.json[.gz]`             | whole-file envelope, opaque bytes |
| Logs               | `artifacts::logs`            | (wired in Commit H — see deferred items)       | whole-file envelope, opaque bytes |
| Macros             | `artifacts::macros`          | `<recordings>/macros/<id>.json.enc`            | whole-file envelope, JSON object  |

### v2 whole-file envelope

64-byte unencrypted preamble + AES-256-GCM ciphertext. AEAD AAD is
the preamble itself, so a tampered preamble fails GCM verification at
decrypt-time. Full layout in `src-tauri/crates/sorng-encryption/src/envelope.rs`.

### v2 chunked stream (recording media)

Fixed-size plaintext chunks (default 64 KiB), each independently
AES-256-GCM-encrypted. Nonce = `nonce_prefix (8 random bytes per
file) || chunk_index_be (4 bytes)`. AAD = `chunk_index_be` so a
chunk swap fails GCM verification even with the same key. Full
layout in `src-tauri/crates/sorng-encryption/src/artifacts/recording_media.rs`.

### Why two formats

Whole-file envelopes are simpler and cheaper for files the playback
path always reads end-to-end (settings, connections, backups).
Recording media files can be tens to hundreds of MiB and the player
needs random-access seek; chunked AEAD lets `read_chunk(idx)` decrypt
exactly one 64 KiB block without touching the rest of the file.

## Defences

### Downgrade resistance

- **Magic byte check** — v2 envelope files start with `b"SORNG\0"`.
  Readers that see a file without that prefix at the canonical path
  (e.g. `data.enc` is bytes that don't start with `SORNG\0`) error
  out as "invalid format" rather than silently treating the bytes as
  plaintext. The legacy `SORNG_ENC:` text envelope was retired in
  the commit Z purge; any file still in that format produces a
  parse error on load.
- **Schema version field** — the preamble carries a `version: u8` at
  offset 6. A reader that sees an unknown version aborts.

### Tampering / swap resistance

- **Whole-file AEAD** binds the preamble to the body via AAD. A
  tampered preamble fails verification.
- **Chunked stream AAD** = chunk index, defeats chunk-swap attacks
  on media files.

### Vault eviction

The OS keychain entry can vanish: macOS keychain reset, Linux
session logout that drops libsecret, migration to a new machine.
The user is not stranded:

1. If a `dek.enc` exists (password / hybrid mode), the unlock screen
   prompts for the password and unwraps it via Argon2id.
2. The unlock screen's "Recover from portable .dek" panel
   (UnlockScreen.tsx, Commit E) accepts a path + password to import
   an exported `.dek` file. Pre-emptively exporting a portable `.dek`
   and storing it offline (USB key, password manager attachment) is
   the documented recovery flow.
3. If neither exists and the vault is gone, the data is
   unrecoverable. This is by design — encryption-at-rest without
   any recovery key would be no recovery at all.

### Brute force / lockout

`LockoutState` (`crate::lockout`) tracks failed-password attempts
with an exponential backoff. After 3 failures the cool-down jumps
from 0 to ~30 s; after 5, ~5 min; capped at 1 h. The counter
persists to `<app_data>/lockout.json` so a quick process restart
doesn't reset it. Successful unlock or rotation calls `record_success()`
which clears the counter.

### Key rotation

`encryption_rotate_master_key_full` (Commit A) walks every artifact:
settings, connections, every v2 backup file across every enabled
destination, every recording metadata envelope, every media sidecar,
every macro. Each file is rewritten via the atomic `temp → rename`
pattern, so a crash inside one file's rewrite leaves the canonical
path at its previous (old-key) bytes. The lossy mid-state — process
dies between artifact rewrites and vault/dek.enc update — is the
documented escape hatch for the portable `.dek` import.

The legacy settings-only `encryption_rotate_master_key` (Phase 6)
is retained but the UI no longer calls it. It exists for advanced
callers that genuinely want the receipts updated without touching
artifacts.

### Audit log

`<app_data>/logs/encryption-audit.log` — JSON-lines append-only.
Records setup, unlock success/failure, lock (with reason metadata —
Commit C), key rotation, password change, portable export/import.
Retention: single-backup rotation at 5 MiB (Commit D); ≤ 2× cap
disk usage.

## Migration

The dev branch is "we're not in production"; commits Y and Z
retired every legacy crypto format (SORNG1 backup envelope,
SORNG_ENC: connections envelope). Files in those formats still on
disk surface as load errors. The migrators that converted them are
gone — the only path forward is to delete the legacy files and let
the app recreate them in v2 on first save.

If you fork this code and add new users on a v1 release, you must
write migration commands before stripping the legacy reader.

## Properties NOT guaranteed

These are deliberate omissions, not bugs:

- **In-memory plaintext after unlock.** Connection passwords,
  decrypted settings, recording content — all live in plaintext in
  process memory once unlocked. Lock-on-blur and lock-on-idle exist
  to shrink the window but cannot eliminate it. A user concerned
  about RAM-dump attacks should keep the app locked and unlock
  per-session.
- **Authenticated boot.** The app does not verify its own binary
  signature at startup. An attacker who can replace the executable
  on disk has compromised the key path.
- **Encrypted swap.** OS-level encrypted swap is the user's
  responsibility. On macOS it's default; on Linux it's optional; on
  Windows it depends on BitLocker.
- **Forward secrecy.** Compromise of the master DEK at time T
  decrypts every artifact ever written. There is no per-session
  ephemeral key.

## Deferred items

- **Logs encryption.** `artifacts::logs` codec exists; the bridge to
  `tauri-plugin-log`'s file writer doesn't. Replacing the plugin
  with a custom `log::Log` impl that writes through the codec is
  Commit H.
- **Streaming media writer.** Every encoder in
  `sorng-recording::encoders` returns a whole `String`, so
  `write_one_shot` is fine. A streaming writer would matter once an
  encoder learns to stream incrementally.
