//! Engine-only startup authority. Never resolves routes, credentials, cookies,
//! browser sessions or consent. The renderer supplies lookup hints, not grants.

use super::{native_browser_owner, NativeAuthorityError, NativeOwnerLease};
use serde::Deserialize;
use serde_json::Value;
use sorng_encryption::EncryptionState;
use std::sync::atomic::{AtomicU8, Ordering};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{Runtime, WebviewWindow};

// No browser/tab identity or URL is needed to warm the engine. Deliberately no
// Debug/Serialize: source_session_id is an existing native unlock proof.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrewarmRequest {
    pub owner_database_id: String,
    pub connection_id: String,
    pub expected_security_revision: String,
    pub source_session_id: String,
}

/// Exact saved owner selected by native_browser_owner::read. The database ID
/// cannot be replaced by a later renderer hint when capturing the UI fence.
pub struct AuthorizedPrewarm {
    pub lease: NativeOwnerLease,
    database_id: String,
}

impl PrewarmRequest {
    pub fn validate(&self) -> Result<(), NativeAuthorityError> {
        for value in [
            &self.owner_database_id,
            &self.connection_id,
            &self.expected_security_revision,
            &self.source_session_id,
        ] {
            if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
                return Err(NativeAuthorityError::InvalidRequest);
            }
        }
        Ok(())
    }
}

/// One automatic attempt per process, including failure and cancellation.
/// Independent of StartupGate: cancelling prewarm never consumes manual startup.
#[derive(Default)]
pub struct PrewarmGate(AtomicU8);

impl PrewarmGate {
    pub fn begin(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn current(&self) -> bool {
        self.0.load(Ordering::Acquire) == 1
    }

    pub fn cancel(&self) {
        // Also handles cancellation reaching native before the async start.
        self.0.store(2, Ordering::Release);
    }
}

fn saved_settings_allow(settings: &Value) -> bool {
    if !settings.is_null() && !settings.is_object() {
        return false;
    }
    let Some(browser) = settings.get("webBrowser") else {
        return true;
    };
    browser.is_object()
        && browser
            .get("version")
            .is_none_or(|value| value.as_u64() == Some(1))
        && browser
            .get("engine")
            .is_none_or(|value| value.as_str() == Some("real-origin"))
        && matches!(
            browser.get("idlePrewarmEnabled"),
            None | Some(Value::Bool(true))
        )
}

type SettingsStamp = Vec<Option<(u64, SystemTime, Option<SystemTime>)>>;

fn settings_stamp(paths: &[PathBuf]) -> Result<SettingsStamp, NativeAuthorityError> {
    paths
        .iter()
        .map(|path| match std::fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => Ok(Some((
                metadata.len(),
                metadata
                    .modified()
                    .map_err(|_| NativeAuthorityError::PolicyUnsupported)?,
                metadata.created().ok(),
            ))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            _ => Err(NativeAuthorityError::PolicyUnsupported),
        })
        .collect()
}

/// Saved settings and the exact database/index are read asynchronously. The queued
/// UI callback rejects changed artifacts under the same coordinator used by native
/// database writes. Only metadata checks run on UI; decryption and waits do not.
pub struct SavedSettingsFence {
    paths: Vec<PathBuf>,
    stamp: SettingsStamp,
}

impl SavedSettingsFence {
    fn capture(root: &Path, database_id: &str) -> Result<Self, NativeAuthorityError> {
        // The managed database reader uses these canonical .json paths for both
        // plain and encrypted SDBF payloads; settings uses a separate .enc file.
        let paths = vec![
            root.join("settings.json"),
            root.join("settings.enc"),
            root.join("databases/index.json"),
            root.join("databases").join(format!("{database_id}.json")),
        ];
        let stamp = settings_stamp(&paths)?;
        Ok(Self { paths, stamp })
    }

    fn unchanged(&self) -> bool {
        settings_stamp(&self.paths).is_ok_and(|stamp| stamp == self.stamp)
    }

    pub fn with_current(&self, begin: impl FnOnce() -> bool) -> bool {
        let Ok(_guard) = sorng_encryption::settings_coordinator::try_lock_settings_write() else {
            return false;
        };
        self.unchanged() && begin()
    }
}

pub async fn recheck<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    owner: &AuthorizedPrewarm,
) -> Result<SavedSettingsFence, NativeAuthorityError> {
    let lease = &owner.lease;
    let root = lease.profile_root();
    let fence = SavedSettingsFence::capture(root, &owner.database_id)?;
    let settings =
        crate::app_settings_commands::read_app_settings_inner(lease.profile_root(), state)
            .await
            .map_err(|_| NativeAuthorityError::PolicyUnsupported)?
            .unwrap_or(Value::Null);
    if !saved_settings_allow(&settings) {
        return Err(NativeAuthorityError::PolicyUnsupported);
    }
    lease
        .recheck(window, state)
        .await
        .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
    if !fence.unchanged() {
        return Err(NativeAuthorityError::PolicyUnsupported);
    }
    Ok(fence)
}

