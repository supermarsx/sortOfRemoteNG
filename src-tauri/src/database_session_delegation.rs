//! Transfer only a derived, target-bound database grant between local app
//! shells. No plaintext, key, source token, or website authority is emitted.
use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedSession {
    session_id: String,
    security_revision: String,
    // Same explicit-null open lifetime as unlock/load. Source revocation is
    // authoritative and inherited through the registry's validity chain.
    session_expires_at: Option<u64>,
}

fn detached_label(label: &str) -> bool {
    label.strip_prefix("detached-").is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

fn trusted_app_location(label: &str, url: &url::Url, dev_url: Option<&url::Url>) -> bool {
    // Match the local-only main/detached capability in capabilities/default.json
    // and the actual shell routes. A matching label on a remote URL is not an
    // application window, nor is a local arbitrary auxiliary page.
    let route = if label == "main" {
        matches!(url.path(), "/" | "/index.html")
    } else if detached_label(label) {
        matches!(
            url.path(),
            "/detached" | "/detached/" | "/detached/index.html" | "/detached.html"
        )
    } else {
        false
    };
    let embedded = matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    );
    let development = dev_url.is_some_and(|dev| {
        matches!(dev.scheme(), "http" | "https") && url.origin() == dev.origin()
    });
    route && url.username().is_empty() && url.password().is_none() && (embedded || development)
}

fn require_app_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window
        .app_handle()
        .get_webview_window(window.label())
        .is_none()
    {
        return Err("database delegation window closed".into());
    }
    let url = window
        .url()
        .map_err(|_| "database delegation window unavailable")?;
    let dev_url = if tauri::is_dev() {
        window.app_handle().config().build.dev_url.as_ref()
    } else {
        None
    };
    if !trusted_app_location(window.label(), &url, dev_url) {
        return Err("database delegation requires a trusted local app window".into());
    }
    Ok(())
}

fn require_target<R: Runtime>(
    source: &WebviewWindow<R>,
    target: &str,
) -> Result<WebviewWindow<R>, String> {
    if !detached_label(target) || source.label() == target {
        return Err("database delegation requires a different detached app window".into());
    }
    let window = source
        .app_handle()
        .get_webview_window(target)
        .ok_or("database delegation target window does not exist")?;
    require_app_window(&window)?;
    Ok(window)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainDatabaseLoad {
    security_revision: String,
    data: Value,
}

/// A detached shell may read an unprotected local database, but neither a
/// sender's row snapshot nor a claimed `plain` kind can unlock an encrypted one.
#[tauri::command]
pub async fn database_protection_load_plain<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    expected_security_revision: String,
) -> Result<PlainDatabaseLoad, String> {
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    require_app_window(&window)?;
    if !detached_label(window.label()) {
        return Err("plain database handoff requires a detached app window".into());
    }
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if is_managed(&snapshot)
        || snapshot.row.get("isEncrypted").and_then(Value::as_bool) != Some(false)
        || revision(&snapshot) != expected_security_revision
        || !snapshot.data.is_object()
        || !snapshot
            .data
            .get("connections")
            .is_some_and(Value::is_array)
    {
        return Err(
            "Database is protected or changed; unlock its owning database before retrying".into(),
        );
    }
    require_app_window(&window)?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    state.resolve_write_policy(sorng_encryption::ArtifactKind::Connections, false)?;
    Ok(PlainDatabaseLoad {
        security_revision: expected_security_revision,
        data: snapshot.data,
    })
}

#[tauri::command]
pub async fn database_protection_delegate_session<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
    target_window: String,
    handoff_id: String,
) -> Result<DelegatedSession, String> {
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    codec::validate_identifier(&session_id)?;
    codec::validate_identifier(&expected_security_revision)?;
    codec::validate_identifier(&handoff_id)?;
    require_app_window(&window)?;
    require_target(&window, &target_window)?;

    // Capture before the await and reacquire/validate the native window after
    // capture. Destruction between either check and issuance removes the epoch;
    // a new window using the same label cannot accept this abandoned request.
    let epoch = window_epoch(&state, &target_window)?;
    require_target(&window, &target_window)?;
    let root = native_root(&window, &state)?;
    let _guard = lock_database_operation(&root.join("databases")).await?;
    if native_root(&window, &state)? != root {
        return Err("Database profile changed; reload before retrying".into());
    }
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision || !is_managed(&snapshot) {
        return Err("database security changed; unlock again".into());
    }
    let profile = profile_binding(&root)?;
    require_app_window(&window)?;
    require_target(&window, &target_window)?;

    // Never call native-window APIs or await while holding this mutex: window
    // destruction revokes through the same registry from the native event loop.
    let session_id = database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .delegate_for_window(
            &session_id,
            &scope(
                &profile,
                &database_id,
                &expected_security_revision,
                window.label(),
                &state,
            ),
            &target_window,
            epoch,
            &handoff_id,
        )?;
    Ok(DelegatedSession {
        session_id,
        security_revision: expected_security_revision,
        session_expires_at: None,
    })
}

#[cfg(test)]
#[path = "database_session_delegation_tests.rs"]
mod tests;
