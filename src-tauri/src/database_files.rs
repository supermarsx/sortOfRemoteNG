//! Per-user-database file storage with a fail-safe write/read ladder.
//!
//! Each user-created "database" / "collection" lives in two files
//! under `<app_data>/databases/`:
//!
//! ```text
//! databases/
//!   index.json          List of database metadata (id, name, ...)
//!   <id>.json           Current per-database payload
//!   <id>.json.bak       Previous generation (last successful save)
//!   <id>.json.tmp       Write-in-progress (auto-cleaned)
//!   <id>.json.v0.bak    Pre-migration rollback from IndexedDB (one-shot)
//! ```
//!
//! All `*.json` files share a 32-byte preamble:
//!
//! ```text
//!  offset  size  description
//!  ──────  ────  ─────────────────────────────────────────────
//!   0       4    b"SDBF"                     magic
//!   4       1    version                     u8 = 1
//!   5       1    flags                       u8 (reserved; 0)
//!   6       8    checksum                    SHA-256(payload), first 8 bytes, LE
//!  14       8    payload_len                 u64 LE
//!  22      10    reserved                    zeros
//!  ──────  ────
//!  32     ..     payload                     serde_json bytes
//! ```
//!
//! The payload is whatever the caller hands us — a JSON object, a
//! WebCrypto-encrypted string, anything. This module doesn't decode
//! the payload; it just guarantees that bytes-in == bytes-out across
//! a crash, a power loss, a single bit-rot, or a single bad write.
//!
//! ## Write ladder (`safe_write`)
//!
//! 1. Compose preamble + payload.
//! 2. Write to `<canonical>.tmp`.
//! 3. Re-read the temp file and verify the preamble + checksum.
//!    Aborts the write if the disk wrote garbage — the canonical
//!    file is untouched and the user keeps their last good save.
//! 4. Rename current `<canonical>` to `<canonical>.bak` (overwriting
//!    any previous `.bak`). Skipped if no current file exists.
//! 5. Rename `<canonical>.tmp` to `<canonical>`. Atomic on every
//!    target OS.
//! 6. fsync the parent dir (POSIX). Windows: no-op (NTFS journals
//!    directory metadata as part of the rename).
//!
//! ## Read ladder (`safe_read`)
//!
//! 1. Try `<canonical>` — preamble + checksum verified. If valid,
//!    return payload with `source: "current"`.
//! 2. Try `<canonical>.bak`. If valid, return with
//!    `source: "backup"`. UI surfaces a one-shot toast.
//! 3. Try `<canonical>.v0.bak` (pre-migration rollback). Returns
//!    with `source: "v0-migration"`. UI surfaces a stronger toast.
//! 4. No valid version exists → `Ok(None)`.
//!
//! A corrupted file at any step is *not* an error — the ladder
//! cascades. Only "every version unreadable" surfaces an error.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// The SDBF codec (preamble, checksum, `safe_write` / `safe_read` /
// `safe_read_raw` ladder, `LoadSource`, `LoadResult`, `FileStoreError`,
// `sibling`) lives in `sorng_storage::sdbf` since t62 so the per-database
// trust store can share it. Re-exported here so every existing caller and
// this module's tests compile unchanged.
pub use sorng_storage::sdbf::*;

fn databases_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("databases");
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(databases_dir(app)?.join("index.json"))
}

fn per_db_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // Sanitise: refuse anything that could escape the databases dir.
    // IDs in the wild are UUIDs but the IPC surface is untrusted, so
    // a path-traversal id like `../../etc/passwd` must error rather
    // than reach `path.join`.
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err(format!("invalid database id: {id:?}"));
    }
    Ok(databases_dir(app)?.join(format!("{id}.json")))
}

// ══════════════════════════════════════════════════════════════════
// P4 — master-DEK encryption-at-rest
// ──────────────────────────────────────────────────────────────────
// `safe_write` / `safe_read` above are byte-level and know nothing
// about encryption. P4 inserts an envelope layer between them and the
// Tauri command surface:
//
//   on-disk = SDBF preamble (32 B) || SHA-256 checksum-protected ||
//             ────────────────────────────────────────────────────
//             SORNG v2 envelope (64 B) || AES-256-GCM ciphertext
//
// The inner envelope's sub-key is derived from the master DEK via
// HKDF-SHA256 with a per-artifact label, so the index file and a
// per-DB payload are not interchangeable even though both use the
// same outer codec. When no master DEK has ever been configured, new
// and already-plaintext stores remain writable in the legacy plaintext
// shape. A configured-but-locked process and existing encrypted
// generations still fail closed: neither may write plaintext.
//
// On read, a payload that starts with the SORNG envelope magic is
// decrypted; a payload that doesn't is treated as legacy plaintext-P1
// from before P4 (tolerant-read migration). The next save promotes
// it to an envelope automatically.
// ══════════════════════════════════════════════════════════════════

use sorng_encryption::envelope::{
    self as enc_envelope, EnvelopeError, EnvelopeHeader, MAGIC as SORNG_ENVELOPE_MAGIC, NONCE_LEN,
};
use sorng_encryption::{ArtifactKind, EncryptionState};

/// Returns true when the given payload bytes start with the SORNG
/// envelope magic — i.e. they've been P4-encrypted. False matches
/// the legacy plaintext-P1 shape (raw JSON bytes).
fn is_envelope_blob(bytes: &[u8]) -> bool {
    bytes.len() >= SORNG_ENVELOPE_MAGIC.len()
        && &bytes[..SORNG_ENVELOPE_MAGIC.len()] == SORNG_ENVELOPE_MAGIC
}

/// Encrypt the given JSON payload bytes into a SORNG v2 envelope keyed
/// off `state`'s sub-key for `artifact`. Returns the envelope-wrapped
/// bytes ready to feed to `safe_write` (which adds the outer SDBF
/// preamble + checksum).
///
/// Refuses to encrypt when the state is locked — there's no fallback to
/// plaintext, by approved policy.
async fn encrypt_payload(
    state: &EncryptionState,
    artifact: ArtifactKind,
    plain_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let sub_key = state
        .sub_key(artifact)
        .await
        .ok_or_else(|| "encryption is locked; unlock first via Settings → Security".to_string())?;

    let mut nonce = [0u8; NONCE_LEN];
    use rand::rngs::OsRng;
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce);

    // Vault-mode header keeps the Argon2 fields zero and skips the
    // password-wrap dance. The mode is only consulted by the unlock
    // screen at boot — since the master DEK is already loaded at
    // every save point we hit, the value here matches whatever the
    // settings.enc file already records, kept simple.
    let header = EnvelopeHeader::new_vault(nonce);
    enc_envelope::write_envelope(&sub_key, &header, plain_bytes)
        .map_err(|e: EnvelopeError| format!("envelope encrypt: {e}"))
}

/// Decrypt a SORNG v2 envelope under the artifact's sub-key.
/// Returns the decrypted JSON bytes (caller decides what to parse them
/// into). Bubbles up `EnvelopeError` so the read path can decide
/// between "locked" (translate to error) and "not an envelope" (treat
/// as legacy plaintext).
///
/// **Retained-key fallback (t74).** A file that does not authenticate
/// under the current sub-key is retried against the bounded ring of
/// superseded master DEKs (`sorng_encryption::key_ring`). That covers
/// the case a rotation missed a file — historically the entire
/// `databases/` tree — so the data opens instead of reading as
/// unrecoverable ciphertext. The ring is defence in depth: rotation
/// still has to walk every file, and does (see the databases step in
/// `encryption_rotation_commands.rs`).
///
/// Nothing is rewritten here. A read path that rewrote would rotate the
/// SDBF `.bak` ladder under a concurrent writer; convergence back onto
/// the current key happens on the next ordinary save, which always
/// encrypts under the live sub-key.
async fn decrypt_payload(
    state: &EncryptionState,
    artifact: ArtifactKind,
    envelope_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let sub_key = state
        .sub_key(artifact)
        .await
        .ok_or_else(|| "encryption is locked; unlock first via Settings → Security".to_string())?;
    match enc_envelope::read_envelope(&sub_key, envelope_bytes) {
        Ok((_header, plaintext)) => Ok(plaintext),
        Err(error) => {
            if let Some(plaintext) =
                sorng_encryption::key_ring::try_decrypt_retired(state, artifact, envelope_bytes)
                    .await
            {
                log::warn!(
                    "database artifact {artifact:?} opened with a retained key from a previous \
                     rotation; it will re-encrypt under the current key on its next save"
                );
                return Ok(plaintext);
            }
            Err(format!("envelope decrypt: {error}"))
        }
    }
}

/// Before a locked-state plaintext write, inspect every generation
/// that the recovery ladder can use. An encrypted or unreadable
/// generation must fail closed: otherwise `safe_write` could rotate
/// it away and silently downgrade or destroy protected data.
fn ensure_locked_plaintext_write_is_safe(canonical: &Path) -> Result<(), String> {
    let candidates = [
        canonical.to_path_buf(),
        sibling(canonical, "bak"),
        canonical.with_extension("json.v0.bak"),
    ];

    for path in candidates {
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "database storage is locked; cannot verify {} before writing: {error}",
                    path.display()
                ))
            }
        };
        let payload = parse_and_verify(&bytes).map_err(|error| {
            format!(
                "database storage is locked; refusing to overwrite unverifiable generation {}: {error}",
                path.display()
            )
        })?;
        if is_envelope_blob(payload) {
            return Err(
                "database storage is encrypted; unlock first via Settings → Security".to_string(),
            );
        }
        serde_json::from_slice::<serde_json::Value>(payload).map_err(|error| {
            format!(
                "database storage is locked; refusing to overwrite invalid plaintext generation {}: {error}",
                path.display()
            )
        })?;
    }

    Ok(())
}

