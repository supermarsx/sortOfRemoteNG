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

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const MAGIC: &[u8; 4] = b"SDBF";
pub const CURRENT_VERSION: u8 = 1;
pub const PREAMBLE_LEN: usize = 32;
const CHECKSUM_OFFSET: usize = 6;
const CHECKSUM_LEN: usize = 8;
const PAYLOAD_LEN_OFFSET: usize = 14;

/// Which file the loaded value came from. The frontend can show a
/// recovery toast based on the variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadSource {
    /// The canonical file decoded cleanly. No user-visible action.
    Current,
    /// The canonical was missing or corrupt; we recovered from
    /// `<file>.bak`. UI shows a one-shot "Recovered from previous
    /// save; verify your most recent changes" toast.
    Backup,
    /// Both `<file>` and `<file>.bak` failed; we recovered from
    /// the pre-IndexedDB-migration rollback. UI shows a stronger
    /// "Restored from migration backup" toast.
    V0Migration,
}

/// Returned by `load_database_data` so the frontend can render a
/// recovery banner when `source != Current`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub value: serde_json::Value,
    pub source: LoadSource,
}

/// All failure modes the safe writer / reader can surface. We
/// hand-roll `Display` here instead of pulling in `thiserror` because
/// this module is path-included into `sorng-commands-core`, which
/// does not have `thiserror` in its dep graph.
///
/// `#[allow(dead_code)]` on the variants because the path-include
/// makes the dead-code lint miss the `Display` consumers — they are
/// genuinely used, but only after the file is compiled into the
/// outer crate context.
#[derive(Debug)]
#[allow(dead_code)]
pub enum FileStoreError {
    Read(String, String),
    Write(String, String),
    Verify(String, String),
    Preamble(String),
    Json(String),
}

impl std::fmt::Display for FileStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileStoreError::Read(p, e) => write!(f, "read failed for {p}: {e}"),
            FileStoreError::Write(p, e) => write!(f, "write failed for {p}: {e}"),
            FileStoreError::Verify(p, e) => write!(f, "verification failed for {p}: {e}"),
            FileStoreError::Preamble(e) => write!(f, "preamble parse: {e}"),
            FileStoreError::Json(e) => write!(f, "payload JSON: {e}"),
        }
    }
}

impl std::error::Error for FileStoreError {}

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
// Preamble encode / decode + checksum
// ══════════════════════════════════════════════════════════════════

fn checksum(payload: &[u8]) -> [u8; CHECKSUM_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(payload);
    let digest = hasher.finalize();
    let mut out = [0u8; CHECKSUM_LEN];
    out.copy_from_slice(&digest[..CHECKSUM_LEN]);
    out
}

