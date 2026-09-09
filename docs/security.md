---
title: Encryption at rest
description: Separate global master-key protection, database passwords, export passwords, and their recovery limits.
permalink: /security/encryption-at-rest/
hide_page_header: true
---

# Encryption at rest: boundaries and recovery

Settings → Security separates **global master-key protection**, **artifact protection**, **the current database's optional password**, and **global policy/export defaults**. The toolbar shield opens this page. Configuring a master key is not proof that all existing files are encrypted; an artifact family can also be deliberately configured for plaintext.

## Protection scopes

| Layer                                | Protects                                                                                                                                                              | Does not protect                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Native global master key             | Managed native artifact envelopes, including settings, database index, connection payloads, trust sidecars, recordings, backups, and encrypted application-log output | Files not yet migrated or rewritten, external copies outside the managed inventory, plaintext audit logs, live process memory |
| Optional database password           | That database's serialized connection payload, inside the native envelope when global protection is also enabled                                                      | Database names/index, trust records, other databases, global settings, application-wide artifacts                             |
| Export password                      | The particular password-encrypted export created with it                                                                                                              | The source database, subsequent exports, global master key                                                                    |
| OS vault                             | Recovery of the native master key under the OS account's vault policy                                                                                                 | A separate application password challenge in vault-only mode                                                                  |
| Standalone random-material generator | Produces random bytes for an external workflow                                                                                                                        | It does not configure or unlock a database or master key; database key-file import is not implemented                         |

Database snapshots do not restore global security preferences when opened. Export inclusion is a separate decision: review whether credentials, trust records, and application settings are included before exporting or importing.

## Key hierarchy and formats

The native master DEK is 32 random bytes. It is held in zeroizing Rust storage and derives artifact-specific AES-256-GCM keys with HKDF-SHA256. All artifact labels share the `sorng-v1::` prefix: examples are `sorng-v1::settings`, `sorng-v1::connections`, `sorng-v1::databases-index`, `sorng-v1::trust-store`, and `sorng-v1::key-ring`. Renaming a label breaks existing ciphertext. The artifact table below abbreviates these labels by omitting their common prefix.

A native database payload has these nested layers:

```text
SDBF durability header/checksum
  native SORNG authenticated envelope, when the artifact policy enables it
    optional per-database password envelope
      connection payload
```

The SDBF checksum is corruption detection, not encryption or an authentication boundary. Whole-file native envelopes authenticate their preamble with AES-GCM. Recording media uses the separate chunked authenticated format; see `envelope.rs` and `artifacts/recording_media.rs`.

Native master passwords wrap the DEK using Argon2id. The application's default is 64 MiB, time cost 3, parallelism 4; stored wrapper parameters govern existing files. New database password envelopes use WebCrypto AES-256-GCM with PBKDF2-SHA256, defaulting to **150,000 iterations**, with parameters embedded in the versioned envelope. The legacy `salt.iv.ciphertext` reader uses the fixed 150,000-iteration compatibility default because that format does not store its iteration count. A future strength/performance adjustment requires version-aware handling rather than changing the legacy reader's default. Existing supported legacy readers are compatibility paths, not permission to downgrade malformed authenticated data.

Algorithm, cipher-mode, and generic benchmark preferences do not select these actual formats. Security displays the actual formats read-only. Export KDF settings remain separate, consumed export defaults.

## Native artifacts and inspection

| Artifact                                | Typical location                                  | Global artifact key                         |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| Global preferences                      | `settings.enc`; legacy `settings.json` may remain | settings                                    |
| Legacy single-store connections         | `storage.json`                                    | connections                                 |
| Database index and names                | `databases/index.json`                            | databases-index                             |
| Database connection payload             | `databases/<id>.json`                             | connections                                 |
| Per-database trust decisions            | `databases/<id>.trust.json`                       | trust-store                                 |
| Retained recovery keys                  | `dek-ring.enc`                                    | key-ring                                    |
| Authenticated artifact-write policy     | `artifact-policy.enc`                             | artifact-policy                             |
| Recording metadata/media and macros     | Recording storage root                            | recordings-meta / recordings-media / macros |
| Managed backups                         | Configured backup destinations                    | backups                                     |
| Native encrypted application-log output | Native log adapter output                         | logs                                        |