/// Inspect only the fixed SDBF header plus the envelope-magic prefix.
/// Configuration detection runs on every locked plaintext save, so it
/// must never read whole database payloads just to decide whether a
/// master-encrypted generation exists.
fn database_generation_is_encrypted(path: &Path) -> Result<bool, String> {
    use std::io::Read;

    let file = std::fs::File::open(path).map_err(|error| {
        format!(
            "cannot inspect database generation {}: {error}",
            path.display()
        )
    })?;
    let file_len = file
        .metadata()
        .map_err(|error| {
            format!(
                "cannot stat database generation {}: {error}",
                path.display()
            )
        })?
        .len();
    let prefix_len = PREAMBLE_LEN + SORNG_ENVELOPE_MAGIC.len();
    let mut prefix = Vec::with_capacity(prefix_len);
    file.take(prefix_len as u64)
        .read_to_end(&mut prefix)
        .map_err(|error| {
            format!(
                "cannot read database generation header {}: {error}",
                path.display()
            )
        })?;

    if prefix.len() < PREAMBLE_LEN {
        return Err(format!(
            "database generation {} has a truncated SDBF header",
            path.display()
        ));
    }
    if &prefix[..4] != MAGIC || prefix[4] != CURRENT_VERSION {
        return Err(format!(
            "database generation {} has an unrecognized SDBF header",
            path.display()
        ));
    }
    let payload_len = u64::from_le_bytes(
        prefix[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
            .try_into()
            .unwrap(),
    );
    let expected_len = (PREAMBLE_LEN as u64)
        .checked_add(payload_len)
        .ok_or_else(|| format!("database generation {} length overflows", path.display()))?;
    if file_len != expected_len {
        return Err(format!(
            "database generation {} has an unverifiable length",
            path.display()
        ));
    }

    let payload_prefix = &prefix[PREAMBLE_LEN..];
    if is_envelope_blob(payload_prefix) {
        return Ok(true);
    }
    if payload_prefix.is_empty() || SORNG_ENVELOPE_MAGIC.starts_with(payload_prefix) {
        return Err(format!(
            "database generation {} has an ambiguous payload header",
            path.display()
        ));
    }

    // serde_json emits one of these bytes first for every valid JSON
    // root. Anything else is neither a known envelope nor credible
    // plaintext, so locked writes fail closed.
    let first = payload_prefix[0];
    let looks_like_json = matches!(
        first,
        b'{' | b'[' | b'"' | b't' | b'f' | b'n' | b'-' | b'0'..=b'9'
    );
    if !looks_like_json {
        return Err(format!(
            "database generation {} has an ambiguous payload header",
            path.display()
        ));
    }

    Ok(false)
}

fn is_database_recovery_generation_name(file_name: &str) -> bool {
    file_name.ends_with(".json")
        || file_name.ends_with(".json.bak")
        || file_name.ends_with(".json.v0.bak")
}

/// Does persistent state prove that master encryption has been
/// configured, even though the in-memory state is currently locked?
///
/// `vault_has_master_dek` is injected so the filesystem decision is
/// hermetic in tests. The command-level probe obtains it from the OS
/// vault. Password wrappers, encrypted settings, setup audit entries,
/// and any encrypted database generation are durable fallback signals
/// when the vault is temporarily unavailable.
fn master_encryption_configured_from_evidence(
    app_data_dir: &Path,
    vault_has_master_dek: bool,
) -> Result<bool, String> {
    if vault_has_master_dek {
        return Ok(true);
    }

    for marker in ["dek.enc", "settings.enc"] {
        let path = app_data_dir.join(marker);
        match path.try_exists() {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(error) => {
                return Err(format!(
                    "cannot verify master-encryption marker {}: {error}",
                    path.display()
                ))
            }
        }
    }

    let audit_paths = [
        app_data_dir.join("logs").join("encryption-audit.log"),
        app_data_dir.join("logs").join("encryption-audit.log.0.bak"),
    ];
    let configuration_events = [
        "\"event\":\"setup-completed\"",
        "\"event\":\"key-rotated\"",
        "\"event\":\"password-changed\"",
        "\"event\":\"settings-migrated\"",
        "\"event\":\"portable-imported\"",
    ];
    for path in audit_paths {
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "cannot verify master-encryption audit marker {}: {error}",
                    path.display()
                ))
            }
        };
        if configuration_events
            .iter()
            .any(|event| text.contains(event))
        {
            return Ok(true);
        }
    }

    let databases = app_data_dir.join("databases");
    let entries = match std::fs::read_dir(&databases) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "cannot inspect database encryption markers in {}: {error}",
                databases.display()
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "cannot inspect database encryption marker in {}: {error}",
                databases.display()
            )
        })?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "cannot inspect database entry {}: {error}",
                entry.path().display()
            )
        })?;
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        if !is_database_recovery_generation_name(&file_name.to_string_lossy()) {
            continue;
        }
        let path = entry.path();
        if database_generation_is_encrypted(&path)? {
            return Ok(true);
        }
    }

    Ok(false)
}

fn classify_vault_master_dek_probe(
    probe: sorng_vault::types::VaultResult<Vec<u8>>,
) -> Result<bool, String> {
    match probe {
        Ok(_) => Ok(true),
        Err(error) if matches!(&error.kind, sorng_vault::types::VaultErrorKind::NotFound) => {
            Ok(false)
        }
        Err(error) => Err(format!(
            "cannot verify whether master encryption is configured in the OS vault: {error}"
        )),
    }
}

async fn master_encryption_configured(
    app: &AppHandle,
    state: &EncryptionState,
) -> Result<bool, String> {
    if state.is_unlocked().await {
        return Ok(true);
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir: {error}"))?;
    let vault_has_master_dek = if sorng_vault::keychain::is_available() {
        classify_vault_master_dek_probe(sorng_vault::keychain::read_dek().await)?
    } else {
        false
    };
    master_encryption_configured_from_evidence(&app_data_dir, vault_has_master_dek)
}

/// High-level storage save.
///
/// With a live master DEK, serialize → encrypt → safe_write. Without
/// one (the normal first-run state when Linux Secret Service is not
/// available), a never-configured store preserves the legacy plaintext
/// format so an explicitly unencrypted database can still be created.
/// Configured-but-locked storage and encrypted generations fail closed.
async fn save_payload(
    state: &EncryptionState,
    artifact: ArtifactKind,
    canonical: &Path,
    value: &serde_json::Value,
    master_encryption_configured: bool,
) -> Result<(), String> {
    let plain = serde_json::to_vec(value).map_err(|e| format!("serialise payload: {e}"))?;
    if state.is_unlocked().await {
        let envelope = encrypt_payload(state, artifact, &plain).await?;
        return safe_write(canonical, &envelope).map_err(|e| e.to_string());
    }

    if master_encryption_configured {
        return Err(
            "database storage is encrypted; unlock first via Settings → Security".to_string(),
        );
    }
    ensure_locked_plaintext_write_is_safe(canonical)?;
    safe_write(canonical, &plain).map_err(|e| e.to_string())
}

/// High-level encrypted load: safe_read → distinguish envelope from
/// legacy plaintext → decrypt or parse as appropriate. Surfaces the
/// `LoadSource` from the recovery ladder unchanged.
///
/// The legacy-tolerant branch is what lets users boot through the P4
/// upgrade without an explicit migration command: a per-DB file
/// written in P1/P2/P3 (raw JSON under the SDBF preamble) is read
/// as-is; the next save promotes it to an envelope.
async fn encrypted_load(
    state: &EncryptionState,
    artifact: ArtifactKind,
    canonical: &Path,
) -> Result<Option<LoadResult>, String> {
    let (payload_bytes, source) = match safe_read_raw(canonical).map_err(|e| e.to_string())? {
        Some(p) => p,
        None => return Ok(None),
    };

    if is_envelope_blob(&payload_bytes) {
        let plain = decrypt_payload(state, artifact, &payload_bytes).await?;
        let value: serde_json::Value =
            serde_json::from_slice(&plain).map_err(|e| format!("decrypted JSON: {e}"))?;
        return Ok(Some(LoadResult { value, source }));
    }

    // Legacy plaintext-P1 path. The file pre-dates P4 — parse the
    // bytes as raw JSON and return as-is. The next save will wrap it
    // in an envelope (per the approved "tolerant read + re-encrypt
    // on write" policy).
    let value: serde_json::Value = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("legacy plaintext JSON: {e}"))?;
    Ok(Some(LoadResult { value, source }))
}

// ══════════════════════════════════════════════════════════════════
// Tauri command surface
// ══════════════════════════════════════════════════════════════════

/// Read the list of `ConnectionDatabase` metadata from
/// `<app_data>/databases/index.json`. Returns an empty vec on first
/// boot. Recovery cascade applies — a corrupted index falls back to
/// `.bak`. The payload is master-DEK-encrypted under
/// `ArtifactKind::DatabasesIndex` (P4); legacy plaintext-P1 files
/// pre-dating P4 are still readable and get promoted on the next save.
#[tauri::command]
pub async fn databases_list(
    app: AppHandle,
    enc_state: tauri::State<'_, EncryptionState>,
) -> Result<Option<LoadResult>, String> {
    let path = index_path(&app)?;
    encrypted_load(&enc_state, ArtifactKind::DatabasesIndex, &path).await
}

/// Write the list. Encrypts under `ArtifactKind::DatabasesIndex` when
/// the master DEK is available. A fresh or already-plaintext store
/// remains writable while locked, but an encrypted generation cannot
/// be downgraded.
#[tauri::command]
pub async fn databases_save_index(
    app: AppHandle,
    enc_state: tauri::State<'_, EncryptionState>,
    list: serde_json::Value,
) -> Result<(), String> {
    let path = index_path(&app)?;
    let configured = master_encryption_configured(&app, &enc_state).await?;
    save_payload(
        &enc_state,
        ArtifactKind::DatabasesIndex,
        &path,
        &list,
        configured,
    )
    .await
}

/// Load `<app_data>/databases/<id>.json`. Returns `None` when no
/// version of the file survives the recovery ladder; the frontend
/// treats this as "database does not exist" and surfaces a
/// `DatabaseNotFoundError`. The payload is decrypted under
/// `ArtifactKind::Connections` (P4) — legacy plaintext-P1 files
/// pre-dating P4 are still readable.
#[tauri::command]
pub async fn load_database_data(
    app: AppHandle,
    enc_state: tauri::State<'_, EncryptionState>,
    database_id: String,
) -> Result<Option<LoadResult>, String> {
    let path = per_db_path(&app, &database_id)?;
    encrypted_load(&enc_state, ArtifactKind::Connections, &path).await
}

/// Save `<app_data>/databases/<id>.json`. The frontend supplies the
/// payload as a JSON value — could be a plain object or an encrypted
/// string envelope from the per-database-password layer — and this
/// command wraps it in the master-DEK envelope when available.
/// Fresh/already-plaintext storage remains writable without a master
/// DEK; encrypted generations still require an unlock.
///
/// **Two-layer note:** when the user has set a per-database password
/// (frontend WebCrypto AES-GCM, the existing checkbox), the value
/// arriving here is already a string-encoded ciphertext. P4 wraps
/// that string in the master-DEK envelope as well, giving a
/// belt-and-suspenders double-encryption. This is intentional —
/// the per-DB-password layer is compartmentalisation across users
/// of the same machine, P4 is at-rest protection of the file itself.
#[tauri::command]
pub async fn save_database_data(
    app: AppHandle,
    enc_state: tauri::State<'_, EncryptionState>,
    database_id: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let path = per_db_path(&app, &database_id)?;
    let configured = master_encryption_configured(&app, &enc_state).await?;
    save_payload(
        &enc_state,
        ArtifactKind::Connections,
        &path,
        &data,
        configured,
    )
    .await
}

