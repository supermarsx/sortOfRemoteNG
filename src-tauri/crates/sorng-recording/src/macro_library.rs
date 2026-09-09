//! Allowlisted opaque frontend libraries. JSON text is data, never MacroRecording commands.
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sorng_encryption::artifacts::macros as codec;
use sorng_encryption::envelope::{MasterKeyStorage, SALT_LEN};
use sorng_encryption::password_wrap::Argon2Params;
use sorng_encryption::{artifact_transaction, EncryptionState};

use crate::error::{RecordingError, RecordingResult};

pub const TERMINAL_KEY: &str = "recording.terminal-macros";
pub const WEB_KEY: &str = "recording.web-automation.v1";
const TERMINAL_ID: &str = "__sorng_terminal_library_v1";
const WEB_ID: &str = "__sorng_web_library_v1";

fn fail(message: &str) -> RecordingError {
    RecordingError::StorageError(message.into())
}

fn descriptor(key: &str) -> RecordingResult<(&'static str, usize)> {
    match key {
        TERMINAL_KEY => Ok((TERMINAL_ID, 8 * 1024 * 1024)),
        WEB_KEY => Ok((WEB_ID, 2 * 1024 * 1024)),
        _ => Err(fail("Unknown macro library key")),
    }
}

pub fn key_for_filename(name: &str) -> Option<&'static str> {
    match name {
        "__sorng_terminal_library_v1.json" | "__sorng_terminal_library_v1.json.enc" => {
            Some(TERMINAL_KEY)
        }
        "__sorng_web_library_v1.json" | "__sorng_web_library_v1.json.enc" => Some(WEB_KEY),
        _ => None,
    }
}

pub fn reserved_filename(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [TERMINAL_ID, WEB_ID]
        .iter()
        .any(|id| name == *id || name.starts_with(&format!("{id}.")))
}

/// Legacy macro CRUD must not alias an opaque library, including Windows paths/ADS.
pub fn validate_macro_id(id: &str) -> RecordingResult<()> {
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains(['/', '\\', ':'])
        || reserved_filename(id)
    {
        return Err(RecordingError::InvalidParameter(
            "Reserved or invalid macro ID".into(),
        ));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LibraryEnvelope {
    version: u32,
    key: String,
    payload_json: String,
}

fn validate_payload(key: &str, payload: &str) -> RecordingResult<()> {
    let (_, max) = descriptor(key)?;
    if payload.len() > max {
        return Err(fail("Macro library exceeds its UTF-8 size limit"));
    }
    serde_json::from_str::<serde_json::Value>(payload)
        .map_err(|_| fail("Macro library is not valid JSON"))?;
    Ok(())
}

fn paths(root: &Path, key: &str) -> RecordingResult<(PathBuf, PathBuf)> {
    let (id, _) = descriptor(key)?;
    Ok((
        root.join("macros").join(format!("{id}.json")),
        root.join("macros").join(format!("{id}.json.enc")),
    ))
}

fn bounded_read(root: &Path, path: &Path, max: usize) -> RecordingResult<Option<Vec<u8>>> {
    artifact_transaction::validate_regular_path(root, path, true)
        .map_err(|_| fail("Macro library path is unavailable or unsafe"))?;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(fail("Cannot read macro library")),
    };
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| fail("Cannot read macro library"))?;
    if bytes.len() > max {
        return Err(fail("Macro library envelope exceeds its size limit"));
    }
    Ok(Some(bytes))
}

async fn decode(
    key: &str,
    bytes: &[u8],
    encrypted: bool,
    state: Option<&EncryptionState>,
) -> RecordingResult<String> {
    let envelope: LibraryEnvelope = if encrypted {
        let state = state.ok_or_else(|| fail("Unlock encryption to read this macro library"))?;
        let value = codec::read(state, bytes)
            .await
            .map_err(|_| fail("Cannot decrypt macro library"))?
            .ok_or_else(|| fail("Empty macro library envelope"))?;
        serde_json::from_value(value).map_err(|_| fail("Invalid macro library envelope"))?
    } else {
        serde_json::from_slice(bytes).map_err(|_| fail("Invalid macro library envelope"))?
    };
    if envelope.version != 1 || envelope.key != key {
        return Err(fail("Macro library envelope key or version mismatch"));
    }
    validate_payload(key, &envelope.payload_json)?;
    Ok(envelope.payload_json)
}

