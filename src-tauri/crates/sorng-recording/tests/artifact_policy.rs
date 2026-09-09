//! Temporary fixtures only: real recording readers/writers and authenticated
//! artifact policy, with no OS vault, application profile, or remote endpoint.
use std::{path::Path, sync::Arc};

use chrono::Utc;
use sorng_encryption::{
    artifact_policy::{self, PolicyDocument, ProtectionMode},
    ArtifactKind, EncryptionState, MasterDek,
};
use sorng_recording::{storage, types::*, RecordingService};

static SERVICE_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn fixture() -> (tempfile::TempDir, Arc<EncryptionState>) {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(EncryptionState::new());
    state.install(MasterDek::generate()).await;
    artifact_policy::initialize(&state, dir.path()).await;
    (dir, state)
}

async fn policy(root: &Path, state: &EncryptionState, modes: &[(ArtifactKind, bool)]) {
    let mut document = PolicyDocument::default();
    for (kind, encrypted) in modes {
        document = document
            .with_mode(
                *kind,
                if *encrypted {
                    ProtectionMode::Encrypted
                } else {
                    ProtectionMode::Plaintext
                },
            )
            .unwrap();
    }
    std::fs::write(
        root.join(artifact_policy::POLICY_FILENAME),
        artifact_policy::encode(state, &document).await.unwrap(),
    )
    .unwrap();
    artifact_policy::refresh(state).await;
    assert!(state.artifact_policy_error().is_none());
}

fn envelope(id: &str) -> SavedRecordingEnvelope {
    SavedRecordingEnvelope {
        id: id.into(),
        name: "Temporary capture".into(),
        description: None,
        protocol: RecordingProtocol::Ssh,
        saved_at: Utc::now(),
        duration_ms: 1,
        size_bytes: 7,
        compression: CompressionAlgorithm::None,
        format: ExportFormat::Asciicast,
        tags: vec![],
        connection_id: None,
        connection_name: None,
        host: None,
        data: "fixture".into(),
        media_blob_basename: None,
    }
}

fn macro_recording() -> MacroRecording {
    MacroRecording {
        id: "macro-fixture".into(),
        name: "Temporary macro".into(),
        description: None,
        category: None,
        steps: vec![MacroStep {
            command: "fixture-only".into(),
            delay_ms: 0,
            send_newline: true,
        }],
        created_at: Utc::now(),
        updated_at: Utc::now(),
        tags: vec![],
        target_protocol: RecordingProtocol::Ssh,
    }
}

fn assert_representation(root: &Path, relative: &str, encrypted: bool) {
    let plain = root.join(relative);
    let encrypted_path = root.join(format!("{relative}.enc"));
    assert_eq!(
        encrypted_path.exists(),
        encrypted,
        "{relative}: encrypted representation"
    );
    assert_eq!(
        plain.exists(),
        !encrypted,
        "{relative}: plaintext representation"
    );
    let bytes = std::fs::read(if encrypted { encrypted_path } else { plain }).unwrap();
    assert_eq!(
        bytes.starts_with(sorng_encryption::envelope::MAGIC),
        encrypted
    );
}

#[tokio::test]
async fn all_eight_metadata_media_macro_policy_combinations_write_and_read_independently() {
    for mask in 0..8 {
        let (dir, state) = fixture().await;
        let root = dir.path().join("recording");
        let meta = mask & 1 != 0;
        let media = mask & 2 != 0;
        let macros = mask & 4 != 0;
        policy(
            dir.path(),
            &state,
            &[
                (ArtifactKind::RecordingsMeta, meta),
                (ArtifactKind::RecordingsMedia, media),
                (ArtifactKind::Macros, macros),
            ],
        )
        .await;
        storage::save_envelope_dispatched(&root, &envelope("capture"), &state)
            .await
            .unwrap();
        storage::save_media_blob_dispatched(&root, "capture.media", b"media-fixture", &state)
            .await
            .unwrap();
        storage::save_macro_dispatched(&root, &macro_recording(), &state)
            .await
            .unwrap();
        assert_representation(&root, "recordings/capture.json", meta);
        assert_representation(&root, "recordings/capture.media", media);
        assert_representation(&root, "macros/macro-fixture.json", macros);
        assert_eq!(
            storage::load_envelope_dispatched(&root, "capture", &state)
                .await
                .unwrap()
                .data,
            "fixture"
        );
        assert_eq!(
            storage::load_media_blob_dispatched(&root, "capture.media", &state)
                .await
                .unwrap(),
            b"media-fixture"
        );
        let loaded = storage::load_all_macros_dispatched(&root, &state)
            .await
            .unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].steps[0].command, "fixture-only");
    }
}

