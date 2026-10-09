use super::*;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[test]
fn only_known_local_shell_locations_can_delegate_or_receive() {
    let dev: url::Url = "http://localhost:3001".parse().unwrap();
    for location in [
        "tauri://localhost/detached?sessionId=one",
        "http://tauri.localhost/detached/",
        "https://tauri.localhost/detached/index.html",
        "http://tauri.localhost/detached.html",
        "http://localhost:3001/detached?sessionId=one",
    ] {
        assert!(
            trusted_app_location("detached-one", &location.parse().unwrap(), Some(&dev)),
            "{location}"
        );
    }
    for (label, location) in [
        ("splash", "http://tauri.localhost/"),
        ("other", "http://tauri.localhost/detached"),
        ("detached-", "http://tauri.localhost/detached"),
        ("detached-one", "http://tauri.localhost/"),
        ("main", "http://tauri.localhost/detached"),
        ("detached-one", "https://website.example/detached"),
        ("detached-one", "http://tauri.localhost.evil/detached"),
        ("detached-one", "http://tauri.localhost:4444/detached"),
        ("detached-one", "http://user@tauri.localhost/detached"),
        ("detached-one", "http://localhost:3002/detached"),
        ("detached-one", "http://127.0.0.1:3001/detached"),
        ("detached-one", "http://localhost:3001/auxiliary"),
        ("detached-one", "http://localhost:3001/detached/other"),
    ] {
        assert!(
            !trusted_app_location(label, &location.parse().unwrap(), Some(&dev)),
            "{label}: {location}"
        );
    }
    assert!(!trusted_app_location(
        "detached-one",
        &"http://localhost:3001/detached".parse().unwrap(),
        None
    ));
    assert!(trusted_app_location(
        "main",
        &"http://tauri.localhost/".parse().unwrap(),
        None
    ));
}

