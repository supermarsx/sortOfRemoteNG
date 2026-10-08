//! Real encrypted DB/lease and production retention tests, without loading CEF.
use super::*;
use serde_json::json;
use sorng_browser_host::ipc::OriginBrowserCreateRequest;
use sorng_commands_core::origin_browser_authority::{authorize_create, NativeAuthorizedBrowser};
use sorng_encryption::{
    database_protection::{self as codec, DataCipher, DatabaseEnvelope, DatabaseKey},
    database_sessions::{self, SessionScope},
};
use tauri::{
    test::{mock_builder, mock_context, noop_assets, MockRuntime},
    WebviewUrl, WebviewWindowBuilder,
};

struct Fixture {
    _app: tauri::App<MockRuntime>,
    root: tempfile::TempDir,
    window: WebviewWindow<MockRuntime>,
    state: EncryptionState,
    key: DatabaseKey,
    profile: String,
    token: String,
    policy: RetentionPolicy,
}
impl Fixture {
    async fn new(mode: RetentionMode) -> Self {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let state = EncryptionState::new();
        sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
        std::fs::create_dir(root.path().join("databases")).unwrap();
        let profile = format!(
            "{:x}",
            Sha256::digest(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_bytes()
            )
        );
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
        let policy = RetentionPolicy {
            mode,
            ..Default::default()
        };
        let connection = |id: &str| {
            json!({"id":id,"protocol":"https","httpsTrustPolicy":"strict",
            "hostname":"https://same.example/","port":443,"httpAutoLogin":false,
            "httpProxyPolicy":{"version":1,"externalResourceOrigins":[],"allowExternalFonts":false},
            "browserSession":{"version":1,"sessionRetention":policy}})
        };
        let data = json!({"connections":[connection("one"),connection("two")],"settings":{}});
        let envelope = DatabaseEnvelope::create(
            "db",
            "key",
            "r1",
            DataCipher::Aes256Gcm,
            vec![slot],
            &data,
            &key,
        )
        .unwrap();
        sorng_storage::sdbf::safe_write(
            &root.path().join("databases/index.json"),
            &serde_json::to_vec(&json!([{"id":"db","name":"fixture","isEncrypted":true,
                "protectionFormat":"sorng-db","securityRevision":"r1"}]))
            .unwrap(),
        )
        .unwrap();
        sorng_storage::sdbf::safe_write(
            &root.path().join("databases/db.json"),
            &serde_json::to_vec(&envelope.value().unwrap()).unwrap(),
        )
        .unwrap();
        let mut fixture = Self {
            _app: app,
            root,
            window,
            state,
            key,
            profile,
            token: String::new(),
            policy,
        };
        fixture.unlock();
        fixture
    }
    fn unlock(&mut self) {
        self.token = database_sessions::global()
            .lock()
            .unwrap()
            .insert(
                &SessionScope {
                    owner: self.state.database_session_owner(),
                    profile: &self.profile,
                    database: "db",
                    revision: "r1",
                    window: "main",
                    generation: self.state.key_generation(),
                },
                self.key.duplicate(),
            )
            .unwrap();
    }
    async fn authorize(&self, tab: &str, connection: &str) -> NativeAuthorizedBrowser {
        let request: OriginBrowserCreateRequest = serde_json::from_value(json!({
            "owner":{"ownerDatabaseId":"db","connectionId":connection,"sessionId":tab},
            "expectedSecurityRevision":"r1","sourceSessionId":self.token,"requestId":"create",
            "initialUrl":"https://same.example/","bounds":{"x":0,"y":0,"width":800,"height":600},
            "visible":false,"policy":{"darkMode":"forced","autoLogin":{"enabled":true,"consent":{"kind":"required"}}}
        }))
        .unwrap();
        authorize_create(&self.window, &self.state, &request)
            .await
            .unwrap()
    }
    async fn owner(&self, tab: &str, connection: &str) -> Arc<NativeCookieRetention> {
        let native = self.authorize(tab, connection).await;
        NativeCookieRetention::prepare(
            &self.window,
            &self.state,
            &native.lease,
            &native.policy,
            self.policy,
        )
        .await
        .unwrap()
    }
    fn database_bytes(&self) -> Vec<u8> {
        std::fs::read(self.root.path().join("databases/db.json")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        database_sessions::revoke_owner(self.state.database_session_owner());
    }
}
fn cookie(value: &str) -> SignInCookie {
    SignInCookie {
        origin: "https://same.example".into(),
        name: "session".into(),
        value: value.into(),
        domain: "same.example".into(),
        path: "/".into(),
        secure: true,
        http_only: true,
        creation: 1,
        expires: None,
        same_site: 2,
        priority: 1,
    }
}
async fn load(owner: &Arc<NativeCookieRetention>) -> Vec<SignInCookie> {
    let owner = owner.clone();
    tauri::async_runtime::spawn_blocking(move || owner.load())
        .await
        .unwrap()
        .unwrap()
}
async fn save(owner: &Arc<NativeCookieRetention>, value: &str) {
    let owner = owner.clone();
    let cookies = vec![cookie(value)];
    tauri::async_runtime::spawn_blocking(move || owner.save(cookies))
        .await
        .unwrap()
        .unwrap();
}
async fn clear(owner: &Arc<NativeCookieRetention>) {
    let owner = owner.clone();
    tauri::async_runtime::spawn_blocking(move || owner.clear())
        .await
        .unwrap()
        .unwrap();
}
async fn finish(owner: &Arc<NativeCookieRetention>) {
    let owner = owner.clone();
    tauri::async_runtime::spawn_blocking(move || owner.finish())
        .await
        .unwrap()
        .unwrap();
}
fn live(owner: &NativeCookieRetention) -> bool {
    let mut delivered = false;
    assert_eq!(owner.with_current(&mut || delivered = true), delivered);
    delivered
}

#[tokio::test]
async fn duplicate_tabs_keep_live_owners_while_only_latest_saves_or_deletes() {
    for mode in [RetentionMode::Memory, RetentionMode::EncryptedDatabase] {
        let fixture = Fixture::new(mode).await;
        let a = fixture.owner("tab-a", "one").await;
        assert!(load(&a).await.is_empty());
        save(&a, "first").await;
        let b = fixture.owner("tab-b", "one").await;
        assert_eq!(load(&b).await[0].value, "first");
        // A delayed native import still has valid attempt authority even
        // though this tab is no longer the persisted snapshot writer.
        assert_eq!(load(&a).await[0].value, "first");
        assert!(live(&a) && live(&b));
        assert!(!a.enabled() && b.enabled());
        assert_ne!(a.identity().attempt_id(), b.identity().attempt_id());
        save(&b, "latest").await;
        let before = fixture.database_bytes();
        save(&a, "stale").await;
        clear(&a).await;
        assert_eq!(before, fixture.database_bytes());
        assert!(live(&b));
        assert!(!live(&a));
        let c = fixture.owner("tab-c", "one").await;
        assert_eq!(load(&c).await[0].value, "latest");
        finish(&b).await;
        assert!(live(&c));
        clear(&c).await;
    }
}

#[tokio::test]
async fn finish_latest_does_not_promote_old_tab_or_old_attempt_after_reconnect() {
    let fixture = Fixture::new(RetentionMode::EncryptedDatabase).await;
    let a = fixture.owner("same-tab", "one").await;
    load(&a).await;
    save(&a, "original").await;
    let b = fixture.owner("same-tab", "one").await;
    load(&b).await;
    save(&b, "reconnected").await;
    finish(&b).await;
    assert!(live(&a));
    assert!(!a.enabled());
    save(&a, "stale").await;
    clear(&a).await;
    let c = fixture.owner("third", "one").await;
    assert_eq!(load(&c).await[0].value, "reconnected");
    clear(&c).await;
}

#[tokio::test]
async fn same_url_different_connections_and_databases_keep_separate_snapshots() {
    for mode in [RetentionMode::Memory, RetentionMode::EncryptedDatabase] {
        let fixture = Fixture::new(mode).await;
        let other_database = Fixture::new(mode).await;
        let a = fixture.owner("a", "one").await;
        let b = fixture.owner("b", "two").await;
        let other = other_database.owner("c", "one").await;
        assert!(load(&a).await.is_empty());
        save(&a, "private-one").await;
        assert!(load(&b).await.is_empty());
        assert!(load(&other).await.is_empty());
        save(&b, "private-two").await;
        assert!(a.enabled() && b.enabled() && other.enabled());
        let next_a = fixture.owner("next-a", "one").await;
        let next_b = fixture.owner("next-b", "two").await;
        assert_eq!(load(&next_a).await[0].value, "private-one");
        assert_eq!(load(&next_b).await[0].value, "private-two");
        for owner in [&a, &b, &other, &next_a, &next_b] {
            clear(owner).await;
        }
    }
}

#[tokio::test]
async fn fresh_unlock_cannot_revive_old_attempts_or_inherit_memory() {
    let mut fixture = Fixture::new(RetentionMode::Memory).await;
    let a = fixture.owner("a", "one").await;
    load(&a).await;
    save(&a, "old-unlock").await;
    let b = fixture.owner("b", "one").await;
    load(&b).await;
    fixture.unlock(); // Replaces the exact native source session token.
    assert!(!live(&a) && !live(&b));
    tauri::async_runtime::spawn_blocking(NativeCookieRetention::housekeeping)
        .await
        .unwrap()
        .unwrap();
    let c = fixture.owner("c", "one").await;
    assert!(load(&c).await.is_empty());
    save(&c, "new-unlock").await;
    clear(&a).await;
    clear(&b).await;
    assert!(live(&c));
    let d = fixture.owner("d", "one").await;
    assert_eq!(load(&d).await[0].value, "new-unlock");
    clear(&c).await;
    clear(&d).await;
}

#[tokio::test]
async fn queued_predecessor_save_is_denied_after_successor_admission() {
    let fixture = Fixture::new(RetentionMode::EncryptedDatabase).await;
    let a = fixture.owner("a", "one").await;
    load(&a).await;
    save(&a, "initial").await;
    let b = fixture.owner("b", "one").await;
    load(&b).await;
    // Simulate a capture already produced by A, dispatched after B admitted.
    let stale = a.clone();
    let old_save = tauri::async_runtime::spawn_blocking(move || stale.save(vec![cookie("stale")]));
    save(&b, "winner").await;
    old_save.await.unwrap().unwrap();
    clear(&a).await;
    let c = fixture.owner("c", "one").await;
    assert_eq!(load(&c).await[0].value, "winner");
    finish(&b).await;
    clear(&c).await;
}

#[tokio::test]
async fn external_snapshot_revision_wins_without_merge_delete_or_cleanup_retry() {
    for action in ["save", "clear", "finish"] {
        let fixture = Fixture::new(RetentionMode::EncryptedDatabase).await;
        let a = fixture.owner("a", "one").await;
        load(&a).await;
        save(&a, "old-session").await;
        let revision = a.revision.lock().unwrap().clone();
        // Production native CAS simulates a reviewed snapshot import outside
        // this tab. It must win over both stale captures and stale cleanup.
        a.lease
            .save_cookie_record(
                revision,
                vec![cookie("imported-session")],
                a.source.clone(),
                a.origins.clone(),
                a.policy,
                || true,
            )
            .await
            .unwrap();
        let before = fixture.database_bytes();
        match action {
            "save" => {
                save(&a, "stale").await;
                assert!(!a.enabled());
                assert!(live(&a));
                clear(&a).await;
            }
            "clear" => clear(&a).await,
            _ => finish(&a).await,
        }
        assert_eq!(fixture.database_bytes(), before);
        let b = fixture.owner("b", "one").await;
        assert_eq!(load(&b).await[0].value, "imported-session");
        clear(&b).await;
    }
}

#[tokio::test]
async fn writer_handover_waits_for_database_coordinator_without_revoking_live_tab() {
    let fixture = Fixture::new(RetentionMode::EncryptedDatabase).await;
    let a = fixture.owner("a", "one").await;
    load(&a).await;
    save(&a, "before-handover").await;
    let native = fixture.authorize("b", "one").await;
    let write = sorng_encryption::settings_coordinator::lock_settings_write().await;
    let mut pending = Box::pin(NativeCookieRetention::prepare(
        &fixture.window,
        &fixture.state,
        &native.lease,
        &native.policy,
        fixture.policy,
    ));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending)
            .await
            .is_err()
    );
    assert!(a.enabled() && live(&a));
    drop(write);
    let b = tokio::time::timeout(std::time::Duration::from_secs(5), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(!a.enabled() && b.enabled());
    assert!(live(&a) && live(&b));
    assert_eq!(load(&b).await[0].value, "before-handover");
    clear(&a).await;
    clear(&b).await;
}

#[tokio::test]
async fn snapshot_expiry_does_not_revoke_independent_live_attempts() {
    let fixture = Fixture::new(RetentionMode::Memory).await;
    let a = fixture.owner("a", "one").await;
    load(&a).await;
    save(&a, "expires").await;
    let b = fixture.owner("b", "one").await;
    load(&b).await;
    registry()
        .lock()
        .unwrap()
        .slots
        .get_mut(&b.scope)
        .unwrap()
        .expires = 0;
    tauri::async_runtime::spawn_blocking(NativeCookieRetention::housekeeping)
        .await
        .unwrap()
        .unwrap();
    assert!(live(&a) && live(&b));
    assert!(!a.enabled() && !b.enabled());
    let c = fixture.owner("c", "one").await;
    assert!(load(&c).await.is_empty());
    for owner in [&a, &b, &c] {
        clear(owner).await;
    }
}
