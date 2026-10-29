//! UI-thread cookie checkpoint coordinator. Disk IO stays on the worker pool;
//! shutdown waits for final save or acknowledged cleanup, including retries.
//!
//! Persistence points of a retained jar (t-cefiso p3):
//! - periodic: every `gate::INTERVAL` (5 s) while the attempt is live. Each
//!   capture is compared with the saved record natively, so an unchanged jar
//!   writes nothing (activity is refreshed at most every five minutes). This
//!   is what keeps a sign-in across an app crash or kill.
//! - on request: right after a completed main-frame document that followed an
//!   earlier one (a form-post sign-in, an SSO redirect chain or an automatic
//!   login landing), instead of waiting for the next periodic capture.
//! - on close: one final capture before the host is torn down, bounded by
//!   `FINAL_CAPTURE_LIMIT`. The host closes as soon as the capture resolves or
//!   that deadline passes; the save itself runs off the UI thread afterwards.
//!   A dropped final capture keeps the last checkpoint, as a crash would.
//!
//! Durable checkpoints (`NativeCookieRetention::checkpoint`) are taken only in
//! encrypted-database mode. Ephemeral retention never captures. Memory mode
//! keeps its in-process snapshot through `save`; nothing reaches storage. A
//! connection with `restoreCookies: false` has no retention owner at all.

#[path = "origin_browser_retention_gate.rs"]
mod gate;

