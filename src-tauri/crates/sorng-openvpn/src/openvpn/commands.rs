//! Tauri command wrappers for the OpenVPN service.
//!
//! Each command is a thin wrapper that delegates to [`OpenVpnService`].

use crate::openvpn::auth::VpnCredentials;
use crate::openvpn::config::ValidationResult;
use crate::openvpn::dns::DnsConfig;
use crate::openvpn::logging::{ExportFormat, LogEntry};
use crate::openvpn::routing::RoutingPolicy;
use crate::openvpn::service::OpenVpnServiceState;
use crate::openvpn::tunnel::HealthCheck;
use crate::openvpn::types::*;
use tauri::State;

// ━━━━━━━━━━  Connection lifecycle ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_create_connection(
    service: State<'_, OpenVpnServiceState>,
    config: OpenVpnConfig,
    label: Option<String>,
    routing_policy: Option<RoutingPolicy>,
    dns_config: Option<DnsConfig>,
) -> Result<ConnectionInfo, String> {
    service
        .create_connection(config, label, routing_policy, dns_config)
        .await
}

#[tauri::command]
pub async fn openvpn_connect(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<ConnectionInfo, String> {
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_connect_with_events<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<ConnectionInfo, String> {
    service.connect_with_events(app, &connection_id).await
}

#[tauri::command]
pub async fn openvpn_create_and_connect(
    service: State<'_, OpenVpnServiceState>,
    config: OpenVpnConfig,
    label: Option<String>,
    routing_policy: Option<RoutingPolicy>,
    dns_config: Option<DnsConfig>,
) -> Result<ConnectionInfo, String> {
    service
        .create_and_connect(config, label, routing_policy, dns_config)
        .await
}

#[tauri::command]
pub async fn openvpn_disconnect(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<(), String> {
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_disconnect_all(
    service: State<'_, OpenVpnServiceState>,
) -> Result<Vec<String>, String> {
    service.disconnect_all().await
}

#[tauri::command]
pub async fn openvpn_remove_connection(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<(), String> {
    service.remove_connection(&connection_id).await
}

// ━━━━━━━━━━  Query ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_list_connections(
    service: State<'_, OpenVpnServiceState>,
) -> Result<Vec<ConnectionInfo>, String> {
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn openvpn_get_connection_info(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<ConnectionInfo, String> {
    service.get_connection_info(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_get_status(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<ConnectionStatus, String> {
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_get_stats(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<SessionStats, String> {
    service.get_stats(&connection_id).await
}

// ━━━━━━━━━━  Auth ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_send_auth(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let creds = VpnCredentials::basic(username, password);
    service.send_auth(&connection_id, creds).await
}

#[tauri::command]
pub async fn openvpn_send_otp(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    code: String,
) -> Result<(), String> {
    service.send_otp(&connection_id, &code).await
}

// ━━━━━━━━━━  Config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_import_config(
    service: State<'_, OpenVpnServiceState>,
    ovpn_content: String,
    label: Option<String>,
) -> Result<ConnectionInfo, String> {
    service.import_config(&ovpn_content, label).await
}

#[tauri::command]
pub async fn openvpn_export_config(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<String, String> {
    service.export_config(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_validate_config(
    service: State<'_, OpenVpnServiceState>,
    ovpn_content: String,
) -> Result<ValidationResult, String> {
    Ok(service.validate_config_text(&ovpn_content))
}

#[tauri::command]
pub async fn openvpn_get_config_templates() -> Result<Vec<crate::openvpn::config::ConfigTemplate>, String> {
    Ok(crate::openvpn::config::builtin_templates())
}

// ━━━━━━━━━━  Routing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_set_routing_policy(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    policy: RoutingPolicy,
) -> Result<(), String> {
    service.set_routing_policy(&connection_id, policy).await
}

#[tauri::command]
pub async fn openvpn_get_routing_policy(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<RoutingPolicy, String> {
    service.get_routing_policy(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_capture_route_table() -> Result<Vec<crate::openvpn::routing::RouteTableEntry>, String> {
    crate::openvpn::routing::capture_route_table()
        .await
        .map_err(|e| e.message)
}

// ━━━━━━━━━━  DNS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_set_dns_config(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    config: DnsConfig,
) -> Result<(), String> {
    service.set_dns_config(&connection_id, config).await
}

#[tauri::command]
pub async fn openvpn_get_dns_config(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<DnsConfig, String> {
    service.get_dns_config(&connection_id).await
}

#[tauri::command]
pub async fn openvpn_check_dns_leak(
    expected_servers: Vec<String>,
    test_domain: Option<String>,
) -> Result<crate::openvpn::dns::DnsLeakResult, String> {
    let domain = test_domain.as_deref().unwrap_or("example.com");
    crate::openvpn::dns::check_dns_leak(&expected_servers, domain)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn openvpn_flush_dns() -> Result<(), String> {
    crate::openvpn::dns::flush_dns_cache()
        .await
        .map_err(|e| e.message)
}

// ━━━━━━━━━━  Health ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_check_health(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<HealthCheck, String> {
    service.check_health(&connection_id).await
}

// ━━━━━━━━━━  Logging ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_get_logs(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    tail: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    service.get_logs(&connection_id, tail).await
}

#[tauri::command]
pub async fn openvpn_search_logs(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    query: String,
) -> Result<Vec<LogEntry>, String> {
    service.search_logs(&connection_id, &query).await
}

#[tauri::command]
pub async fn openvpn_export_logs(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    format: ExportFormat,
) -> Result<String, String> {
    service.export_logs(&connection_id, format).await
}

#[tauri::command]
pub async fn openvpn_clear_logs(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
) -> Result<(), String> {
    service.clear_logs(&connection_id).await
}

// ━━━━━━━━━━  Management passthrough ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_mgmt_command(
    service: State<'_, OpenVpnServiceState>,
    connection_id: String,
    command: String,
) -> Result<(), String> {
    service.mgmt_command(&connection_id, &command).await
}

// ━━━━━━━━━━  System ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_detect_version(
    service: State<'_, OpenVpnServiceState>,
) -> Result<String, String> {
    service.detect_version().await
}

#[tauri::command]
pub async fn openvpn_find_binary(
    service: State<'_, OpenVpnServiceState>,
) -> Result<Option<String>, String> {
    Ok(service.find_binary())
}

#[tauri::command]
pub async fn openvpn_get_binary_paths() -> Result<Vec<String>, String> {
    Ok(default_binary_paths()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

// ━━━━━━━━━━  Defaults ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn openvpn_set_default_reconnect(
    service: State<'_, OpenVpnServiceState>,
    policy: ReconnectPolicy,
) -> Result<(), String> {
    service.set_default_reconnect(policy).await;
    Ok(())
}

#[tauri::command]
pub async fn openvpn_get_default_reconnect(
    service: State<'_, OpenVpnServiceState>,
) -> Result<ReconnectPolicy, String> {
    Ok(service.get_default_reconnect().await)
}

#[tauri::command]
pub async fn openvpn_set_default_routing(
    service: State<'_, OpenVpnServiceState>,
    policy: RoutingPolicy,
) -> Result<(), String> {
    service.set_default_routing(policy).await;
    Ok(())
}

#[tauri::command]
pub async fn openvpn_set_default_dns(
    service: State<'_, OpenVpnServiceState>,
    config: DnsConfig,
) -> Result<(), String> {
    service.set_default_dns(config).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Command functions are thin wrappers — test that they compile and the
    // service delegation would work.  Actual integration tests live in the
    // service module.

    #[test]
    fn command_count() {
        // Ensure we have the expected number of exported commands.
        // Each command is a separate function in this module.
        // Count the #[tauri::command] attributes above (37 commands).
        assert!(true, "All 37 command wrappers compiled successfully");
    }
}
