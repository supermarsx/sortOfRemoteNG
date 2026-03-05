// ── sorng-caddy/src/commands.rs ──────────────────────────────────────────────
//! Tauri commands – thin wrappers around `CaddyService`.

use std::collections::HashMap;
use tauri::State;
use crate::service::CaddyServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_connect(
    state: State<'_, CaddyServiceState>,
    id: String,
    config: CaddyConnectionConfig,
) -> CmdResult<CaddyConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_disconnect(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn caddy_list_connections(
    state: State<'_, CaddyServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn caddy_ping(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<CaddyConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_get_full_config(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<CaddyConfig> {
    state.lock().await.get_full_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_raw_config(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_raw_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_config_path(
    state: State<'_, CaddyServiceState>,
    id: String,
    path: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_config_path(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_config_path(
    state: State<'_, CaddyServiceState>,
    id: String,
    path: String,
    value: serde_json::Value,
) -> CmdResult<()> {
    state.lock().await.set_config_path(&id, &path, value).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_patch_config_path(
    state: State<'_, CaddyServiceState>,
    id: String,
    path: String,
    value: serde_json::Value,
) -> CmdResult<()> {
    state.lock().await.patch_config_path(&id, &path, value).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_delete_config_path(
    state: State<'_, CaddyServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.delete_config_path(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_load_config(
    state: State<'_, CaddyServiceState>,
    id: String,
    config: serde_json::Value,
) -> CmdResult<()> {
    state.lock().await.load_config(&id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_adapt_caddyfile(
    state: State<'_, CaddyServiceState>,
    id: String,
    caddyfile: String,
) -> CmdResult<CaddyfileAdaptResult> {
    state.lock().await.adapt_caddyfile(&id, caddyfile).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_stop_server(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.stop_server(&id).await.map_err(map_err)
}

// ── Servers ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_list_servers(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<HashMap<String, CaddyServer>> {
    state.lock().await.list_servers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_server(
    state: State<'_, CaddyServiceState>,
    id: String,
    name: String,
) -> CmdResult<CaddyServer> {
    state.lock().await.get_server(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_server(
    state: State<'_, CaddyServiceState>,
    id: String,
    name: String,
    server: CaddyServer,
) -> CmdResult<()> {
    state.lock().await.set_server(&id, &name, server).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_delete_server(
    state: State<'_, CaddyServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_server(&id, &name).await.map_err(map_err)
}

// ── Routes ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_list_routes(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
) -> CmdResult<Vec<CaddyRoute>> {
    state.lock().await.list_routes(&id, &server).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_route(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    index: usize,
) -> CmdResult<CaddyRoute> {
    state.lock().await.get_route(&id, &server, index).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_add_route(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    route: CaddyRoute,
) -> CmdResult<()> {
    state.lock().await.add_route(&id, &server, route).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_route(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    index: usize,
    route: CaddyRoute,
) -> CmdResult<()> {
    state.lock().await.set_route(&id, &server, index, route).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_delete_route(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    index: usize,
) -> CmdResult<()> {
    state.lock().await.delete_route(&id, &server, index).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_all_routes(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    routes: Vec<CaddyRoute>,
) -> CmdResult<()> {
    state.lock().await.set_all_routes(&id, &server, routes).await.map_err(map_err)
}

// ── TLS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_get_tls_app(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<TlsApp> {
    state.lock().await.get_tls_app(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_tls_app(
    state: State<'_, CaddyServiceState>,
    id: String,
    tls: TlsApp,
) -> CmdResult<()> {
    state.lock().await.set_tls_app(&id, tls).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_list_automate_domains(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_automate_domains(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_automate_domains(
    state: State<'_, CaddyServiceState>,
    id: String,
    domains: Vec<String>,
) -> CmdResult<()> {
    state.lock().await.set_automate_domains(&id, domains).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_tls_automation(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<TlsAutomation> {
    state.lock().await.get_tls_automation(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_set_tls_automation(
    state: State<'_, CaddyServiceState>,
    id: String,
    automation: TlsAutomation,
) -> CmdResult<()> {
    state.lock().await.set_tls_automation(&id, automation).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_list_tls_certificates(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<Vec<CaddyCertificate>> {
    state.lock().await.list_tls_certificates(&id).await.map_err(map_err)
}

// ── Reverse Proxy ─────────────────────────────────────────────────

#[tauri::command]
pub async fn caddy_create_reverse_proxy(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    request: CreateReverseProxyRequest,
) -> CmdResult<()> {
    state.lock().await.create_reverse_proxy(&id, &server, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_get_upstreams(
    state: State<'_, CaddyServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state.lock().await.get_upstreams(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_create_file_server(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    request: CreateFileServerRequest,
) -> CmdResult<()> {
    state.lock().await.create_file_server(&id, &server, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn caddy_create_redirect(
    state: State<'_, CaddyServiceState>,
    id: String,
    server: String,
    request: CreateRedirectRequest,
) -> CmdResult<()> {
    state.lock().await.create_redirect(&id, &server, request).await.map_err(map_err)
}
