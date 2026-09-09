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
    let app = mock_builder()
        .invoke_handler(sorng_commands_core::database_protection::build())
        .build(mock_context(noop_assets()))
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
    invoke(&main, names[3], json!({"databaseId":"db"})).unwrap();
    assert!(invoke(&other, names[4], request).is_err());
    assert!(invoke(&other, names[6], load_request).is_err());
    assert_eq!(
        invoke(&other, names[1], json!({"databaseId":"db"})).unwrap()["unlocked"],
        false
    );
    assert!(root.path().join("databases/db.json").is_file());
}