struct Fixture {
    app: tauri::App<MockRuntime>,
    _root: tempfile::TempDir,
    state: EncryptionState,
    source: WebviewWindow<MockRuntime>,
    target: WebviewWindow<MockRuntime>,
    source_token: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let state = EncryptionState::new();
        tauri::async_runtime::block_on(sorng_encryption::artifact_policy::initialize(
            &state,
            root.path(),
        ));
        std::fs::create_dir(root.path().join("databases")).unwrap();
        let profile = profile_binding(root.path()).unwrap();
        let key = DatabaseKey::generate();
        let slot = codec::new_vault_slot(
            "db",
            "key",
            "slot".into(),
            &profile,
            "fixture",
            &DatabaseKey::generate(),
            &key,
        )
        .unwrap();
        let data = json!({"connections":[{"id":"saved","protocol":"https","hostname":"fixture.example"}],"settings":{}});
        let envelope = DatabaseEnvelope::create(
            "db",
            "key",
            "revision",
            DataCipher::Aes256Gcm,
            vec![slot],
            &data,
            &key,
        )
        .unwrap();
        sorng_storage::sdbf::safe_write(&root.path().join("databases/index.json"), &serde_json::to_vec(&json!([
            {"id":"db","name":"fixture","isEncrypted":true,"protectionFormat":"sorng-db","securityRevision":"revision"}
        ])).unwrap()).unwrap();
        sorng_storage::sdbf::safe_write(
            &root.path().join("databases/db.json"),
            &serde_json::to_vec(&envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        let app = mock_builder()
            .invoke_handler(super::super::build())
            .build(mock_context(noop_assets()))
            .unwrap();
        app.manage(state.clone());
        let source = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        let target =
            WebviewWindowBuilder::new(&app, "detached-one", WebviewUrl::App("detached".into()))
                .build()
                .unwrap();
        let source_token = database_sessions::global()
            .lock()
            .unwrap()
            .insert(&scope(&profile, "db", "revision", "main", &state), key)
            .unwrap();
        Self {
            app,
            _root: root,
            state,
            source,
            target,
            source_token,
        }
    }

    fn request(&self) -> Value {
        json!({"databaseId":"db","sessionId":self.source_token,"expectedSecurityRevision":"revision","targetWindow":"detached-one","handoffId":"bootstrap-one"})
    }
}

fn invoke(window: &WebviewWindow<MockRuntime>, command: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: window.url().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

const DELEGATE: &str = "database_protection_delegate_session";
const LOAD: &str = "database_protection_load";
const LOAD_PLAIN: &str = "database_protection_load_plain";

fn write_plain(f: &Fixture, row: Value, data: Value) {
    for (file, value) in [("index.json", json!([row])), ("db.json", data)] {
        sorng_storage::sdbf::safe_write(
            &f._root.path().join("databases").join(file),
            &serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn plain_handoff_reads_complete_local_data_without_grants_or_passwords() {
    assert!(crate::is_command(LOAD_PLAIN));
    let f = Fixture::new();
    let data = json!({"connections":[{"id":"detached"},{"id":"not-detached"}],"settings":{}});
    write_plain(&f, json!({"id":"db","isEncrypted":false}), data.clone());
    let request = json!({"databaseId":"db","expectedSecurityRevision":""});
    let result = invoke(&f.target, LOAD_PLAIN, request.clone()).unwrap();
    assert_eq!(result["data"], data);
    assert_eq!(result["securityRevision"], "");
    assert_eq!(result.as_object().unwrap().len(), 2);
    assert!(invoke(&f.source, LOAD_PLAIN, request.clone()).is_err());
    let remote = WebviewWindowBuilder::new(
        &f.app,
        "detached-remote",
        WebviewUrl::External("https://website.example/detached".parse().unwrap()),
    )
    .build()
    .unwrap();
    assert!(invoke(&remote, LOAD_PLAIN, request).is_err());
}

#[test]
fn plain_handoff_cannot_downgrade_managed_legacy_or_changed_databases() {
    let f = Fixture::new();
    let request = json!({"databaseId":"db","expectedSecurityRevision":"revision"});
    assert!(invoke(&f.target, LOAD_PLAIN, request.clone()).is_err());
    for (row, data) in [
        (
            json!({"id":"db","isEncrypted":true,"securityRevision":"revision"}),
            json!("encrypted-legacy-data"),
        ),
        (
            json!({"id":"db","isEncrypted":false,"securityRevision":"new-revision"}),
            json!({"connections":[]}),
        ),
        (
            json!({"id":"db","isEncrypted":false,"securityRevision":"revision"}),
            json!("encrypted-legacy-data"),
        ),
        (
            json!({"id":"db","isEncrypted":false,"securityRevision":"revision"}),
            json!({"notConnections":[]}),
        ),
    ] {
        write_plain(&f, row, data);
        assert!(invoke(&f.target, LOAD_PLAIN, request.clone()).is_err());
    }
}

#[test]
fn plain_handoff_does_not_bypass_global_encryption_lock() {
    let f = Fixture::new();
    write_plain(
        &f,
        json!({"id":"db","isEncrypted":false}),
        json!({"connections":[]}),
    );
    tauri::async_runtime::block_on(async {
        f.state
            .install(sorng_encryption::MasterDek::generate())
            .await;
        f.state.lock().await;
    });
    let error = invoke(
        &f.target,
        LOAD_PLAIN,
        json!({"databaseId":"db","expectedSecurityRevision":""}),
    )
    .unwrap_err();
    assert!(error.to_string().contains("locked"), "{error}");
}

#[test]
fn delegation_ipc_returns_only_target_grant_and_existing_load_enforces_ownership() {
    assert!(
        crate::is_command(DELEGATE),
        "missing production command route"
    );
    let f = Fixture::new();
    let grant = invoke(&f.source, DELEGATE, f.request()).unwrap();
    assert_eq!(grant.as_object().unwrap().len(), 3);
    assert_eq!(grant["securityRevision"], "revision");
    assert!(grant["sessionExpiresAt"].is_null());
    assert_ne!(grant["sessionId"], f.source_token);
    assert!(!grant.to_string().contains(&f.source_token));
    assert_eq!(invoke(&f.source, DELEGATE, f.request()).unwrap(), grant);
    let mut load = f.request();
    load.as_object_mut().unwrap().remove("targetWindow");
    assert!(invoke(&f.target, LOAD, load.clone()).is_err());
    load["sessionId"] = grant["sessionId"].clone();
    assert!(invoke(&f.source, LOAD, load.clone()).is_err());
    let loaded = invoke(&f.target, LOAD, load.clone()).unwrap();
    assert_eq!(loaded["data"]["connections"][0]["id"], "saved");
    assert_eq!(loaded["sessionId"], grant["sessionId"]);
    invoke(
        &f.target,
        "database_protection_release_session",
        json!({"databaseId":"db","sessionId":grant["sessionId"]}),
    )
    .unwrap();
    assert!(invoke(&f.target, LOAD, load.clone()).is_err());
    let replacement = invoke(&f.source, DELEGATE, f.request()).unwrap();
    assert_ne!(grant["sessionId"], replacement["sessionId"]);
    load["sessionId"] = replacement["sessionId"].clone();
    invoke(
        &f.source,
        "database_protection_release_session",
        json!({"databaseId":"db","sessionId":f.source_token}),
    )
    .unwrap();
    assert!(invoke(&f.target, LOAD, load).is_err());
    assert!(invoke(&f.source, DELEGATE, f.request()).is_err());
}

#[test]
fn delegation_ipc_requires_handoff_and_keeps_refreshed_receiver_alive() {
    let f = Fixture::new();
    let mut missing = f.request();
    missing.as_object_mut().unwrap().remove("handoffId");
    assert!(invoke(&f.source, DELEGATE, missing).is_err());
    for bad in ["", "not/opaque", &"x".repeat(129)] {
        let mut request = f.request();
        request["handoffId"] = bad.into();
        assert!(invoke(&f.source, DELEGATE, request).is_err());
    }
    let old = invoke(&f.source, DELEGATE, f.request()).unwrap();
    let mut refreshed = f.request();
    refreshed["handoffId"] = "bootstrap-two".into();
    let new = invoke(&f.source, DELEGATE, refreshed.clone()).unwrap();
    assert_ne!(old["sessionId"], new["sessionId"]);
    assert_eq!(invoke(&f.source, DELEGATE, f.request()).unwrap(), old);
    assert_eq!(invoke(&f.source, DELEGATE, refreshed).unwrap(), new);
    invoke(
        &f.target,
        "database_protection_release_session",
        json!({"databaseId":"db","sessionId":old["sessionId"]}),
    )
    .unwrap();
    assert!(invoke(&f.target, LOAD, json!({"databaseId":"db","sessionId":new["sessionId"],"expectedSecurityRevision":"revision"})).is_ok());
}

#[test]
fn delegation_ipc_rejects_missing_auxiliary_remote_targets_and_stale_revision() {
    let f = Fixture::new();
    for (label, url) in [
        ("auxiliary", "http://tauri.localhost/detached"),
        ("detached-remote", "https://website.example/detached"),
        ("detached-wrong-route", "http://tauri.localhost/auxiliary"),
    ] {
        WebviewWindowBuilder::new(&f.app, label, WebviewUrl::External(url.parse().unwrap()))
            .build()
            .unwrap();
    }
    for target in [
        "main",
        "missing",
        "detached-missing",
        "auxiliary",
        "detached-remote",
        "detached-wrong-route",
    ] {
        let mut request = f.request();
        request["targetWindow"] = target.into();
        assert!(invoke(&f.source, DELEGATE, request).is_err(), "{target}");
    }
    let mut stale = f.request();
    stale["expectedSecurityRevision"] = "stale".into();
    assert!(invoke(&f.source, DELEGATE, stale).is_err());
    let mut thief = f.request();
    thief["targetWindow"] = "detached-remote".into();
    assert!(invoke(&f.target, DELEGATE, thief).is_err());
    assert!(invoke(&f.source, DELEGATE, f.request()).is_ok());
}

#[test]
fn delegation_ipc_fences_target_destruction_while_waiting_for_database_barrier() {
    let f = Fixture::new();
    // Poll through the real preflight/window epoch capture, then block the
    // storage await. Model the existing native Destroyed callback, including
    // a new lifetime at the same label before the request resumes.
    let barrier = tauri::async_runtime::block_on(sorng_encryption::settings_coordinator::lock());
    let mut pending = Box::pin(database_protection_delegate_session(
        f.source.clone(),
        f.app.state(),
        "db".into(),
        f.source_token.clone(),
        "revision".into(),
        "detached-one".into(),
        "bootstrap-one".into(),
    ));
    let waker = std::task::Waker::noop();
    let mut context = std::task::Context::from_waker(waker);
    assert!(pending.as_mut().poll(&mut context).is_pending());
    database_sessions::revoke_window(f.state.database_session_owner(), "detached-one");
    window_epoch(&f.state, "detached-one").unwrap();
    drop(barrier);
    let error = tauri::async_runtime::block_on(pending).err().unwrap();
    assert!(error.contains("target window closed"), "{error}");
    assert!(invoke(&f.source, DELEGATE, f.request()).is_ok());
}