pub async fn authorize<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request: &PrewarmRequest,
) -> Result<AuthorizedPrewarm, NativeAuthorityError> {
    request.validate()?;
    if window.label() != "main" {
        return Err(NativeAuthorityError::OwnerUnavailable);
    }
    let (connection, lease) = native_browser_owner::read(
        window,
        state,
        &request.owner_database_id,
        &request.connection_id,
        &request.expected_security_revision,
        &request.source_session_id,
    )
    .await
    .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
    if !matches!(
        connection.get("protocol").and_then(Value::as_str),
        Some("http" | "https")
    ) || connection
        .get("isGroup")
        .is_some_and(|value| value != &Value::Bool(false))
    {
        return Err(NativeAuthorityError::InvalidRequest);
    }
    // Drop the saved record without extracting any credentials or network policy.
    drop(connection);
    let owner = AuthorizedPrewarm {
        lease,
        database_id: request.owner_database_id.clone(),
    };
    recheck(window, state, &owner).await?;
    Ok(owner)
}

#[cfg(test)]
#[allow(dead_code)]
#[path = "origin_browser_runtime_flow.rs"]
mod startup_flow;

#[cfg(test)]
mod tests {
    use super::super::tests::{connection, Fixture};
    use super::*;
    use serde_json::json;

    fn request(f: &Fixture) -> PrewarmRequest {
        PrewarmRequest {
            owner_database_id: f.request.owner.owner_database_id.clone(),
            connection_id: f.request.owner.connection_id.clone(),
            expected_security_revision: f.request.expected_security_revision.clone(),
            source_session_id: f.request.source_session_id.clone(),
        }
    }

    async fn assert_current_when_idle(fence: &SavedSettingsFence) {
        // Independent fixtures still share the process-wide write coordinator.
        // A failed nonblocking acquisition is expected while another test saves;
        // it is not evidence that this fixture's unchanged artifacts are stale.
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                assert!(
                    fence.unchanged(),
                    "fixture changed while waiting for write coordinator"
                );
                if fence.with_current(|| true) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("unchanged fixture must become current when parallel writes finish");
    }

    #[test]
    fn defaults_allow_but_disabled_legacy_and_malformed_settings_deny() {
        for value in [
            Value::Null,
            json!({}),
            json!({"webBrowser":{}}),
            json!({"webBrowser":{"engine":"real-origin","idlePrewarmEnabled":true}}),
        ] {
            assert!(saved_settings_allow(&value));
        }
        for value in [
            json!([]),
            json!({"webBrowser":null}),
            json!({"webBrowser":[]}),
            json!({"webBrowser":{"idlePrewarmEnabled":false}}),
            json!({"webBrowser":{"idlePrewarmEnabled":"true"}}),
            json!({"webBrowser":{"engine":"legacy"}}),
            json!({"webBrowser":{"engine":null}}),
            json!({"webBrowser":{"version":2}}),
            json!({"webBrowser":{"version":"1"}}),
        ] {
            assert!(!saved_settings_allow(&value));
        }
    }

    #[test]
    fn one_attempt_coalesces_and_cancellation_latches_even_before_start() {
        let gate = PrewarmGate::default();
        assert!(gate.begin());
        assert!(!gate.begin());
        assert!(gate.current());
        gate.cancel();
        assert!(!gate.current());
        assert!(!gate.begin());
        let gate = PrewarmGate::default();
        gate.cancel();
        assert!(!gate.begin());
    }

    #[tokio::test]
    async fn authority_timeout_preserves_runtime_ready_before_or_during_recheck() {
        for ready_before in [false, true] {
            let admission = startup_flow::RuntimeAdmission::default();
            if ready_before {
                admission.observe_policy(true);
            }
            let outcome = tokio::time::timeout(std::time::Duration::from_millis(5), async {
                if !ready_before {
                    tokio::task::yield_now().await;
                    admission.observe_policy(true);
                }
                std::future::pending::<()>().await;
            })
            .await;
            assert!(outcome.is_err());
            // Even a caller that originally initialized CEF cannot revoke its
            // now-healthy runtime because a later owner/settings read timed out.
            assert!(!admission.timeout_owned_startup(true));
            assert!(admission.ready());
            assert!(!admission.revoked());
        }
    }

