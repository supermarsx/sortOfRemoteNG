//! End-to-end test for the full-artifact master-key rotation
//! orchestrator (`encryption_rotation_commands.rs`).
//!
//! Unit coverage for each per-artifact rewrite helper already lives
//! beside the helper (see the `rewrite_*_with_*` tests in
//! `sorng-storage::backup` and `sorng-recording::storage`). What's
//! missing — and what this file adds — is end-to-end coverage of the
//! orchestrator itself: every artifact kind on disk simultaneously,
//! one call to the rotation entry point, and assertions that DEK B can
//! read every artifact afterwards while DEK A cannot.
//!
//! The test drives the Tauri-agnostic helper
//! `app_lib::encryption_rotation_commands::rotate_master_key_full_inner`
//! directly so no Tauri runtime is needed.

use std::sync::Arc;

use serde_json::json;
use tempfile::tempdir;

use app_lib::encryption_rotation_commands::rotate_master_key_full_inner;

use sorng_encryption::artifacts::{
    backups as artifact_backups, connections as artifact_connections,
    macros as artifact_macros, recording_media as artifact_recording_media,
    recording_meta as artifact_recording_meta, settings as artifact_settings,
};
use sorng_encryption::envelope::{MasterKeyStorage, MAGIC, SALT_LEN};
use sorng_encryption::password_wrap::Argon2Params;
use sorng_encryption::{EncryptionState, MasterDek};

use sorng_recording::service::RecordingService;
use sorng_recording::storage as rec_storage;
use sorng_recording::types::{
    CompressionAlgorithm, ExportFormat, MacroRecording, RecordingProtocol,
    SavedRecordingEnvelope,
};

use sorng_storage::backup::{BackupConfig, BackupService};
use sorng_storage::storage::{SecureStorage, StorageData};

/// Fixture envelope. The orchestrator round-trips it through the
/// recording-meta v2 codec; only the JSON-encodable shape matters.
fn fixture_envelope(id: &str) -> SavedRecordingEnvelope {
    SavedRecordingEnvelope {
        id: id.to_string(),
        name: format!("rec-{id}"),
        description: Some("integration-test fixture".into()),
        protocol: RecordingProtocol::Ssh,
        saved_at: chrono::Utc::now(),
        duration_ms: 1234,
        size_bytes: 42,
        compression: CompressionAlgorithm::None,
        format: ExportFormat::Asciicast,
        tags: vec!["e2e".into()],
        connection_id: Some("conn-1".into()),
        connection_name: Some("test".into()),
        host: Some("example.com".into()),
        data: "[]".to_string(),
        media_blob_basename: None,
    }
}

fn fixture_macro(id: &str) -> MacroRecording {
    MacroRecording {
        id: id.to_string(),
        name: format!("macro-{id}"),
        description: Some("integration-test macro".into()),
        category: None,
        steps: vec![],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        tags: vec!["e2e".into()],
        target_protocol: RecordingProtocol::Ssh,
    }
}

fn fixture_storage_data() -> StorageData {
    StorageData {
        connections: vec![json!({ "id": "c1", "host": "h.example", "port": 22 })],
        settings: std::collections::HashMap::new(),
        timestamp: 1_700_000_000,
        app_data: std::collections::HashMap::new(),
    }
}

