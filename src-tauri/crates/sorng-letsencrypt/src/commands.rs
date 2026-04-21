// # Let's Encrypt Tauri Commands
//
// All `#[tauri::command]` handlers for the Let's Encrypt / ACME subsystem.
// Registered in the main Tauri `generate_handler![]` macro.

use super::service::LetsEncryptServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

// ── Service Lifecycle ───────────────────────────────────────────────

/// Get the overall Let's Encrypt service status.
#[tauri::command]
pub async fn le_get_status(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<LetsEncryptStatus> {
    let svc = state.lock().await;
    Ok(svc.status())
}

/// Start the Let's Encrypt service.
#[tauri::command]
pub async fn le_start(state: State<'_, LetsEncryptServiceState>) -> CmdResult<()> {
    state.lock().await.start().await
}

/// Stop the Let's Encrypt service.
#[tauri::command]
pub async fn le_stop(state: State<'_, LetsEncryptServiceState>) -> CmdResult<()> {
    state.lock().await.stop().await
}

/// Get the current Let's Encrypt configuration.
#[tauri::command]
pub async fn le_get_config(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<LetsEncryptConfig> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

/// Update the Let's Encrypt configuration.
#[tauri::command]
pub async fn le_update_config(
    state: State<'_, LetsEncryptServiceState>,
    config: LetsEncryptConfig,
) -> CmdResult<()> {
    state.lock().await.update_config(config).await
}

// ── Account Management ──────────────────────────────────────────────

/// Register or fetch an ACME account.
#[tauri::command]
pub async fn le_register_account(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<AcmeAccount> {
    state.lock().await.register_account().await
}

/// List registered ACME accounts.
#[tauri::command]
pub async fn le_list_accounts(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<Vec<AcmeAccount>> {
    let svc = state.lock().await;
    Ok(svc.list_accounts())
}

/// Remove an ACME account.
#[tauri::command]
pub async fn le_remove_account(
    state: State<'_, LetsEncryptServiceState>,
    account_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_account(&account_id).await
}

// ── Certificate Operations ──────────────────────────────────────────

/// Request a new TLS certificate for the given domains.
#[tauri::command]
pub async fn le_request_certificate(
    state: State<'_, LetsEncryptServiceState>,
    domains: Vec<String>,
    challenge_type: Option<ChallengeType>,
) -> CmdResult<ManagedCertificate> {
    state
        .lock()
        .await
        .request_certificate(domains, challenge_type)
        .await
}

/// Renew an existing certificate.
#[tauri::command]
pub async fn le_renew_certificate(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<ManagedCertificate> {
    state.lock().await.renew_certificate(&certificate_id).await
}

/// Revoke a certificate.
#[tauri::command]
pub async fn le_revoke_certificate(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
    reason: Option<u8>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .revoke_certificate(&certificate_id, reason)
        .await
}

/// List all managed certificates.
#[tauri::command]
pub async fn le_list_certificates(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<Vec<ManagedCertificate>> {
    let svc = state.lock().await;
    Ok(svc.list_certificates())
}

/// Get a single certificate by ID.
#[tauri::command]
pub async fn le_get_certificate(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<Option<ManagedCertificate>> {
    let svc = state.lock().await;
    Ok(svc.get_certificate(&certificate_id))
}

/// Find certificates for a domain.
#[tauri::command]
pub async fn le_find_certificates_by_domain(
    state: State<'_, LetsEncryptServiceState>,
    domain: String,
) -> CmdResult<Vec<ManagedCertificate>> {
    let svc = state.lock().await;
    Ok(svc.find_certificates_by_domain(&domain))
}

/// Remove a certificate from storage.
#[tauri::command]
pub async fn le_remove_certificate(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_certificate(&certificate_id)
}

/// Get the file paths (cert + key PEM) for a managed certificate.
#[tauri::command]
pub async fn le_get_cert_paths(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<(String, String)> {
    let svc = state.lock().await;
    svc.get_cert_paths(&certificate_id)
}

// ── Health & Monitoring ─────────────────────────────────────────────

/// Run a health check across all managed certificates.
#[tauri::command]
pub async fn le_health_check(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<super::monitor::CertificateHealthSummary> {
    let mut svc = state.lock().await;
    Ok(svc.health_check())
}

/// Check whether any certificates have critical issues.
#[tauri::command]
pub async fn le_has_critical_issues(state: State<'_, LetsEncryptServiceState>) -> CmdResult<bool> {
    let svc = state.lock().await;
    Ok(svc.has_critical_issues())
}

// ── OCSP ────────────────────────────────────────────────────────────

/// Fetch a fresh OCSP response for a certificate.
#[tauri::command]
pub async fn le_fetch_ocsp(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<OcspStatus> {
    state.lock().await.fetch_ocsp(&certificate_id).await
}

/// Get the cached OCSP status for a certificate.
#[tauri::command]
pub async fn le_get_ocsp_status(
    state: State<'_, LetsEncryptServiceState>,
    certificate_id: String,
) -> CmdResult<Option<OcspStatus>> {
    let svc = state.lock().await;
    Ok(svc.get_ocsp_status(&certificate_id))
}

// ── Events ──────────────────────────────────────────────────────────

/// Get recent events from the Let's Encrypt service.
#[tauri::command]
pub async fn le_recent_events(
    state: State<'_, LetsEncryptServiceState>,
    count: Option<usize>,
) -> CmdResult<Vec<LetsEncryptEvent>> {
    let svc = state.lock().await;
    Ok(svc
        .recent_events(count.unwrap_or(20))
        .into_iter()
        .cloned()
        .collect())
}

/// Drain pending events (one-shot read + clear for the frontend).
#[tauri::command]
pub async fn le_drain_events(
    state: State<'_, LetsEncryptServiceState>,
) -> CmdResult<Vec<LetsEncryptEvent>> {
    let mut svc = state.lock().await;
    Ok(svc.drain_events())
}

// ── Rate Limits ─────────────────────────────────────────────────────

/// Check rate-limit status for a domain.
#[tauri::command]
pub async fn le_check_rate_limit(
    state: State<'_, LetsEncryptServiceState>,
    domain: String,
) -> CmdResult<Option<RateLimitInfo>> {
    let svc = state.lock().await;
    Ok(svc.check_rate_limit(&domain))
}

/// Check whether a domain is currently rate-limited.
#[tauri::command]
pub async fn le_is_rate_limited(
    state: State<'_, LetsEncryptServiceState>,
    domain: String,
) -> CmdResult<bool> {
    let svc = state.lock().await;
    Ok(svc.is_rate_limited(&domain))
}