    #[test]
    fn only_owned_pending_initialization_is_revoked_by_timeout() {
        let admission = startup_flow::RuntimeAdmission::default();
        // A slow authorization or caller joining another startup owns no init.
        assert!(!admission.timeout_owned_startup(false));
        assert!(!admission.revoked());
        assert!(admission.timeout_owned_startup(true));
        admission.observe_policy(true);
        assert!(admission.revoked());
        assert!(!admission.ready());
    }

    #[tokio::test]
    async fn queued_saved_record_edit_deletion_and_index_change_cancel_before_initialize() {
        for change in ["protocol", "record-deleted", "database-deleted", "index"] {
            let mut f = Fixture::new(connection()).await;
            let owner = authorize(&f.window, &f.state, &request(&f)).await.unwrap();
            let fence = recheck(&f.window, &f.state, &owner).await.unwrap();
            assert_current_when_idle(&fence).await;
            let startup = startup_flow::StartupGate::default();
            let permit = startup.prepare().unwrap();
            {
                let _write = crate::database_files::lock_database_operation(
                    &f.root.path().join("databases"),
                )
                .await
                .unwrap();
                match change {
                    "protocol" => {
                        let mut row = connection();
                        row["protocol"] = json!("ssh");
                        f.replace_connection(row);
                    }
                    "record-deleted" => {
                        let mut row = connection();
                        row["id"] = json!("another-record");
                        f.replace_connection(row);
                    }
                    "database-deleted" => {
                        std::fs::remove_file(f.root.path().join("databases/db.json")).unwrap()
                    }
                    _ => sorng_storage::sdbf::safe_write(
                        &f.root.path().join("databases/index.json"),
                        b"[]",
                    )
                    .unwrap(),
                }
            }
            // Session validity alone deliberately does not inspect record content.
            assert!(owner.lease.is_current());
            // Do not let unrelated write contention make the rejection pass
            // without proving that the saved-artifact fence actually changed.
            assert!(!fence.unchanged());
            assert!(!fence.with_current(|| owner.lease.is_current() && permit.begin_native()));
            drop(permit);
            assert!(!startup.started());
            assert!(startup.prepare().unwrap().begin_native());
        }
    }

    #[tokio::test]
    async fn queued_cancel_settings_disable_and_owner_lock_leave_manual_startup_retryable() {
        for reason in ["cancel", "settings", "owner"] {
            let f = Fixture::new(connection()).await;
            let lease = authorize(&f.window, &f.state, &request(&f)).await.unwrap();
            let fence = recheck(&f.window, &f.state, &lease).await.unwrap();
            let gate = PrewarmGate::default();
            assert!(gate.begin());
            let startup = startup_flow::StartupGate::default();
            let permit = startup.prepare().unwrap();
            match reason {
                "cancel" => gate.cancel(),
                "settings" => std::fs::write(
                    f.root.path().join("settings.json"),
                    br#"{"webBrowser":{"idlePrewarmEnabled":false}}"#,
                )
                .unwrap(),
                _ => f.state.lock().await,
            }
            assert!(!fence.with_current(|| lease.lease.is_current()
                && gate.current()
                && permit.begin_native()));
            drop(permit);
            assert!(!startup.started());
            // A fresh manually authorized caller can still claim initialization.
            assert!(startup.prepare().unwrap().begin_native());
        }
    }

    #[tokio::test]
    async fn settings_write_in_flight_blocks_ui_without_waiting() {
        let root = tempfile::tempdir().unwrap();
        let fence = SavedSettingsFence::capture(root.path(), "db").unwrap();
        let guard = sorng_encryption::settings_coordinator::lock_settings_write().await;
        let mut initialized = false;
        assert!(!fence.with_current(|| {
            initialized = true;
            true
        }));
        assert!(!initialized);
        drop(guard);
        assert_current_when_idle(&fence).await;
    }

    #[test]
    fn global_toggle_does_not_invalidate_native_browser_preferences() {
        for enabled in [false, true] {
            let settings = json!({"webBrowser":{"version":1,"idlePrewarmEnabled":enabled}});
            assert!(
                super::super::NativeBrowserPreferences::from_saved(&connection(), &settings)
                    .is_ok()
            );
        }
    }