/// Caller holds the shared settings coordinator and has checked current Macros access.
pub async fn read(
    root: &Path,
    key: &str,
    state: Option<&EncryptionState>,
) -> RecordingResult<Option<String>> {
    let (_, max) = descriptor(key)?;
    let (plain, encrypted) = paths(root, key)?;
    if !root.join("macros").exists() {
        return Ok(None);
    }
    // A staged/recovery peer is never guessed away or silently deleted.
    for path in [&plain, &encrypted] {
        if bounded_read(
            root,
            &path.with_file_name(format!(
                "{}.v0.bak",
                path.file_name().unwrap().to_string_lossy()
            )),
            max * 6 + 4096,
        )?
        .is_some()
        {
            return Err(fail("Macro library recovery data requires review"));
        }
    }
    let plain_bytes = bounded_read(root, &plain, max * 6 + 4096)?;
    let encrypted_bytes = bounded_read(root, &encrypted, max * 6 + 4096)?;
    match (plain_bytes, encrypted_bytes) {
        (Some(_), Some(_)) => Err(fail("Conflicting macro library variants require review")),
        (Some(bytes), None) => decode(key, &bytes, false, state).await.map(Some),
        (None, Some(bytes)) => decode(key, &bytes, true, state).await.map(Some),
        (None, None) => Ok(None),
    }
}

/// Exact source CAS. No fallback overwrite, no source removal until verified publication.
pub async fn compare_and_swap(
    root: &Path,
    key: &str,
    expected: Option<&str>,
    replacement: &str,
    state: Option<&EncryptionState>,
    encrypt: bool,
) -> RecordingResult<bool> {
    validate_payload(key, replacement)?;
    if let Some(value) = expected {
        validate_payload(key, value)?;
    }
    if read(root, key, state).await?.as_deref() != expected {
        return Ok(false);
    }
    let envelope = LibraryEnvelope {
        version: 1,
        key: key.into(),
        payload_json: replacement.into(),
    };
    let value = serde_json::to_value(envelope)?;
    let bytes = if encrypt {
        codec::write(
            state.ok_or_else(|| fail("Unlock encryption to save macro libraries"))?,
            &value,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0; SALT_LEN],
        )
        .await
        .map_err(|_| fail("Cannot encrypt macro library"))?
    } else {
        serde_json::to_vec(&value)?
    };
    let (plain, encrypted) = paths(root, key)?;
    artifact_transaction::validate_regular_path(root, root, false)
        .map_err(|_| fail("Macro library root is unavailable"))?;
    std::fs::create_dir_all(root.join("macros"))
        .map_err(|_| fail("Cannot create macro library directory"))?;
    let (target, old) = if encrypt {
        (&encrypted, &plain)
    } else {
        (&plain, &encrypted)
    };
    artifact_transaction::validate_regular_path(root, target, true)
        .map_err(|_| fail("Macro library target is unsafe"))?;
    let stage = target.with_file_name(format!(
        "{}.v0.bak",
        target.file_name().unwrap().to_string_lossy()
    ));
    artifact_transaction::durable_write(&stage, &bytes)
        .map_err(|_| fail("Cannot stage macro library"))?;
    let result = async {
        let (_, max) = descriptor(key)?;
        let staged = bounded_read(root, &stage, max * 6 + 4096)?
            .ok_or_else(|| fail("Macro library stage disappeared"))?;
        if decode(key, &staged, encrypt, state).await? != replacement {
            return Err(fail("Macro library verification failed"));
        }
        std::fs::rename(&stage, target).map_err(|_| fail("Cannot publish macro library"))?;
        artifact_transaction::sync_parent(target)
            .map_err(|_| fail("Cannot synchronize macro library"))?;
        let committed = bounded_read(root, target, max * 6 + 4096)?
            .ok_or_else(|| fail("Macro library disappeared"))?;
        if decode(key, &committed, encrypt, state).await? != replacement {
            return Err(fail("Macro library read-back verification failed"));
        }
        match std::fs::remove_file(old) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(fail("Macro library saved but old encoding cleanup failed")),
        }
        artifact_transaction::sync_parent(target)
            .map_err(|_| fail("Macro library saved but cleanup synchronization failed"))?;
        Ok(true)
    }
    .await;
    if stage.exists() {
        let _ = std::fs::remove_file(stage);
    }
    result
}

