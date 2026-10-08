//! App-runtime adapter for CEF downloads. This file belongs beside the native
//! runtime (not commands-core): native dialogs are an app dependency, while
//! NativeOwnerLease remains factored through commands-core.
use sorng_browser_host::native_downloads::{
    DownloadError, DownloadPool, DownloadSaveCompletion, DownloadSaveRequest, DownloadSnapshot,
    NativeDownloadDelegate, SaveDestination, ORIGIN_BROWSER_DOWNLOAD_EVENT,
};
use sorng_commands_core::origin_browser_authority::NativeOwnerLease;
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Instant,
};
use tauri::{Emitter, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[path = "origin_browser_download_reveal.rs"]
mod reveal;

struct DialogSlot(String);
fn slots() -> &'static Mutex<HashSet<String>> {
    static SLOTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SLOTS.get_or_init(Mutex::default)
}
impl DialogSlot {
    fn reserve(window: &WebviewWindow) -> Option<Self> {
        slots()
            .lock()
            .ok()?
            .insert(window.label().to_owned())
            .then(|| Self(window.label().to_owned()))
    }
}
impl Drop for DialogSlot {
    fn drop(&mut self) {
        slots()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.0);
    }
}

pub(super) struct DownloadOwner {
    window: WebviewWindow,
    identity: BrowserIdentity,
    lease: NativeOwnerLease,
    enabled: bool,
    pool: Arc<DownloadPool>,
    revoked: Arc<AtomicBool>,
}
impl DownloadOwner {
    /// `enabled` MUST come from native-resolved effective settings, never an
    /// IPC flag. Call only after validating this window/lease/attempt together.
    pub(super) fn new(
        window: WebviewWindow,
        identity: BrowserIdentity,
        lease: NativeOwnerLease,
        enabled: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            window,
            pool: Arc::new(DownloadPool::new(identity.clone())),
            identity,
            lease,
            enabled,
            revoked: Arc::new(AtomicBool::new(false)),
        })
    }
    pub(super) fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }
}
impl NativeDownloadDelegate for DownloadOwner {
    fn pool(&self) -> Arc<DownloadPool> {
        self.pool.clone()
    }
    fn downloads_enabled(&self) -> bool {
        self.enabled
    }
    fn is_current(&self, identity: &BrowserIdentity) -> bool {
        *identity == self.identity
            && !self.revoked.load(Ordering::Acquire)
            && self.lease.is_current()
    }
    fn choose_destination(&self, request: DownloadSaveRequest, completion: DownloadSaveCompletion) {
        if !self.enabled
            || !self.is_current(&request.identity)
            || Instant::now() >= request.expires_at
        {
            return;
        }
        let Some(slot) = DialogSlot::reserve(&self.window) else {
            return;
        };
        let window = self.window.clone();
        let lease = self.lease.clone();
        let revoked = self.revoked.clone();
        let _ = self.window.run_on_main_thread(move || {
            if revoked.load(Ordering::Acquire)
                || !lease.is_current()
                || Instant::now() >= request.expires_at
            {
                return;
            }
            window
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("Save website download")
                .set_file_name(request.suggested_name)
                .save_file(move |selected| {
                    let _slot = slot;
                    if revoked.load(Ordering::Acquire)
                        || !lease.is_current()
                        || Instant::now() >= request.expires_at
                    {
                        return;
                    }
                    // Only a platform-native user selection can authorize a
                    // destination. Cancel/invalid path drops the decision.
                    let destination = selected
                        .and_then(|selected| selected.into_path().ok())
                        .and_then(SaveDestination::from_dialog);
                    completion.complete(destination);
                });
        });
    }
    fn supports_reveal(&self) -> bool {
        reveal::supported()
    }
    fn reveal(
        &self,
        identity: &BrowserIdentity,
        path: &std::path::Path,
    ) -> Result<(), DownloadError> {
        if !self.enabled || !self.is_current(identity) {
            return Err(DownloadError::OwnerUnavailable);
        }
        // The host resolves this path from the completed row. There is no
        // path-bearing renderer command and the downloaded file is never run.
        reveal::reveal(path).map_err(|_| DownloadError::ActionUnavailable)
    }
    fn changed(&self, snapshot: DownloadSnapshot) {
        if self.is_current(&self.identity)
            && snapshot.identity.validate_matches(&self.identity).is_ok()
        {
            // Emission is confined to the owning shell, never global. Metadata
            // is bounded by the host and has no URL, headers or selected path.
            if self
                .window
                .emit(ORIGIN_BROWSER_DOWNLOAD_EVENT, snapshot)
                .is_err()
            {
                self.revoke();
            }
        }
    }
}
