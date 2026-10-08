//! Non-blocking certificate review in the trusted app shell, not an OS modal
//! message loop and never inside the remote website's renderer.
use super::Attempt;
use crate::origin_browser_certificate_prompt::{Decision, Prompt, Registry, Request, Snapshot};
use rand::RngCore;
use sorng_browser_host::ipc::OriginBrowserIdentity;
use sorng_commands_core::origin_browser_authority::{
    NativeCertificatePermit, NativeCertificateReview,
};
use sorng_encryption::EncryptionState;
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, EventTarget, WebviewWindow};

const EVENT: &str = "origin-browser-certificate-review";
const TIMEOUT: Duration = Duration::from_secs(90);
fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

pub(crate) fn operate(window: &WebviewWindow, request: Request) -> Result<Snapshot, String> {
    let snapshot = {
        let mut registry = registry()
            .lock()
            .map_err(|_| "Certificate review unavailable")?;
        match request {
            Request::Pending {} => registry.snapshot(window.label(), Instant::now()),
            Request::Respond {
                request_id,
                identity,
                decision,
            } => registry.respond(
                window.label(),
                &request_id,
                &identity,
                decision,
                Instant::now(),
            )?,
        }
    };
    // IPC is available only to the owning app WebView. A remote CEF page cannot
    // obtain this registry or manufacture native certificate evidence.
    let _ = notify(window, &snapshot);
    Ok(snapshot)
}

fn notify(window: &WebviewWindow, snapshot: &Snapshot) -> tauri::Result<()> {
    // WebviewWindow::emit broadcasts app-wide. Target both the native event and
    // the shell listener so detached windows never display another owner's review.
    window.emit_to(EventTarget::webview_window(window.label()), EVENT, snapshot)
}

struct PromptGuard {
    window: WebviewWindow,
    request_id: String,
}
impl Drop for PromptGuard {
    fn drop(&mut self) {
        let snapshot = registry().lock().unwrap_or_else(|e| e.into_inner()).remove(
            self.window.label(),
            &self.request_id,
            Instant::now(),
        );
        let _ = notify(&self.window, &snapshot);
    }
}

pub(super) async fn review_certificate(
    window: &WebviewWindow,
    state: &EncryptionState,
    attempt: &Arc<Attempt>,
    review: NativeCertificateReview,
) -> Option<NativeCertificatePermit> {
    if !attempt.current() {
        return None;
    }
    let now = Instant::now();
    let mut random = [0u8; 16];
    rand::rngs::OsRng.try_fill_bytes(&mut random).ok()?;
    let request_id = hex::encode(random);
    let expires_at_unix_ms = (SystemTime::now() + TIMEOUT)
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()?;
    let prompt = Prompt {
        request_id: request_id.clone(),
        identity: OriginBrowserIdentity::from_native(&attempt.identity),
        origin: review.origin().into(),
        fingerprint: review.fingerprint().into(),
        reason: review.reason().into(),
        temporary: review.is_temporary(),
        expires_at_unix_ms,
    };
    let weak = Arc::downgrade(attempt);
    let current = Arc::new(move || weak.upgrade().is_some_and(|attempt| attempt.current()));
    let (snapshot, mut receiver) =
        registry()
            .lock()
            .ok()?
            .begin(window.label(), prompt, now + TIMEOUT, current, now)?;
    let guard = PromptGuard {
        window: window.clone(),
        request_id,
    };
    notify(window, &snapshot).ok()?;
    // Pending reviews alone are observed. This never reads/decrypts databases
    // or runs CEF from a worker; immediate lease revocation remains authoritative.
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    let decision = loop {
        tokio::select! {
            response=&mut receiver => break response.ok(),
            _=tick.tick() => if !attempt.current() || now.elapsed()>=TIMEOUT { break None; },
        }
    };
    drop(guard);
    let remember = match decision {
        Some(Decision::AllowOnce) => false,
        Some(Decision::Remember) => true,
        _ => return None,
    };
    if !attempt.current() {
        return None;
    }
    // The native single-use review owns the exact handshake certificate and
    // rechecks the database plus trust-store baseline before writing or allowing.
    review.approve(window, state, remember).await.ok()
}
