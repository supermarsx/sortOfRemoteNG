//! Ephemeral native request ownership and ProxyCommand review. No renderer
//! supplies command text, routes, credentials or a trusted execution grant.
use super::{NativeAuthorityError, NativeOwnerLease};
use crate::ssh::proxy_command::{self, ProxyCommandReviewPermit, ReviewedProxyCommand};
use sorng_browser_host::ipc::{OriginBrowserCreateRequest, OriginBrowserOwner};
use sorng_encryption::EncryptionState;
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, LazyLock, Mutex, Weak},
    time::Duration,
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};
use tokio::sync::oneshot;

const LIMIT: usize = 32;
const REVIEW_TIME: Duration = Duration::from_secs(90);
const ERROR: &str = "The SSH command review is no longer available.";
type Key = (u64, String, String);
struct Entry {
    key: Key,
    owner: OriginBrowserOwner,
    request_id: String,
    permit: ProxyCommandReviewPermit,
}
#[derive(Clone)]
pub(super) struct CurrentRequest(Arc<Entry>);
/// The app dispatcher retains this guard for the exact native create future.
/// Dropping it cancels reviews and invalidates unconsumed execution approval.
pub struct RequestScope(CurrentRequest);
static REQUESTS: LazyLock<Mutex<HashMap<Key, Weak<Entry>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
struct Pending {
    claim: CurrentRequest,
    lease: NativeOwnerLease,
    reply: oneshot::Sender<bool>,
}
static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
fn unavailable(stage: &'static str) -> NativeAuthorityError {
    NativeAuthorityError::SshRouteUnavailable { stage }
}
fn begin(
    owner_id: u64,
    window: &str,
    owner: &OriginBrowserOwner,
    request_id: &str,
) -> Result<RequestScope, String> {
    owner.validate().map_err(|_| ERROR)?;
    if request_id.is_empty()
        || request_id.len() > 256
        || request_id
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(ERROR.into());
    }
    let key = (owner_id, window.to_owned(), owner.session_id.clone());
    let mut requests = REQUESTS.lock().map_err(|_| ERROR)?;
    requests.retain(|_, value| value.strong_count() > 0);
    if !requests.contains_key(&key) && requests.len() >= LIMIT {
        return Err(ERROR.into());
    }
    if let Some(previous) = requests.get(&key).and_then(Weak::upgrade) {
        previous.permit.cancel();
    }
    let entry = Arc::new(Entry {
        key: key.clone(),
        owner: owner.clone(),
        request_id: request_id.into(),
        permit: ProxyCommandReviewPermit::pending_request(),
    });
    requests.insert(key, Arc::downgrade(&entry));
    Ok(RequestScope(CurrentRequest(entry)))
}
pub fn begin_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &OriginBrowserCreateRequest,
) -> Result<RequestScope, String> {
    let state = window.try_state::<EncryptionState>().ok_or(ERROR)?;
    begin(
        state.database_session_owner(),
        window.label(),
        &request.owner,
        &request.request_id,
    )
}
impl Drop for RequestScope {
    fn drop(&mut self) {
        self.0 .0.permit.cancel();
        if let Ok(mut requests) = REQUESTS.lock() {
            if requests
                .get(&self.0 .0.key)
                .and_then(Weak::upgrade)
                .is_some_and(|entry| Arc::ptr_eq(&entry, &self.0 .0))
            {
                requests.remove(&self.0 .0.key);
            }
        }
    }
}
pub(super) fn current<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    owner: &OriginBrowserOwner,
    request_id: &str,
) -> Option<CurrentRequest> {
    let key = (
        state.database_session_owner(),
        window.label().to_owned(),
        owner.session_id.clone(),
    );
    let entry = REQUESTS.lock().ok()?.get(&key)?.upgrade()?;
    (entry.request_id == request_id && entry.owner == *owner).then_some(CurrentRequest(entry))
}
impl CurrentRequest {
    fn ended(&self) -> NativeAuthorityError {
        unavailable(if self.0.permit.is_expired() {
            "command-review-timeout"
        } else {
            "command-review-cancelled"
        })
    }
    pub(super) fn is_current(&self) -> bool {
        self.0.permit.is_current()
    }
    pub(super) async fn run<T>(
        &self,
        work: impl Future<Output = Result<T, NativeAuthorityError>>,
    ) -> Result<T, NativeAuthorityError> {
        tokio::select! {
            biased;
            () = self.0.permit.cancelled() => Err(self.ended()),
            result = work => {
                let value = result?;
                if self.is_current() {
                    Ok(value)
                } else {
                    Err(self.ended())
                }
            }
        }
    }
}
/// Called only by the app-shell guarded command, including cancellation before
/// any review has appeared. Exact dispatcher registration precedes this RPC.
pub fn cancel<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request_id: &str,
) -> Result<(), String> {
    cancel_for(state.database_session_owner(), window.label(), request_id)
}
fn cancel_for(owner: u64, window: &str, request_id: &str) -> Result<(), String> {
    let requests = REQUESTS.lock().map_err(|_| ERROR)?;
    for entry in requests.values().filter_map(Weak::upgrade) {
        if entry.key.0 == owner && entry.key.1 == window && entry.request_id == request_id {
            entry.permit.cancel();
        }
    }
    Ok(())
}
struct PendingGuard<R: Runtime> {
    nonce: String,
    window: WebviewWindow<R>,
    request_id: String,
    session_id: String,
}
impl<R: Runtime> Drop for PendingGuard<R> {
    fn drop(&mut self) {
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&self.nonce);
        }
        // Native expiry/replacement closes the exact ephemeral UI prompt; no
        // frontend polling or stale visible confirmation is needed.
        let _ = self.window.emit(
            "ssh://native-browser-command-review",
            serde_json::json!({
                "nonce":self.nonce,"createRequestId":self.request_id,
                "hostKeyPromptId":format!("native-browser:{}",self.session_id),"closed":true,
            }),
        );
    }
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Prompt<'a> {
    nonce: &'a str,
    create_request_id: &'a str,
    host_key_prompt_id: String,
    command_preview: &'a str,
}
pub(super) async fn review<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    lease: &NativeOwnerLease,
    claim: &CurrentRequest,
    config: &crate::ssh::SshConnectionConfig,
) -> Result<ReviewedProxyCommand, NativeAuthorityError> {
    lease
        .recheck(window, state)
        .await
        .map_err(|_| unavailable("owner"))?;
    if !claim.is_current() {
        return Err(claim.ended());
    }
    let config_command = config
        .proxy_command
        .as_ref()
        .ok_or_else(|| unavailable("command-review-unavailable"))?;
    let expanded = proxy_command::build_command_string(
        config_command,
        &config.host,
        config.port,
        &config.username,
    )
    .map_err(|_| unavailable("command-review-unavailable"))?;
    let preview = proxy_command::redact_proxy_credentials(&expanded);
    if preview.is_empty() || preview.len() > 16384 || preview.contains('\0') {
        return Err(unavailable("command-review-unavailable"));
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    claim
        .0
        .permit
        .start_review(REVIEW_TIME)
        .map_err(|_| claim.ended())?;
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = PENDING
            .lock()
            .map_err(|_| unavailable("command-review-unavailable"))?;
        pending.retain(|_, entry| entry.claim.is_current() && entry.lease.is_current());
        if pending.len() >= LIMIT {
            return Err(unavailable("command-review-unavailable"));
        }
        pending.insert(
            nonce.clone(),
            Pending {
                claim: claim.clone(),
                lease: lease.clone(),
                reply: sender,
            },
        );
    }
    let _pending = PendingGuard {
        nonce: nonce.clone(),
        window: window.clone(),
        request_id: claim.0.request_id.clone(),
        session_id: claim.0.owner.session_id.clone(),
    };
    window
        .emit(
            "ssh://native-browser-command-review",
            Prompt {
                nonce: &nonce,
                create_request_id: &claim.0.request_id,
                host_key_prompt_id: format!("native-browser:{}", claim.0.owner.session_id),
                command_preview: &preview,
            },
        )
        .map_err(|_| unavailable("command-review-unavailable"))?;
    let accepted = claim.run(async {
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        tokio::pin!(receiver);
        let deadline = tokio::time::sleep(REVIEW_TIME);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                _ = tick.tick() => {
                    if !lease.is_current() {
                        return Err(unavailable("owner"));
                    }
                },
                _ = &mut deadline => return Err(unavailable("command-review-timeout")),
                result = &mut receiver => return result.map_err(|_| unavailable("command-review-cancelled")),
            }
        }
    }).await?;
    if !accepted {
        return Err(unavailable("command-review-cancelled"));
    }
    lease
        .recheck(window, state)
        .await
        .map_err(|_| unavailable("owner"))?;
    claim.0.permit.approve(&expanded).map_err(|_| claim.ended())
}
/// Called only by the app-shell guarded reply wrapper. The nonce selects native
/// metadata; renderer fields never select an SSH source or command.
pub async fn respond<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    nonce: &str,
    accepted: bool,
) -> Result<(), String> {
    let entry = {
        let mut pending = PENDING.lock().map_err(|_| ERROR)?;
        let entry = pending.get(nonce).ok_or(ERROR)?;
        if entry.claim.0.key.0 != state.database_session_owner()
            || entry.claim.0.key.1 != window.label()
        {
            return Err(ERROR.into());
        }
        pending.remove(nonce).ok_or(ERROR)?
    };
    if !entry.claim.is_current() {
        return Err(ERROR.into());
    }
    entry
        .lease
        .recheck(window, state)
        .await
        .map_err(|_| ERROR)?;
    if !entry.claim.is_current() {
        return Err(ERROR.into());
    }
    entry.reply.send(accepted).map_err(|_| ERROR.into())
}
#[cfg(test)]
pub(super) fn begin_test<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    request: &OriginBrowserCreateRequest,
) -> Option<RequestScope> {
    if current(window, state, &request.owner, &request.request_id).is_some() {
        None
    } else {
        Some(
            begin(
                state.database_session_owner(),
                window.label(),
                &request.owner,
                &request.request_id,
            )
            .expect("valid test request"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1000000000);
    fn owner() -> OriginBrowserOwner {
        OriginBrowserOwner {
            owner_database_id: "fixture-db".into(),
            connection_id: "fixture-connection".into(),
            session_id: "fixture-session".into(),
        }
    }
    #[test]
    fn replacement_and_drop_cannot_reactivate_an_old_request_approval() {
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let owner = owner();
        let old = begin(id, "main", &owner, "first").unwrap();
        old.0 .0.permit.start_review(REVIEW_TIME).unwrap();
        let _approved = old.0 .0.permit.approve("same-fixture-command").unwrap();
        let new = begin(id, "main", &owner, "second").unwrap();
        assert!(!old.0.is_current());
        assert!(new.0.is_current());
        assert!(old.0 .0.permit.approve("same-fixture-command").is_err());
        drop(old);
        assert!(new.0.is_current());
    }
    #[test]
    fn cancellation_is_exact_to_app_window_and_create_request_even_before_a_prompt() {
        let id = NEXT.fetch_add(2, Ordering::SeqCst);
        let owner = owner();
        let first = begin(id, "main", &owner, "same-request").unwrap();
        let other_window = begin(id, "detached-other", &owner, "same-request").unwrap();
        let other_app = begin(id + 1, "main", &owner, "same-request").unwrap();
        cancel_for(id, "main", "foreign-request").unwrap();
        assert!(first.0.is_current());
        cancel_for(id, "main", "same-request").unwrap();
        assert!(!first.0.is_current());
        assert!(other_window.0.is_current());
        assert!(other_app.0.is_current());
    }
    struct Dropped(Arc<AtomicUsize>);
    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    #[tokio::test]
    async fn request_lifetime_is_not_a_review_deadline_until_prompt_is_armed() {
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let scope = begin(id, "main", &owner(), "expiry").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), scope.0 .0.permit.cancelled())
                .await
                .is_err()
        );
        assert!(scope.0.is_current());
        scope
            .0
             .0
            .permit
            .start_review(Duration::from_millis(20))
            .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            scope
                .0
                .run(std::future::pending::<Result<(), NativeAuthorityError>>()),
        )
        .await
        .unwrap();
        assert!(matches!(
            result,
            Err(NativeAuthorityError::SshRouteUnavailable {
                stage: "command-review-timeout"
            })
        ));
    }
    #[tokio::test]
    async fn request_cancellation_drops_pending_work_without_waiting_for_a_renderer_reply() {
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let scope = begin(id, "main", &owner(), "pending").unwrap();
        let drops = Arc::new(AtomicUsize::new(0));
        let probe = Dropped(drops.clone());
        let work = scope.0.run(async move {
            let _probe = probe;
            std::future::pending::<Result<(), NativeAuthorityError>>().await
        });
        tokio::pin!(work);
        assert!(tokio::time::timeout(Duration::from_millis(10), &mut work)
            .await
            .is_err());
        cancel_for(id, "main", "pending").unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(1), work)
            .await
            .unwrap()
            .is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn foreign_window_reply_does_not_consume_an_owners_prompt_and_revocation_denies_late_approval(
    ) {
        use crate::origin_browser_authority::tests::{connection, Fixture};
        let f = Fixture::new(connection()).await;
        let authorized = f.authorize().await.unwrap();
        let scope = begin(
            f.state.database_session_owner(),
            f.window.label(),
            &f.request.owner,
            &f.request.request_id,
        )
        .unwrap();
        let nonce = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(
            nonce.clone(),
            Pending {
                claim: scope.0.clone(),
                lease: authorized.lease.clone(),
                reply: tx,
            },
        );
        let foreign = tauri::WebviewWindowBuilder::new(
            &f._app,
            "detached-review-foreign",
            tauri::WebviewUrl::default(),
        )
        .build()
        .unwrap();
        assert!(respond(&foreign, &f.state, &nonce, true).await.is_err());
        assert!(PENDING.lock().unwrap().contains_key(&nonce));
        respond(&f.window, &f.state, &nonce, true).await.unwrap();
        assert!(rx.await.unwrap());
        let nonce = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(
            nonce.clone(),
            Pending {
                claim: scope.0.clone(),
                lease: authorized.lease.clone(),
                reply: tx,
            },
        );
        authorized.lease.revoke();
        assert!(respond(&f.window, &f.state, &nonce, true).await.is_err());
        assert!(rx.await.is_err());
    }
}