The native `log_adapter.rs` bridge exists. This does **not** mean every log is encrypted: `logs/encryption-audit.log` is deliberately plaintext, and frontend action-log storage is separate. Settings change logs record field names, not old/new credential-bearing objects.

Settings' database disk-status card calls `databases_encryption_status` with `verify: false`. This is read-only header inspection of selected current/fallback files, not a decryptability audit or a certificate that every backup generation is protected. Envelope counts do not prove that the active key can open those envelopes. Unknown, unreadable, pending-transaction, or recovery states require investigation. Native callers may explicitly request `verify: true` for key-opening checks.

Setting up a master key does not retroactively encrypt every plaintext generation. Use artifact preview/apply to convert the managed inventory and inspect the result; review rotation results separately. Do not mistake “key configured” or “codec ready” for “all files encrypted.”

### Manage existing files and future writes

The **Artifact protection** panel replaces the separate legacy settings and recording/macros migration controls. Each row shows actual native inspection—encrypted, plaintext, mixed, absent, or unverified—with file counts, inspected bytes, restrictions, and its independent future-write policy. **Automatic / native default** means no explicit override; it is not a claim that existing files are encrypted. Refresh is explicit, not a polling scan. Browser previews have no native file-management fallback and cannot apply these changes.

Choose a row, selected rows, or **all supported** families, then choose **Encrypt & enable** or **Decrypt & disable**. The native preview binds the exact selection and target to a short-lived token, with file/byte counts. Confirmation applies both the existing-file conversion and the future-write decision. A preview expires after five minutes; changed files or policy require a fresh preview and confirmation, never an automatic retry of decryption.

Decrypting removes only the global artifact layer. It does not remove a database's separate password or independently password-protected backup/export layers, and it does not delete the master key or retained recovery keys. The key ring and authenticated policy remain protected, read-only infrastructure excluded from bulk actions. An unlocked master key is still needed to authenticate policy even when all supported data families are plaintext. This is distinct from locking or unlocking the application.

Scope is physical managed stores, not every file related to a feature:

- Connections includes the native legacy connection store and database payloads; the database index/names and trust sidecars are separate families. Recognized local recovery generations are inspected too.
- Recording metadata includes native recording envelopes, recording configuration, and in-flight snapshots. Media sidecars have a separate policy. Macros covers native recording-service macro files; macros embedded in global preferences follow Settings.
- Logs covers managed native runtime log files. The encryption audit deliberately stays plaintext, and frontend histories/action logs follow their own containing storage, not the native Logs switch.
- Backups covers recognized archives and integrity sidecars in configured, accessible local roots. Remote, offline, unavailable, and unmanaged copies are not counted as converted. A restriction can exclude the entire family from **all supported**.
- Legacy global `trust_store.json` and `rdp-cert-trust.json` inputs, including recognized generations, block TrustStore conversion as unverified. Follow Trust Center's migration/cleanup workflow; this panel does not delete or convert those legacy inputs automatically.

The native recording configuration's `encrypt_at_rest` flag remains a legacy/default fallback. Explicit per-family policies from Settings → Security → Artifact protection take precedence; the recording flag does not override independently configured metadata, media, or macro protection.

Unknown or corrupt files, conflicting plaintext/encrypted peers, inaccessible roots, active recordings, and pending recovery can prevent a transition. Review the visible reason rather than treating missing verification as an all-clear. A verified conversion removes managed obsolete representations; this is **not secure erasure** of SSD/free space, OS snapshots, external exports, or offline backups.

Bulk actions use ordered per-family transactions, not one atomic transaction for the whole profile. The report distinguishes committed, unchanged, failed, and not-attempted families; earlier commits can remain when a later family fails. Progress and cancellation operate at safe boundaries before commit, and cancellation does not undo already committed families. **Recover interrupted transition** rolls back uncommitted work or finishes cleanup of committed work, then refreshes inspected state. A committed result with cleanup/recovery warnings must not be mistaken for an unchanged file or reverted policy.