#[tokio::test]
async fn subsequent_writes_switch_representation_without_leaving_a_stale_preferred_copy() {
    let (dir, state) = fixture().await;
    let root = dir.path().join("recording");
    for encrypted in [true, false, true] {
        policy(
            dir.path(),
            &state,
            &[
                (ArtifactKind::RecordingsMeta, encrypted),
                (ArtifactKind::RecordingsMedia, encrypted),
                (ArtifactKind::Macros, encrypted),
            ],
        )
        .await;
        let mut item = envelope("capture");
        item.data = format!("new-{encrypted}");
        storage::save_envelope_dispatched(&root, &item, &state)
            .await
            .unwrap();
        storage::save_media_blob_dispatched(&root, "capture.media", item.data.as_bytes(), &state)
            .await
            .unwrap();
        storage::save_macro_dispatched(&root, &macro_recording(), &state)
            .await
            .unwrap();
        assert_representation(&root, "recordings/capture.json", encrypted);
        assert_representation(&root, "recordings/capture.media", encrypted);
        assert_representation(&root, "macros/macro-fixture.json", encrypted);
        assert_eq!(
            storage::load_envelope_dispatched(&root, "capture", &state)
                .await
                .unwrap()
                .data,
            item.data
        );
        assert_eq!(
            storage::load_media_blob_dispatched(&root, "capture.media", &state)
                .await
                .unwrap(),
            item.data.as_bytes()
        );
    }
}

#[tokio::test]
async fn recording_config_follows_metadata_policy_not_macros_or_media_policy() {
    let (dir, state) = fixture().await;
    let root = dir.path().join("recording");
    for encrypted in [true, false] {
        policy(
            dir.path(),
            &state,
            &[
                (ArtifactKind::RecordingsMeta, encrypted),
                (ArtifactKind::RecordingsMedia, !encrypted),
                (ArtifactKind::Macros, !encrypted),
            ],
        )
        .await;
        let config = RecordingGlobalConfig {
            encrypt_at_rest: !encrypted,
            ..Default::default()
        };
        storage::save_config_dispatched(&root, &config, &state)
            .await
            .unwrap();
        let bytes = std::fs::read(root.join("config.json")).unwrap();
        assert_eq!(
            bytes.starts_with(sorng_encryption::envelope::MAGIC),
            encrypted
        );
        assert_eq!(
            storage::load_config_dispatched(&root, &state)
                .await
                .unwrap()
                .encrypt_at_rest,
            !encrypted
        );
    }
}

#[tokio::test]
async fn locked_and_pending_states_refuse_plaintext_override_without_touching_existing_captures() {
    for locked in [false, true] {
        let (dir, state) = fixture().await;
        let root = dir.path().join("recording");
        policy(
            dir.path(),
            &state,
            &[
                (ArtifactKind::RecordingsMeta, false),
                (ArtifactKind::RecordingsMedia, false),
                (ArtifactKind::Macros, false),
            ],
        )
        .await;
        storage::save_envelope_dispatched(&root, &envelope("capture"), &state)
            .await
            .unwrap();
        storage::save_media_blob_dispatched(&root, "capture.media", b"original", &state)
            .await
            .unwrap();
        storage::save_macro_dispatched(&root, &macro_recording(), &state)
            .await
            .unwrap();
        let paths = [
            root.join("recordings/capture.json"),
            root.join("recordings/capture.media"),
            root.join("macros/macro-fixture.json"),
        ];
        let originals: Vec<_> = paths
            .iter()
            .map(|path| std::fs::read(path).unwrap())
            .collect();
        if locked {
            state.lock().await;
        } else {
            state.set_artifact_recovery_required(true);
        }
        assert!(
            storage::save_envelope_dispatched(&root, &envelope("capture"), &state)
                .await
                .is_err()
        );
        assert!(storage::save_media_blob_dispatched(
            &root,
            "capture.media",
            b"replacement",
            &state
        )
        .await
        .is_err());
        assert!(
            storage::save_macro_dispatched(&root, &macro_recording(), &state)
                .await
                .is_err()
        );
        assert!(storage::load_envelope_dispatched(&root, "capture", &state)
            .await
            .is_err());
        assert!(
            storage::load_media_blob_dispatched(&root, "capture.media", &state)
                .await
                .is_err()
        );
        assert!(storage::load_all_macros_dispatched(&root, &state)
            .await
            .is_err());
        for (path, original) in paths.iter().zip(originals) {
            assert_eq!(std::fs::read(path).unwrap(), original);
        }
    }
}

