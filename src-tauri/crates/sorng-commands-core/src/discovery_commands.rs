//! Native discovery reachability bridge; frontend owns scan policy and defaults.

#[tauri::command]
pub async fn probe_discovery_host(
    host: String,
    method: String,
    timeout_ms: u64,
    port: Option<u16>,
) -> sorng_network::discovery_ping::DiscoveryProbeResult {
    sorng_network::discovery_ping::probe_discovery_host(host, method, timeout_ms, port).await
}