    #[tokio::test]
    async fn encrypted_settings_preserve_toggle_and_invalidate_queued_fence() {
        let f = Fixture::new(connection()).await;
        f.state
            .install(sorng_encryption::MasterDek::generate())
            .await;
        for enabled in [true, false] {
            let value = json!({"webBrowser":{"version":1,"idlePrewarmEnabled":enabled}});
            let bytes = sorng_encryption::artifacts::settings::write(
                &f.state,
                &value,
                sorng_encryption::envelope::MasterKeyStorage::Vault,
                sorng_encryption::password_wrap::Argon2Params::OWASP,
                [0; 16],
            )
            .await
            .unwrap();
            let before = SavedSettingsFence::capture(f.root.path(), "db").unwrap();
            std::fs::write(f.root.path().join("settings.enc"), bytes).unwrap();
            assert!(!before.with_current(|| true));
            let read =
                crate::app_settings_commands::read_app_settings_inner(f.root.path(), &f.state)
                    .await
                    .unwrap()
                    .unwrap();
            assert_eq!(read, value);
            assert_eq!(saved_settings_allow(&read), enabled);
        }
    }

    #[test]
    fn request_rejects_missing_oversized_proofs_and_extra_authority() {
        let valid = json!({"ownerDatabaseId":"db","connectionId":"saved",
            "expectedSecurityRevision":"revision","sourceSessionId":"session"});
        for key in [
            "ownerDatabaseId",
            "connectionId",
            "expectedSecurityRevision",
            "sourceSessionId",
        ] {
            for value in ["".to_owned(), "x".repeat(257), "bad\nproof".to_owned()] {
                let mut row = valid.clone();
                row[key] = value.into();
                assert!(serde_json::from_value::<PrewarmRequest>(row)
                    .unwrap()
                    .validate()
                    .is_err());
            }
        }
        for key in ["initialUrl", "sessionId", "policy", "credentials"] {
            let mut row = valid.clone();
            row[key] = json!("not-permitted");
            assert!(serde_json::from_value::<PrewarmRequest>(row).is_err());
        }
    }

    #[tokio::test]
    async fn rejects_wrong_owner_revision_token_connection_and_window() {
        let f = Fixture::new(connection()).await;
        for field in 0..4 {
            let mut input = request(&f);
            match field {
                0 => input.owner_database_id = "other".into(),
                1 => input.connection_id = "other".into(),
                2 => input.expected_security_revision = "other".into(),
                _ => input.source_session_id = "other".into(),
            }
            assert!(authorize(&f.window, &f.state, &input).await.is_err());
        }
        let other =
            tauri::WebviewWindowBuilder::new(&f._app, "other", tauri::WebviewUrl::default())
                .build()
                .unwrap();
        assert!(authorize(&other, &f.state, &request(&f)).await.is_err());
        assert!(authorize(&f.window, &f.state, &request(&f)).await.is_ok());
        f.state.lock().await;
        assert!(authorize(&f.window, &f.state, &request(&f)).await.is_err());
    }

    #[tokio::test]
    async fn engine_authority_does_not_resolve_credentials_routes_or_modify_database() {
        let mut row = connection();
        row["credentialId"] = json!("missing-vault-credential");
        row["proxyProfileId"] = json!("missing-route");
        let f = Fixture::new(row).await;
        let before = std::fs::read(f.root.path().join("databases/db.json")).unwrap();
        let lease = authorize(&f.window, &f.state, &request(&f)).await.unwrap();
        assert!(lease.lease.is_current());
        assert_eq!(
            before,
            std::fs::read(f.root.path().join("databases/db.json")).unwrap()
        );
        std::fs::write(
            f.root.path().join("settings.json"),
            br#"{"webBrowser":{"idlePrewarmEnabled":false}}"#,
        )
        .unwrap();
        assert!(recheck(&f.window, &f.state, &lease).await.is_err());
        assert!(authorize(&f.window, &f.state, &request(&f)).await.is_err());
        // Prewarm denial does not revoke the user's native unlock session.
        assert!(lease.lease.is_current());
    }

    #[tokio::test]
    async fn rejects_non_web_connections_and_groups() {
        for patch in [json!({"protocol":"ssh"}), json!({"isGroup":true})] {
            let mut row = connection();
            row.as_object_mut()
                .unwrap()
                .extend(patch.as_object().unwrap().clone());
            let f = Fixture::new(row).await;
            assert!(authorize(&f.window, &f.state, &request(&f)).await.is_err());
        }
    }
}
