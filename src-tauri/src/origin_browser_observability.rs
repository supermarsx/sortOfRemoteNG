//! Read-only live-session diagnostics. No page, address, token or credential data.
use serde::Serialize;
use sorng_browser_host::ipc::{OriginBrowserFailureReason, OriginBrowserPhase};
use sorng_protocols::private_forward_proxy::PrivateProxyDiagnostics;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionIdentity {
    pub connection_id: String,
    pub session_id: String,
    pub attempt_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDiagnostics {
    pub identity: SessionIdentity,
    /// None means a busy/poisoned snapshot, not a fabricated lifecycle state.
    pub phase: Option<OriginBrowserPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<OriginBrowserFailureReason>,
    /// None means a busy/poisoned session, never zero activity.
    pub proxy: Option<PrivateProxyDiagnostics>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDiagnosticsResponse {
    /// Whether this build exposes native observations, not engine readiness.
    pub available: bool,
    pub sessions: Vec<SessionDiagnostics>,
}