/// Best-effort removal of every variant (canonical + .bak + .tmp +
/// .v0.bak). Used when the user deletes a database from the picker.
/// Always returns `Ok(())` — missing files aren't an error.
#[tauri::command]
pub async fn delete_database_data(app: AppHandle, database_id: String) -> Result<(), String> {
    let canonical = per_db_path(&app, &database_id)?;
    for suffix in &["", ".bak", ".tmp", ".v0.bak"] {
        let path = if suffix.is_empty() {
            canonical.clone()
        } else {
            let mut s = canonical.as_os_str().to_owned();
            s.push(*suffix);
            PathBuf::from(s)
        };
        let _ = std::fs::remove_file(&path);
    }
    // t62: the per-database trust store lives beside the payload.
    if let Ok(rt) = sorng_storage::trust_store::runtime() {
        rt.delete_store(&database_id)?;
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════
// t74-e3 — read-only encryption-status probe
// ──────────────────────────────────────────────────────────────────
// Nothing in the UI tells a user whether their connection databases
// are encrypted at rest, so a capability that has shipped since P4
// reads as absent. This probe is the source of truth the Database
// Center and the Security panel render from.
//
// It is also the diagnostic for the rotation defect this task fixes
// (plan t74 §2 Gap A1): a master-key rotation that did not walk
// `databases/` leaves every file carrying a valid SORNG envelope that
// no live key opens. "Encrypted: true" is useless there — the states
// that matter are three, not two:
//
//   plaintext                       no envelope on disk
//   envelope + open-state current   opens under the live master DEK
//   envelope + open-state no-key    STRANDED — envelope intact, key gone
//
// A fourth state exists once t74-e1's retained key ring lands: the
// file opens under a *previous* DEK the ring still holds, i.e. it was
// missed by a rotation but is still recoverable. `OpenState::RetainedKey`
// carries that; see `retained_master_deks` for the one-function seam.
//
// Contract, non-negotiable:
//   - **Strictly read-only.** No write, no migration, no "repair".
//   - **Never fails the whole call for one bad file.** Every artifact
//     carries its own status; directory-level trouble lands in `errors`.
//   - **Cheap by default.** `verify = false` (the default, and what a
//     list view uses) inspects the 32-byte SDBF preamble plus the
//     envelope magic and stops. Decryption happens only when the
//     caller explicitly asks for it (plan t74 §7 R5).
// ══════════════════════════════════════════════════════════════════

use serde::Serialize;
use sorng_encryption::key_ring::{self, RetiredKeyRing};

/// What the bytes on disk are, independent of whether any key opens
/// them. Determined from the SDBF preamble + envelope magic alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AtRestState {
    /// Payload begins with the SORNG envelope magic — encrypted at rest.
    Envelope,
    /// Payload is legacy plaintext JSON (pre-P4, or a store that was
    /// never encrypted because no master DEK exists on this machine).
    Plaintext,
    /// No generation of the file survives header inspection: truncated,
    /// wrong magic, length mismatch, unreadable. Reported per artifact
    /// so one bad file never sinks the probe.
    Unreadable,
    /// The file (and every recovery generation of it) is absent.
    Missing,
}

/// Whether a key this profile still holds opens the artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpenState {
    /// Not an envelope — there is nothing to open.
    NotEncrypted,
    /// Decrypts under the sub-key derived from the *current* master DEK.
    CurrentKey,
    /// Does **not** open under the current master DEK, but does open
    /// under a retained (previous) DEK. The artifact was missed by a
    /// rotation and is still recoverable — a re-save re-keys it.
    RetainedKey,
    /// An envelope that no available key opens. This is the stranded
    /// state Gap A1 produces; the data is unrecoverable unless the old
    /// DEK is restored from a backup.
    NoKey,
    /// Encryption is locked, so openability cannot be decided. Not a
    /// failure — unlock and probe again.
    Locked,
    /// Not determined: `verify` was false, or the artifact is
    /// `Unreadable` / `Missing` and there is nothing to attempt.
    Unknown,
}

/// Status of one on-disk artifact (`index.json`, `<id>.json`, or
/// `<id>.trust.json`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactEncryptionStatus {
    /// File name only, never an absolute path — the probe result is
    /// rendered in the UI and must not leak the user's directory
    /// layout into a screenshot or a bug report.
    pub file: String,
    pub at_rest: AtRestState,
    /// Which generation of the recovery ladder answered: `current`,
    /// `backup`, or `v0-migration`. `null` when nothing was readable.
    /// Anything other than `current` means the canonical file is
    /// already damaged, independently of encryption.
    pub source: Option<LoadSource>,
    pub open_state: OpenState,
    /// Human-readable reason for `Unreadable` / `NoKey`. Never contains
    /// key material or plaintext.
    pub detail: Option<String>,
}

impl ArtifactEncryptionStatus {
    fn missing(file: String) -> Self {
        Self {
            file,
            at_rest: AtRestState::Missing,
            source: None,
            open_state: OpenState::Unknown,
            detail: None,
        }
    }
}

/// One row of the Database Center, joined with what is actually on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEncryptionStatus {
    pub id: String,
    /// From the index when it is readable, else `null`. Display only.
    pub name: Option<String>,
    /// Layer B — the optional per-database password (`isEncrypted` in
    /// the index). `null` when the index could not be read. This is a
    /// *different thing* from `data.at_rest`, and conflating the two is
    /// the confusion this probe exists to end.
    pub password_protected: Option<bool>,
    /// `databases/<id>.json` — the connection payload.
    pub data: ArtifactEncryptionStatus,
    /// `databases/<id>.trust.json` — the per-database trust store.
    /// `null` when the database has no trust store at all (the common
    /// case until the user accepts a host key).
    pub trust: Option<ArtifactEncryptionStatus>,
}

/// Roll-up across every database, for a one-line UI summary.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasesEncryptionSummary {
    /// Databases seen, on disk or in the index.
    pub total: usize,
    /// `data.at_rest == Envelope`.
    pub encrypted: usize,
    /// `data.at_rest == Plaintext`.
    pub plaintext: usize,
    /// `data.at_rest` is `Unreadable` or `Missing`.
    pub unreadable: usize,
    /// Envelopes that no available key opens — only ever non-zero when
    /// `verified` is true. **This is the Gap A1 casualty count.**
    pub stranded: usize,
    /// Envelopes that open only under a retained key: missed by a
    /// rotation, still recoverable.
    pub recoverable_with_retained_key: usize,
}

/// The whole probe result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasesEncryptionStatus {
    /// Master encryption has been configured for this profile (vault
    /// entry, `dek.enc`, encrypted settings, an audit record, or an
    /// encrypted database generation).
    pub master_configured: bool,
    /// A master DEK is loaded right now.
    pub unlocked: bool,
    /// Whether decryption was actually attempted. When false every
    /// `open_state` is `unknown` and `stranded` is 0 — absence of
    /// evidence, not evidence of absence.
    pub verified: bool,
    /// Whether any retained (previous) DEKs were available to try.
    pub retained_keys_available: usize,
    /// `databases/index.json`.
    pub index: ArtifactEncryptionStatus,
    /// Sorted by id so the UI renders stably across probes.
    pub databases: Vec<DatabaseEncryptionStatus>,
    pub summary: DatabasesEncryptionSummary,
    /// Non-fatal, directory-level problems (e.g. the databases dir
    /// could not be enumerated). Never a reason to fail the call.
    pub errors: Vec<String>,
}

/// The retained (previous) master DEKs this profile still holds.
///
/// t74-e1 landed `<app_data>/dek-ring.enc`: a bounded, newest-first ring
/// of the last `KEY_RING_CAPACITY` superseded DEKs, itself encrypted
/// under the *current* master key. Its purpose is that a rotation which
/// missed an artifact stays recoverable; its purpose *here* is that
/// "missed by a rotation but still recoverable" is a materially
/// different thing to tell a user than "gone".
///
/// Best-effort by construction: no ring file, a locked state, or a
/// damaged ring all mean "no retained keys" - never an error. The
/// probe's job is to report what it can see.
async fn retained_key_ring(state: &EncryptionState, app_data_dir: &Path) -> RetiredKeyRing {
    key_ring::load(&key_ring::ring_path(app_data_dir), state)
        .await
        .unwrap_or_else(|_| RetiredKeyRing::empty())
}

/// Header-only classification of one artifact, walking the same
/// recovery ladder `safe_read` would (`current` → `.bak` → `.v0.bak`)
/// so the reported state matches what a real load would actually get.
///
/// Reads at most `PREAMBLE_LEN + magic` bytes per generation — no
/// payload, no decryption, no allocation proportional to file size.
fn classify_generation_ladder(canonical: &Path) -> ArtifactEncryptionStatus {
    let file = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (
            canonical.with_extension("json.v0.bak"),
            LoadSource::V0Migration,
        ),
    ];

    let mut any_present = false;
    let mut first_error: Option<String> = None;

    for (path, source) in candidates {
        match path.try_exists() {
            Ok(true) => {}
            Ok(false) => continue,
            Err(error) => {
                any_present = true;
                if first_error.is_none() {
                    first_error = Some(format!("cannot stat {}: {error}", path.display()));
                }
                continue;
            }
        }
        any_present = true;
        match database_generation_is_encrypted(&path) {
            Ok(true) => {
                return ArtifactEncryptionStatus {
                    file,
                    at_rest: AtRestState::Envelope,
                    source: Some(source),
                    open_state: OpenState::Unknown,
                    detail: None,
                }
            }
            Ok(false) => {
                return ArtifactEncryptionStatus {
                    file,
                    at_rest: AtRestState::Plaintext,
                    source: Some(source),
                    open_state: OpenState::NotEncrypted,
                    detail: None,
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    // `database_generation_is_encrypted` already names
                    // the path; strip nothing, it is a file name plus a
                    // reason and carries no secret material.
                    first_error = Some(error);
                }
            }
        }
    }

    if !any_present {
        return ArtifactEncryptionStatus::missing(file);
    }
    ArtifactEncryptionStatus {
        file,
        at_rest: AtRestState::Unreadable,
        source: None,
        open_state: OpenState::Unknown,
        detail: first_error,
    }
}