#[tokio::test]
async fn invalid_policy_cannot_turn_encrypted_writer_into_plaintext_fallback() {
    let (dir, state) = fixture().await;
    let root = dir.path().join("recording");
    policy(dir.path(), &state, &[(ArtifactKind::RecordingsMeta, true)]).await;
    storage::save_envelope_dispatched(&root, &envelope("capture"), &state)
        .await
        .unwrap();
    let before = std::fs::read(root.join("recordings/capture.json.enc")).unwrap();
    std::fs::write(
        dir.path().join(artifact_policy::POLICY_FILENAME),
        b"invalid-policy",
    )
    .unwrap();
    artifact_policy::refresh(&state).await;
    assert!(
        storage::save_envelope_dispatched(&root, &envelope("capture"), &state)
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read(root.join("recordings/capture.json.enc")).unwrap(),
        before
    );
    assert!(!root.join("recordings/capture.json").exists());
}

#[tokio::test]
async fn service_library_sidecars_and_macros_obey_separate_policies_over_legacy_global_toggle() {
    let _serial = SERVICE_TESTS.lock().await;
    for meta in [false, true] {
        let (dir, state) = fixture().await;
        policy(
            dir.path(),
            &state,
            &[
                (ArtifactKind::RecordingsMeta, meta),
                (ArtifactKind::RecordingsMedia, !meta),
                (ArtifactKind::Macros, !meta),
            ],
        )
        .await;
        let service = RecordingService::new(dir.path().to_str().unwrap());
        service.set_encryption_state(state.clone()).await;
        service
            .update_config(RecordingGlobalConfig {
                encrypt_at_rest: !meta,
                ..Default::default()
            })
            .await
            .unwrap();
        let mut item = envelope("service-capture");
        item.format = ExportFormat::Raw;
        service.save_to_library(item).await.unwrap();
        service.import_macro(macro_recording()).await.unwrap();
        let root = service.storage_root_snapshot().await;
        assert_representation(&root, "recordings/service-capture.json", meta);
        assert_representation(&root, "recordings/service-capture.media", !meta);
        assert_representation(&root, "macros/macro-fixture.json", !meta);
        assert_eq!(
            storage::load_media_blob_dispatched(&root, "service-capture.media", &state)
                .await
                .unwrap(),
            b"fixture"
        );
        assert_eq!(
            service
                .get_from_library("service-capture")
                .await
                .unwrap()
                .media_blob_basename
                .as_deref(),
            Some("service-capture.media")
        );
    }
}

#[tokio::test]
async fn failed_service_stop_preserves_live_terminal_capture_for_retry_after_unlock_or_recovery() {
    let _serial = SERVICE_TESTS.lock().await;
    for locked in [false, true] {
        let (dir, state) = fixture().await;
        policy(dir.path(), &state, &[(ArtifactKind::RecordingsMeta, true)]).await;
        let service = RecordingService::new(dir.path().to_str().unwrap());
        service.set_encryption_state(state.clone()).await;
        service
            .start_terminal_recording(
                "session-fixture".into(),
                RecordingProtocol::Ssh,
                "fixture.invalid".into(),
                "fixture".into(),
                80,
                24,
                false,
                vec![],
            )
            .await
            .unwrap();
        service
            .append_terminal_output("session-fixture", "retained output")
            .await;
        if locked {
            state.lock().await;
        } else {
            state.set_artifact_recovery_required(true);
        }
        assert!(service
            .stop_terminal_recording("session-fixture")
            .await
            .is_err());
        assert!(service
            .engine
            .lock()
            .await
            .is_terminal_recording("session-fixture"));
    }
}