/// Re-encode a fresh settings.enc directly via the codec, then drop
/// the bytes into `<app_data>/settings.enc`. Mirrors what the
/// `write_app_settings` Tauri command would produce at runtime.
async fn plant_settings_enc(
    path: &std::path::Path,
    enc_state: &EncryptionState,
    payload: &serde_json::Value,
) {
    let blob = artifact_settings::write(
        enc_state,
        payload,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .unwrap();
    std::fs::write(path, &blob).unwrap();
}

/// Exhaustive end-to-end test: materialise every artifact kind on
/// disk under DEK A, call the orchestrator with no password and no
/// vault, and verify (a) the rotation report is fully populated,
/// (b) every artifact decodes under the new state's DEK B, and
/// (c) every artifact's pre-rotation snapshot of DEK A no longer
/// authenticates the file.
#[tokio::test]
async fn full_rotation_walks_every_artifact_and_re_keys_each() {
    // ── Set up directories ─────────────────────────────────────────
    // The app data dir is the canonical root: settings.enc, the
    // connections store, the backup destination, and the recording
    // root all live under it in this test. Production puts the
    // backup destination + recording root in user-chosen folders,
    // but the orchestrator just walks paths the services report —
    // co-locating them keeps cleanup trivial.
    let tmp = tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let backup_dir = app_data.join("backups");
    std::fs::create_dir_all(&backup_dir).unwrap();

    // ── Install DEK A ──────────────────────────────────────────────
    // A deterministic non-zero key so the post-rotation negative
    // assertions can rebuild it from raw bytes when needed. The
    // orchestrator never touches the snapshot — its only role here is
    // to give us a clean "old key" handle for the unreadability check.
    let dek_a_bytes = [3u8; 32];
    let enc_state = Arc::new(EncryptionState::new());
    enc_state
        .install(MasterDek::from_bytes(&dek_a_bytes).unwrap())
        .await;

    // ── Stand up services and inject the state ─────────────────────
    let storage_state = SecureStorage::new(
        app_data.join("storage.json").to_string_lossy().to_string(),
    );
    storage_state.lock().await.set_encryption_state(enc_state.clone());

    let backup_state = BackupService::new(backup_dir.to_string_lossy().to_string());
    {
        let mut svc = backup_state.lock().await;
        // Plain BackupConfig pointed at our backup dir. No compression
        // / encryption flags needed — the v2 envelope path is selected
        // by the presence of an unlocked EncryptionState, not by
        // BackupConfig.
        let mut cfg = BackupConfig::default();
        cfg.destination_path = backup_dir.to_string_lossy().to_string();
        cfg.compress_backups = false;
        cfg.max_backups_to_keep = 0;
        svc.update_config(cfg);
        svc.set_encryption_state(enc_state.clone());
    }

    // RecordingService::new constructs the recording root *under* the
    // supplied app-data path (it appends a `recordings/` subdir
    // internally), so we point it at our tempdir.
    let rec_svc = RecordingService::new(&app_data.to_string_lossy());
    rec_svc.set_encryption_state(enc_state.clone()).await;
    let rec_root = rec_svc.storage_root_snapshot().await;
    rec_storage::ensure_dirs(&rec_root).unwrap();
    let recording_state =
        std::sync::Arc::new(tokio::sync::Mutex::new(rec_svc));

    // ── Materialise every artifact kind under DEK A ────────────────

    // 1. settings.enc — write the codec output straight to disk.
    let settings_path = app_data.join("settings.enc");
    let settings_payload = json!({ "theme": "dark", "language": "en" });
    plant_settings_enc(&settings_path, &enc_state, &settings_payload).await;

    // 2. Connections store: save_data with unlocked state produces v2.
    let storage_data = fixture_storage_data();
    storage_state
        .lock()
        .await
        .save_data(storage_data.clone(), false)
        .await
        .unwrap();
    let connections_path = app_data.join("storage.json");

    // 3. Backup: run_backup writes a v2-envelope `backup_*.json` plus a
    //    `.meta.` sidecar that `list_v2_files()` filters out.
    let backup_payload = json!({ "x": 1, "y": "two" });
    {
        let mut svc = backup_state.lock().await;
        svc.run_backup("manual", &backup_payload).await.unwrap();
    }

    // 4-6. Recording metadata envelope + media sidecar + macro,
    //      written through the dispatched codecs while DEK A is live.
    let envelope = fixture_envelope("e2e-rec");
    rec_storage::save_envelope_dispatched(&rec_root, &envelope, &enc_state)
        .await
        .unwrap();

    let media_basename = "e2e.media";
    let media_bytes: Vec<u8> = (0u8..200).cycle().take(150_000).collect();
    rec_storage::save_media_blob_dispatched(
        &rec_root,
        media_basename,
        &media_bytes,
        &enc_state,
    )
    .await
    .unwrap();

    let macro_fixture = fixture_macro("e2e-mac");
    rec_storage::save_macro_dispatched(&rec_root, &macro_fixture, &enc_state)
        .await
        .unwrap();

    // ── Pre-rotation sanity: every artifact exists + has v2 magic ──
    let settings_bytes_before = std::fs::read(&settings_path).unwrap();
    assert_eq!(
        &settings_bytes_before[..6],
        MAGIC,
        "settings.enc must carry v2 magic"
    );
    let connections_bytes_before = std::fs::read(&connections_path).unwrap();
    assert_eq!(
        &connections_bytes_before[..6],
        MAGIC,
        "connections file must carry v2 magic"
    );
    // Locate the backup file the orchestrator will rewrite.
    let backup_paths_before = {
        let svc = backup_state.lock().await;
        svc.list_v2_files().await
    };
    assert_eq!(
        backup_paths_before.len(),
        1,
        "exactly one v2 backup file expected, found {:?}",
        backup_paths_before
    );
    let backup_path = backup_paths_before[0].clone();
    let backup_bytes_before = std::fs::read(&backup_path).unwrap();
    assert_eq!(&backup_bytes_before[..6], MAGIC);

    // Recording-related paths. `list_encrypted_*_paths` returns
    // canonical positions inside the root; we keep them for the
    // unreadability check after rotation.
    let env_paths_before = rec_storage::list_encrypted_envelope_paths(&rec_root);
    assert_eq!(env_paths_before.len(), 1);
    let env_path = env_paths_before[0].clone();
    let media_paths_before = rec_storage::list_encrypted_media_paths(&rec_root);
    assert_eq!(media_paths_before.len(), 1);
    let media_path = media_paths_before[0].clone();
    let macro_paths_before = rec_storage::list_encrypted_macro_paths(&rec_root);
    assert_eq!(macro_paths_before.len(), 1);
    let macro_path = macro_paths_before[0].clone();

    // ── Snapshot DEK A so the post-rotation negative check still has
    //    a live handle to the old key. Snapshot is taken *before* the
    //    orchestrator runs because the orchestrator installs DEK B
    //    into `enc_state`, replacing whatever was there.
    let state_a = enc_state.snapshot().await.unwrap();

    // ── Call the rotation helper ───────────────────────────────────
    // password: None + vault_present: false → vault-only mode; no
    // dek.enc write, no host-keychain write. Matches the orchestrator's
    // `(false, false)` branch which defaults to `MasterKeyStorage::Vault`
    // for the new settings header.
    let report = rotate_master_key_full_inner(
        &app_data,
        &enc_state,
        &storage_state,
        &backup_state,
        &recording_state,
        None,
        false, // vault_present
    )
    .await
    .expect("rotation must succeed");

    // ── Report assertions ──────────────────────────────────────────
    assert!(
        report.failures.is_empty(),
        "no per-artifact failures expected, got: {:?}",
        report.failures
    );
    assert!(report.settings_rewritten);
    assert!(report.connections_rewritten);
    assert_eq!(report.backups_rewritten, 1);
    assert_eq!(report.recording_envelopes_rewritten, 1);
    assert_eq!(report.media_sidecars_rewritten, 1);
    assert_eq!(report.macros_rewritten, 1);
    assert!(report.bytes_rewritten > 0);
    // vault_present: false and password: None ⇒ neither receipt got
    // touched. This is the explicit contract for the headless test
    // path; the production command path is exercised elsewhere via
    // the unit tests on the receipt writers.
    assert!(!report.vault_updated);
    assert!(!report.dek_enc_updated);

    // ── Post-rotation readability: every artifact decodes under DEK B
    //    via the live `enc_state` (which the orchestrator swapped in).
    let settings_bytes_after = std::fs::read(&settings_path).unwrap();
    assert_eq!(&settings_bytes_after[..6], MAGIC);
    let decoded_settings = artifact_settings::read(&enc_state, &settings_bytes_after)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decoded_settings, settings_payload);

    let connections_bytes_after = std::fs::read(&connections_path).unwrap();
    assert_eq!(&connections_bytes_after[..6], MAGIC);
    let decoded_connections =
        artifact_connections::read(&enc_state, &connections_bytes_after)
            .await
            .unwrap()
            .unwrap();
    // The codec round-trips arbitrary JSON; we just need the shape to
    // survive — the connections array should be intact.
    assert_eq!(decoded_connections["connections"][0]["id"], "c1");

    let backup_bytes_after = std::fs::read(&backup_path).unwrap();
    assert!(artifact_backups::read(&enc_state, &backup_bytes_after)
        .await
        .is_ok());

    let env_bytes_after = std::fs::read(&env_path).unwrap();
    let decoded_env = artifact_recording_meta::read(&enc_state, &env_bytes_after)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decoded_env["id"], "e2e-rec");

    let media_bytes_after = std::fs::read(&media_path).unwrap();
    let decoded_media =
        artifact_recording_media::read_all(&enc_state, &media_bytes_after)
            .await
            .unwrap();
    assert_eq!(decoded_media.len(), media_bytes.len());
    assert_eq!(decoded_media, media_bytes);

    let macro_bytes_after = std::fs::read(&macro_path).unwrap();
    let decoded_macro = artifact_macros::read(&enc_state, &macro_bytes_after)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decoded_macro["id"], "e2e-mac");

    // ── Post-rotation un-readability: every artifact rejects DEK A.
    //    Without this check, a buggy orchestrator that silently kept
    //    DEK A live and re-encrypted with it would still pass the
    //    readability assertions above.
    assert!(
        artifact_settings::read(&state_a, &settings_bytes_after)
            .await
            .is_err(),
        "settings.enc must no longer authenticate under old DEK A"
    );
    assert!(
        artifact_connections::read(&state_a, &connections_bytes_after)
            .await
            .is_err(),
        "connections file must no longer authenticate under old DEK A"
    );
    assert!(
        artifact_backups::read(&state_a, &backup_bytes_after)
            .await
            .is_err(),
        "backup file must no longer authenticate under old DEK A"
    );
    assert!(
        artifact_recording_meta::read(&state_a, &env_bytes_after)
            .await
            .is_err(),
        "recording envelope must no longer authenticate under old DEK A"
    );
    assert!(
        artifact_recording_media::read_all(&state_a, &media_bytes_after)
            .await
            .is_err(),
        "media sidecar must no longer authenticate under old DEK A"
    );
    assert!(
        artifact_macros::read(&state_a, &macro_bytes_after)
            .await
            .is_err(),
        "macro envelope must no longer authenticate under old DEK A"
    );
}
