//! Native-attempt scoped recording adapter. No global IndexedDB persistence,
//! page reconstruction, body interception, arbitrary path writes, or UI-thread IO.
use super::{lookup, shared, Attempt, STALE};
use crate::origin_browser_recording::{Operation, Request};
use sorng_browser_host::cef_requests::recording::{self, Recording, RecordingData, RecordingOwner};
use sorng_encryption::EncryptionState;
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};
use tauri::WebviewWindow;

#[path = "origin_browser_recording_har.rs"]
mod har;

struct Owner(Weak<Attempt>);
impl RecordingOwner for Owner {
    fn current(&self, identity: &BrowserIdentity) -> bool {
        self.0
            .upgrade()
            .is_some_and(|attempt| attempt.identity == *identity && attempt.current())
    }
}

pub(super) fn revoke(identity: &BrowserIdentity) {
    recording::discard(identity);
}
pub(super) fn reap() {
    // CEF can pump much faster than housekeeping needs. Explicit attempt
    // revocation still discards immediately; callbacks always check the lease.
    static NEXT: OnceLock<Mutex<Instant>> = OnceLock::new();
    let now = Instant::now();
    let Ok(mut next) = NEXT.get_or_init(|| Mutex::new(now)).try_lock() else {
        return;
    };
    if now < *next {
        return;
    }
    *next = now + Duration::from_millis(250);
    drop(next);
    recording::reap();
}

pub(crate) async fn operate(
    window: WebviewWindow,
    state: &EncryptionState,
    request: Request,
) -> Result<serde_json::Value, String> {
    request.validate()?;
    let attempt = lookup(&window, &request.identity)?;
    if !attempt.current() || !shared().admission.ready() {
        revoke(&attempt.identity);
        return Err(STALE.into());
    }
    // Saved database content is rechecked only on the async command path, not
    // for every status poll and never inside a CEF request callback.
    if matches!(
        &request.operation,
        Operation::Start { .. } | Operation::Export { .. }
    ) {
        if attempt.lease.recheck(&window, state).await.is_err() {
            revoke(&attempt.identity);
            return Err(STALE.into());
        }
    }
    let current = || {
        if attempt.current() && shared().admission.ready() {
            Ok(())
        } else {
            revoke(&attempt.identity);
            Err(STALE.to_owned())
        }
    };
    current()?;
    let record = if matches!(&request.operation, Operation::Start { .. }) {
        Some(
            Recording::start(&attempt.identity, Arc::new(Owner(Arc::downgrade(&attempt))))
                .map_err(|error| error.to_string())?,
        )
    } else {
        recording::find(&attempt.identity)
    };
    let Some(record) = record else {
        if matches!(request.operation, Operation::Status {}) {
            return Ok(serde_json::json!({"snapshot":null,"har":null}));
        }
        return Err("The browser recording is unavailable or changed".into());
    };
    let snapshot = record.snapshot().map_err(|error| error.to_string())?;
    if let Operation::Stop { recording_id }
    | Operation::Discard { recording_id }
    | Operation::Export { recording_id } = &request.operation
    {
        if *recording_id != snapshot.recording_id {
            return Err("The browser recording is unavailable or changed".into());
        }
    }
    let reply = match request.operation {
        Operation::Status {} | Operation::Start { .. } => {
            serde_json::json!({"snapshot":snapshot,"har":null})
        }
        Operation::Stop { .. } => {
            serde_json::json!({"snapshot":record.stop().map_err(|e| e.to_string())?,"har":null})
        }
        Operation::Discard { .. } => {
            if !recording::discard_exact(&attempt.identity, &snapshot.recording_id) {
                return Err("The browser recording is unavailable or changed".into());
            }
            serde_json::json!({"snapshot":null,"har":null})
        }
        Operation::Export { .. } => {
            let data = record.export().map_err(|error| error.to_string())?;
            serde_json::json!({"snapshot":data.snapshot,"har":har::export(&data, &|unix_ms| {
                chrono::DateTime::<chrono::Utc>::from_timestamp_millis(unix_ms as i64)
                    .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)).unwrap_or_default()
            })})
        }
    };
    current()?;
    Ok(reply)
}