The frontend uses `encryption_get_artifact_status`, `encryption_preview_artifact_policy`, and token-bound `encryption_apply_artifact_policy`; cancellation, preview release, and interrupted-transition recovery have separate commands. Closing a preview releases its native reservation. These controls never receive renderer-supplied file paths or encryption keys.

## Locking and database password changes

Intentional global locks are owned by the primary window. They drain current saves and shared database mutations, stop sensitive views, fence captured database credentials, then invoke native lock. Detached windows request that operation from the primary window and wait for acknowledgement; a failure or missing acknowledgement is not reported as a successful lock.

Native lock events immediately block decrypted interfaces in primary and detached windows and invalidate cached database passwords/pending captures. A lock initiated externally cannot retroactively save an unfinished renderer edit: do not assume such edits reached disk. Successful unlock reloads persisted global preferences before enabling the interface and auto-lock policy. A failed settings read cannot be saved back as a defaults-based replacement.

Vault-only manual/idle locks remain in place until the user chooses **Unlock from OS vault**. This uses the current OS account's vault access; it is not a separate password-authentication boundary. Password fields are cleared after successful unlock.

The current-database card uses a shared mutation queue and flushes pending current data before changing its password. Closing an unencrypted database is labelled **Close**, not password-lock protection. Closing or locking the current database closes sensitive session and editor views in this window, including sessions not attributed to that database; it does not filter views by database origin. Locking a password-protected database also removes its cached password. Other database passwords and the global master key are unchanged; the named last-closed target remains available for explicit unlock/open.

Database password changes commit payload representation and index security metadata together: the desktop path uses a coordinated native transaction with durable recovery records, while the browser path uses a single IndexedDB transaction. A verified committed change can report cleanup warnings; that is a committed new password with recovery cleanup pending, not a reason to resume using the old password. Stale security revisions and captured old credentials are rejected. Password changes do not rewrite independent external exports or filesystem snapshots and do not promise secure erasure.

## Recovery and rotation

See [Master-key recovery and locking](master-key-recovery.md) for native receipt handling, startup evidence checks, and the remaining global rotation/import crash limitations.

- Keep an independently stored portable master-key backup and its export password when operationally appropriate. Use the native Open/Save picker to grant access to the selected `.dek` path. A typed arbitrary path is not a filesystem permission grant.
- If encrypted/unverifiable artifacts exist but key receipts are missing, restore the original vault/key backup. Fresh setup must not replace an unknown existing key. A newly generated key cannot recover old ciphertext.
- Full `encryption_rotate_master_key_full` is the supported rotation path. The legacy settings-only rotation command is retired/refuses operation; it is not an advanced shortcut.
- Full rotation rewrites managed artifacts and reports failures. It is not one power-loss-atomic transaction across the entire profile.
- `dek-ring.enc` retains up to **five previous master DEKs**, encrypted under the current DEK. This improves recovery from missed/older artifacts, but compromise of the current key also exposes those retained keys and any corresponding old ciphertext copies. Rotation therefore does not make all prior ciphertext unreadable. A sixth rotation evicts the oldest retained key.
- Unknown legacy formats should be preserved for investigation or an appropriate compatible recovery path. Never delete encrypted files, `dek.enc`, or vault entries simply to make an error disappear.

## Threat model and limits

The intended boundary is offline access to correctly encrypted managed artifacts without the corresponding password/vault material. It does not defend against a compromised unlocked process, debugger, malicious OS account, keychain compromise, malicious application binary, or arbitrary live renderer compromise. JavaScript passwords/plaintext cannot be guaranteed securely erased from memory by clearing a field; native zeroizing buffers do not erase all copies, swap, crash dumps, or external backups.

Browser-only mode has no native global master-key/vault or native disk-protection audit. Its optional database passwords are a separate WebCrypto/IndexedDB capability. Do not infer desktop protection from a browser preview.

These are implementation contracts and focused regression checks, not cryptographic certification or a claim of live vault/recovery verification on every supported OS. Relevant tests include `UnlockScreen`, `useGlobalEncryptionGuard`, `globalEncryptionLock`, `SettingsContext.encryption`, `CurrentDatabaseSecuritySection`, native database transaction tests, and the encryption crate's fault/recovery tests.