pub async fn migrate_to_encrypted(
    root: &Path,
    key: &str,
    state: &EncryptionState,
) -> RecordingResult<()> {
    let current = read(root, key, Some(state))
        .await?
        .ok_or_else(|| fail("Macro library disappeared before migration"))?;
    if !compare_and_swap(root, key, Some(&current), &current, Some(state), true).await? {
        return Err(fail("Macro library changed before migration"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{storage, RecordingService};
    use sorng_encryption::{artifact_policy, ArtifactKind, MasterDek};
    use std::sync::Arc;

    async fn unlocked() -> Arc<EncryptionState> {
        let state = Arc::new(EncryptionState::new());
        state
            .install(MasterDek::from_bytes(&[41; 32]).unwrap())
            .await;
        state
    }

    #[tokio::test]
    async fn default_locked_library_refuses_without_a_file() {
        let _fixture = crate::service::recording_fixture_guard().await;
        let tmp = tempfile::tempdir().unwrap();
        let svc = RecordingService::new(tmp.path().to_str().unwrap());
        svc.set_encryption_state(Arc::new(EncryptionState::new()))
            .await;
        assert!(svc.read_macro_library(TERMINAL_KEY).await.is_err());
        assert!(svc
            .compare_and_swap_macro_library(TERMINAL_KEY, None, "{}")
            .await
            .is_err());
        assert_eq!(
            std::fs::read_dir(tmp.path().join("recording/macros"))
                .unwrap()
                .count(),
            0
        );
    }

    #[tokio::test]
    async fn exact_encrypted_cas_and_lock_do_not_expose_or_overwrite_data() {
        let _fixture = crate::service::recording_fixture_guard().await;
        let tmp = tempfile::tempdir().unwrap();
        let svc = RecordingService::new(tmp.path().to_str().unwrap());
        let state = unlocked().await;
        svc.set_encryption_state(state.clone()).await;
        let raw = " { \"z\": 1, \"a\": [\"a\\\\b\", \"é\"] }\n";
        assert!(svc
            .compare_and_swap_macro_library(TERMINAL_KEY, None, raw)
            .await
            .unwrap());
        assert_eq!(
            svc.read_macro_library(TERMINAL_KEY)
                .await
                .unwrap()
                .as_deref(),
            Some(raw)
        );
        assert!(!svc
            .compare_and_swap_macro_library(TERMINAL_KEY, None, "{}")
            .await
            .unwrap());
        assert!(svc
            .compare_and_swap_macro_library(TERMINAL_KEY, Some(raw), "{\"next\":true}")
            .await
            .unwrap());
        let root = svc.storage_root_snapshot().await;
        let (_, path) = paths(&root, TERMINAL_KEY).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(!before.windows(raw.len()).any(|part| part == raw.as_bytes()));
        state.lock().await;
        assert!(svc.read_macro_library(TERMINAL_KEY).await.is_err());
        assert!(svc
            .compare_and_swap_macro_library(TERMINAL_KEY, Some("{\"next\":true}"), "{}")
            .await
            .is_err());
        assert_eq!(std::fs::read(path).unwrap(), before);
    }

    #[tokio::test]
    async fn explicit_macro_plaintext_policy_is_independent_of_connections() {
        let _fixture = crate::service::recording_fixture_guard().await;
        let tmp = tempfile::tempdir().unwrap();
        let svc = RecordingService::new(tmp.path().to_str().unwrap());
        let state = unlocked().await;
        let policy = artifact_policy::PolicyDocument::default()
            .with_mode(
                ArtifactKind::Macros,
                artifact_policy::ProtectionMode::Plaintext,
            )
            .unwrap()
            .with_mode(
                ArtifactKind::Connections,
                artifact_policy::ProtectionMode::Encrypted,
            )
            .unwrap();
        std::fs::write(
            tmp.path().join(artifact_policy::POLICY_FILENAME),
            artifact_policy::encode(&state, &policy).await.unwrap(),
        )
        .unwrap();
        std::fs::write(tmp.path().join(artifact_policy::POLICY_MARKER), b"1").unwrap();
        artifact_policy::initialize(&state, tmp.path()).await;
        svc.set_encryption_state(state.clone()).await;
        let raw = "{\"scripts\":[], \"macros\":[]}";
        assert!(svc
            .compare_and_swap_macro_library(WEB_KEY, None, raw)
            .await
            .unwrap());
        assert_eq!(
            svc.read_macro_library(WEB_KEY).await.unwrap().as_deref(),
            Some(raw)
        );
        let (plain, enc) = paths(&svc.storage_root_snapshot().await, WEB_KEY).unwrap();
        assert!(plain.exists());
        assert!(!enc.exists());
        state.lock().await;
        assert!(svc.read_macro_library(WEB_KEY).await.is_err());
        assert!(svc
            .compare_and_swap_macro_library(WEB_KEY, Some(raw), "{}")
            .await
            .is_err());
        assert!(plain.exists());
    }

    #[tokio::test]
    async fn rejects_unknown_oversized_malformed_and_dual_variants_without_deletion() {
        let tmp = tempfile::tempdir().unwrap();
        storage::ensure_dirs(tmp.path()).unwrap();
        for key in ["../escape", "unknown", "recording.web-automation.v2"] {
            assert!(compare_and_swap(tmp.path(), key, None, "{}", None, false)
                .await
                .is_err());
        }
        assert!(
            compare_and_swap(tmp.path(), WEB_KEY, None, "bad JSON", None, false)
                .await
                .is_err()
        );
        assert!(compare_and_swap(
            tmp.path(),
            WEB_KEY,
            None,
            &format!("\"{}\"", "é".repeat(1024 * 1024)),
            None,
            false
        )
        .await
        .is_err());
        let raw = serde_json::to_string(&"\\".repeat(1024 * 1024 - 1)).unwrap();
        assert!(
            compare_and_swap(tmp.path(), WEB_KEY, None, &raw, None, false)
                .await
                .unwrap()
        );
        assert_eq!(
            read(tmp.path(), WEB_KEY, None).await.unwrap().as_deref(),
            Some(raw.as_str())
        );
        let (plain, enc) = paths(tmp.path(), WEB_KEY).unwrap();
        std::fs::write(&enc, b"malformed encrypted peer").unwrap();
        let before = std::fs::read(&plain).unwrap();
        assert!(
            compare_and_swap(tmp.path(), WEB_KEY, Some(&raw), "{}", None, false)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&plain).unwrap(), before);
        assert!(enc.exists());
        std::fs::remove_file(enc).unwrap();
        std::fs::write(&plain, br#"{"version":1,"key":"wrong","payloadJson":"{}"}"#).unwrap();
        assert!(read(tmp.path(), WEB_KEY, None).await.is_err());
        assert!(plain.exists());
    }

    #[tokio::test]
    async fn libraries_migrate_and_rotate_but_never_load_as_legacy_macros() {
        let tmp = tempfile::tempdir().unwrap();
        storage::ensure_dirs(tmp.path()).unwrap();
        let state = unlocked().await;
        let raw = " {\"z\": [], \"a\": 4} ";
        for key in [TERMINAL_KEY, WEB_KEY] {
            assert!(
                compare_and_swap(tmp.path(), key, None, raw, Some(&state), false)
                    .await
                    .unwrap()
            );
        }
        assert!(storage::load_all_macros(tmp.path()).unwrap().is_empty());
        assert_eq!(
            storage::migrate_all_macros_to_encrypted(tmp.path(), &state)
                .await
                .unwrap(),
            (2, 0)
        );
        assert!(storage::load_all_macros_dispatched(tmp.path(), &state)
            .await
            .unwrap()
            .is_empty());
        let encrypted = storage::list_encrypted_macro_paths(tmp.path());
        assert_eq!(encrypted.len(), 2);
        let new = EncryptionState::new();
        new.install(MasterDek::from_bytes(&[42; 32]).unwrap()).await;
        for path in encrypted {
            storage::rewrite_macro_with(&path, &state, &new)
                .await
                .unwrap();
        }
        for key in [TERMINAL_KEY, WEB_KEY] {
            assert_eq!(
                read(tmp.path(), key, Some(&new)).await.unwrap().as_deref(),
                Some(raw)
            );
            assert!(read(tmp.path(), key, Some(&state)).await.is_err());
        }
    }

    #[tokio::test]
    async fn legacy_crud_cannot_claim_reserved_library_ids() {
        let _fixture = crate::service::recording_fixture_guard().await;
        let tmp = tempfile::tempdir().unwrap();
        let svc = RecordingService::new(tmp.path().to_str().unwrap());
        svc.set_encryption_state(unlocked().await).await;
        for id in [
            TERMINAL_ID,
            WEB_ID,
            "__SORNG_TERMINAL_LIBRARY_V1",
            "sub/../__sorng_web_library_v1",
            "other:stream",
        ] {
            let rec = crate::types::MacroRecording {
                id: id.into(),
                name: "fixture".into(),
                description: None,
                category: None,
                steps: vec![],
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                tags: vec![],
                target_protocol: crate::types::RecordingProtocol::Ssh,
            };
            assert!(svc.import_macro(rec.clone()).await.is_err());
            assert!(svc.update_macro(rec).await.is_err());
            assert!(svc.delete_macro(id).await.is_err());
            assert!(svc.get_macro(id).await.is_none());
        }
        assert!(svc.list_macros().await.is_empty());
    }
}