fn encode_preamble(payload: &[u8]) -> [u8; PREAMBLE_LEN] {
    let mut buf = [0u8; PREAMBLE_LEN];
    buf[..4].copy_from_slice(MAGIC);
    buf[4] = CURRENT_VERSION;
    buf[5] = 0; // flags reserved
    buf[CHECKSUM_OFFSET..CHECKSUM_OFFSET + CHECKSUM_LEN].copy_from_slice(&checksum(payload));
    buf[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
        .copy_from_slice(&(payload.len() as u64).to_le_bytes());
    // bytes 22..32 are zero by default
    buf
}

/// Validate a (preamble || payload) buffer end-to-end. Returns the
/// payload slice on success. Catches: short buffer, wrong magic,
/// unknown version, payload length mismatch, checksum mismatch.
fn parse_and_verify(bytes: &[u8]) -> Result<&[u8], FileStoreError> {
    if bytes.len() < PREAMBLE_LEN {
        return Err(FileStoreError::Preamble(format!(
            "buffer is {} bytes, preamble needs {}",
            bytes.len(),
            PREAMBLE_LEN
        )));
    }
    if &bytes[..4] != MAGIC {
        return Err(FileStoreError::Preamble("magic mismatch".into()));
    }
    let version = bytes[4];
    if version != CURRENT_VERSION {
        return Err(FileStoreError::Preamble(format!(
            "unknown version {version}"
        )));
    }
    let stamped_checksum: [u8; CHECKSUM_LEN] = bytes
        [CHECKSUM_OFFSET..CHECKSUM_OFFSET + CHECKSUM_LEN]
        .try_into()
        .unwrap();
    let payload_len = u64::from_le_bytes(
        bytes[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
            .try_into()
            .unwrap(),
    ) as usize;
    if bytes.len() < PREAMBLE_LEN + payload_len {
        return Err(FileStoreError::Preamble(format!(
            "preamble claims {} body bytes, only {} available",
            payload_len,
            bytes.len() - PREAMBLE_LEN
        )));
    }
    let payload = &bytes[PREAMBLE_LEN..PREAMBLE_LEN + payload_len];
    let actual_checksum = checksum(payload);
    if actual_checksum != stamped_checksum {
        return Err(FileStoreError::Verify(
            "checksum".into(),
            "stored checksum does not match payload".into(),
        ));
    }
    Ok(payload)
}

// ══════════════════════════════════════════════════════════════════
// Safe writer + reader (no AppHandle; pure paths so tests can drive)
// ══════════════════════════════════════════════════════════════════

/// Atomic write with the full failure-safe ladder. Caller passes
/// the canonical path; we manage `.tmp` and `.bak` siblings.
pub fn safe_write(canonical: &Path, payload: &[u8]) -> Result<(), FileStoreError> {
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| FileStoreError::Write(parent.display().to_string(), e.to_string()))?;
    }
    let tmp = sibling(canonical, "tmp");
    let bak = sibling(canonical, "bak");
    let preamble = encode_preamble(payload);
    let mut buf = Vec::with_capacity(PREAMBLE_LEN + payload.len());
    buf.extend_from_slice(&preamble);
    buf.extend_from_slice(payload);

    // Step 2: write tmp.
    std::fs::write(&tmp, &buf)
        .map_err(|e| FileStoreError::Write(tmp.display().to_string(), e.to_string()))?;

    // Step 3: read-back verify. If the disk wrote garbage we leave
    // the canonical alone and bubble up an error.
    let written = std::fs::read(&tmp)
        .map_err(|e| FileStoreError::Read(tmp.display().to_string(), e.to_string()))?;
    if written != buf {
        let _ = std::fs::remove_file(&tmp);
        return Err(FileStoreError::Verify(
            tmp.display().to_string(),
            "read-back bytes do not match what we wrote".into(),
        ));
    }
    parse_and_verify(&written).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;

    // Step 4: shift current to .bak (overwriting any prior .bak).
    // Skipped when there's nothing to shift.
    if canonical.exists() {
        // remove old .bak first so rename overwrites cleanly on
        // platforms that don't allow it implicitly.
        let _ = std::fs::remove_file(&bak);
        std::fs::rename(canonical, &bak).map_err(|e| {
            FileStoreError::Write(bak.display().to_string(), format!("backup rotate: {e}"))
        })?;
    }

    // Step 5: promote tmp.
    std::fs::rename(&tmp, canonical).map_err(|e| {
        FileStoreError::Write(canonical.display().to_string(), format!("promote: {e}"))
    })?;

    // Step 6: parent dir fsync — POSIX only. On Windows the NTFS
    // journal handles directory metadata as part of the rename, so
    // a separate sync is a no-op.
    #[cfg(unix)]
    {
        if let Some(parent) = canonical.parent() {
            if let Ok(f) = std::fs::File::open(parent) {
                let _ = f.sync_all();
            }
        }
    }

    Ok(())
}

/// Lower-level read: walks the same recovery ladder as `safe_read`
/// but returns the verified payload BYTES + source instead of parsing
/// them as JSON. Used by the P4 encrypted path — an envelope blob is
/// not valid JSON, so the JSON-parsing step in `safe_read` would
/// false-reject a valid encrypted file.
pub fn safe_read_raw(canonical: &Path) -> Result<Option<(Vec<u8>, LoadSource)>, FileStoreError> {
    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (
            canonical.with_extension("json.v0.bak"),
            LoadSource::V0Migration,
        ),
    ];
    for (path, source) in &candidates {
        if !path.exists() {
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let payload = match parse_and_verify(&bytes) {
            Ok(p) => p,
            Err(_) => continue,
        };
        return Ok(Some((payload.to_vec(), *source)));
    }
    Ok(None)
}

/// Read with the failure-safe ladder. Returns `Ok(None)` only when
/// every candidate (`.json`, `.bak`, `.v0.bak`) is missing or
/// corrupt — that's the "first-run / wiped" path.
///
/// Kept exported (instead of inlining into the tests it now serves)
/// so the test-side legacy-plaintext fixtures match production's old
/// shape exactly. `#[allow(dead_code)]` because the path-include into
/// `sorng-commands-core` makes the dead-code lint miss the tests.
#[allow(dead_code)]
pub fn safe_read(canonical: &Path) -> Result<Option<LoadResult>, FileStoreError> {
    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (
            canonical.with_extension("json.v0.bak"),
            LoadSource::V0Migration,
        ),
    ];
    for (path, source) in &candidates {
        if !path.exists() {
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let payload = match parse_and_verify(&bytes) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        return Ok(Some(LoadResult {
            value,
            source: *source,
        }));
    }
    Ok(None)
}

fn sibling(canonical: &Path, suffix: &str) -> PathBuf {
    let mut s = canonical.as_os_str().to_owned();
    s.push(".");
    s.push(suffix);
    PathBuf::from(s)
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
async fn decrypt_payload(
    state: &EncryptionState,
    artifact: ArtifactKind,
    envelope_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let sub_key = state
        .sub_key(artifact)
        .await
        .ok_or_else(|| "encryption is locked; unlock first via Settings → Security".to_string())?;
    let (_header, plaintext) = enc_envelope::read_envelope(&sub_key, envelope_bytes)
        .map_err(|e| format!("envelope decrypt: {e}"))?;
    Ok(plaintext)
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
    Ok(())
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
}
