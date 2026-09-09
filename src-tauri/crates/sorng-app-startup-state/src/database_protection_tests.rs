//! Real IPC decoding against isolated temp files. No OS vault/hardware calls.
use serde_json::{json, Value};
use sorng_encryption::EncryptionState;
use tauri::{
    test::{mock_builder, mock_context, noop_assets, MockRuntime},
    Manager,
};

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
fn managed_database_all_seven_commands_execute_through_real_lean_ipc_on_temp_profile() {
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    tauri::async_runtime::block_on(sorng_encryption::artifact_policy::initialize(
        &state,
        root.path(),
    ));
    std::fs::create_dir(root.path().join("databases")).unwrap();
    let data = json!({"connections":[],"settings":{"fixture":true}});
    sorng_storage::sdbf::safe_write(
        &root.path().join("databases/index.json"),
        &serde_json::to_vec(
            &json!([{"id":"db","name":"Fixture","isEncrypted":false,"securityRevision":"r0"}]),
        )
        .unwrap(),
    )
    .unwrap();
    sorng_storage::sdbf::safe_write(
        &root.path().join("databases/db.json"),
        &serde_json::to_vec(&data).unwrap(),
    )
    .unwrap();
    let managed_handler = sorng_commands_core::database_protection::build();
    let force_handler = sorng_commands_core::build_force_delete_trust_handler();
    let app = mock_builder()
        .invoke_handler(move |invoke| {
            if matches!(
                invoke.message.command(),
                "trust_preview_force_delete_legacy"
                    | "trust_force_delete_legacy"
                    | "trust_cancel_force_delete_legacy"
            ) {
                force_handler(invoke)
            } else {
                managed_handler(invoke)
            }
        })
        .build(mock_context(noop_assets()))
        .unwrap();
    // This runtime is bound only to this temporary profile. No default OS
    // AppData or real legacy known-host/trust source is inspected by the IPC.
    let trust_runtime = sorng_storage::trust_store::install_runtime(
        root.path().join("databases"),
        Some(std::sync::Arc::new(state.clone())),
    );
    trust_runtime
        .set_active(Some("unrelated-active".into()), None)
        .unwrap();
    std::fs::write(
        root.path().join("trust_store.json"),
        serde_json::to_vec(&sorng_storage::trust_store::TrustStoreData::default()).unwrap(),
    )
    .unwrap();
    app.manage(state);
    let main = tauri::WebviewWindowBuilder::new(&app, "db-main", Default::default())
        .build()
        .unwrap();
    let other = tauri::WebviewWindowBuilder::new(&app, "db-other", Default::default())
        .build()
        .unwrap();
    let names = [
        "database_protection_capabilities",
        "database_protection_status",
        "database_protection_unlock",
        "database_protection_lock",
        "database_protection_save",
        "database_protection_change",
        "database_protection_load",
    ];
    for name in names {
        assert!(
            sorng_commands_core::is_command(name),
            "missing lean route {name}"
        );
    }
    let capabilities = invoke(&main, names[0], json!({})).unwrap();
    assert_eq!(capabilities["ciphers"][0]["id"], "aes-256-gcm");
    let before = invoke(&main, names[1], json!({"databaseId":"db"})).unwrap();
    assert_eq!(before["kind"], "none");
    let migrate_command = "trust_migrate_legacy_database";
    assert!(sorng_commands_core::is_command(migrate_command));
    assert!(invoke(
        &main,
        migrate_command,
        json!({"databaseId":"db","expectedSecurityRevision":"stale"})
    )
    .is_err());
    let migrated = invoke(
        &main,
        migrate_command,
        json!({"databaseId":"db","expectedSecurityRevision":"r0"}),
    )
    .unwrap();
    assert_eq!(migrated["status"], "migrated");
    assert_eq!(
        trust_runtime.active_database_id().as_deref(),
        Some("unrelated-active")
    );
    let changed = invoke(&main,names[5],json!({"databaseId":"db","expectedSecurityRevision":"r0",
        "expectedData":data,"legacyVerifiedData":data,"target":{"dataCipher":"chacha20-poly1305",
        "keepSlotIds":[],"newSlots":[{"type":"password","label":"Portable","password":"fixture-only",
        "argon2":{"memoryKib":8192,"timeCost":1,"parallelism":1}}]}})).unwrap();
    assert_eq!(changed["committed"], true);
    assert_eq!(changed["cleanupPending"], false);
    assert!(changed["sessionExpiresAt"].is_u64());
    let protected = invoke(&main, names[1], json!({"databaseId":"db"})).unwrap();
    assert_eq!(protected["kind"], "managed");
    assert_eq!(protected["dataCipher"], "chacha20-poly1305");
    let opened = invoke(
        &other,
        names[2],
        json!({"databaseId":"db","slotId":protected["slots"][0]["id"],"password":"fixture-only"}),
    )
    .unwrap();
    assert_eq!(opened["data"], data);
    let managed_migration = json!({"databaseId":"db","expectedSecurityRevision":opened["securityRevision"],"sourceSessionId":opened["sessionId"]});
    assert!(invoke(&main, migrate_command, managed_migration.clone()).is_err());
    assert_eq!(
        invoke(&other, migrate_command, managed_migration.clone()).unwrap()["status"],
        "migrated"
    );
    assert_eq!(
        trust_runtime.active_database_id().as_deref(),
        Some("unrelated-active")
    );
    let request = json!({"databaseId":"db","sessionId":opened["sessionId"],
        "expectedSecurityRevision":opened["securityRevision"],"data":{"connections":[{"id":"saved"}]}});
    assert!(invoke(&main, names[4], request.clone()).is_err());
    let saved = invoke(&other, names[4], request.clone()).unwrap();
    assert_eq!(saved["committed"], true);
    assert_eq!(saved["securityRevision"], opened["securityRevision"]);
    let load_request = json!({"databaseId":"db","sessionId":opened["sessionId"],"expectedSecurityRevision":opened["securityRevision"]});
    assert!(invoke(&main, names[6], load_request.clone()).is_err());
    let reloaded = invoke(&other, names[6], load_request.clone()).unwrap();
    assert_eq!(reloaded["data"], request["data"]);
    assert_eq!(reloaded["sessionId"], opened["sessionId"]);
    assert_eq!(reloaded["sessionExpiresAt"], opened["sessionExpiresAt"]);
    let locked = invoke(&main, names[3], json!({"databaseId":"db"})).unwrap();
    assert_eq!(locked["locked"], true);
    assert_eq!(locked["notificationPending"], false);
    assert_eq!(locked["warnings"], json!([]));
    assert!(invoke(&other, names[4], request).is_err());
    assert!(invoke(&other, names[6], load_request).is_err());
    assert!(invoke(&other, migrate_command, managed_migration).is_err());
    // Legacy password path carries the exact previously verified encrypted
    // representation, never a renderer-supplied plaintext copy to persist.
    sorng_storage::sdbf::safe_write(
        &root.path().join("databases/index.json"),
        &serde_json::to_vec(
            &json!([{"id":"db","isEncrypted":true,"securityRevision":"legacy-r0"}]),
        )
        .unwrap(),
    )
    .unwrap();
    sorng_storage::sdbf::safe_write(
        &root.path().join("databases/db.json"),
        &serde_json::to_vec(&json!("opaque-legacy-password-fixture")).unwrap(),
    )
    .unwrap();
    assert!(invoke(&main,migrate_command,json!({"databaseId":"db","expectedSecurityRevision":"legacy-r0","expectedData":"wrong-raw","connectionIds":[]})).is_err());
    let legacy=invoke(&main,migrate_command,json!({"databaseId":"db","expectedSecurityRevision":"legacy-r0","expectedData":"opaque-legacy-password-fixture","connectionIds":[]})).unwrap();
    assert_eq!(legacy["status"], "migrated");
    assert!(root.path().join("trust_store.json").exists());
    assert_eq!(
        invoke(&other, names[1], json!({"databaseId":"db"})).unwrap()["kind"],
        "legacy-password"
    );
    assert!(root.path().join("databases/db.json").is_file());
    // Force cleanup is distinct from migration eligibility and copies opaque
    // input without changing the active database or any current trust sidecar.
    let force_names = [
        "trust_preview_force_delete_legacy",
        "trust_force_delete_legacy",
        "trust_cancel_force_delete_legacy",
    ];
    for name in force_names {
        assert!(sorng_commands_core::is_command(name));
    }
    let source = root.path().join("trust_store.json");
    std::fs::write(&source, b"malformed legacy bytes").unwrap();
    let destination = root.path().join("databases/db.trust.json");
    let destination_bytes = std::fs::read(&destination).unwrap();
    let preview = invoke(&main, force_names[0], json!({})).unwrap();
    assert_eq!(
        invoke(&other, force_names[2], json!({"token":preview["token"]})).unwrap(),
        false
    );
    assert_eq!(
        invoke(&main, force_names[2], json!({"token":preview["token"]})).unwrap(),
        true
    );
    let request = json!({"token":preview["token"],"confirmation":"FORCE DELETE LEGACY TRUST"});
    assert!(invoke(&main, force_names[1], request).is_err());
    let preview = invoke(&main, force_names[0], json!({})).unwrap();
    let request = json!({"token":preview["token"],"confirmation":"FORCE DELETE LEGACY TRUST"});
    assert!(invoke(&other, force_names[1], request.clone()).is_err());
    let result = invoke(&main, force_names[1], request.clone()).unwrap();
    assert_eq!(result["completed"], true);
    assert_eq!(result["removedFiles"], json!(["trust_store.json"]));
    assert_eq!(
        std::fs::read(
            std::path::Path::new(result["recoveryPath"].as_str().unwrap()).join("trust_store.json")
        )
        .unwrap(),
        b"malformed legacy bytes"
    );
    assert_eq!(std::fs::read(destination).unwrap(), destination_bytes);
    assert!(!source.exists());
    assert_eq!(
        trust_runtime.active_database_id().as_deref(),
        Some("unrelated-active")
    );
    assert!(invoke(&main, force_names[1], request).is_err());
}
