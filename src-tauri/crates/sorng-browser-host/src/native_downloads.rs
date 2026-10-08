//! Native download ownership and state. The existing CEF download is the only
//! transport: this module never fetches a URL or accepts a renderer save path.
//! Callback objects remain on the CEF UI thread; only a dialog decision crosses
//! threads. No URL, headers, destination path or credentials enter events/logs.

use crate::ipc::{
    OriginBrowserIdentity, OriginBrowserIpcError, ValidateOriginBrowserRequest, MAX_JS_INTEGER,
};
use serde::{Deserialize, Serialize};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    collections::BTreeMap,
    marker::PhantomData,
    path::{Component, PathBuf},
    rc::Rc,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const ORIGIN_BROWSER_DOWNLOAD_EVENT: &str = "origin-browser-download";
pub const MAX_DOWNLOADS: usize = 128;
pub const MAX_ACTIVE_DOWNLOADS: usize = 8;
pub const SAVE_TIMEOUT: Duration = Duration::from_secs(120);
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// URL used only for the existing native destination-policy check, never for a
/// new request. The CEF adapter must separately establish exact browser/owner
/// identity. Blob exports require an HTTP(S) creator origin matching that
/// browser's actual current main document; opaque/cross-origin blobs fail shut.
pub fn download_policy_url(target: &str, current_document: Option<&str>) -> Option<String> {
    if target.is_empty() || target.len() > 16_384 || target.chars().any(char::is_control) {
        return None;
    }
    let target_url = url::Url::parse(target).ok()?;
    let http_origin = |url: &url::Url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    };
    if http_origin(&target_url) {
        return Some(target.to_owned());
    }
    if target_url.scheme() != "blob" {
        return None;
    }
    let creator = url::Url::parse(target_url.path()).ok()?;
    let document = current_document
        .filter(|value| value.len() <= 16_384 && !value.chars().any(char::is_control))?;
    let document = url::Url::parse(document).ok()?;
    if !http_origin(&creator)
        || !http_origin(&document)
        || creator.path() == "/"
        || creator.origin() != document.origin()
    {
        return None;
    }
    Some(format!("{}/", creator.origin().ascii_serialization()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadAction {
    Cancel,
    Pause,
    Resume,
    Reveal,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadListRequest {
    pub identity: OriginBrowserIdentity,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadControlRequest {
    pub identity: OriginBrowserIdentity,
    pub download_id: u32,
    pub action: DownloadAction,
}

impl ValidateOriginBrowserRequest for DownloadListRequest {
    fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()
    }
}
impl ValidateOriginBrowserRequest for DownloadControlRequest {
    fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()?;
        if self.download_id == 0 {
            return Err(OriginBrowserIpcError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadStatus {
    AwaitingDestination,
    InProgress,
    Paused,
    Completed,
    Cancelled,
    Interrupted,
}

impl DownloadStatus {
    pub fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Interrupted)
    }
}

/// Owner-window display only. Deliberately no Debug implementation.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub identity: OriginBrowserIdentity,
    /// App-local ID, not CEF's global download ID. Always pair with identity.
    pub download_id: u32,
    pub sequence: u64,
    pub file_name: String,
    pub status: DownloadStatus,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: u64,
    pub can_pause: bool,
    pub can_resume: bool,
    pub can_cancel: bool,
    pub can_reveal: bool,
}

/// Copied scalars only; a CEF DownloadItem must never be retained.
#[derive(Clone, Copy, Default)]
pub struct DownloadProgress {
    pub in_progress: bool,
    pub complete: bool,
    pub cancelled: bool,
    pub interrupted: bool,
    pub paused: bool,
    pub received: i64,
    pub total: i64,
    pub speed: i64,
}

/// Implemented by a UI-thread CEF callback wrapper. Drop without continuation
/// cancels the pending CEF download, including dialog cancellation/timeout.
pub trait BeforeDownload: 'static {
    fn save(self: Box<Self>, destination: SaveDestination);
}
pub trait DownloadControl: 'static {
    fn cancel(&self);
    fn pause(&self);
    fn resume(&self);
}

pub struct DownloadSaveRequest {
    pub identity: BrowserIdentity,
    pub download_id: u32,
    pub suggested_name: String,
    pub expires_at: Instant,
}

pub trait NativeDownloadDelegate: Send + Sync {
    /// The SAME pool must be returned for the root and every popup belonging
    /// to this native attempt. It allocates IDs/quotas, never callback ownership.
    fn pool(&self) -> Arc<DownloadPool>;
    /// Owner liveness is independent of the saved download opt-in. A disabled
    /// but current owner may still list its (empty) downloads without an error.
    fn is_current(&self, identity: &BrowserIdentity) -> bool;
    fn downloads_enabled(&self) -> bool;
    fn choose_destination(&self, request: DownloadSaveRequest, completion: DownloadSaveCompletion);
    /// Native-only path, resolved from this owner's completed row. No renderer
    /// command or event may carry it. Must reveal, never execute/open the file.
    fn reveal(
        &self,
        _identity: &BrowserIdentity,
        _path: &std::path::Path,
    ) -> Result<(), DownloadError> {
        Err(DownloadError::ActionUnavailable)
    }
    fn supports_reveal(&self) -> bool {
        false
    }
    fn changed(&self, snapshot: DownloadSnapshot);
}

/// Construct only from a native save dialog result, never from IPC. Not
/// serializable or Debug. CEF owns creation/overwrite after dialog confirmation.
pub struct SaveDestination(PathBuf);
impl SaveDestination {
    pub fn from_dialog(path: PathBuf) -> Option<Self> {
        let text = path.to_str()?;
        if !path.is_absolute()
            || text.len() > 32_768
            || text.chars().any(char::is_control)
            || path.file_name().is_none()
            || path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        {
            return None;
        }
        #[cfg(windows)]
        if path.components().any(|c| matches!(c, Component::Prefix(p) if matches!(p.kind(), std::path::Prefix::DeviceNS(_) | std::path::Prefix::Verbatim(_)))) { return None; }
        let parent = path.parent()?;
        if !parent.is_dir() {
            return None;
        }
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return None
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return None,
            _ => {}
        }
        Some(Self(path))
    }
    /// For the CEF callback only. Never put this value into events or logs.
    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

enum Selection {
    Pending,
    Denied,
    Selected(SaveDestination),
    Consumed,
}
pub struct DownloadSaveCompletion {
    selection: Arc<Mutex<Selection>>,
}
impl DownloadSaveCompletion {
    pub fn complete(self, path: Option<SaveDestination>) {
        if let Ok(mut selection) = self.selection.lock() {
            if matches!(*selection, Selection::Pending) {
                *selection = path.map(Selection::Selected).unwrap_or(Selection::Denied);
            }
        }
    }
}
impl Drop for DownloadSaveCompletion {
    fn drop(&mut self) {
        if let Ok(mut selection) = self.selection.lock() {
            if matches!(*selection, Selection::Pending) {
                *selection = Selection::Denied;
            }
        }
    }
}

/// Sanitized basename only; remove path traversal, control/bidi characters,
/// shell/file-dialog syntax, and Windows reserved device names on all platforms.
pub fn suggested_file_name(input: &str) -> String {
    if input.len() > 4096 {
        return "download".into();
    }
    let leaf = input.rsplit(['/', '\\']).next().unwrap_or_default();
    let name: String = leaf
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .take(120)
        .collect();
    let name = name.trim_matches([' ', '.']);
    if name.is_empty() {
        return "download".into();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("_{name}")
    } else {
        name.into()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DownloadError {
    #[error("Download owner is unavailable")]
    OwnerUnavailable,
    #[error("Download is unavailable")]
    Unavailable,
    #[error("Download limit reached")]
    Limit,
    #[error("Download action is unavailable")]
    ActionUnavailable,
}

/// Native attempt-wide identity and quota allocator. Managers remain view-local
/// so closing one popup cannot cancel root/sibling callbacks. IDs are never
/// recycled while the attempt exists, even when a view is dropped.
pub struct DownloadPool {
    identity: BrowserIdentity,
    state: Mutex<PoolState>,
}
struct PoolState {
    next_id: u32,
    rows: usize,
    active: usize,
}
impl DownloadPool {
    pub fn new(identity: BrowserIdentity) -> Self {
        Self {
            identity,
            state: Mutex::new(PoolState {
                next_id: 1,
                rows: 0,
                active: 0,
            }),
        }
    }
    fn can_start(&self) -> bool {
        self.state.lock().is_ok_and(|state| {
            state.next_id < u32::MAX
                && state.rows < MAX_DOWNLOADS
                && state.active < MAX_ACTIVE_DOWNLOADS
        })
    }
    fn reserve(self: &Arc<Self>) -> Result<DownloadReservation, DownloadError> {
        let mut state = self.state.lock().map_err(|_| DownloadError::Unavailable)?;
        if state.rows >= MAX_DOWNLOADS || state.active >= MAX_ACTIVE_DOWNLOADS {
            return Err(DownloadError::Limit);
        }
        let id = state.next_id;
        state.next_id = id.checked_add(1).ok_or(DownloadError::Limit)?;
        state.rows += 1;
        state.active += 1;
        Ok(DownloadReservation {
            pool: self.clone(),
            id,
            active: true,
        })
    }
}
struct DownloadReservation {
    pool: Arc<DownloadPool>,
    id: u32,
    active: bool,
}
impl DownloadReservation {
    fn finish(&mut self) {
        if self.active {
            let mut state = self.pool.state.lock().unwrap_or_else(|e| e.into_inner());
            state.active -= 1;
            self.active = false;
        }
    }
}
impl Drop for DownloadReservation {
    fn drop(&mut self) {
        self.finish();
        self.pool
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .rows -= 1;
    }
}

struct Row {
    reservation: DownloadReservation,
    snapshot: DownloadSnapshot,
    before: Option<Box<dyn BeforeDownload>>,
    control: Option<Box<dyn DownloadControl>>,
    selection: Arc<Mutex<Selection>>,
    expires_at: Instant,
    started: bool,
    approved: bool,
    destination: Option<PathBuf>,
    paused: bool,
    last_published: Instant,
    dirty: bool,
}

/// One manager per native view, only accessed on CEF UI. The delegate supplies
/// its attempt-wide pool. View revocation cancels only this manager's callbacks.
pub struct DownloadManager {
    identity: BrowserIdentity,
    delegate: Arc<dyn NativeDownloadDelegate>,
    rows: BTreeMap<u32, Row>,
    pool: Arc<DownloadPool>,
    revoked: bool,
    _ui_thread: PhantomData<Rc<()>>,
}

impl DownloadManager {
    pub fn new(identity: BrowserIdentity, delegate: Arc<dyn NativeDownloadDelegate>) -> Self {
        let pool = delegate.pool();
        Self {
            identity,
            delegate,
            rows: BTreeMap::new(),
            pool,
            revoked: false,
            _ui_thread: PhantomData,
        }
    }
    pub fn current(&self) -> bool {
        !self.revoked
            && self.pool.identity == self.identity
            && self.delegate.is_current(&self.identity)
    }
    pub fn can_start(&self) -> bool {
        self.current() && self.delegate.downloads_enabled() && self.pool.can_start()
    }
    /// Recheck queued CEF operations immediately before delivery, after any
    /// intervening user cancellation or owner revocation on the UI thread.
    pub fn permits_transfer(&self, cef_id: u32) -> bool {
        self.current()
            && self.delegate.downloads_enabled()
            && self
                .rows
                .get(&cef_id)
                .is_some_and(|row| row.approved && !row.snapshot.status.terminal())
    }
    pub fn wants_control(&self, cef_id: u32, action: DownloadAction) -> bool {
        self.permits_transfer(cef_id)
            && self.rows.get(&cef_id).is_some_and(|row| match action {
                DownloadAction::Pause => row.snapshot.status == DownloadStatus::Paused,
                DownloadAction::Resume => row.snapshot.status == DownloadStatus::InProgress,
                DownloadAction::Cancel | DownloadAction::Reveal => false,
            })
    }
    fn check(&mut self) -> Result<(), DownloadError> {
        if self.current() {
            Ok(())
        } else {
            self.revoke();
            Err(DownloadError::OwnerUnavailable)
        }
    }
    fn insert(&mut self, cef_id: u32, now: Instant) -> Result<(), DownloadError> {
        self.check()?;
        if !self.delegate.downloads_enabled() {
            return Err(DownloadError::ActionUnavailable);
        }
        if self.rows.contains_key(&cef_id) {
            return Ok(());
        }
        if !self.can_start() {
            return Err(DownloadError::Limit);
        }
        let reservation = self.pool.reserve()?;
        let download_id = reservation.id;
        self.rows.insert(
            cef_id,
            Row {
                reservation,
                snapshot: DownloadSnapshot {
                    identity: OriginBrowserIdentity::from_native(&self.identity),
                    download_id,
                    sequence: 0,
                    file_name: "download".into(),
                    status: DownloadStatus::AwaitingDestination,
                    received_bytes: 0,
                    total_bytes: None,
                    bytes_per_second: 0,
                    can_pause: false,
                    can_resume: false,
                    can_cancel: true,
                    can_reveal: false,
                },
                before: None,
                control: None,
                selection: Arc::new(Mutex::new(Selection::Pending)),
                expires_at: now + SAVE_TIMEOUT,
                started: false,
                approved: false,
                destination: None,
                paused: false,
                last_published: now,
                dirty: false,
            },
        );
        Ok(())
    }
    pub fn before(
        &mut self,
        cef_id: u32,
        suggested: &str,
        callback: Box<dyn BeforeDownload>,
        now: Instant,
    ) -> Result<(), DownloadError> {
        self.insert(cef_id, now)?;
        let row = self
            .rows
            .get_mut(&cef_id)
            .ok_or(DownloadError::Unavailable)?;
        if row.started || row.snapshot.status.terminal() {
            return Err(DownloadError::Unavailable);
        }
        row.started = true;
        row.before = Some(callback);
        row.snapshot.file_name = suggested_file_name(suggested);
        let request = DownloadSaveRequest {
            identity: self.identity.clone(),
            download_id: row.snapshot.download_id,
            suggested_name: row.snapshot.file_name.clone(),
            expires_at: row.expires_at,
        };
        let completion = DownloadSaveCompletion {
            selection: row.selection.clone(),
        };
        self.publish(cef_id, now);
        if self.check().is_err() {
            return Err(DownloadError::OwnerUnavailable);
        }
        self.delegate.choose_destination(request, completion);
        Ok(())
    }
    pub fn update(
        &mut self,
        cef_id: u32,
        progress: DownloadProgress,
        callback: Box<dyn DownloadControl>,
        now: Instant,
    ) -> Result<(), DownloadError> {
        if let Err(error) = self.insert(cef_id, now) {
            callback.cancel();
            return Err(error);
        }
        let row = self
            .rows
            .get_mut(&cef_id)
            .ok_or(DownloadError::Unavailable)?;
        if row.snapshot.status.terminal() {
            if row.snapshot.status != DownloadStatus::Completed {
                callback.cancel();
            }
            return Ok(());
        }
        let previous = row.snapshot.status;
        row.control = Some(callback);
        let bytes = |n: i64| (n.max(0) as u64).min(MAX_JS_INTEGER);
        row.snapshot.received_bytes = bytes(progress.received);
        row.snapshot.total_bytes = (progress.total > 0).then(|| bytes(progress.total));
        row.snapshot.bytes_per_second = bytes(progress.speed);
        row.snapshot.status = if progress.cancelled {
            DownloadStatus::Cancelled
        } else if progress.interrupted {
            DownloadStatus::Interrupted
        } else if progress.complete {
            if row.approved {
                DownloadStatus::Completed
            } else {
                DownloadStatus::Cancelled
            }
        } else if !row.approved {
            DownloadStatus::AwaitingDestination
        } else if progress.paused || row.paused {
            DownloadStatus::Paused
        } else if progress.in_progress {
            DownloadStatus::InProgress
        } else {
            DownloadStatus::Interrupted
        };
        if row.snapshot.status.terminal() {
            Self::finish_row(row, row.snapshot.status != DownloadStatus::Completed);
        }
        row.dirty = true;
        if previous != row.snapshot.status
            || now.duration_since(row.last_published) >= PROGRESS_INTERVAL
        {
            self.publish(cef_id, now);
        }
        Ok(())
    }
    fn finish_row(row: &mut Row, cancel: bool) {
        row.reservation.finish();
        if let Ok(mut selection) = row.selection.lock() {
            *selection = Selection::Denied;
        }
        row.before.take();
        if let Some(control) = row.control.take() {
            if cancel {
                control.cancel();
            }
        }
        row.snapshot.bytes_per_second = 0;
        if row.snapshot.status != DownloadStatus::Completed {
            row.destination = None;
        }
    }
    /// The exact owning CEF browser failed destination admission for an
    /// existing row. Cancel/finalize it without admitting new metadata or rows;
    /// terminal callbacks and later OnBeforeDownload cannot resurrect it.
    pub fn deny(&mut self, cef_id: u32, now: Instant) {
        if self.check().is_err() {
            return;
        }
        let Some(row) = self.rows.get_mut(&cef_id) else {
            return;
        };
        if row.snapshot.status.terminal() {
            return;
        }
        row.snapshot.status = DownloadStatus::Cancelled;
        Self::finish_row(row, true);
        self.publish(cef_id, now);
    }
    fn publish(&mut self, cef_id: u32, now: Instant) {
        let Some(row) = self.rows.get_mut(&cef_id) else {
            return;
        };
        if !row.started {
            return;
        }
        row.snapshot.can_cancel = !row.snapshot.status.terminal();
        row.snapshot.can_pause =
            row.control.is_some() && row.snapshot.status == DownloadStatus::InProgress;
        row.snapshot.can_resume =
            row.control.is_some() && row.snapshot.status == DownloadStatus::Paused;
        row.snapshot.can_reveal = row.snapshot.status == DownloadStatus::Completed
            && row.destination.is_some()
            && self.delegate.supports_reveal();
        row.snapshot.sequence = (row.snapshot.sequence + 1).min(MAX_JS_INTEGER);
        row.last_published = now;
        row.dirty = false;
        self.delegate.changed(row.snapshot.clone());
    }
    pub fn poll(&mut self, now: Instant) -> bool {
        if self.check().is_err() {
            return false;
        }
        let ids: Vec<_> = self.rows.keys().copied().collect();
        for id in ids {
            if !self.delegate.downloads_enabled() {
                self.deny(id, now);
                continue;
            }
            let row = self.rows.get_mut(&id).expect("registered download");
            if row.snapshot.status.terminal() {
                continue;
            }
            if !row.approved {
                let choice = match row.selection.lock() {
                    Ok(mut selection) if now >= row.expires_at => {
                        *selection = Selection::Denied;
                        Some(Selection::Denied)
                    }
                    Ok(mut selection) if !matches!(*selection, Selection::Pending) => {
                        Some(std::mem::replace(&mut *selection, Selection::Consumed))
                    }
                    Ok(_) => None,
                    Err(_) => Some(Selection::Denied),
                };
                match choice {
                    Some(Selection::Selected(destination)) if row.before.is_some() => {
                        // Owner must still be valid immediately before the only
                        // operation that permits CEF to write the selected file.
                        if !self.delegate.is_current(&self.identity)
                            || !self.delegate.downloads_enabled()
                        {
                            self.revoke();
                            return false;
                        }
                        row.approved = true;
                        row.destination = Some(destination.path().to_owned());
                        row.snapshot.status = DownloadStatus::InProgress;
                        row.before
                            .take()
                            .expect("pending callback")
                            .save(destination);
                        self.publish(id, now);
                    }
                    Some(_) => {
                        row.snapshot.status = DownloadStatus::Cancelled;
                        Self::finish_row(row, true);
                        self.publish(id, now);
                    }
                    None => {}
                }
            } else if row.dirty && now.duration_since(row.last_published) >= PROGRESS_INTERVAL {
                self.publish(id, now);
            }
        }
        self.rows.values().any(|r| !r.snapshot.status.terminal())
    }
    pub fn list(
        &mut self,
        identity: &OriginBrowserIdentity,
    ) -> Result<Vec<DownloadSnapshot>, DownloadError> {
        if identity.validate_matches(&self.identity).is_err() {
            return Err(DownloadError::OwnerUnavailable);
        }
        self.check()?;
        Ok(self
            .rows
            .values()
            .filter(|r| r.started)
            .map(|r| r.snapshot.clone())
            .collect())
    }
    pub fn control(
        &mut self,
        request: &DownloadControlRequest,
        now: Instant,
    ) -> Result<(), DownloadError> {
        if request.validate().is_err() || request.identity.validate_matches(&self.identity).is_err()
        {
            return Err(DownloadError::OwnerUnavailable);
        }
        self.check()?;
        if request.action != DownloadAction::Cancel && !self.delegate.downloads_enabled() {
            return Err(DownloadError::ActionUnavailable);
        }
        let id = self
            .rows
            .iter()
            .find_map(|(id, r)| {
                (r.snapshot.download_id == request.download_id && r.started).then_some(*id)
            })
            .ok_or(DownloadError::Unavailable)?;
        let row = self.rows.get_mut(&id).expect("registered download");
        match request.action {
            DownloadAction::Reveal if row.snapshot.can_reveal => {
                return self.delegate.reveal(
                    &self.identity,
                    row.destination
                        .as_deref()
                        .ok_or(DownloadError::ActionUnavailable)?,
                );
            }
            DownloadAction::Cancel if row.snapshot.status == DownloadStatus::Cancelled => {
                return Ok(())
            }
            DownloadAction::Cancel if !row.snapshot.status.terminal() => {
                row.snapshot.status = DownloadStatus::Cancelled;
                Self::finish_row(row, true);
            }
            DownloadAction::Pause
                if row.snapshot.status == DownloadStatus::InProgress && row.control.is_some() =>
            {
                row.control.as_ref().expect("download control").pause();
                row.paused = true;
                row.snapshot.status = DownloadStatus::Paused;
            }
            DownloadAction::Resume
                if row.snapshot.status == DownloadStatus::Paused && row.control.is_some() =>
            {
                row.control.as_ref().expect("download control").resume();
                row.paused = false;
                row.snapshot.status = DownloadStatus::InProgress;
            }
            _ => return Err(DownloadError::ActionUnavailable),
        }
        self.publish(id, now);
        Ok(())
    }
    pub fn revoke(&mut self) {
        if self.revoked {
            return;
        }
        self.revoked = true;
        for row in self.rows.values_mut() {
            if !row.snapshot.status.terminal() {
                row.snapshot.status = DownloadStatus::Cancelled;
                Self::finish_row(row, true);
            }
            row.destination = None;
        }
        // A view can close while the source attempt remains live. Finalize its
        // rows in the shared owner UI too, including clearing completed Reveal
        // affordances. Never emit after the actual owner/attempt is revoked.
        let ids: Vec<_> = self.rows.keys().copied().collect();
        for id in ids {
            if self.pool.identity != self.identity || !self.delegate.is_current(&self.identity) {
                break;
            }
            self.publish(id, Instant::now());
        }
    }
}
impl Drop for DownloadManager {
    fn drop(&mut self) {
        self.revoke();
    }
}

#[cfg(test)]
mod pool_tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;

    #[test]
    fn download_pool_id_exhaustion_never_wraps_or_reuses_zero() {
        let identity = OriginBrowserPolicy::new("db", "connection", "tab", "https://example.test")
            .unwrap()
            .identity()
            .clone();
        let pool = Arc::new(DownloadPool::new(identity));
        pool.state.lock().unwrap().next_id = u32::MAX - 1;
        let last = pool.reserve().unwrap();
        assert_eq!(last.id, u32::MAX - 1);
        drop(last);
        assert!(!pool.can_start());
        assert!(matches!(pool.reserve(), Err(DownloadError::Limit)));
        assert_eq!(pool.state.lock().unwrap().next_id, u32::MAX);
    }
}
