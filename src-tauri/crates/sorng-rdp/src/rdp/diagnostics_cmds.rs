use secrecy::SecretString;

use super::diagnostics::*;

/// Run a deep diagnostic probe against an RDP server.
/// This performs each connection phase independently and reports
/// detailed results for each step, without actually creating an
/// active session.
#[tauri::command]
pub async fn diagnose_rdp_connection(
    state: tauri::State<'_, RdpServiceState>,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    rdp_settings: Option<RdpSettingsPayload>,
) -> Result<DiagnosticReport, String> {
    // Wrap the incoming credential in the same SecretString type the
    // production session path uses (see commands_cmds.rs / session_runner.rs)
    // so it is redacted/zeroized consistently and never logged. The Tauri
    // command still accepts the raw `password` string from the frontend; we
    // wrap it immediately at the boundary.
    let h = host.clone();
    let u = username.clone();
    let p = SecretString::new(password);
    let d = domain.clone();

    let payload = rdp_settings.unwrap_or_default();
    let settings = ResolvedSettings::from_payload(&payload, 1024, 768);

    let service = state.lock().await;
    let cached_tls = service.cached_tls_connector.clone();
    let cached_http = service.cached_http_client.clone();
    drop(service);

    tokio::task::spawn_blocking(move || {
        run_diagnostics(
            &h,
            port,
            &u,
            &p,
            d.as_deref(),
            &settings,
            cached_tls,
            cached_http,
        )
    })
    .await
    .map_err(|e| format!("Diagnostic task panicked: {e}"))
}
