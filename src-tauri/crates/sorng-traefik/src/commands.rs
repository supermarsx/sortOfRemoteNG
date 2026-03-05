// ── sorng-traefik/src/commands.rs ────────────────────────────────────────────
//! Tauri commands – thin wrappers around `TraefikService`.

use tauri::State;
use crate::service::TraefikServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_connect(
    state: State<'_, TraefikServiceState>,
    id: String,
    config: TraefikConnectionConfig,
) -> CmdResult<TraefikConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_disconnect(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_connections(
    state: State<'_, TraefikServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn traefik_ping(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<TraefikConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Routers ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_list_http_routers(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikRouter>> {
    state.lock().await.list_http_routers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_http_router(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikRouter> {
    state.lock().await.get_http_router(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_tcp_routers(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikTcpRouter>> {
    state.lock().await.list_tcp_routers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_tcp_router(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikTcpRouter> {
    state.lock().await.get_tcp_router(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_udp_routers(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikUdpRouter>> {
    state.lock().await.list_udp_routers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_udp_router(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikUdpRouter> {
    state.lock().await.get_udp_router(&id, &name).await.map_err(map_err)
}

// ── Services ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_list_http_services(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikService>> {
    state.lock().await.list_http_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_http_service(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikService> {
    state.lock().await.get_http_service(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_tcp_services(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikTcpService>> {
    state.lock().await.list_tcp_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_tcp_service(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikTcpService> {
    state.lock().await.get_tcp_service(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_udp_services(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikUdpService>> {
    state.lock().await.list_udp_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_udp_service(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikUdpService> {
    state.lock().await.get_udp_service(&id, &name).await.map_err(map_err)
}

// ── Middleware ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_list_http_middlewares(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikMiddleware>> {
    state.lock().await.list_http_middlewares(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_http_middleware(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikMiddleware> {
    state.lock().await.get_http_middleware(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_list_tcp_middlewares(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikTcpMiddleware>> {
    state.lock().await.list_tcp_middlewares(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_tcp_middleware(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikTcpMiddleware> {
    state.lock().await.get_tcp_middleware(&id, &name).await.map_err(map_err)
}

// ── Entrypoints ───────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_list_entrypoints(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikEntryPoint>> {
    state.lock().await.list_entrypoints(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_entrypoint(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikEntryPoint> {
    state.lock().await.get_entrypoint(&id, &name).await.map_err(map_err)
}

// ── TLS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_list_tls_certificates(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<Vec<TraefikTlsCertificate>> {
    state.lock().await.list_tls_certificates(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_tls_certificate(
    state: State<'_, TraefikServiceState>,
    id: String,
    name: String,
) -> CmdResult<TraefikTlsCertificate> {
    state.lock().await.get_tls_certificate(&id, &name).await.map_err(map_err)
}

// ── Overview ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn traefik_get_overview(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<TraefikOverview> {
    state.lock().await.get_overview(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_version(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<TraefikVersion> {
    state.lock().await.get_version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn traefik_get_raw_config(
    state: State<'_, TraefikServiceState>,
    id: String,
) -> CmdResult<TraefikRawConfig> {
    state.lock().await.get_raw_config(&id).await.map_err(map_err)
}