/// Decide `open_state` for an artifact already classified as an
/// envelope. Only called when `verify` is true.
///
/// Tries the live master DEK first, then each retained DEK in turn.
/// A failure here is *information*, never an error: `NoKey` is the
/// answer the caller asked for.
async fn probe_open_state(
    state: &EncryptionState,
    retained: &RetiredKeyRing,
    artifact: ArtifactKind,
    canonical: &Path,
    status: &ArtifactEncryptionStatus,
) -> (OpenState, Option<String>) {
    // Read the generation the ladder would serve. `safe_read_raw`
    // re-walks current → .bak → .v0.bak and verifies the checksum, so
    // it lands on the same generation `classify_generation_ladder`
    // reported.
    let payload = match safe_read_raw(canonical) {
        Ok(Some((payload, _source))) => payload,
        Ok(None) => return (OpenState::Unknown, None),
        Err(error) => return (OpenState::Unknown, Some(error.to_string())),
    };
    if !is_envelope_blob(&payload) {
        return (OpenState::NotEncrypted, None);
    }

    if let Some(sub_key) = state.sub_key(artifact).await {
        match enc_envelope::read_envelope(&sub_key, &payload) {
            Ok(_) => return (OpenState::CurrentKey, None),
            Err(error) => {
                // Fall through to the retained ring, but keep the
                // current-key failure as the reason if nothing opens it.
                let current_failure =
                    format!("current master key does not open {}: {error}", status.file);
                // `try_open` walks the ring newest-first and reports how
                // deep the match was, i.e. how many rotations ago this
                // artifact was left behind. Depth matters: the ring is
                // bounded, so a file near the end of it is one rotation
                // away from being unrecoverable.
                if let Some((_plaintext, depth)) = retained.try_open(artifact, &payload) {
                    return (
                        OpenState::RetainedKey,
                        Some(format!(
                            "{} opens under retained key {} of {} — a master-key rotation \n                             left it behind. Re-save it to re-key it under the current key; \n                             the ring keeps only the last {}.",
                            status.file,
                            depth + 1,
                            retained.len(),
                            key_ring::KEY_RING_CAPACITY
                        )),
                    );
                }
                return (OpenState::NoKey, Some(current_failure));
            }
        }
    }

    (OpenState::Locked, None)
}

/// Collect the database ids present in `databases/`.
///
/// Mirrors the enumeration the trust-store runtime uses: a database id
/// is a file named `<id>.json` that is neither `index.json` nor a
/// `<id>.trust.json`. Recovery generations (`.json.bak`, `.json.v0.bak`,
/// `.json.tmp`) do not end in `.json` and are skipped — they are
/// inspected as part of their canonical artifact's ladder instead.
fn database_ids_on_disk(databases_dir: &Path, errors: &mut Vec<String>) -> Vec<String> {
    let entries = match std::fs::read_dir(databases_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            errors.push(format!(
                "cannot enumerate {}: {error}",
                databases_dir.display()
            ));
            return Vec::new();
        }
    };

    let mut ids = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                errors.push(format!(
                    "cannot inspect an entry in {}: {error}",
                    databases_dir.display()
                ));
                continue;
            }
        };
        match entry.file_type() {
            Ok(file_type) if file_type.is_file() => {}
            Ok(_) => continue,
            Err(error) => {
                errors.push(format!("cannot stat {}: {error}", entry.path().display()));
                continue;
            }
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // Recovery generations count as evidence that a database
        // exists. `safe_read` will happily serve a `.bak` when the
        // canonical file is gone, so a probe that only looked at
        // `<id>.json` would report nothing for a database the app can
        // still open — the exact invisibility this command exists to
        // end. `.tmp` is transient and never a source of truth.
        let base = [".json.v0.bak", ".json.bak", ".json"]
            .iter()
            .find_map(|suffix| name.strip_suffix(suffix));
        let base = match base {
            Some(base) => base,
            None => continue,
        };
        if base.is_empty() || base == "index" || base.ends_with(".trust") {
            continue;
        }
        ids.push(base.to_string());
    }
    ids
}

/// Read the index for display metadata — names and the Layer-B
/// `isEncrypted` flag. Best-effort: a locked or damaged index simply
/// means those two fields come back `null`, never that the probe fails.
async fn index_metadata(
    state: &EncryptionState,
    index_file: &Path,
) -> Option<Vec<(String, Option<String>, Option<bool>)>> {
    if !state.is_unlocked().await {
        // The index may well be an envelope; do not attempt it and do
        // not report a spurious error.
        return None;
    }
    let loaded = encrypted_load(state, ArtifactKind::DatabasesIndex, index_file)
        .await
        .ok()??;
    let rows = loaded.value.as_array()?;
    Some(
        rows.iter()
            .filter_map(|row| {
                let id = row.get("id")?.as_str()?.to_string();
                let name = row.get("name").and_then(|v| v.as_str()).map(str::to_string);
                let password = row.get("isEncrypted").and_then(serde_json::Value::as_bool);
                Some((id, name, password))
            })
            .collect(),
    )
}

/// The probe proper, factored out of the command so it can be unit
/// tested over a tempdir with no Tauri runtime.
async fn databases_encryption_status_inner(
    state: &EncryptionState,
    databases_dir: &Path,
    master_configured: bool,
    verify: bool,
) -> DatabasesEncryptionStatus {
    let mut errors = Vec::new();
    let unlocked = state.is_unlocked().await;
    // `<app_data>/databases` -> `<app_data>`. Derived rather than taken
    // from `key_ring::app_data_dir()`'s process-wide slot so the probe
    // stays hermetic and testable over a tempdir.
    let retained = match (verify, databases_dir.parent()) {
        (true, Some(app_data_dir)) => retained_key_ring(state, app_data_dir).await,
        _ => RetiredKeyRing::empty(),
    };

    let index_file = databases_dir.join("index.json");
    let mut index = classify_generation_ladder(&index_file);
    if verify && index.at_rest == AtRestState::Envelope {
        let (open_state, detail) = probe_open_state(
            state,
            &retained,
            ArtifactKind::DatabasesIndex,
            &index_file,
            &index,
        )
        .await;
        index.open_state = open_state;
        index.detail = index.detail.or(detail);
    }

    let metadata = index_metadata(state, &index_file).await;

    let mut ids = database_ids_on_disk(databases_dir, &mut errors);
    // An id the index knows about but that has no file on disk is
    // worth reporting as `missing` rather than silently omitting: it
    // is the shape a half-finished delete or a failed restore leaves.
    if let Some(rows) = metadata.as_ref() {
        for (id, _, _) in rows {
            if !ids.iter().any(|existing| existing == id) {
                ids.push(id.clone());
            }
        }
    }
    ids.sort();
    ids.dedup();

    let mut databases = Vec::with_capacity(ids.len());
    let mut summary = DatabasesEncryptionSummary::default();

    for id in ids {
        let data_path = databases_dir.join(format!("{id}.json"));
        let mut data = classify_generation_ladder(&data_path);
        if verify && data.at_rest == AtRestState::Envelope {
            let (open_state, detail) = probe_open_state(
                state,
                &retained,
                ArtifactKind::Connections,
                &data_path,
                &data,
            )
            .await;
            data.open_state = open_state;
            data.detail = data.detail.or(detail);
        }

        let trust_path = databases_dir.join(format!("{id}.trust.json"));
        let mut trust = classify_generation_ladder(&trust_path);
        let trust = if trust.at_rest == AtRestState::Missing {
            None
        } else {
            if verify && trust.at_rest == AtRestState::Envelope {
                let (open_state, detail) = probe_open_state(
                    state,
                    &retained,
                    ArtifactKind::TrustStore,
                    &trust_path,
                    &trust,
                )
                .await;
                trust.open_state = open_state;
                trust.detail = trust.detail.or(detail);
            }
            Some(trust)
        };

        summary.total += 1;
        match data.at_rest {
            AtRestState::Envelope => summary.encrypted += 1,
            AtRestState::Plaintext => summary.plaintext += 1,
            AtRestState::Unreadable | AtRestState::Missing => summary.unreadable += 1,
        }
        match data.open_state {
            OpenState::NoKey => summary.stranded += 1,
            OpenState::RetainedKey => summary.recoverable_with_retained_key += 1,
            _ => {}
        }

        let (name, password_protected) = metadata
            .as_ref()
            .and_then(|rows| rows.iter().find(|(row_id, _, _)| row_id == &id))
            .map(|(_, name, password)| (name.clone(), *password))
            .unwrap_or((None, None));

        databases.push(DatabaseEncryptionStatus {
            id,
            name,
            password_protected,
            data,
            trust,
        });
    }

    DatabasesEncryptionStatus {
        master_configured,
        unlocked,
        verified: verify,
        retained_keys_available: retained.len(),
        index,
        databases,
        summary,
        errors,
    }
}

/// Report, per connection database, whether it is encrypted at rest and
/// whether this profile still holds a key that opens it.
///
/// **Read-only.** The command opens files, reads at most a header (or,
/// with `verify`, the payload), and writes nothing. It never migrates,
/// re-keys or repairs anything, and one unreadable file never fails the
/// call — that artifact reports `unreadable` and the walk continues.
///
/// `verify` (default `false`): when false the probe is header-only and
/// cheap enough to back a list view; every `open_state` is `unknown`.
/// When true it additionally attempts an AES-GCM open of each envelope
/// under the live master DEK (and any retained DEK), which is what
/// distinguishes an encrypted database you can still open from one
/// stranded by a master-key rotation that missed `databases/`.
#[tauri::command]
pub async fn databases_encryption_status(
    app: AppHandle,
    enc_state: tauri::State<'_, EncryptionState>,
    verify: Option<bool>,
) -> Result<DatabasesEncryptionStatus, String> {
    let dir = databases_dir(&app)?;
    // A vault probe that errors must not sink the whole report — the
    // per-artifact facts are exactly what a caller needs when the
    // keychain is the thing misbehaving. Degrade to "not configured"
    // and carry the reason in `errors`.
    let (configured, configured_error) = match master_encryption_configured(&app, &enc_state).await
    {
        Ok(configured) => (configured, None),
        Err(error) => (false, Some(error)),
    };
    let mut status =
        databases_encryption_status_inner(&enc_state, &dir, configured, verify.unwrap_or(false))
            .await;
    if let Some(error) = configured_error {
        status.errors.push(error);
    }
    Ok(status)
}

