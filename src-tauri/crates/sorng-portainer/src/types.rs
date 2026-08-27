// ── sorng-portainer/src/types.rs ─────────────────────────────────────────────
//! Wire shapes shared with the frontend (`src/types/portainer.ts`, camelCase).

use serde::{Deserialize, Serialize};

// ── Connection ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerConnectionConfig {
    /// e.g. `https://host:9443` (trailing slash tolerated).
    pub base_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub api_key: Option<String>,
    pub skip_tls_verify: Option<bool>,
    /// Runtime-only acknowledgement that must match the effective skip flag.
    #[serde(default, skip_serializing, rename = "acknowledge_invalid_cert_risk")]
    pub acknowledge_invalid_cert_risk: bool,
    pub timeout_secs: Option<u64>,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PortainerAuthMode {
    Password,
    ApiKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerConnectionSummary {
    pub version: Option<String>,
    pub instance_id: Option<String>,
    pub user: Option<String>,
    pub role: Option<u8>,
    pub auth_mode: PortainerAuthMode,
}

// ── Raw API responses ─────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PortainerStatusResponse {
    #[serde(rename = "Version")]
    pub version: Option<String>,
    #[serde(rename = "InstanceID")]
    pub instance_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortainerAuthResponse {
    pub jwt: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortainerAuthPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortainerUserResponse {
    #[serde(rename = "Id")]
    pub id: Option<u64>,
    #[serde(rename = "Username")]
    pub username: Option<String>,
    #[serde(rename = "Role")]
    pub role: Option<u8>,
}

// ── Environments (endpoints) ──────────────────────────────────────

/// Docker snapshot summary attached to an environment. Mirrors the subset of
/// Portainer's `Snapshots[]` entry the panel renders (`src/types/portainer.ts`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerEndpointSnapshot {
    pub time: Option<i64>,
    pub docker_version: Option<String>,
    pub swarm: Option<bool>,
    #[serde(rename = "totalCpu")]
    pub total_cpu: Option<i64>,
    pub total_memory: Option<i64>,
    pub running_container_count: Option<u64>,
    pub stopped_container_count: Option<u64>,
    pub healthy_container_count: Option<u64>,
    pub unhealthy_container_count: Option<u64>,
    pub image_count: Option<u64>,
    pub volume_count: Option<u64>,
    pub stack_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerEndpoint {
    pub id: u64,
    pub name: String,
    /// Portainer endpoint type (1 = Docker, 2 = Agent, 3 = Azure, 4 = Edge, 5 = Kubernetes, ...).
    /// Wire name is `type` — the panel reads `ep.type`.
    #[serde(rename = "type")]
    pub endpoint_type: u32,
    pub url: String,
    /// 1 = up, 2 = down.
    pub status: u32,
    pub group_id: Option<u64>,
    /// Always present on the wire (empty when Portainer reports no snapshot).
    #[serde(default)]
    pub snapshots: Vec<PortainerEndpointSnapshot>,
}

// ── Containers ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerContainerPort {
    pub ip: Option<String>,
    pub private_port: u16,
    pub public_port: Option<u16>,
    #[serde(rename = "type")]
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerContainer {
    pub id: String,
    /// Docker names with the leading `/` stripped.
    pub names: Vec<String>,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: Vec<PortainerContainerPort>,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerLogLine {
    /// `stdout`, `stderr` or `stdin` (raw TTY output is reported as `stdout`).
    pub stream: String,
    pub text: String,
}

// ── Stacks ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortainerStack {
    pub id: u64,
    pub name: String,
    /// 1 = Swarm, 2 = Compose, 3 = Kubernetes. Wire name is `type` — the panel
    /// reads `s.type`.
    #[serde(rename = "type")]
    pub stack_type: u32,
    pub endpoint_id: u64,
    /// 1 = active, 2 = inactive.
    pub status: u32,
}
