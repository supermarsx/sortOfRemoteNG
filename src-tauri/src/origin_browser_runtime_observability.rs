//! Caller-window-only relay counters; never touches CEF or probes the network.
use super::*;
use crate::origin_browser_observability::{
    SessionDiagnostics, SessionDiagnosticsResponse, SessionIdentity,
};

#[path = "origin_browser_observability_flow.rs"]
mod observation_flow;

pub(crate) fn snapshot(window: &WebviewWindow) -> Result<SessionDiagnosticsResponse, String> {
    let mut sessions = observation_flow::snapshot_authorized(
        &shared().attempts,
        // Memory-only exact native token/expiry/generation + shell lifetime.
        // Do not call recheck(): it reads databases and revokes on failure.
        |attempt| attempt.window == window.label() && attempt.current(),
        |attempt| {
            let phase = attempt
                .snapshot
                .try_lock()
                .ok()
                .map(|snapshot| snapshot.phase());
            let failure_reason = if matches!(phase, Some(OriginBrowserPhase::Failed)) {
                attempt.failure.get().map(Into::into)
            } else {
                None
            };
            let proxy = attempt
                .session
                .try_lock()
                .ok()
                .map(|session| session.proxy_diagnostics());
            SessionDiagnostics {
                identity: SessionIdentity {
                    connection_id: attempt.identity.connection_id().to_owned(),
                    session_id: attempt.identity.session_id().to_owned(),
                    attempt_id: attempt.identity.attempt_id().to_string(),
                },
                phase,
                failure_reason,
                proxy,
            }
        },
    )
    .map_err(|_| "Native browser session diagnostics are temporarily unavailable.".to_owned())?;
    // Stable order avoids artificial refresh churn. MAX_ATTEMPTS bounds rows.
    sessions.sort_by(|a, b| a.identity.attempt_id.cmp(&b.identity.attempt_id));
    Ok(SessionDiagnosticsResponse {
        available: true,
        sessions,
    })
}