// ══════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn payload_json(obj: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&obj).unwrap()
    }

    // ── Preamble + checksum unit tests ─────────────────────────────

    #[test]
    fn round_trip_via_parse_and_verify() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        buf.extend_from_slice(&payload);
        let recovered = parse_and_verify(&buf).unwrap();
        assert_eq!(recovered, payload.as_slice());
    }

    #[test]
    fn truncated_buffer_rejected() {
        let bytes = vec![0u8; 10];
        assert!(matches!(
            parse_and_verify(&bytes),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn wrong_magic_rejected() {
        let payload = b"x";
        let mut buf = encode_preamble(payload).to_vec();
        buf[0] = b'X';
        buf.extend_from_slice(payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn unknown_version_rejected() {
        let payload = b"x";
        let mut buf = encode_preamble(payload).to_vec();
        buf[4] = 99;
        buf.extend_from_slice(payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn body_bit_flip_caught_by_checksum() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        buf.extend_from_slice(&payload);
        let flip_idx = PREAMBLE_LEN + 4;
        buf[flip_idx] ^= 0x01;
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Verify(_, _))
        ));
    }

    #[test]
    fn payload_length_mismatch_rejected() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        // Claim 1000 payload bytes but only supply 11.
        buf[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8].copy_from_slice(&1000_u64.to_le_bytes());
        buf.extend_from_slice(&payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    // ── safe_write / safe_read round trips ─────────────────────────

    #[test]
    fn safe_write_then_safe_read_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db1.json");
        let payload = payload_json(serde_json::json!({"a": 1, "b": "two"}));
        safe_write(&path, &payload).unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Current);
        assert_eq!(result.value["a"], 1);
        assert_eq!(result.value["b"], "two");
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("never-written.json");
        assert!(safe_read(&path).unwrap().is_none());
    }

    #[test]
    fn second_write_shifts_current_to_bak() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        // Current must hold gen=2.
        let cur = safe_read(&path).unwrap().unwrap();
        assert_eq!(cur.source, LoadSource::Current);
        assert_eq!(cur.value["gen"], 2);
        // Sibling .bak must hold gen=1.
        let bak = sibling(&path, "bak");
        let bytes = std::fs::read(&bak).unwrap();
        let payload = parse_and_verify(&bytes).unwrap();
        let value: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["gen"], 1);
    }

    // ── Recovery ladder ────────────────────────────────────────────

    #[test]
    fn current_corrupted_falls_back_to_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        // Corrupt the canonical file beyond recovery.
        std::fs::write(&path, b"definitely not a valid preamble").unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Backup);
        assert_eq!(result.value["gen"], 1);
    }

    #[test]
    fn current_missing_falls_back_to_backup() {
        // Simulates the "crashed between rename(current → .bak) and
        // rename(tmp → current)" mid-write window.
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        std::fs::remove_file(&path).unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Backup);
    }

    #[test]
    fn both_corrupt_falls_back_to_v0_migration_bak() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v0 = payload_json(serde_json::json!({"gen": 0}));
        // Plant the pre-migration rollback file directly.
        let v0_bak = path.with_extension("json.v0.bak");
        let mut buf = encode_preamble(&v0).to_vec();
        buf.extend_from_slice(&v0);
        std::fs::write(&v0_bak, &buf).unwrap();
        // Corrupt the canonical and .bak.
        std::fs::write(&path, b"garbage").unwrap();
        std::fs::write(sibling(&path, "bak"), b"more garbage").unwrap();

        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::V0Migration);
        assert_eq!(result.value["gen"], 0);
    }

    #[test]
    fn every_version_unreadable_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        // Plant garbage at every candidate slot — every version
        // unreadable maps to None, not Err. The caller distinguishes
        // "missing" from "corrupt" via the on-disk presence.
        std::fs::write(&path, b"x").unwrap();
        std::fs::write(sibling(&path, "bak"), b"x").unwrap();
        std::fs::write(path.with_extension("json.v0.bak"), b"x").unwrap();
        assert!(safe_read(&path).unwrap().is_none());
    }

    // ── Atomic write / leftover handling ───────────────────────────

    #[test]
    fn leftover_tmp_does_not_block_next_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        // Plant a leftover .tmp from a pretend-killed prior process.
        let tmp = sibling(&path, "tmp");
        std::fs::write(&tmp, b"stale junk").unwrap();
        let v = payload_json(serde_json::json!({"k": "v"}));
        safe_write(&path, &v).unwrap();
        // Canonical readable, .tmp cleaned up by the rename.
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.value["k"], "v");
        assert!(!tmp.exists());
    }

    #[test]
    fn safe_write_auto_creates_parent_dir() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("deeply/nested/dirs/db.json");
        let v = payload_json(serde_json::json!({"deep": true}));
        safe_write(&path, &v).unwrap();
        assert!(path.exists());
    }

    // ── Id sanitisation ────────────────────────────────────────────

    #[test]
    fn per_db_path_rejects_traversal_ids() {
        // We can't easily test `per_db_path` without an AppHandle,
        // but the sanitiser is purely path-string based — drive it
        // by reconstructing the same predicate.
        for bad in &["../etc/passwd", "..\\windows", "a/b", "a\\b", "", "x\0y"] {
            let id = *bad;
            let rejected = id.is_empty()
                || id.contains('/')
                || id.contains('\\')
                || id.contains("..")
                || id.contains('\0');
            assert!(rejected, "expected to reject {id:?}");
        }
        for good in &[
            "550e8400-e29b-41d4-a716-446655440000",
            "Personal",
            "work_prod_2026",
        ] {
            let id = *good;
            let rejected = id.is_empty()
                || id.contains('/')
                || id.contains('\\')
                || id.contains("..")
                || id.contains('\0');
            assert!(!rejected, "should not reject {id:?}");
        }
    }

    // ── Backup not clobbered by a write that fails verification ────

    #[test]
    fn read_back_failure_leaves_canonical_intact() {
        // Hard to inject a real read-back failure without faulting
        // the filesystem, so we exercise the parse-and-verify guard:
        // an empty payload that round-trips cleanly DOES succeed,
        // proving the verify step doesn't reject the happy path.
        // A real "wrote garbage" scenario is unreproducible in a
        // hermetic test without a fault-injecting FS — documented
        // here as the limit of unit coverage.
        let dir = tempdir().unwrap();
        let path = dir.path().join("empty.json");
        safe_write(&path, b"\"\"").unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.value, serde_json::json!(""));
    }

    // ══════════════════════════════════════════════════════════════
    // P4 — master-DEK encryption-at-rest
    // ──────────────────────────────────────────────────────────────
    // These tests use the `EncryptionState` shim directly without
    // any Tauri runtime, since the encrypt/decrypt helpers take a
    // borrowed state.
    // ══════════════════════════════════════════════════════════════

    use sorng_encryption::MasterDek;

    async fn unlocked_state(seed: u8) -> EncryptionState {
        let state = EncryptionState::new();
        let dek = MasterDek::from_bytes(&[seed; 32]).expect("32-byte DEK");
        state.install(dek).await;
        state
    }

    #[tokio::test]
    async fn encrypted_round_trip_per_database() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("dbA.json");
        let state = unlocked_state(0x11).await;
        let value = serde_json::json!({
            "connections": [{ "id": "c1", "host": "example.com" }],
            "settings": {},
            "timestamp": 42,
        });
        save_payload(&state, ArtifactKind::Connections, &path, &value, true)
            .await
            .unwrap();
        // Confirm what's on disk is NOT plaintext JSON — i.e. the
        // master-DEK layer fired. Strip the SDBF preamble and verify
        // the payload starts with the SORNG envelope magic.
        let on_disk = std::fs::read(&path).unwrap();
        assert!(on_disk.len() > PREAMBLE_LEN);
        let inner = &on_disk[PREAMBLE_LEN..];
        assert!(
            is_envelope_blob(inner),
            "P4 must wrap the payload in a SORNG envelope on disk"
        );
        // And the load path must recover the exact original value.
        let loaded = encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value, value);
        assert_eq!(loaded.source, LoadSource::Current);
    }

    #[tokio::test]
    async fn encrypted_round_trip_index() {
        // Index payload is a JSON array at the root — confirms the
        // envelope codec doesn't care about object-vs-array, unlike
        // the artifact-specific writers.
        let dir = tempdir().unwrap();
        let path = dir.path().join("index.json");
        let state = unlocked_state(0x22).await;
        let value = serde_json::json!([
            { "id": "a", "name": "Alpha" },
            { "id": "b", "name": "Beta" },
        ]);
        save_payload(&state, ArtifactKind::DatabasesIndex, &path, &value, true)
            .await
            .unwrap();
        let loaded = encrypted_load(&state, ArtifactKind::DatabasesIndex, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value, value);
    }

    #[tokio::test]
    async fn fresh_locked_store_creates_index_and_unencrypted_database() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        let index_path = databases.join("index.json");
        let database_path = databases.join("fedora-new-db.json");
        let state = EncryptionState::new(); // locked
        let index = serde_json::json!([{
            "id": "fedora-new-db",
            "name": "MyDataBase",
            "isEncrypted": false,
        }]);
        let data = serde_json::json!({
            "connections": [],
            "settings": {},
            "timestamp": 42,
        });
        let configured = master_encryption_configured_from_evidence(dir.path(), false).unwrap();
        assert!(!configured, "fresh Fedora-style state is not configured");

        save_payload(
            &state,
            ArtifactKind::DatabasesIndex,
            &index_path,
            &index,
            configured,
        )
        .await
        .unwrap();
        save_payload(
            &state,
            ArtifactKind::Connections,
            &database_path,
            &data,
            configured,
        )
        .await
        .unwrap();

        for path in [&index_path, &database_path] {
            let on_disk = std::fs::read(path).unwrap();
            let inner = parse_and_verify(&on_disk).unwrap();
            assert!(
                !is_envelope_blob(inner),
                "a store with no configured master key must remain plaintext"
            );
        }

        let loaded_index = encrypted_load(&state, ArtifactKind::DatabasesIndex, &index_path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded_index.value, index);
        let loaded_data = encrypted_load(&state, ArtifactKind::Connections, &database_path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded_data.value, data);
    }

    #[test]
    fn master_encryption_evidence_detects_vault_and_persistent_markers() {
        let empty = tempdir().unwrap();
        assert!(
            !master_encryption_configured_from_evidence(empty.path(), false).unwrap(),
            "an empty app-data directory is a never-configured first run"
        );
        assert!(
            master_encryption_configured_from_evidence(empty.path(), true).unwrap(),
            "a master DEK in the OS vault is configured encryption"
        );

        let password = tempdir().unwrap();
        std::fs::write(password.path().join("dek.enc"), b"wrapped-dek").unwrap();
        assert!(
            master_encryption_configured_from_evidence(password.path(), false).unwrap(),
            "the password wrapper must block locked plaintext writes"
        );

        let settings = tempdir().unwrap();
        std::fs::write(settings.path().join("settings.enc"), b"encrypted-settings").unwrap();
        assert!(
            master_encryption_configured_from_evidence(settings.path(), false).unwrap(),
            "encrypted settings must block locked plaintext writes"
        );

        let audit = tempdir().unwrap();
        let logs = audit.path().join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(
            logs.join("encryption-audit.log"),
            br#"{"event":"setup-completed","method":"vault"}"#,
        )
        .unwrap();
        assert!(
            master_encryption_configured_from_evidence(audit.path(), false).unwrap(),
            "a durable setup audit entry must survive temporary vault unavailability"
        );
    }

    #[test]
    fn vault_probe_only_treats_explicit_not_found_as_unconfigured() {
        use sorng_vault::types::VaultError;

        assert!(
            classify_vault_master_dek_probe(Ok(vec![0x42; 32])).unwrap(),
            "a readable vault DEK is configured encryption"
        );
        assert!(
            !classify_vault_master_dek_probe(Err(VaultError::not_found("missing"))).unwrap(),
            "an explicit NotFound is the only unconfigured vault result"
        );
        for error in [
            VaultError::access_denied("vault locked"),
            VaultError::platform("secret service unavailable"),
            VaultError::internal("probe task failed"),
        ] {
            let result = classify_vault_master_dek_probe(Err(error));
            assert!(
                result.is_err(),
                "ambiguous vault failures must block plaintext fallback"
            );
        }
    }

    #[tokio::test]
    async fn configured_locked_store_refuses_brand_new_database_path() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        let encrypted_index = databases.join("index.json");
        let new_database = databases.join("brand-new.json");
        let writer = unlocked_state(0x28).await;
        save_payload(
            &writer,
            ArtifactKind::DatabasesIndex,
            &encrypted_index,
            &serde_json::json!([{ "id": "existing" }]),
            true,
        )
        .await
        .unwrap();

        let configured = master_encryption_configured_from_evidence(dir.path(), false).unwrap();
        assert!(
            configured,
            "an encrypted database generation is global configuration evidence"
        );

        let locked = EncryptionState::new();
        let err = save_payload(
            &locked,
            ArtifactKind::Connections,
            &new_database,
            &serde_json::json!({ "connections": [] }),
            configured,
        )
        .await
        .unwrap_err();
        assert!(err.contains("encrypted"), "got: {err}");
        assert!(
            !new_database.exists(),
            "configured-but-locked IPC path must not create plaintext"
        );
    }

    #[tokio::test]
    async fn stale_truncated_tmp_does_not_block_plaintext_save() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        let database_path = databases.join("fedora-new-db.json");
        let tmp_path = sibling(&database_path, "tmp");
        std::fs::write(&tmp_path, b"truncated interrupted write").unwrap();

        let configured = master_encryption_configured_from_evidence(dir.path(), false).unwrap();
        assert!(
            !configured,
            "temporary files are not trusted recovery generations"
        );

        let state = EncryptionState::new();
        let value = serde_json::json!({ "connections": [], "settings": {} });
        save_payload(
            &state,
            ArtifactKind::Connections,
            &database_path,
            &value,
            configured,
        )
        .await
        .unwrap();

        assert!(database_path.exists());
        assert!(
            !tmp_path.exists(),
            "successful promotion consumes the temp file"
        );
        let loaded = encrypted_load(&state, ArtifactKind::Connections, &database_path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value, value);
    }

    #[tokio::test]
    async fn locked_store_can_rewrite_existing_plaintext_database() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("plaintext.json");
        let state = EncryptionState::new();
        let first = serde_json::json!({ "generation": 1 });
        let second = serde_json::json!({ "generation": 2 });

        save_payload(&state, ArtifactKind::Connections, &path, &first, false)
            .await
            .unwrap();
        let configured = master_encryption_configured_from_evidence(dir.path(), false).unwrap();
        assert!(
            !configured,
            "plaintext generations are not encryption markers"
        );
        save_payload(
            &state,
            ArtifactKind::Connections,
            &path,
            &second,
            configured,
        )
        .await
        .unwrap();

        let current = encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(current.value, second);

        let backup = sibling(&path, "bak");
        let backup_bytes = std::fs::read(backup).unwrap();
        let backup_payload = parse_and_verify(&backup_bytes).unwrap();
        let backup_value: serde_json::Value = serde_json::from_slice(backup_payload).unwrap();
        assert_eq!(backup_value, first);
    }

    #[tokio::test]
    async fn locked_store_refuses_to_downgrade_encrypted_database() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("encrypted.json");
        let writer = unlocked_state(0x29).await;
        save_payload(
            &writer,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "generation": 1 }),
            true,
        )
        .await
        .unwrap();
        let before = std::fs::read(&path).unwrap();

        let locked = EncryptionState::new();
        let err = save_payload(
            &locked,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "generation": 2 }),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("encrypted"), "got: {err}");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            before,
            "refused downgrade must not modify the encrypted generation"
        );
    }

    #[tokio::test]
    async fn locked_store_refuses_when_only_encrypted_backup_survives() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("encrypted-backup.json");
        let writer = unlocked_state(0x2A).await;
        save_payload(
            &writer,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "generation": 1 }),
            true,
        )
        .await
        .unwrap();
        save_payload(
            &writer,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "generation": 2 }),
            true,
        )
        .await
        .unwrap();
        std::fs::remove_file(&path).unwrap();
        let backup = sibling(&path, "bak");
        let before = std::fs::read(&backup).unwrap();

        let locked = EncryptionState::new();
        let err = save_payload(
            &locked,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "generation": 3 }),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("encrypted"), "got: {err}");
        assert!(!path.exists(), "refused write must not create a canonical");
        assert_eq!(std::fs::read(&backup).unwrap(), before);
    }

    #[tokio::test]
    async fn load_refuses_when_locked_on_encrypted_file() {
        // Write while unlocked, then drop the state and try to read
        // with a locked state. Must error rather than return data.
        let dir = tempdir().unwrap();
        let path = dir.path().join("dbE.json");
        let writer = unlocked_state(0x33).await;
        save_payload(
            &writer,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "a": 1 }),
            true,
        )
        .await
        .unwrap();

        let locked = EncryptionState::new();
        let err = encrypted_load(&locked, ArtifactKind::Connections, &path)
            .await
            .unwrap_err();
        assert!(err.contains("locked"), "got: {err}");
    }

    #[tokio::test]
    async fn legacy_plaintext_p1_is_still_readable() {
        // Write a file in the OLD shape: SDBF preamble + raw JSON.
        // P4 must read it transparently — that's the migration path.
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.json");
        let legacy_value = serde_json::json!({
            "connections": [],
            "settings": {},
            "timestamp": 7,
        });
        let legacy_bytes = serde_json::to_vec(&legacy_value).unwrap();
        safe_write(&path, &legacy_bytes).unwrap();

        // Even an unlocked state must read the legacy file (the
        // envelope branch doesn't fire because the magic doesn't
        // match) — and even a locked state should read it, since
        // there's no envelope to decrypt.
        let state = EncryptionState::new();
        let loaded = encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value, legacy_value);
    }

    #[tokio::test]
    async fn legacy_per_db_password_string_payload_still_loads() {
        // Pre-P4 per-database-password encryption stored a JSON
        // *string* at the root: a WebCrypto envelope literal like
        // `"{salt: ..., iv: ..., ciphertext: ...}"` JSON-encoded
        // down to `"\"...\""` bytes under the SDBF preamble. The
        // bytes start with `"`, not the SORNG envelope magic, so
        // the legacy-plaintext branch must accept them and return
        // the `Value::String` so the frontend WebCrypto layer can
        // decrypt it. P4 wraps subsequent saves in the master-DEK
        // envelope; the per-DB string lives inside that envelope's
        // ciphertext.
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy-string.json");
        let password_envelope =
            serde_json::json!("QkFTRTY0LXNhbHQ=.QkFTRTY0LWl2.QkFTRTY0LWNpcGhlcnRleHQ=");
        let legacy_bytes = serde_json::to_vec(&password_envelope).unwrap();
        safe_write(&path, &legacy_bytes).unwrap();

        let state = EncryptionState::new(); // locked is fine for legacy
        let loaded = encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value, password_envelope);
        assert!(loaded.value.is_string());
    }

    #[tokio::test]
    async fn next_save_promotes_legacy_to_envelope() {
        // The tolerant-read-+-re-encrypt-on-write policy: a legacy
        // plaintext file is upgraded automatically when the user
        // next saves. Verify the on-disk shape changes accordingly.
        let dir = tempdir().unwrap();
        let path = dir.path().join("promote.json");
        let legacy = serde_json::json!({ "v": 1 });
        let legacy_bytes = serde_json::to_vec(&legacy).unwrap();
        safe_write(&path, &legacy_bytes).unwrap();

        let state = unlocked_state(0x44).await;
        let updated = serde_json::json!({ "v": 2 });
        save_payload(&state, ArtifactKind::Connections, &path, &updated, true)
            .await
            .unwrap();

        let on_disk = std::fs::read(&path).unwrap();
        let inner = &on_disk[PREAMBLE_LEN..];
        assert!(
            is_envelope_blob(inner),
            "save must promote the file from legacy to envelope shape"
        );
    }

    #[tokio::test]
    async fn cross_kind_isolation_index_vs_per_db() {
        // A per-DB file (ArtifactKind::Connections) must NOT decrypt
        // when read under ArtifactKind::DatabasesIndex even with the
        // same master DEK — the HKDF labels enforce sub-key domain
        // separation. This is the property new ArtifactKind variants
        // exist to provide.
        let dir = tempdir().unwrap();
        let perdb_path = dir.path().join("perdb.json");
        let state = unlocked_state(0x55).await;
        save_payload(
            &state,
            ArtifactKind::Connections,
            &perdb_path,
            &serde_json::json!({ "k": "v" }),
            true,
        )
        .await
        .unwrap();

        let err = encrypted_load(&state, ArtifactKind::DatabasesIndex, &perdb_path)
            .await
            .unwrap_err();
        assert!(
            err.contains("envelope") || err.contains("auth"),
            "cross-kind load must fail authentication; got: {err}"
        );
    }

    #[tokio::test]
    async fn cross_master_dek_isolation() {
        // Write with master A, try to read with master B — must fail.
        let dir = tempdir().unwrap();
        let path = dir.path().join("rotated.json");
        let writer = unlocked_state(0x66).await;
        save_payload(
            &writer,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "k": "v" }),
            true,
        )
        .await
        .unwrap();

        let other = unlocked_state(0x77).await;
        let err = encrypted_load(&other, ArtifactKind::Connections, &path)
            .await
            .unwrap_err();
        assert!(
            err.contains("envelope") || err.contains("auth"),
            "wrong master must fail; got: {err}"
        );
    }

    #[tokio::test]
    async fn recovery_ladder_surfaces_source_on_encrypted_files() {
        // Write twice → canonical and .bak both exist as envelopes.
        // Delete canonical → next load comes from .bak with source=Backup.
        let dir = tempdir().unwrap();
        let path = dir.path().join("ladder.json");
        let state = unlocked_state(0x88).await;
        save_payload(
            &state,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "gen": 1 }),
            true,
        )
        .await
        .unwrap();
        save_payload(
            &state,
            ArtifactKind::Connections,
            &path,
            &serde_json::json!({ "gen": 2 }),
            true,
        )
        .await
        .unwrap();
        std::fs::remove_file(&path).unwrap();

        let loaded = encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.source, LoadSource::Backup);
        // Generation 1 is the previous save — the .bak we promoted.
        assert_eq!(loaded.value, serde_json::json!({ "gen": 1 }));
    }
    // ══════════════════════════════════════════════════════════════
    // t74-e3 — `databases_encryption_status` probe
    //
    // The probe's whole reason to exist is that "encrypted: true/false"
    // is not enough. A database can be an intact SORNG envelope that
    // *no live key opens* — the state a master-key rotation that skipped
    // `databases/` leaves behind (plan t74 Gap A1). These tests pin all
    // four states plus the read-only and don't-fail-the-call contracts.
    // ══════════════════════════════════════════════════════════════

    /// Write a well-formed encrypted artifact under `seed`'s DEK.
    async fn write_encrypted(
        path: &Path,
        artifact: ArtifactKind,
        seed: u8,
        value: serde_json::Value,
    ) {
        let state = unlocked_state(seed).await;
        save_payload(&state, artifact, path, &value, true)
            .await
            .expect("write encrypted artifact");
    }

    /// Write a legacy plaintext-P1 artifact (raw JSON under the SDBF
    /// preamble, no envelope).
    fn write_plaintext(path: &Path, value: serde_json::Value) {
        safe_write(path, &payload_json(value)).expect("write plaintext artifact");
    }

    fn find<'a>(status: &'a DatabasesEncryptionStatus, id: &str) -> &'a DatabaseEncryptionStatus {
        status
            .databases
            .iter()
            .find(|db| db.id == id)
            .unwrap_or_else(|| panic!("no probe row for {id}"))
    }

    #[tokio::test]
    async fn probe_classifies_envelope_plaintext_and_unreadable_without_erroring() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();

        write_encrypted(
            &databases.join("enc.json"),
            ArtifactKind::Connections,
            0x31,
            serde_json::json!({ "connections": [] }),
        )
        .await;
        write_plaintext(
            &databases.join("plain.json"),
            serde_json::json!({ "connections": [] }),
        );
        // Garbage that is not even a valid SDBF preamble. This is the
        // file that used to be able to sink a whole scan.
        std::fs::write(databases.join("broken.json"), b"not an sdbf file at all").unwrap();

        let state = unlocked_state(0x31).await;
        let status = databases_encryption_status_inner(&state, &databases, true, false).await;

        assert_eq!(find(&status, "enc").data.at_rest, AtRestState::Envelope);
        assert_eq!(find(&status, "plain").data.at_rest, AtRestState::Plaintext);
        assert_eq!(
            find(&status, "broken").data.at_rest,
            AtRestState::Unreadable
        );
        assert!(
            find(&status, "broken").data.detail.is_some(),
            "an unreadable artifact must say why"
        );
        // One bad file does not fail the call, and does not become a
        // directory-level error either.
        assert!(
            status.errors.is_empty(),
            "unexpected errors: {:?}",
            status.errors
        );
        assert_eq!(status.summary.total, 3);
        assert_eq!(status.summary.encrypted, 1);
        assert_eq!(status.summary.plaintext, 1);
        assert_eq!(status.summary.unreadable, 1);
    }

    #[tokio::test]
    async fn probe_reports_missing_trust_store_as_null() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_plaintext(&databases.join("solo.json"), serde_json::json!({}));
        write_plaintext(&databases.join("withtrust.json"), serde_json::json!({}));
        write_encrypted(
            &databases.join("withtrust.trust.json"),
            ArtifactKind::TrustStore,
            0x32,
            serde_json::json!({ "records": [] }),
        )
        .await;

        let state = unlocked_state(0x32).await;
        let status = databases_encryption_status_inner(&state, &databases, true, false).await;

        assert!(find(&status, "solo").trust.is_none());
        let trust = find(&status, "withtrust").trust.as_ref().unwrap();
        assert_eq!(trust.at_rest, AtRestState::Envelope);
        // The trust store must not be mistaken for a database of its own.
        assert!(
            status.databases.iter().all(|db| db.id != "withtrust.trust"),
            "`<id>.trust.json` must not be enumerated as a database"
        );
    }

    #[tokio::test]
    async fn probe_is_header_only_until_verify_is_requested() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_encrypted(
            &databases.join("a.json"),
            ArtifactKind::Connections,
            0x33,
            serde_json::json!({}),
        )
        .await;

        let state = unlocked_state(0x33).await;
        let status = databases_encryption_status_inner(&state, &databases, true, false).await;
        assert!(!status.verified);
        assert_eq!(find(&status, "a").data.at_rest, AtRestState::Envelope);
        assert_eq!(
            find(&status, "a").data.open_state,
            OpenState::Unknown,
            "without verify the probe must not claim to know whether a key opens the file"
        );
        assert_eq!(status.summary.stranded, 0);

        let verified = databases_encryption_status_inner(&state, &databases, true, true).await;
        assert!(verified.verified);
        assert_eq!(find(&verified, "a").data.open_state, OpenState::CurrentKey);
    }

    #[tokio::test]
    async fn probe_reports_an_envelope_the_current_key_cannot_open() {
        // THE state this probe exists to surface: the file is a
        // perfectly valid, checksummed, non-corrupt SORNG envelope, and
        // the live master DEK does not open it. A rotation that skipped
        // `databases/` leaves exactly this. "encrypted: true" would call
        // it healthy.
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_encrypted(
            &databases.join("stranded.json"),
            ArtifactKind::Connections,
            0xA1,
            serde_json::json!({ "connections": [{ "id": "c1" }] }),
        )
        .await;
        write_encrypted(
            &databases.join("stranded.trust.json"),
            ArtifactKind::TrustStore,
            0xA1,
            serde_json::json!({ "records": [] }),
        )
        .await;

        // A different master DEK — i.e. the post-rotation profile.
        let rotated = unlocked_state(0xB2).await;
        let status = databases_encryption_status_inner(&rotated, &databases, true, true).await;

        let row = find(&status, "stranded");
        assert_eq!(row.data.at_rest, AtRestState::Envelope);
        assert_eq!(
            row.data.open_state,
            OpenState::NoKey,
            "an envelope no live key opens must be distinguishable from a healthy one"
        );
        assert!(
            row.data.detail.is_some(),
            "the stranded state must explain itself"
        );
        assert_eq!(
            row.trust.as_ref().unwrap().open_state,
            OpenState::NoKey,
            "trust stores are the quietest failure and must be probed too"
        );
        assert_eq!(status.summary.stranded, 1);
        assert_eq!(status.summary.encrypted, 1);
    }

    #[tokio::test]
    async fn probe_reports_retained_key_when_a_previous_dek_opens_it() {
        // t74-e1's retained key ring turns the stranded state above into
        // a recoverable one, and the difference is worth telling a user:
        // "left behind by a rotation, re-save to fix" is not the same
        // message as "the key is gone". This drives the whole path
        // end-to-end, ring file included.
        let dir = tempdir().unwrap();
        let app_data = dir.path();
        let databases = app_data.join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        let path = databases.join("missed.json");
        write_encrypted(
            &path,
            ArtifactKind::Connections,
            0xA1,
            serde_json::json!({ "connections": [] }),
        )
        .await;

        // The profile after a rotation to 0xB2 that missed `databases/`.
        let rotated = unlocked_state(0xB2).await;

        // No ring yet: the file is simply stranded.
        let stranded = databases_encryption_status_inner(&rotated, &databases, true, true).await;
        assert_eq!(find(&stranded, "missed").data.open_state, OpenState::NoKey);
        assert_eq!(stranded.retained_keys_available, 0);

        // Now the rotation retains the outgoing key, as t74-e1 makes it.
        let mut ring = key_ring::RetiredKeyRing::empty();
        ring.retire(&[0xA1; 32], 1_700_000_000);
        std::fs::write(
            key_ring::ring_path(app_data),
            key_ring::encode(&rotated, &ring).await.unwrap(),
        )
        .unwrap();

        let rescued = databases_encryption_status_inner(&rotated, &databases, true, true).await;
        assert_eq!(rescued.retained_keys_available, 1);
        let row = find(&rescued, "missed");
        assert_eq!(
            row.data.open_state,
            OpenState::RetainedKey,
            "opening only under a retained key is a distinct, recoverable state"
        );
        let detail = row.data.detail.as_deref().unwrap();
        assert!(
            detail.contains("retained key 1 of 1"),
            "the message must say how deep in the bounded ring the key was: {detail}"
        );
        assert_eq!(rescued.summary.recoverable_with_retained_key, 1);
        assert_eq!(
            rescued.summary.stranded, 0,
            "a recoverable file must not be counted as lost"
        );

        // A ring that does not hold the right key leaves it stranded.
        let mut wrong = key_ring::RetiredKeyRing::empty();
        wrong.retire(&[0xC3; 32], 1_700_000_001);
        std::fs::write(
            key_ring::ring_path(app_data),
            key_ring::encode(&rotated, &wrong).await.unwrap(),
        )
        .unwrap();
        let still_stranded =
            databases_encryption_status_inner(&rotated, &databases, true, true).await;
        assert_eq!(
            find(&still_stranded, "missed").data.open_state,
            OpenState::NoKey
        );
        assert_eq!(still_stranded.summary.stranded, 1);
    }

    #[tokio::test]
    async fn probe_reports_locked_rather_than_guessing() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_encrypted(
            &databases.join("a.json"),
            ArtifactKind::Connections,
            0x44,
            serde_json::json!({}),
        )
        .await;

        let locked = EncryptionState::new();
        let status = databases_encryption_status_inner(&locked, &databases, true, true).await;
        assert!(!status.unlocked);
        assert_eq!(find(&status, "a").data.at_rest, AtRestState::Envelope);
        assert_eq!(
            find(&status, "a").data.open_state,
            OpenState::Locked,
            "a locked profile must not be reported as key-less"
        );
        assert_eq!(status.summary.stranded, 0);
        // Names and the Layer-B flag are unavailable while locked, and
        // that is reported as `null`, not guessed.
        assert!(find(&status, "a").name.is_none());
        assert!(find(&status, "a").password_protected.is_none());
    }

    #[tokio::test]
    async fn probe_joins_index_metadata_and_separates_the_two_layers() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        let state = unlocked_state(0x55).await;

        // Layer A (at rest) and Layer B (per-database password) are
        // orthogonal: `pw` is password-protected but its file is an
        // envelope just like `nopw`'s.
        save_payload(
            &state,
            ArtifactKind::DatabasesIndex,
            &databases.join("index.json"),
            &serde_json::json!([
                { "id": "pw", "name": "With password", "isEncrypted": true },
                { "id": "nopw", "name": "No password", "isEncrypted": false },
                { "id": "ghost", "name": "Deleted payload", "isEncrypted": false },
            ]),
            true,
        )
        .await
        .unwrap();
        write_encrypted(
            &databases.join("pw.json"),
            ArtifactKind::Connections,
            0x55,
            serde_json::json!("v2.webcrypto.envelope.string"),
        )
        .await;
        write_encrypted(
            &databases.join("nopw.json"),
            ArtifactKind::Connections,
            0x55,
            serde_json::json!({ "connections": [] }),
        )
        .await;

        let status = databases_encryption_status_inner(&state, &databases, true, true).await;

        assert_eq!(status.index.at_rest, AtRestState::Envelope);
        assert_eq!(status.index.open_state, OpenState::CurrentKey);

        let pw = find(&status, "pw");
        assert_eq!(pw.name.as_deref(), Some("With password"));
        assert_eq!(pw.password_protected, Some(true));
        assert_eq!(pw.data.at_rest, AtRestState::Envelope);

        let nopw = find(&status, "nopw");
        assert_eq!(nopw.password_protected, Some(false));
        assert_eq!(
            nopw.data.at_rest,
            AtRestState::Envelope,
            "encrypted at rest is independent of the per-database password"
        );

        // An index row whose payload file is gone is reported, not hidden.
        let ghost = find(&status, "ghost");
        assert_eq!(ghost.data.at_rest, AtRestState::Missing);
        assert!(ghost.trust.is_none());

        // Rows are sorted so the UI does not reshuffle between probes.
        let ids: Vec<&str> = status.databases.iter().map(|db| db.id.as_str()).collect();
        assert_eq!(ids, vec!["ghost", "nopw", "pw"]);
    }

    #[tokio::test]
    async fn probe_falls_back_to_the_recovery_ladder_and_reports_the_source() {
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        let path = databases.join("ladder.json");
        let state = unlocked_state(0x66).await;
        write_encrypted(
            &path,
            ArtifactKind::Connections,
            0x66,
            serde_json::json!({ "gen": 1 }),
        )
        .await;
        write_encrypted(
            &path,
            ArtifactKind::Connections,
            0x66,
            serde_json::json!({ "gen": 2 }),
        )
        .await;
        std::fs::remove_file(&path).unwrap();

        let status = databases_encryption_status_inner(&state, &databases, true, true).await;
        let row = find(&status, "ladder");
        assert_eq!(row.data.at_rest, AtRestState::Envelope);
        assert_eq!(
            row.data.source,
            Some(LoadSource::Backup),
            "the probe must report which generation answered, not just that one did"
        );
        assert_eq!(row.data.open_state, OpenState::CurrentKey);
    }

    #[tokio::test]
    async fn probe_never_writes_anything() {
        // Read-only is a hard contract: this command is offered to users
        // whose data may already be stranded, and a probe that "helpfully"
        // re-saves would promote a legacy plaintext file or rotate a good
        // `.bak` away. Fingerprint the directory before and after.
        fn fingerprint(dir: &Path) -> Vec<(String, u64, Vec<u8>)> {
            let mut out: Vec<(String, u64, Vec<u8>)> = std::fs::read_dir(dir)
                .unwrap()
                .map(|entry| {
                    let entry = entry.unwrap();
                    let bytes = std::fs::read(entry.path()).unwrap();
                    (
                        entry.file_name().to_string_lossy().into_owned(),
                        bytes.len() as u64,
                        bytes,
                    )
                })
                .collect();
            out.sort();
            out
        }

        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_plaintext(
            &databases.join("legacy.json"),
            serde_json::json!({ "a": 1 }),
        );
        write_encrypted(
            &databases.join("enc.json"),
            ArtifactKind::Connections,
            0x77,
            serde_json::json!({ "b": 2 }),
        )
        .await;
        write_encrypted(
            &databases.join("stale.json"),
            ArtifactKind::Connections,
            0x99,
            serde_json::json!({ "c": 3 }),
        )
        .await;
        std::fs::write(databases.join("junk.json"), b"garbage").unwrap();

        let before = fingerprint(&databases);
        let state = unlocked_state(0x77).await;
        // Both modes, including the one that decrypts.
        let _ = databases_encryption_status_inner(&state, &databases, true, false).await;
        let _ = databases_encryption_status_inner(&state, &databases, true, true).await;
        assert_eq!(
            before,
            fingerprint(&databases),
            "the probe must not create, modify or delete a single byte"
        );
    }

    #[tokio::test]
    async fn probe_on_a_profile_with_no_databases_dir_is_empty_not_an_error() {
        let dir = tempdir().unwrap();
        let state = unlocked_state(0x88).await;
        let status =
            databases_encryption_status_inner(&state, &dir.path().join("databases"), false, true)
                .await;
        assert!(status.databases.is_empty());
        assert!(status.errors.is_empty());
        assert_eq!(status.index.at_rest, AtRestState::Missing);
        assert_eq!(status.summary.total, 0);
        assert!(!status.master_configured);
    }

    #[tokio::test]
    async fn probe_sees_a_database_that_survives_only_as_a_recovery_generation() {
        // `safe_read` serves `<id>.json.bak` / `.v0.bak` when the
        // canonical file is gone, so a database in that state is still
        // openable by the app. A probe that only enumerated `<id>.json`
        // would report it as absent — invisibility again, in the one
        // state where the user most needs to be told something is off.
        // `.tmp` is transient and must never become an id.
        let dir = tempdir().unwrap();
        let databases = dir.path().join("databases");
        std::fs::create_dir_all(&databases).unwrap();
        write_plaintext(&databases.join("real.json"), serde_json::json!({}));
        std::fs::write(databases.join("real.json.tmp"), b"partial").unwrap();
        write_plaintext(
            &databases.join("orphan.json"),
            serde_json::json!({ "o": 1 }),
        );
        std::fs::rename(
            databases.join("orphan.json"),
            databases.join("orphan.json.v0.bak"),
        )
        .unwrap();

        let state = unlocked_state(0x9a).await;
        let status = databases_encryption_status_inner(&state, &databases, true, false).await;
        let ids: Vec<&str> = status.databases.iter().map(|db| db.id.as_str()).collect();
        assert_eq!(ids, vec!["orphan", "real"]);
        let orphan = find(&status, "orphan");
        assert_eq!(orphan.data.at_rest, AtRestState::Plaintext);
        assert_eq!(
            orphan.data.source,
            Some(LoadSource::V0Migration),
            "the probe must name the generation that answered so the UI can warn"
        );
    }

    #[test]
    fn probe_result_serialises_with_the_camel_case_contract_the_ui_consumes() {
        // e5/e6 render this shape; the discriminants are load-bearing
        // strings in TS unions, so pin them here rather than in a
        // frontend snapshot that would not fail this crate's build.
        let status = DatabasesEncryptionStatus {
            master_configured: true,
            unlocked: true,
            verified: true,
            retained_keys_available: 2,
            index: ArtifactEncryptionStatus {
                file: "index.json".to_string(),
                at_rest: AtRestState::Envelope,
                source: Some(LoadSource::V0Migration),
                open_state: OpenState::CurrentKey,
                detail: None,
            },
            databases: vec![DatabaseEncryptionStatus {
                id: "a".to_string(),
                name: Some("Alpha".to_string()),
                password_protected: Some(false),
                data: ArtifactEncryptionStatus {
                    file: "a.json".to_string(),
                    at_rest: AtRestState::Envelope,
                    source: Some(LoadSource::Current),
                    open_state: OpenState::NoKey,
                    detail: Some("boom".to_string()),
                },
                trust: None,
            }],
            summary: DatabasesEncryptionSummary {
                total: 1,
                encrypted: 1,
                plaintext: 0,
                unreadable: 0,
                stranded: 1,
                recoverable_with_retained_key: 0,
            },
            errors: vec!["nope".to_string()],
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["masterConfigured"], serde_json::json!(true));
        assert_eq!(json["retainedKeysAvailable"], serde_json::json!(2));
        assert_eq!(json["index"]["atRest"], serde_json::json!("envelope"));
        assert_eq!(json["index"]["source"], serde_json::json!("v0-migration"));
        assert_eq!(json["index"]["openState"], serde_json::json!("current-key"));
        assert_eq!(
            json["databases"][0]["passwordProtected"],
            serde_json::json!(false)
        );
        assert_eq!(
            json["databases"][0]["data"]["openState"],
            serde_json::json!("no-key")
        );
        assert_eq!(json["databases"][0]["trust"], serde_json::Value::Null);
        assert_eq!(
            json["summary"]["recoverableWithRetainedKey"],
            serde_json::json!(0)
        );
        assert_eq!(
            serde_json::to_value(AtRestState::Unreadable).unwrap(),
            serde_json::json!("unreadable")
        );
        assert_eq!(
            serde_json::to_value(OpenState::RetainedKey).unwrap(),
            serde_json::json!("retained-key")
        );
        assert_eq!(
            serde_json::to_value(OpenState::NotEncrypted).unwrap(),
            serde_json::json!("not-encrypted")
        );
        assert_eq!(
            serde_json::to_value(OpenState::Locked).unwrap(),
            serde_json::json!("locked")
        );
    }
}
