//! Native discovery reachability bridge; frontend owns scan policy and defaults.

#[tauri::command]
pub async fn detect_interface_subnets(
) -> Result<Vec<sorng_network::interface_subnets::InterfaceSubnet>, String> {
    sorng_network::interface_subnets::detect_interface_subnets().await
}

#[tauri::command]
pub async fn get_discovery_capacity(
) -> Result<sorng_network::discovery_capacity::DiscoveryCapacity, String> {
    sorng_network::discovery_capacity::get_discovery_capacity().await
}

#[tauri::command]
pub async fn discovery_reverse_dns(
    host: String,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    sorng_network::discovery_capacity::discovery_reverse_dns(host, timeout_ms).await
}

#[tauri::command]
pub async fn probe_discovery_batch(
    host: String,
    probes: Vec<sorng_network::discovery_batch::DiscoveryBatchProbe>,
    timeout_secs: u64,
    parallelism: usize,
) -> Result<Vec<sorng_network::network::PortCheckResult>, String> {
    sorng_network::discovery_batch::probe_discovery_batch(host, probes, timeout_secs, parallelism)
        .await
}

#[tauri::command]
pub async fn probe_discovery_host(
    host: String,
    method: String,
    timeout_ms: u64,
    port: Option<u16>,
    methods: Option<Vec<String>>,
    udp_port: Option<u16>,
) -> sorng_network::discovery_ping::DiscoveryProbeResult {
    sorng_network::discovery_ping::probe_discovery_host_with_options(
        host, method, timeout_ms, port, methods, udp_port,
    )
    .await
}

#[tauri::command]
pub async fn get_discovery_probe_capabilities(
) -> sorng_network::discovery_ping::DiscoveryProbeCapabilities {
    sorng_network::discovery_ping::get_discovery_probe_capabilities().await
}
