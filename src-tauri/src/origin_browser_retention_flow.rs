//! UI-thread cookie checkpoint coordinator. Disk IO stays on the worker pool;
//! shutdown waits for final save or acknowledged cleanup, including retries.

#[path = "origin_browser_retention_gate.rs"]
mod gate;

use super::retention::NativeCookieRetention;
use gate::{FailureNotice, Gate, Work};
use sorng_browser_host::{
    cef_browser::CefBrowserHost,
    cef_session_retention::{CookieCapture, RetentionError},
};
use std::{sync::Arc, time::Instant};
use tokio::sync::oneshot;

pub(super) struct Checkpoint {
    capture: Option<CookieCapture>,
    worker: Option<oneshot::Receiver<Result<(), RetentionError>>>,
    gate: Gate,
    failure: FailureNotice<RetentionError>,
    cleanup_error: Option<RetentionError>,
}

impl Checkpoint {
    pub(super) fn new() -> Self {
        Self {
            capture: None,
            worker: None,
            gate: Gate::new(Instant::now()),
            failure: FailureNotice::new(),
            cleanup_error: None,
        }
    }

    /// Start final capture before revoking the primary lease/proxy, even when
    /// a periodic save is pending. Consume its result only after that save.
    pub(super) fn begin_close(
        &mut self,
        host: &CefBrowserHost<'_>,
        owner: &Arc<NativeCookieRetention>,
    ) {
        if !self.gate.begin_close(Instant::now()) {
            return;
        }
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
        if let Some(capture) = &mut self.capture {
            match capture.take() {
                Ok(cookies) => {
                    self.capture = None;
                    let work = self.gate.start_save(Instant::now());
                    let (sender, receiver) = oneshot::channel();
                    self.worker = Some(receiver);
                    let owner = owner.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let result = owner.save(cookies).and_then(|()| {
                            if work == Work::FinalSave {
                                owner.finish()
                            } else {
                                Ok(())
                            }
                        });
                        let _ = sender.send(result);
                    });
                }
                Err(RetentionError::Pending) => (),
                Err(error) => self.fail(owner, error),
            }
        } else if live && self.gate.periodic_due(Instant::now()) {
            match host.capture_sign_in_cookies(owner.clone()) {
                Ok(capture) => self.capture = Some(capture),
                Err(error) => self.fail(owner, error),
            }
        }
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
