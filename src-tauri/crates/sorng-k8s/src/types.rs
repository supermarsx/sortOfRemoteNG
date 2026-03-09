// ── sorng-k8s/src/types.rs ──────────────────────────────────────────────────
//! Comprehensive Kubernetes type definitions covering kubeconfig, clusters,
//! namespaces, pods, deployments, services, configmaps, secrets, ingress,
//! jobs, nodes, RBAC, Helm, events, and metrics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Kubeconfig & Cluster Connection ────────────────────────────────────────

/// Top-level kubeconfig representation (mirrors ~/.kube/config).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kubeconfig {
    pub api_version: String,
    pub kind: String,
    pub current_context: String,
    pub clusters: Vec<KubeconfigCluster>,
    pub contexts: Vec<KubeconfigContext>,
    pub users: Vec<KubeconfigUser>,
    pub preferences: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeconfigCluster {
    pub name: String,
    pub cluster: ClusterEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterEndpoint {
    pub server: String,
    pub certificate_authority: Option<String>,
    pub certificate_authority_data: Option<String>,
    pub insecure_skip_tls_verify: Option<bool>,
    pub proxy_url: Option<String>,
    pub tls_server_name: Option<String>,
    pub disable_compression: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeconfigContext {
    pub name: String,
    pub context: ContextSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSpec {
    pub cluster: String,
    pub user: String,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeconfigUser {
    pub name: String,
    pub user: UserCredentials,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCredentials {
    pub client_certificate: Option<String>,
    pub client_certificate_data: Option<String>,
    pub client_key: Option<String>,
    pub client_key_data: Option<String>,
    pub token: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub exec: Option<ExecCredentialConfig>,
    pub auth_provider: Option<AuthProviderConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecCredentialConfig {
    pub api_version: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub env: Option<Vec<ExecEnvVar>>,
    pub install_hint: Option<String>,
    pub provide_cluster_info: Option<bool>,
    pub interactive_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecEnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProviderConfig {
    pub name: String,
    pub config: HashMap<String, String>,
}

/// App-level connection configuration for a K8s cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sConnectionConfig {
    pub id: String,
    pub name: String,
    pub kubeconfig_path: Option<String>,
    pub kubeconfig_inline: Option<String>,
    pub context_name: Option<String>,
    pub api_server_url: Option<String>,
    pub auth_method: K8sAuthMethod,
    pub namespace: Option<String>,
    pub tls_config: Option<K8sTlsConfig>,
    pub proxy_url: Option<String>,
    pub request_timeout_secs: Option<u64>,
    pub watch_timeout_secs: Option<u64>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum K8sAuthMethod {
    Kubeconfig,
    Token(String),
    ClientCertificate {
        cert_data: String,
        key_data: String,
    },
    BasicAuth {
        username: String,
        password: String,
    },
    ExecCredential(ExecCredentialConfig),
    OidcProvider {
        issuer_url: String,
        client_id: String,
        client_secret: Option<String>,
        refresh_token: Option<String>,
    },
    AwsIamAuthenticator {
        cluster_id: String,
        role_arn: Option<String>,
        profile: Option<String>,
    },
    GcpAuthProvider {
        project_id: Option<String>,
        access_token: Option<String>,
    },
    AzureAuthProvider {
        tenant_id: Option<String>,
        client_id: Option<String>,
    },
    ServiceAccount {
        token_path: String,
        ca_path: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sTlsConfig {
    pub ca_cert_data: Option<String>,
    pub ca_cert_path: Option<String>,
    pub client_cert_data: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_data: Option<String>,
    pub client_key_path: Option<String>,
    pub insecure_skip_verify: bool,
    pub server_name: Option<String>,
}

// ─── Cluster Info ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterInfo {
    pub name: String,
    pub server_url: String,
    pub version: Option<K8sVersion>,
    pub platform: Option<String>,
    pub node_count: usize,
    pub namespace_count: usize,
    pub status: ClusterStatus,
    pub api_resources: Vec<ApiResource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sVersion {
    pub major: String,
    pub minor: String,
    pub git_version: String,
    pub git_commit: String,
    pub build_date: String,
    pub platform: String,
    pub go_version: String,
    pub compiler: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClusterStatus {
    Connected,
    Disconnected,
    Unreachable,
    AuthError,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResource {
    pub name: String,
    pub singular_name: String,
    pub namespaced: bool,
    pub kind: String,
    pub group: String,
    pub version: String,
    pub verbs: Vec<String>,
    pub short_names: Vec<String>,
}

// ─── ObjectMeta (shared across all resources) ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObjectMeta {
    pub name: String,
    pub namespace: Option<String>,
    pub uid: Option<String>,
    pub resource_version: Option<String>,
    pub generation: Option<i64>,
    pub creation_timestamp: Option<DateTime<Utc>>,
    pub deletion_timestamp: Option<DateTime<Utc>>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub owner_references: Vec<OwnerReference>,
    pub finalizers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerReference {
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub uid: String,
    pub controller: Option<bool>,
    pub block_owner_deletion: Option<bool>,
}

/// Generic label selector.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LabelSelector {
    pub match_labels: HashMap<String, String>,
    pub match_expressions: Vec<LabelSelectorRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelSelectorRequirement {
    pub key: String,
    pub operator: String, // In, NotIn, Exists, DoesNotExist
    pub values: Vec<String>,
}

// ─── Namespace ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamespaceInfo {
    pub metadata: ObjectMeta,
    pub phase: NamespacePhase,
    pub conditions: Vec<NamespaceCondition>,
    pub resource_quota: Option<ResourceQuotaInfo>,
    pub limit_range: Option<LimitRangeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NamespacePhase {
    Active,
    Terminating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamespaceCondition {
    pub condition_type: String,
    pub status: String,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNamespaceConfig {
    pub name: String,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

// ─── Resource Quotas & Limit Ranges ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceQuotaInfo {
    pub metadata: ObjectMeta,
    pub hard: HashMap<String, String>,
    pub used: HashMap<String, String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitRangeInfo {
    pub metadata: ObjectMeta,
    pub limits: Vec<LimitRangeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitRangeItem {
    pub limit_type: String, // Pod, Container, PersistentVolumeClaim
    pub max: HashMap<String, String>,
    pub min: HashMap<String, String>,
    pub default: HashMap<String, String>,
    pub default_request: HashMap<String, String>,
    pub max_limit_request_ratio: HashMap<String, String>,
}

// ─── Pod ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodInfo {
    pub metadata: ObjectMeta,
    pub spec: PodSpec,
    pub status: PodStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodSpec {
    pub containers: Vec<ContainerSpec>,
    pub init_containers: Vec<ContainerSpec>,
    pub ephemeral_containers: Vec<EphemeralContainerSpec>,
    pub volumes: Vec<Volume>,
    pub node_name: Option<String>,
    pub node_selector: HashMap<String, String>,
    pub service_account_name: Option<String>,
    pub automount_service_account_token: Option<bool>,
    pub host_network: Option<bool>,
    pub host_pid: Option<bool>,
    pub host_ipc: Option<bool>,
    pub dns_policy: Option<String>,
    pub dns_config: Option<PodDnsConfig>,
    pub tolerations: Vec<Toleration>,
    pub affinity: Option<Affinity>,
    pub restart_policy: Option<String>,
    pub termination_grace_period_seconds: Option<i64>,
    pub active_deadline_seconds: Option<i64>,
    pub priority_class_name: Option<String>,
    pub priority: Option<i32>,
    pub scheduler_name: Option<String>,
    pub security_context: Option<PodSecurityContext>,
    pub image_pull_secrets: Vec<LocalObjectReference>,
    pub topology_spread_constraints: Vec<TopologySpreadConstraint>,
    pub runtime_class_name: Option<String>,
    pub overhead: HashMap<String, String>,
    pub preemption_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerSpec {
    pub name: String,
    pub image: String,
    pub image_pull_policy: Option<String>,
    pub command: Vec<String>,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub env: Vec<EnvVar>,
    pub env_from: Vec<EnvFromSource>,
    pub ports: Vec<ContainerPort>,
    pub resources: Option<ResourceRequirements>,
    pub volume_mounts: Vec<VolumeMount>,
    pub liveness_probe: Option<Probe>,
    pub readiness_probe: Option<Probe>,
    pub startup_probe: Option<Probe>,
    pub lifecycle: Option<Lifecycle>,
    pub security_context: Option<SecurityContext>,
    pub stdin: Option<bool>,
    pub stdin_once: Option<bool>,
    pub tty: Option<bool>,
    pub termination_message_path: Option<String>,
    pub termination_message_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EphemeralContainerSpec {
    pub name: String,
    pub image: String,
    pub command: Vec<String>,
    pub args: Vec<String>,
    pub env: Vec<EnvVar>,
    pub target_container_name: Option<String>,
    pub security_context: Option<SecurityContext>,
    pub stdin: Option<bool>,
    pub tty: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub name: String,
    pub value: Option<String>,
    pub value_from: Option<EnvVarSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVarSource {
    pub config_map_key_ref: Option<ConfigMapKeyRef>,
    pub secret_key_ref: Option<SecretKeyRef>,
    pub field_ref: Option<ObjectFieldSelector>,
    pub resource_field_ref: Option<ResourceFieldSelector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMapKeyRef {
    pub name: String,
    pub key: String,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretKeyRef {
    pub name: String,
    pub key: String,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectFieldSelector {
    pub api_version: Option<String>,
    pub field_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceFieldSelector {
    pub container_name: Option<String>,
    pub resource: String,
    pub divisor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvFromSource {
    pub prefix: Option<String>,
    pub config_map_ref: Option<ConfigMapEnvSource>,
    pub secret_ref: Option<SecretEnvSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMapEnvSource {
    pub name: String,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEnvSource {
    pub name: String,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerPort {
    pub name: Option<String>,
    pub container_port: u16,
    pub host_port: Option<u16>,
    pub host_ip: Option<String>,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRequirements {
    pub limits: HashMap<String, String>,
    pub requests: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeMount {
    pub name: String,
    pub mount_path: String,
    pub sub_path: Option<String>,
    pub sub_path_expr: Option<String>,
    pub read_only: Option<bool>,
    pub mount_propagation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volume {
    pub name: String,
    pub volume_source: VolumeSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VolumeSource {
    EmptyDir {
        medium: Option<String>,
        size_limit: Option<String>,
    },
    HostPath {
        path: String,
        host_path_type: Option<String>,
    },
    ConfigMap {
        name: String,
        items: Vec<KeyToPath>,
        optional: Option<bool>,
    },
    Secret {
        secret_name: String,
        items: Vec<KeyToPath>,
        optional: Option<bool>,
    },
    PersistentVolumeClaim {
        claim_name: String,
        read_only: Option<bool>,
    },
    Projected {
        sources: Vec<ProjectedVolumeSource>,
    },
    Nfs {
        server: String,
        path: String,
        read_only: Option<bool>,
    },
    Csi {
        driver: String,
        read_only: Option<bool>,
        volume_attributes: HashMap<String, String>,
    },
    Downward {
        items: Vec<DownwardApiVolumeFile>,
    },
    Unknown(serde_json::Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyToPath {
    pub key: String,
    pub path: String,
    pub mode: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectedVolumeSource {
    pub secret: Option<SecretProjection>,
    pub config_map: Option<ConfigMapProjection>,
    pub downward_api: Option<DownwardApiProjection>,
    pub service_account_token: Option<ServiceAccountTokenProjection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretProjection {
    pub name: String,
    pub items: Vec<KeyToPath>,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMapProjection {
    pub name: String,
    pub items: Vec<KeyToPath>,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownwardApiProjection {
    pub items: Vec<DownwardApiVolumeFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownwardApiVolumeFile {
    pub path: String,
    pub field_ref: Option<ObjectFieldSelector>,
    pub resource_field_ref: Option<ResourceFieldSelector>,
    pub mode: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAccountTokenProjection {
    pub audience: Option<String>,
    pub expiration_seconds: Option<i64>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Probe {
    pub http_get: Option<HttpGetAction>,
    pub tcp_socket: Option<TcpSocketAction>,
    pub exec: Option<ExecAction>,
    pub grpc: Option<GrpcAction>,
    pub initial_delay_seconds: Option<i32>,
    pub timeout_seconds: Option<i32>,
    pub period_seconds: Option<i32>,
    pub success_threshold: Option<i32>,
    pub failure_threshold: Option<i32>,
    pub termination_grace_period_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpGetAction {
    pub path: String,
    pub port: u16,
    pub host: Option<String>,
    pub scheme: Option<String>,
    pub http_headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpSocketAction {
    pub port: u16,
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecAction {
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcAction {
    pub port: u16,
    pub service: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lifecycle {
    pub post_start: Option<LifecycleHandler>,
    pub pre_stop: Option<LifecycleHandler>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleHandler {
    pub exec: Option<ExecAction>,
    pub http_get: Option<HttpGetAction>,
    pub tcp_socket: Option<TcpSocketAction>,
    pub sleep: Option<SleepAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SleepAction {
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityContext {
    pub run_as_user: Option<i64>,
    pub run_as_group: Option<i64>,
    pub run_as_non_root: Option<bool>,
    pub read_only_root_filesystem: Option<bool>,
    pub allow_privilege_escalation: Option<bool>,
    pub privileged: Option<bool>,
    pub capabilities: Option<Capabilities>,
    pub se_linux_options: Option<SeLinuxOptions>,
    pub seccomp_profile: Option<SeccompProfile>,
    pub proc_mount: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodSecurityContext {
    pub run_as_user: Option<i64>,
    pub run_as_group: Option<i64>,
    pub run_as_non_root: Option<bool>,
    pub fs_group: Option<i64>,
    pub fs_group_change_policy: Option<String>,
    pub supplemental_groups: Vec<i64>,
    pub se_linux_options: Option<SeLinuxOptions>,
    pub seccomp_profile: Option<SeccompProfile>,
    pub sysctls: Vec<Sysctl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub add: Vec<String>,
    pub drop: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeLinuxOptions {
    pub user: Option<String>,
    pub role: Option<String>,
    pub se_type: Option<String>,
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeccompProfile {
    pub profile_type: String, // RuntimeDefault, Localhost, Unconfined
    pub localhost_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sysctl {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodDnsConfig {
    pub nameservers: Vec<String>,
    pub searches: Vec<String>,
    pub options: Vec<PodDnsOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodDnsOption {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Toleration {
    pub key: Option<String>,
    pub operator: Option<String>,
    pub value: Option<String>,
    pub effect: Option<String>,
    pub toleration_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affinity {
    pub node_affinity: Option<serde_json::Value>,
    pub pod_affinity: Option<serde_json::Value>,
    pub pod_anti_affinity: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalObjectReference {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologySpreadConstraint {
    pub max_skew: i32,
    pub topology_key: String,
    pub when_unsatisfiable: String,
    pub label_selector: Option<LabelSelector>,
    pub min_domains: Option<i32>,
    pub node_affinity_policy: Option<String>,
    pub node_taints_policy: Option<String>,
    pub match_label_keys: Vec<String>,
}

// ─── Pod Status ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodStatus {
    pub phase: PodPhase,
    pub conditions: Vec<PodCondition>,
    pub host_ip: Option<String>,
    pub pod_ip: Option<String>,
    pub pod_ips: Vec<PodIp>,
    pub start_time: Option<DateTime<Utc>>,
    pub container_statuses: Vec<ContainerStatus>,
    pub init_container_statuses: Vec<ContainerStatus>,
    pub ephemeral_container_statuses: Vec<ContainerStatus>,
    pub qos_class: Option<String>,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub nominated_node_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PodPhase {
    Pending,
    Running,
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodCondition {
    pub condition_type: String,
    pub status: String,
    pub last_probe_time: Option<DateTime<Utc>>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodIp {
    pub ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerStatus {
    pub name: String,
    pub ready: bool,
    pub started: Option<bool>,
    pub restart_count: i32,
    pub image: String,
    pub image_id: String,
    pub container_id: Option<String>,
    pub state: Option<ContainerState>,
    pub last_state: Option<ContainerState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContainerState {
    Waiting {
        reason: Option<String>,
        message: Option<String>,
    },
    Running {
        started_at: Option<DateTime<Utc>>,
    },
    Terminated {
        exit_code: i32,
        signal: Option<i32>,
        reason: Option<String>,
        message: Option<String>,
        started_at: Option<DateTime<Utc>>,
        finished_at: Option<DateTime<Utc>>,
        container_id: Option<String>,
    },
}

// ─── Pod Operations ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PodLogOptions {
    pub container: Option<String>,
    pub follow: bool,
    pub tail_lines: Option<i64>,
    pub since_seconds: Option<i64>,
    pub since_time: Option<DateTime<Utc>>,
    pub timestamps: bool,
    pub previous: bool,
    pub limit_bytes: Option<i64>,
    pub insecure_skip_tls_verify_backend: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodExecOptions {
    pub container: Option<String>,
    pub command: Vec<String>,
    pub stdin: bool,
    pub stdout: bool,
    pub stderr: bool,
    pub tty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardRequest {
    pub pod_name: String,
    pub namespace: String,
    pub ports: Vec<PortForwardMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardMapping {
    pub local_port: u16,
    pub remote_port: u16,
    pub local_address: Option<String>,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardSession {
    pub id: String,
    pub pod_name: String,
    pub namespace: String,
    pub mappings: Vec<PortForwardMapping>,
    pub status: PortForwardStatus,
    pub started_at: DateTime<Utc>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PortForwardStatus {
    Active,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecSession {
    pub id: String,
    pub pod_name: String,
    pub namespace: String,
    pub container: Option<String>,
    pub command: Vec<String>,
    pub status: ExecSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExecSessionStatus {
    Running,
    Completed,
    Error,
}

// ─── Deployment ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentInfo {
    pub metadata: ObjectMeta,
    pub spec: DeploymentSpec,
    pub status: DeploymentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentSpec {
    pub replicas: Option<i32>,
    pub selector: LabelSelector,
    pub strategy: Option<DeploymentStrategy>,
    pub min_ready_seconds: Option<i32>,
    pub revision_history_limit: Option<i32>,
    pub progress_deadline_seconds: Option<i32>,
    pub paused: Option<bool>,
    pub template: PodTemplateSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodTemplateSpec {
    pub metadata: ObjectMeta,
    pub spec: PodSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStrategy {
    pub strategy_type: String, // RollingUpdate, Recreate
    pub rolling_update: Option<RollingUpdateDeployment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollingUpdateDeployment {
    pub max_unavailable: Option<String>,
    pub max_surge: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStatus {
    pub observed_generation: Option<i64>,
    pub replicas: Option<i32>,
    pub updated_replicas: Option<i32>,
    pub ready_replicas: Option<i32>,
    pub available_replicas: Option<i32>,
    pub unavailable_replicas: Option<i32>,
    pub conditions: Vec<DeploymentCondition>,
    pub collision_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentCondition {
    pub condition_type: String,
    pub status: String,
    pub last_update_time: Option<DateTime<Utc>>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDeploymentConfig {
    pub name: String,
    pub namespace: String,
    pub replicas: i32,
    pub image: String,
    pub container_name: Option<String>,
    pub container_port: Option<u16>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub env: Vec<EnvVar>,
    pub resources: Option<ResourceRequirements>,
    pub strategy: Option<DeploymentStrategy>,
    pub command: Vec<String>,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleConfig {
    pub replicas: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolloutInfo {
    pub revision: i64,
    pub status: String,
    pub desired_replicas: i32,
    pub current_replicas: i32,
    pub ready_replicas: i32,
    pub updated_replicas: i32,
    pub conditions: Vec<DeploymentCondition>,
}

// ─── StatefulSet ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatefulSetInfo {
    pub metadata: ObjectMeta,
    pub replicas: Option<i32>,
    pub ready_replicas: Option<i32>,
    pub current_replicas: Option<i32>,
    pub updated_replicas: Option<i32>,
    pub current_revision: Option<String>,
    pub update_revision: Option<String>,
    pub collision_count: Option<i32>,
    pub service_name: String,
    pub pod_management_policy: Option<String>,
    pub update_strategy: Option<String>,
}

// ─── DaemonSet ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonSetInfo {
    pub metadata: ObjectMeta,
    pub desired_number_scheduled: i32,
    pub current_number_scheduled: i32,
    pub number_ready: i32,
    pub number_available: Option<i32>,
    pub number_unavailable: Option<i32>,
    pub updated_number_scheduled: Option<i32>,
    pub number_misscheduled: i32,
    pub update_strategy: Option<String>,
}

// ─── ReplicaSet ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicaSetInfo {
    pub metadata: ObjectMeta,
    pub replicas: Option<i32>,
    pub ready_replicas: Option<i32>,
    pub available_replicas: Option<i32>,
    pub fully_labeled_replicas: Option<i32>,
    pub observed_generation: Option<i64>,
}

// ─── Service ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub metadata: ObjectMeta,
    pub spec: ServiceSpec,
    pub status: Option<ServiceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSpec {
    pub service_type: ServiceType,
    pub cluster_ip: Option<String>,
    pub cluster_ips: Vec<String>,
    pub external_ips: Vec<String>,
    pub external_name: Option<String>,
    pub external_traffic_policy: Option<String>,
    pub internal_traffic_policy: Option<String>,
    pub load_balancer_ip: Option<String>,
    pub load_balancer_source_ranges: Vec<String>,
    pub load_balancer_class: Option<String>,
    pub ports: Vec<ServicePort>,
    pub selector: HashMap<String, String>,
    pub session_affinity: Option<String>,
    pub session_affinity_config: Option<SessionAffinityConfig>,
    pub ip_families: Vec<String>,
    pub ip_family_policy: Option<String>,
    pub allocate_load_balancer_node_ports: Option<bool>,
    pub health_check_node_port: Option<i32>,
    pub publish_not_ready_addresses: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceType {
    ClusterIP,
    NodePort,
    LoadBalancer,
    ExternalName,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicePort {
    pub name: Option<String>,
    pub port: i32,
    pub target_port: Option<String>,
    pub node_port: Option<i32>,
    pub protocol: Option<String>,
    pub app_protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionAffinityConfig {
    pub client_ip: Option<ClientIpConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientIpConfig {
    pub timeout_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub load_balancer: Option<LoadBalancerStatus>,
    pub conditions: Vec<ServiceCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerStatus {
    pub ingress: Vec<LoadBalancerIngress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerIngress {
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub ports: Vec<PortStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortStatus {
    pub port: i32,
    pub protocol: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCondition {
    pub condition_type: String,
    pub status: String,
    pub observed_generation: Option<i64>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServiceConfig {
    pub name: String,
    pub namespace: String,
    pub service_type: ServiceType,
    pub ports: Vec<ServicePort>,
    pub selector: HashMap<String, String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub external_ips: Vec<String>,
    pub load_balancer_ip: Option<String>,
    pub session_affinity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointInfo {
    pub metadata: ObjectMeta,
    pub subsets: Vec<EndpointSubset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointSubset {
    pub addresses: Vec<EndpointAddress>,
    pub not_ready_addresses: Vec<EndpointAddress>,
    pub ports: Vec<EndpointPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointAddress {
    pub ip: String,
    pub hostname: Option<String>,
    pub node_name: Option<String>,
    pub target_ref: Option<ObjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectReference {
    pub kind: Option<String>,
    pub name: Option<String>,
    pub namespace: Option<String>,
    pub uid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointPort {
    pub name: Option<String>,
    pub port: i32,
    pub protocol: Option<String>,
    pub app_protocol: Option<String>,
}

// ─── ConfigMap ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigMapInfo {
    pub metadata: ObjectMeta,
    pub data: HashMap<String, String>,
    pub binary_data: HashMap<String, String>, // base64-encoded
    pub immutable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConfigMapConfig {
    pub name: String,
    pub namespace: String,
    pub data: HashMap<String, String>,
    pub binary_data: HashMap<String, String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub immutable: Option<bool>,
}

// ─── Secret ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretInfo {
    pub metadata: ObjectMeta,
    pub secret_type: SecretType,
    pub data: HashMap<String, String>, // base64-encoded
    pub string_data: HashMap<String, String>,
    pub immutable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SecretType {
    Opaque,
    ServiceAccountToken,
    DockerConfigJson,
    DockerConfig,
    BasicAuth,
    SshAuth,
    Tls,
    BootstrapToken,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSecretConfig {
    pub name: String,
    pub namespace: String,
    pub secret_type: SecretType,
    pub data: HashMap<String, String>,
    pub string_data: HashMap<String, String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub immutable: Option<bool>,
}

// ─── Ingress ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressInfo {
    pub metadata: ObjectMeta,
    pub spec: IngressSpec,
    pub status: Option<IngressStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressSpec {
    pub ingress_class_name: Option<String>,
    pub default_backend: Option<IngressBackend>,
    pub tls: Vec<IngressTls>,
    pub rules: Vec<IngressRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressBackend {
    pub service: Option<IngressServiceBackend>,
    pub resource: Option<TypedLocalObjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressServiceBackend {
    pub name: String,
    pub port: IngressServiceBackendPort,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressServiceBackendPort {
    pub name: Option<String>,
    pub number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedLocalObjectReference {
    pub api_group: Option<String>,
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressTls {
    pub hosts: Vec<String>,
    pub secret_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressRule {
    pub host: Option<String>,
    pub http: Option<HttpIngressRuleValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpIngressRuleValue {
    pub paths: Vec<HttpIngressPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpIngressPath {
    pub path: String,
    pub path_type: String, // Prefix, Exact, ImplementationSpecific
    pub backend: IngressBackend,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressStatus {
    pub load_balancer: Option<LoadBalancerStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressClassInfo {
    pub metadata: ObjectMeta,
    pub controller: String,
    pub is_default: bool,
    pub parameters: Option<IngressClassParameters>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressClassParameters {
    pub api_group: Option<String>,
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIngressConfig {
    pub name: String,
    pub namespace: String,
    pub ingress_class_name: Option<String>,
    pub default_backend: Option<IngressBackend>,
    pub tls: Vec<IngressTls>,
    pub rules: Vec<IngressRule>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

// ─── Job ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobInfo {
    pub metadata: ObjectMeta,
    pub spec: JobSpec,
    pub status: JobStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub parallelism: Option<i32>,
    pub completions: Option<i32>,
    pub active_deadline_seconds: Option<i64>,
    pub pod_failure_policy: Option<serde_json::Value>,
    pub backoff_limit: Option<i32>,
    pub backoff_limit_per_index: Option<i32>,
    pub max_failed_indexes: Option<i32>,
    pub completion_mode: Option<String>,
    pub suspend: Option<bool>,
    pub ttl_seconds_after_finished: Option<i32>,
    pub template: PodTemplateSpec,
    pub selector: Option<LabelSelector>,
    pub manual_selector: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatus {
    pub conditions: Vec<JobCondition>,
    pub start_time: Option<DateTime<Utc>>,
    pub completion_time: Option<DateTime<Utc>>,
    pub active: Option<i32>,
    pub succeeded: Option<i32>,
    pub failed: Option<i32>,
    pub terminating: Option<i32>,
    pub completed_indexes: Option<String>,
    pub failed_indexes: Option<String>,
    pub ready: Option<i32>,
    pub uncounted_terminated_pods: Option<UncountedTerminatedPods>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobCondition {
    pub condition_type: String,
    pub status: String,
    pub last_probe_time: Option<DateTime<Utc>>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UncountedTerminatedPods {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobConfig {
    pub name: String,
    pub namespace: String,
    pub image: String,
    pub command: Vec<String>,
    pub args: Vec<String>,
    pub parallelism: Option<i32>,
    pub completions: Option<i32>,
    pub backoff_limit: Option<i32>,
    pub active_deadline_seconds: Option<i64>,
    pub ttl_seconds_after_finished: Option<i32>,
    pub restart_policy: Option<String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub env: Vec<EnvVar>,
    pub resources: Option<ResourceRequirements>,
}

// ─── CronJob ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJobInfo {
    pub metadata: ObjectMeta,
    pub schedule: String,
    pub time_zone: Option<String>,
    pub concurrency_policy: Option<String>, // Allow, Forbid, Replace
    pub suspend: Option<bool>,
    pub starting_deadline_seconds: Option<i64>,
    pub successful_jobs_history_limit: Option<i32>,
    pub failed_jobs_history_limit: Option<i32>,
    pub last_schedule_time: Option<DateTime<Utc>>,
    pub last_successful_time: Option<DateTime<Utc>>,
    pub active: Vec<ObjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCronJobConfig {
    pub name: String,
    pub namespace: String,
    pub schedule: String,
    pub time_zone: Option<String>,
    pub image: String,
    pub command: Vec<String>,
    pub args: Vec<String>,
    pub concurrency_policy: Option<String>,
    pub suspend: Option<bool>,
    pub starting_deadline_seconds: Option<i64>,
    pub successful_jobs_history_limit: Option<i32>,
    pub failed_jobs_history_limit: Option<i32>,
    pub backoff_limit: Option<i32>,
    pub active_deadline_seconds: Option<i64>,
    pub restart_policy: Option<String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub env: Vec<EnvVar>,
    pub resources: Option<ResourceRequirements>,
}

// ─── Node ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub metadata: ObjectMeta,
    pub spec: NodeSpec,
    pub status: NodeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSpec {
    pub pod_cidr: Option<String>,
    pub pod_cidrs: Vec<String>,
    pub provider_id: Option<String>,
    pub unschedulable: Option<bool>,
    pub taints: Vec<Taint>,
    pub config_source: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Taint {
    pub key: String,
    pub value: Option<String>,
    pub effect: String, // NoSchedule, PreferNoSchedule, NoExecute
    pub time_added: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub capacity: HashMap<String, String>,
    pub allocatable: HashMap<String, String>,
    pub conditions: Vec<NodeCondition>,
    pub addresses: Vec<NodeAddress>,
    pub daemon_endpoints: Option<NodeDaemonEndpoints>,
    pub node_info: Option<NodeSystemInfo>,
    pub images: Vec<NodeImage>,
    pub volumes_in_use: Vec<String>,
    pub volumes_attached: Vec<AttachedVolume>,
    pub phase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCondition {
    pub condition_type: String,
    pub status: String,
    pub last_heartbeat_time: Option<DateTime<Utc>>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeAddress {
    pub address_type: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDaemonEndpoints {
    pub kubelet_endpoint: Option<DaemonEndpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonEndpoint {
    pub port: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSystemInfo {
    pub machine_id: String,
    pub system_uuid: String,
    pub boot_id: String,
    pub kernel_version: String,
    pub os_image: String,
    pub container_runtime_version: String,
    pub kubelet_version: String,
    pub kube_proxy_version: String,
    pub operating_system: String,
    pub architecture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeImage {
    pub names: Vec<String>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedVolume {
    pub name: String,
    pub device_path: String,
}

// ─── PersistentVolume / PersistentVolumeClaim ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentVolumeInfo {
    pub metadata: ObjectMeta,
    pub capacity: HashMap<String, String>,
    pub access_modes: Vec<String>,
    pub reclaim_policy: Option<String>,
    pub storage_class_name: Option<String>,
    pub volume_mode: Option<String>,
    pub claim_ref: Option<ObjectReference>,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub mount_options: Vec<String>,
    pub node_affinity: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentVolumeClaimInfo {
    pub metadata: ObjectMeta,
    pub access_modes: Vec<String>,
    pub storage_class_name: Option<String>,
    pub volume_name: Option<String>,
    pub volume_mode: Option<String>,
    pub resources: Option<ResourceRequirements>,
    pub phase: Option<String>,
    pub capacity: HashMap<String, String>,
    pub conditions: Vec<PvcCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PvcCondition {
    pub condition_type: String,
    pub status: String,
    pub last_probe_time: Option<DateTime<Utc>>,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageClassInfo {
    pub metadata: ObjectMeta,
    pub provisioner: String,
    pub parameters: HashMap<String, String>,
    pub reclaim_policy: Option<String>,
    pub mount_options: Vec<String>,
    pub allow_volume_expansion: Option<bool>,
    pub volume_binding_mode: Option<String>,
    pub allowed_topologies: Vec<serde_json::Value>,
    pub is_default: bool,
}

// ─── RBAC ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleInfo {
    pub metadata: ObjectMeta,
    pub rules: Vec<PolicyRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterRoleInfo {
    pub metadata: ObjectMeta,
    pub rules: Vec<PolicyRule>,
    pub aggregation_rule: Option<AggregationRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub verbs: Vec<String>,
    pub api_groups: Vec<String>,
    pub resources: Vec<String>,
    pub resource_names: Vec<String>,
    pub non_resource_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregationRule {
    pub cluster_role_selectors: Vec<LabelSelector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleBindingInfo {
    pub metadata: ObjectMeta,
    pub subjects: Vec<RbacSubject>,
    pub role_ref: RoleRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterRoleBindingInfo {
    pub metadata: ObjectMeta,
    pub subjects: Vec<RbacSubject>,
    pub role_ref: RoleRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RbacSubject {
    pub kind: String, // User, Group, ServiceAccount
    pub name: String,
    pub namespace: Option<String>,
    pub api_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleRef {
    pub api_group: String,
    pub kind: String, // Role, ClusterRole
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAccountInfo {
    pub metadata: ObjectMeta,
    pub automount_service_account_token: Option<bool>,
    pub secrets: Vec<ObjectReference>,
    pub image_pull_secrets: Vec<LocalObjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleConfig {
    pub name: String,
    pub namespace: String,
    pub rules: Vec<PolicyRule>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateClusterRoleConfig {
    pub name: String,
    pub rules: Vec<PolicyRule>,
    pub aggregation_rule: Option<AggregationRule>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleBindingConfig {
    pub name: String,
    pub namespace: String,
    pub subjects: Vec<RbacSubject>,
    pub role_ref: RoleRef,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateClusterRoleBindingConfig {
    pub name: String,
    pub subjects: Vec<RbacSubject>,
    pub role_ref: RoleRef,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServiceAccountConfig {
    pub name: String,
    pub namespace: String,
    pub automount_service_account_token: Option<bool>,
    pub image_pull_secrets: Vec<String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
}

// ─── Helm ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmRelease {
    pub name: String,
    pub namespace: String,
    pub revision: i32,
    pub updated: String,
    pub status: HelmReleaseStatus,
    pub chart: String,
    pub chart_version: String,
    pub app_version: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub values: serde_json::Value,
    pub manifest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HelmReleaseStatus {
    Deployed,
    Uninstalled,
    Superseded,
    Failed,
    Uninstalling,
    PendingInstall,
    PendingUpgrade,
    PendingRollback,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmRepository {
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ca_file: Option<String>,
    pub cert_file: Option<String>,
    pub key_file: Option<String>,
    pub insecure_skip_tls_verify: Option<bool>,
    pub pass_credentials_all: Option<bool>,
    pub oci: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmChart {
    pub name: String,
    pub version: String,
    pub app_version: Option<String>,
    pub description: Option<String>,
    pub home: Option<String>,
    pub icon: Option<String>,
    pub keywords: Vec<String>,
    pub maintainers: Vec<HelmMaintainer>,
    pub sources: Vec<String>,
    pub urls: Vec<String>,
    pub created: Option<String>,
    pub deprecated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmMaintainer {
    pub name: String,
    pub email: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmInstallConfig {
    pub release_name: String,
    pub chart: String,
    pub version: Option<String>,
    pub namespace: String,
    pub create_namespace: bool,
    pub values: serde_json::Value,
    pub values_files: Vec<String>,
    pub set_values: HashMap<String, String>,
    pub wait: bool,
    pub wait_for_jobs: bool,
    pub timeout_secs: Option<u64>,
    pub atomic: bool,
    pub dry_run: bool,
    pub description: Option<String>,
    pub dependency_update: bool,
    pub disable_openapi_validation: bool,
    pub no_hooks: bool,
    pub skip_crds: bool,
    pub render_subchart_notes: bool,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmUpgradeConfig {
    pub release_name: String,
    pub chart: String,
    pub version: Option<String>,
    pub namespace: String,
    pub values: serde_json::Value,
    pub values_files: Vec<String>,
    pub set_values: HashMap<String, String>,
    pub wait: bool,
    pub wait_for_jobs: bool,
    pub timeout_secs: Option<u64>,
    pub atomic: bool,
    pub dry_run: bool,
    pub install: bool, // --install flag
    pub force: bool,
    pub reset_values: bool,
    pub reuse_values: bool,
    pub cleanup_on_fail: bool,
    pub no_hooks: bool,
    pub description: Option<String>,
    pub max_history: Option<i32>,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmRollbackConfig {
    pub release_name: String,
    pub namespace: String,
    pub revision: i32,
    pub wait: bool,
    pub timeout_secs: Option<u64>,
    pub no_hooks: bool,
    pub force: bool,
    pub recreate_pods: bool,
    pub cleanup_on_fail: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmUninstallConfig {
    pub release_name: String,
    pub namespace: String,
    pub keep_history: bool,
    pub no_hooks: bool,
    pub timeout_secs: Option<u64>,
    pub dry_run: bool,
    pub description: Option<String>,
    pub wait: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmHistory {
    pub revision: i32,
    pub updated: String,
    pub status: HelmReleaseStatus,
    pub chart: String,
    pub app_version: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelmTemplateConfig {
    pub release_name: String,
    pub chart: String,
    pub version: Option<String>,
    pub namespace: String,
    pub values: serde_json::Value,
    pub set_values: HashMap<String, String>,
    pub show_only: Vec<String>,
    pub api_versions: Vec<String>,
    pub kube_version: Option<String>,
    pub validate: bool,
    pub include_crds: bool,
    pub skip_tests: bool,
}

// ─── Events ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sEvent {
    pub metadata: ObjectMeta,
    pub involved_object: ObjectReference,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub source: Option<EventSource>,
    pub event_type: Option<String>, // Normal, Warning
    pub first_timestamp: Option<DateTime<Utc>>,
    pub last_timestamp: Option<DateTime<Utc>>,
    pub count: Option<i32>,
    pub action: Option<String>,
    pub reporting_component: Option<String>,
    pub reporting_instance: Option<String>,
    pub series: Option<EventSeries>,
    pub related: Option<ObjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSource {
    pub component: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSeries {
    pub count: i32,
    pub last_observed_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventFilter {
    pub namespace: Option<String>,
    pub involved_object_name: Option<String>,
    pub involved_object_kind: Option<String>,
    pub event_type: Option<String>,
    pub reason: Option<String>,
    pub field_selector: Option<String>,
    pub label_selector: Option<String>,
    pub limit: Option<i64>,
}

// ─── Metrics ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMetrics {
    pub metadata: ObjectMeta,
    pub timestamp: DateTime<Utc>,
    pub window: String,
    pub usage: NodeResourceUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeResourceUsage {
    pub cpu: String,
    pub memory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodMetrics {
    pub metadata: ObjectMeta,
    pub timestamp: DateTime<Utc>,
    pub window: String,
    pub containers: Vec<ContainerMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerMetrics {
    pub name: String,
    pub usage: ContainerResourceUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerResourceUsage {
    pub cpu: String,
    pub memory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterResourceSummary {
    pub total_nodes: usize,
    pub ready_nodes: usize,
    pub total_pods: usize,
    pub running_pods: usize,
    pub total_cpu_capacity: String,
    pub total_cpu_allocatable: String,
    pub total_cpu_usage: Option<String>,
    pub total_memory_capacity: String,
    pub total_memory_allocatable: String,
    pub total_memory_usage: Option<String>,
    pub total_namespaces: usize,
    pub total_deployments: usize,
    pub total_services: usize,
    pub total_persistent_volumes: usize,
}

// ─── HPA (Horizontal Pod Autoscaler) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaInfo {
    pub metadata: ObjectMeta,
    pub min_replicas: Option<i32>,
    pub max_replicas: i32,
    pub current_replicas: i32,
    pub desired_replicas: i32,
    pub target_ref: CrossVersionObjectReference,
    pub metrics: Vec<HpaMetricSpec>,
    pub current_metrics: Vec<HpaMetricStatus>,
    pub conditions: Vec<HpaCondition>,
    pub behavior: Option<HpaBehavior>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossVersionObjectReference {
    pub kind: String,
    pub name: String,
    pub api_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaMetricSpec {
    pub metric_type: String, // Resource, Pods, Object, External, ContainerResource
    pub resource: Option<HpaResourceMetric>,
    pub pods: Option<serde_json::Value>,
    pub object: Option<serde_json::Value>,
    pub external: Option<serde_json::Value>,
    pub container_resource: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaResourceMetric {
    pub name: String,
    pub target_type: String,
    pub target_average_utilization: Option<i32>,
    pub target_average_value: Option<String>,
    pub target_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaMetricStatus {
    pub metric_type: String,
    pub resource: Option<HpaResourceMetricStatus>,
    pub pods: Option<serde_json::Value>,
    pub object: Option<serde_json::Value>,
    pub external: Option<serde_json::Value>,
    pub container_resource: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaResourceMetricStatus {
    pub name: String,
    pub current_average_utilization: Option<i32>,
    pub current_average_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaCondition {
    pub condition_type: String,
    pub status: String,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaBehavior {
    pub scale_up: Option<HpaScalingRules>,
    pub scale_down: Option<HpaScalingRules>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaScalingRules {
    pub stabilization_window_seconds: Option<i32>,
    pub select_policy: Option<String>,
    pub policies: Vec<HpaScalingPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpaScalingPolicy {
    pub policy_type: String,
    pub value: i32,
    pub period_seconds: i32,
}

// ─── NetworkPolicy ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicyInfo {
    pub metadata: ObjectMeta,
    pub pod_selector: LabelSelector,
    pub policy_types: Vec<String>, // Ingress, Egress
    pub ingress: Vec<NetworkPolicyIngressRule>,
    pub egress: Vec<NetworkPolicyEgressRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicyIngressRule {
    pub from: Vec<NetworkPolicyPeer>,
    pub ports: Vec<NetworkPolicyPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicyEgressRule {
    pub to: Vec<NetworkPolicyPeer>,
    pub ports: Vec<NetworkPolicyPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicyPeer {
    pub pod_selector: Option<LabelSelector>,
    pub namespace_selector: Option<LabelSelector>,
    pub ip_block: Option<IpBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpBlock {
    pub cidr: String,
    pub except: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicyPort {
    pub protocol: Option<String>,
    pub port: Option<String>,
    pub end_port: Option<i32>,
}

// ─── Custom Resource Definitions ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdInfo {
    pub metadata: ObjectMeta,
    pub group: String,
    pub names: CrdNames,
    pub scope: String, // Namespaced, Cluster
    pub versions: Vec<CrdVersion>,
    pub conditions: Vec<CrdCondition>,
    pub accepted_names: Option<CrdNames>,
    pub stored_versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdNames {
    pub plural: String,
    pub singular: String,
    pub kind: String,
    pub short_names: Vec<String>,
    pub list_kind: Option<String>,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdVersion {
    pub name: String,
    pub served: bool,
    pub storage: bool,
    pub deprecated: Option<bool>,
    pub deprecation_warning: Option<String>,
    pub schema: Option<serde_json::Value>,
    pub additional_printer_columns: Vec<CrdPrinterColumn>,
    pub subresources: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdPrinterColumn {
    pub name: String,
    pub column_type: String,
    pub json_path: String,
    pub description: Option<String>,
    pub format: Option<String>,
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdCondition {
    pub condition_type: String,
    pub status: String,
    pub last_transition_time: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub message: Option<String>,
}

// ─── Generic / Misc ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sListResponse<T> {
    pub items: Vec<T>,
    pub metadata: ListMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListMeta {
    pub resource_version: Option<String>,
    pub r#continue: Option<String>,
    pub remaining_item_count: Option<i64>,
    pub self_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchEvent<T> {
    pub event_type: WatchEventType,
    pub object: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WatchEventType {
    Added,
    Modified,
    Deleted,
    Bookmark,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sStatus {
    pub api_version: String,
    pub kind: String,
    pub metadata: ListMeta,
    pub status: String,
    pub message: Option<String>,
    pub reason: Option<String>,
    pub details: Option<StatusDetails>,
    pub code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusDetails {
    pub name: Option<String>,
    pub group: Option<String>,
    pub kind: Option<String>,
    pub uid: Option<String>,
    pub causes: Vec<StatusCause>,
    pub retry_after_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusCause {
    pub cause_type: Option<String>,
    pub message: Option<String>,
    pub field: Option<String>,
}

/// Apply (patch) configuration for server-side apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyConfig {
    pub namespace: String,
    pub resource_type: String,
    pub name: String,
    pub manifest: serde_json::Value,
    pub field_manager: Option<String>,
    pub force: bool,
    pub dry_run: bool,
}

/// Generic resource descriptor for raw/custom resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericResource {
    pub api_version: String,
    pub kind: String,
    pub metadata: ObjectMeta,
    pub spec: Option<serde_json::Value>,
    pub status: Option<serde_json::Value>,
    pub data: Option<serde_json::Value>,
}

/// Filter / query parameters for list operations.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListOptions {
    pub label_selector: Option<String>,
    pub field_selector: Option<String>,
    pub limit: Option<i64>,
    pub continue_token: Option<String>,
    pub resource_version: Option<String>,
    pub timeout_seconds: Option<i64>,
    pub watch: bool,
    pub allow_watch_bookmarks: bool,
}

/// Delete options for resource removal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteOptions {
    pub grace_period_seconds: Option<i64>,
    pub propagation_policy: Option<String>, // Orphan, Background, Foreground
    pub preconditions: Option<Preconditions>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preconditions {
    pub uid: Option<String>,
    pub resource_version: Option<String>,
}