use super::retention::NativeCookieRetention;
use gate::{FailureNotice, Gate, Work};
use sorng_browser_host::{
    cef_browser::CefBrowserHost,
    cef_session_retention::{CookieCapture, RetentionError, RetentionMode, RetentionPolicy},
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

/// How long a closing attempt waits for its final cookie capture before the
/// host is torn down anyway. The capture is native and in-process; it either
/// answers within a pump or two, or the cookie manager is stuck.
const FINAL_CAPTURE_LIMIT: Duration = Duration::from_secs(3);

/// Whether an attempt takes durable checkpoints: it has a retention owner
/// (cookies enabled, not Quick Connect, `restoreCookies` on) and its policy
/// keeps cookies in the encrypted database. Ephemeral and memory never do.
pub(super) fn durable_checkpoints(has_owner: bool, policy: RetentionPolicy) -> bool {
    has_owner && policy.mode == RetentionMode::EncryptedDatabase && policy.enabled()
}

/// CEF-free capture scheduling, driven by the caller's clock.
struct Schedule {
    durable: bool,
    requested: bool,
    final_deadline: Option<Instant>,
}

impl Schedule {
    /// `durable`: the attempt checkpoints to the encrypted database.
    fn new(durable: bool) -> Self {
        Self {
            durable,
            requested: false,
            final_deadline: None,
        }
    }

    fn durable(&self) -> bool {
        self.durable
    }

    /// A completed sign-in navigation. Only durable attempts act on it.
    fn request(&mut self) {
        self.requested |= self.durable;
    }

    fn begin_close(&mut self, now: Instant) {
        if self.final_deadline.is_none() {
            self.final_deadline = Some(now + FINAL_CAPTURE_LIMIT);
        }
        self.requested = false;
    }

    /// Whether a pending final capture must be dropped now.
    fn final_capture_expired(&self, now: Instant) -> bool {
        self.final_deadline.is_some_and(|deadline| now >= deadline)
    }

    /// Whether to start a mid-session capture now. Consumes a request.
    fn capture_due(&mut self, gate: &Gate, live: bool, now: Instant) -> bool {
        if !live || !gate.open() || !gate.can_capture() {
            return false;
        }
        let due = gate.periodic_due(now) || self.requested;
        if due {
            self.requested = false;
        }
        due
    }
}

pub(super) struct Checkpoint {
    capture: Option<CookieCapture>,
    worker: Option<oneshot::Receiver<Result<(), RetentionError>>>,
    gate: Gate,
    schedule: Schedule,
    failure: FailureNotice<RetentionError>,
    cleanup_error: Option<RetentionError>,
}

impl Checkpoint {
    pub(super) fn new(durable: bool) -> Self {
        Self {
            capture: None,
            worker: None,
            gate: Gate::new(Instant::now()),
            schedule: Schedule::new(durable),
            failure: FailureNotice::new(),
            cleanup_error: None,
        }
    }

    /// Capture soon after a sign-in navigation completed (durable mode only).
    pub(super) fn request(&mut self) {
        self.schedule.request();
    }

    /// Start final capture before revoking the primary lease/proxy, even when
    /// a periodic save is pending. Consume its result only after that save.
    pub(super) fn begin_close(
        &mut self,
        host: &CefBrowserHost<'_>,
        owner: &Arc<NativeCookieRetention>,
    ) {
        let now = Instant::now();
        if !self.gate.begin_close(now) {
            return;
        }
        self.schedule.begin_close(now);
        self.capture = None;
        if !owner.enabled() {
            if self.gate.claim_finish() {
                self.spawn_work(owner, Work::Finish);
            }
            return;
        }
        match host.capture_sign_in_cookies(owner.clone()) {
            Ok(capture) => self.capture = Some(capture),
            Err(error) => self.fail(owner, error),
        }
    }

    fn invalidate(&mut self, owner: &NativeCookieRetention) {
        // This atomic fence precedes dropping captures or scheduling IO.
        // Storage must also fence successor generations during retirement.
        owner.invalidate();
        self.capture = None;
    }

    fn record_failure(&mut self, owner: &NativeCookieRetention, error: RetentionError) {
        if owner.enabled() {
            self.failure.record(error);
        }
    }

    fn fail(&mut self, owner: &Arc<NativeCookieRetention>, error: RetentionError) {
        if self
            .gate
            .fail(error == RetentionError::OwnerUnavailable, Instant::now())
        {
            self.invalidate(owner);
            self.record_failure(owner, error);
        }
        self.schedule_cleanup(owner);
    }

    fn spawn_work(&mut self, owner: &Arc<NativeCookieRetention>, work: Work) {
        debug_assert!(self.worker.is_none());
        let (sender, receiver) = oneshot::channel();
        self.worker = Some(receiver);
        let owner = owner.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = match work {
                Work::Finish => owner.finish(),
                Work::Clear => owner.clear(),
                Work::Revoke => owner.revoke(),
                _ => unreachable!("save requires a captured jar"),
            };
            let _ = sender.send(result);
        });
    }

    fn schedule_cleanup(&mut self, owner: &Arc<NativeCookieRetention>) {
        if let Some(work) = self.gate.claim_cleanup(Instant::now()) {
            self.spawn_work(owner, work);
        }
    }

    pub(super) fn tick(
        &mut self,
        host: &CefBrowserHost<'_>,
        owner: &Arc<NativeCookieRetention>,
        live: bool,
    ) {
        // Poll before expiry: final IO may already have completed successfully.
        // Empty must still allow timeout invalidation, not return early.
        if let Some(worker) = &mut self.worker {
            let result = match worker.try_recv() {
                Ok(result) => Some(result),
                Err(oneshot::error::TryRecvError::Closed) => {
                    Some(Err(RetentionError::NativeFailure))
                }
                Err(oneshot::error::TryRecvError::Empty) => None,
            };
            if let Some(result) = result {
                self.worker = None;
                if self.gate.worker().is_some_and(Work::cleanup) {
                    if let Err(error) = result {
                        if self.cleanup_error != Some(error) {
                            log::warn!("Cookie retention cleanup failed; shutdown remains pending: {error:?}");
                            self.cleanup_error = Some(error);
                        }
                    }
                }
                if self.gate.completed(
                    result.map_err(|error| error == RetentionError::OwnerUnavailable),
                    Instant::now(),
                ) {
                    self.invalidate(owner);
                    self.record_failure(owner, result.unwrap_err());
                }
            }
        }
        if self.gate.open() && !live {
            self.fail(owner, RetentionError::OwnerUnavailable);
        }
        if self.gate.expire(Instant::now()) {
            self.invalidate(owner);
            self.record_failure(owner, RetentionError::NativeFailure);
        }
        self.schedule_cleanup(owner);
        if !self.gate.can_capture() {
            return;
        }
        // Writer handover can happen during a periodic worker or native
        // capture. Keep the worker until acknowledged, then finish the reader
        // without capturing again or deleting the successor's saved snapshot.
        if !owner.enabled() {
            self.capture = None;
            if self.gate.claim_finish() {
                self.spawn_work(owner, Work::Finish);
            }
            return;
        }
        let now = Instant::now();
        if self.capture.is_some() && self.schedule.final_capture_expired(now) {
            // Never hold teardown for a stuck cookie manager. The record keeps
            // the last checkpoint; finishing (not clearing) the slot below.
            log::warn!("Final sign-in cookie capture timed out; keeping the last checkpoint");
            self.capture = None;
        }
        if let Some(capture) = &mut self.capture {
            match capture.take() {
                Ok(cookies) => {
                    self.capture = None;
                    let work = self.gate.start_save(now);
                    let durable = self.schedule.durable();
                    let (sender, receiver) = oneshot::channel();
                    self.worker = Some(receiver);
                    let owner = owner.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let result = match work {
                            Work::FinalSave => owner.save(cookies).and_then(|()| owner.finish()),
                            // A live attempt's durable mid-session checkpoint.
                            _ if durable => owner.checkpoint(cookies),
                            // Memory mode: the in-process snapshot only.
                            _ => owner.save(cookies),
                        };
                        let _ = sender.send(result);
                    });
                }
                Err(RetentionError::Pending) => (),
                Err(error) => self.fail(owner, error),
            }
        } else if !self.gate.open() {
            // Closing without a capture: the final capture was dropped.
            if self.gate.claim_finish() {
                self.spawn_work(owner, Work::Finish);
            }
        } else if self.schedule.capture_due(&self.gate, live, now) {
            match host.capture_sign_in_cookies(owner.clone()) {
                Ok(capture) => self.capture = Some(capture),
                Err(error) => self.fail(owner, error),
            }
        }
    }

    /// A native cookie capture is outstanding. The host (and so its request
    /// context's cookie manager) must stay open until it resolves; storage IO
    /// afterwards needs neither.
    pub(super) fn capturing(&self) -> bool {
        self.capture.is_some()
    }

    pub(super) fn draining(&self) -> bool {
        self.gate.draining()
    }

    /// One notice per opted-in checkpoint. The runtime should map this to its
    /// fixed cookie-retention-failed message, never interpolate storage details.
    pub(super) fn take_failure(&mut self) -> Option<RetentionError> {
        self.failure.take()
    }
}

#[cfg(test)]
#[path = "origin_browser_retention_flow_tests.rs"]
mod tests;
