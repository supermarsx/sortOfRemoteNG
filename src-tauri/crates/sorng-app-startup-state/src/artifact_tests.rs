//! Real lean IPC, always using native policy roots pointing into a tempfile.
use super::*;
use serde_json::{json, Value};
use sorng_encryption::{
    artifact_policy, artifact_transaction, ArtifactKind, EncryptionState, MasterDek,
};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

fn invoke(
    view: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        view,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

#[test]
fn lean_artifact_ipc_inspects_previews_and_applies_verified_bidirectional_policy() {
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    tauri::async_runtime::block_on(async {
        state
            .install(MasterDek::from_bytes(&[37u8; 32]).unwrap())
            .await;
        artifact_policy::initialize(&state, root.path()).await;
    });
    assert_eq!(state.artifact_policy_root().as_deref(), Some(root.path()));
    let fixture = mock_builder()
        .invoke_handler(sorng_commands_core::artifact_handler::build())
        .build(mock_context(noop_assets()))
        .unwrap();
    fixture.manage(state.clone());
    fixture.manage(SecureStorage::new(
        root.path()
            .join("storage.json")
            .to_string_lossy()
            .into_owned(),
    ));
    fixture.manage(backup::BackupService::new(
        root.path().join("backups").to_string_lossy().into_owned(),
    ));
    security_data::register_recording(&fixture, root.path());
    let view = tauri::WebviewWindowBuilder::new(&fixture, "artifact-fixture", Default::default())
        .build()
        .unwrap();
    let original = br#"{"theme":"fixture","nested":{"preserved":true}}"#;
    std::fs::write(root.path().join("settings.json"), original).unwrap();
    let status = invoke(&view, "encryption_get_artifact_status", json!({})).unwrap();
    let rows = status["artifacts"].as_array().unwrap();
    assert_eq!(rows.len(), 11);
    let ids: std::collections::HashSet<_> =
        rows.iter().map(|row| row["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 11);
    assert_eq!(status["unlocked"], true);
    for protected in ["key-ring", "artifact-policy"] {
        assert_eq!(
            rows.iter().find(|row| row["id"] == protected).unwrap()["mutable"],
            false
        );
        assert!(invoke(
            &view,
            "encryption_preview_artifact_policy",
            json!({"artifacts":[protected],"target":"plaintext"})
        )
        .is_err());
    }
    let preview = invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["settings"],"target":"encrypted"}),
    )
    .unwrap();
    // An unrelated live log append does not invalidate a Settings-only preview.
    std::fs::create_dir_all(root.path().join("logs")).unwrap();
    std::fs::write(root.path().join("logs/unrelated.log"), b"fixture event\n").unwrap();
    let result = invoke(
        &view,
        "encryption_apply_artifact_policy",
        json!({"token":preview["token"],"confirmPlaintext":false,"requestId":"encrypt-fixture"}),
    )
    .unwrap();
    assert_eq!(result["outcome"], "completed");
    assert_eq!(result["results"][0]["id"], "settings");
    assert!(!root.path().join("settings.json").exists());
    let encoded = std::fs::read(root.path().join("settings.enc")).unwrap();
    let decoded = tauri::async_runtime::block_on(sorng_encryption::artifacts::settings::read(
        &state, &encoded,
    ))
    .unwrap()
    .unwrap();
    assert_eq!(
        decoded,
        json!({"theme":"fixture","nested":{"preserved":true}})
    );
    assert!(state
        .resolve_write_policy(ArtifactKind::Settings, false)
        .unwrap());
    assert!(!artifact_transaction::has_pending(root.path()).unwrap());
    let preview = invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["settings"],"target":"plaintext"}),
    )
    .unwrap();
    assert!(invoke(
        &view,
        "encryption_apply_artifact_policy",
        json!({"token":preview["token"],"confirmPlaintext":false,"requestId":"deny-plaintext"})
    )
    .is_err());
    assert!(root.path().join("settings.enc").exists());
    let result = invoke(
        &view,
        "encryption_apply_artifact_policy",
        json!({"token":preview["token"],"confirmPlaintext":true,"requestId":"decrypt-fixture"}),
    )
    .unwrap();
    assert_eq!(result["outcome"], "completed");
    assert_eq!(result["recoveryRequired"], false);
    assert!(!root.path().join("settings.enc").exists());
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(root.path().join("settings.json")).unwrap())
            .unwrap(),
        decoded
    );
    assert!(!state
        .resolve_write_policy(ArtifactKind::Settings, true)
        .unwrap());
    // Preview is not permission to overwrite later external changes.
    let preview = invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["settings"],"target":"encrypted"}),
    )
    .unwrap();
    let receipt = std::fs::read(root.path().join(artifact_policy::POLICY_FILENAME)).unwrap();
    std::fs::write(root.path().join("settings.json"), br#"{"theme":"changed"}"#).unwrap();
    assert!(invoke(
        &view,
        "encryption_apply_artifact_policy",
        json!({"token":preview["token"],"confirmPlaintext":false,"requestId":"drift-fixture"})
    )
    .is_err());
    assert_eq!(
        std::fs::read(root.path().join(artifact_policy::POLICY_FILENAME)).unwrap(),
        receipt
    );
    assert!(!root.path().join("settings.enc").exists());
    let preview = invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["macros"],"target":"encrypted"}),
    )
    .unwrap();
    invoke(
        &view,
        "encryption_release_artifact_preview",
        json!({"token":preview["token"]}),
    )
    .unwrap();
    assert!(invoke(
        &view,
        "encryption_apply_artifact_policy",
        json!({"token":preview["token"],"confirmPlaintext":false,"requestId":"released-fixture"})
    )
    .is_err());
    invoke(
        &view,
        "encryption_cancel_artifact_policy",
        json!({"requestId":"no-active-fixture"}),
    )
    .unwrap();
    invoke(&view, "encryption_recover_artifact_transition", json!({})).unwrap();
    let preview = invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["macros"],"target":"plaintext"}),
    )
    .unwrap();
    let result=invoke(&view,"encryption_apply_artifact_policy",json!({"token":preview["token"],"confirmPlaintext":true,"requestId":"absent-policy-fixture"})).unwrap();
    assert_eq!(result["outcome"], "completed");
    assert_eq!(result["results"][0]["files"], 0);
    assert!(!state
        .resolve_write_policy(ArtifactKind::Macros, true)
        .unwrap());
    // Recovery must not depend on BackupService hydrating custom destinations
    // from Settings (normal settings reads are gated until recovery finishes).
    let external = tempfile::tempdir().unwrap();
    let backup = external.path().join("backup.json");
    std::fs::write(&backup, b"original external backup").unwrap();
    tauri::async_runtime::block_on(async {
        let mut tx = artifact_transaction::ArtifactTransaction::begin(
            root.path(),
            &[external.path().to_path_buf()],
            &state,
        )
        .await
        .unwrap();
        artifact_transaction::durable_write(&tx.replace(&backup).unwrap(), b"interrupted stage")
            .unwrap();
        // Drop simulates interruption. The managed BackupService still has its
        // initial/default configuration, which does not contain this root.
    });
    assert!(state.artifact_recovery_required());
    invoke(&view, "encryption_recover_artifact_transition", json!({})).unwrap();
    assert_eq!(std::fs::read(backup).unwrap(), b"original external backup");
    assert_eq!(std::fs::read_dir(external.path()).unwrap().count(), 1);
    assert!(!state.artifact_recovery_required());
    tauri::async_runtime::block_on(state.lock());
    assert!(invoke(
        &view,
        "encryption_preview_artifact_policy",
        json!({"artifacts":["settings"],"target":"plaintext"})
    )
    .is_err());
}
