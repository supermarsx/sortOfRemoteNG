// ── TypeScript types for sorng-k8s crate ─────────────────────────────────────

// ── Auth & Connection ─────────────────────────────────────────────────────────

export type K8sAuthMethod =
  | { type: "Kubeconfig"; path?: string; context?: string }
  | { type: "Token"; token: string }
  | { type: "ClientCertificate"; cert_path: string; key_path: string }
  | { type: "BasicAuth"; username: string; password: string }
  | { type: "ExecCredential"; config: ExecCredentialConfig }
  | { type: "OidcProvider"; issuer_url: string; client_id: string; client_secret?: string; refresh_token?: string }
  | { type: "AwsIamAuthenticator"; cluster_name: string; role_arn?: string; profile?: string }
  | { type: "GcpAuthProvider"; access_token?: string; cmd_path?: string }
  | { type: "AzureAuthProvider"; tenant_id?: string; client_id?: string }
  | { type: "ServiceAccount"; token_path?: string };

export interface ExecCredentialConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  api_version?: string;
}

export interface K8sTlsConfig {
  ca_cert_path?: string;
  ca_cert_data?: string;
  client_cert_path?: string;
  client_cert_data?: string;
  client_key_path?: string;
  client_key_data?: string;
  insecure_skip_verify: boolean;
}

export interface K8sConnectionConfig {
  name: string;
  api_server: string;
  auth: K8sAuthMethod;
  tls?: K8sTlsConfig;
  default_namespace?: string;
  proxy_url?: string;
  timeout_seconds?: number;
}

// ── Cluster ───────────────────────────────────────────────────────────────────

export interface ClusterInfo {
  version: K8sVersion;
  platform: string;
  api_server: string;
  status: ClusterStatus;
}

export interface K8sVersion {
  major: string;
  minor: string;
  git_version: string;
  platform: string;
}

export type ClusterStatus = "Healthy" | "Degraded" | "Unknown";

// ── ObjectMeta ────────────────────────────────────────────────────────────────

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  resource_version?: string;
  creation_timestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  owner_references?: OwnerReference[];
  finalizers?: string[];
}

export interface OwnerReference {
  api_version: string;
  kind: string;
  name: string;
  uid: string;
  controller?: boolean;
}

// ── Namespaces ────────────────────────────────────────────────────────────────

export interface NamespaceInfo {
  metadata: ObjectMeta;
  phase: string;
}

export interface CreateNamespaceConfig {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface ResourceQuotaInfo {
  metadata: ObjectMeta;
  hard: Record<string, string>;
  used: Record<string, string>;
}

export interface LimitRangeInfo {
  metadata: ObjectMeta;
  limits: Record<string, unknown>[];
}

// ── Pods ──────────────────────────────────────────────────────────────────────

export interface PodInfo {
  metadata: ObjectMeta;
  spec: PodSpec;
  status: PodStatus;
}

export interface PodSpec {
  containers: ContainerSpec[];
  init_containers?: ContainerSpec[];
  node_name?: string;
  service_account_name?: string;
  restart_policy?: string;
  node_selector?: Record<string, string>;
  volumes?: Volume[];
  tolerations?: Toleration[];
}

export interface ContainerSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  ports?: ContainerPort[];
  env?: EnvVar[];
  resources?: ResourceRequirements;
  volume_mounts?: VolumeMount[];
  image_pull_policy?: string;
  readiness_probe?: Probe;
  liveness_probe?: Probe;
}

export interface ContainerPort {
  name?: string;
  container_port: number;
  protocol?: string;
}

export interface EnvVar {
  name: string;
  value?: string;
  value_from?: Record<string, unknown>;
}

export interface ResourceRequirements {
  limits?: Record<string, string>;
  requests?: Record<string, string>;
}

export interface VolumeMount {
  name: string;
  mount_path: string;
  sub_path?: string;
  read_only?: boolean;
}

export interface Volume {
  name: string;
  config_map?: Record<string, unknown>;
  secret?: Record<string, unknown>;
  persistent_volume_claim?: Record<string, unknown>;
  empty_dir?: Record<string, unknown>;
  host_path?: Record<string, unknown>;
}

export interface Toleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  toleration_seconds?: number;
}

export interface Probe {
  http_get?: Record<string, unknown>;
  tcp_socket?: Record<string, unknown>;
  exec?: Record<string, unknown>;
  initial_delay_seconds?: number;
  period_seconds?: number;
  timeout_seconds?: number;
  success_threshold?: number;
  failure_threshold?: number;
}

export interface PodStatus {
  phase: PodPhase;
  conditions?: Record<string, unknown>[];
  host_ip?: string;
  pod_ip?: string;
  start_time?: string;
  container_statuses?: ContainerStatus[];
  qos_class?: string;
}

export type PodPhase = "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restart_count: number;
  state: ContainerState;
  image: string;
  image_id: string;
}

export type ContainerState =
  | { type: "Waiting"; reason?: string; message?: string }
  | { type: "Running"; started_at?: string }
  | { type: "Terminated"; exit_code: number; reason?: string; message?: string; started_at?: string; finished_at?: string };

export interface PodLogOptions {
  container?: string;
  follow?: boolean;
  tail_lines?: number;
  since_seconds?: number;
  timestamps?: boolean;
  previous?: boolean;
}

// ── Deployments ───────────────────────────────────────────────────────────────

export interface DeploymentInfo {
  metadata: ObjectMeta;
  spec: DeploymentSpec;
  status: DeploymentStatus;
}

export interface DeploymentSpec {
  replicas: number;
  selector: LabelSelector;
  strategy?: DeploymentStrategy;
  min_ready_seconds?: number;
  revision_history_limit?: number;
}

export interface LabelSelector {
  match_labels?: Record<string, string>;
  match_expressions?: Record<string, unknown>[];
}

export interface DeploymentStrategy {
  strategy_type: string;
  rolling_update?: RollingUpdateConfig;
}

export interface RollingUpdateConfig {
  max_unavailable?: string;
  max_surge?: string;
}

export interface DeploymentStatus {
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
  available_replicas: number;
  unavailable_replicas: number;
  observed_generation?: number;
  conditions?: Record<string, unknown>[];
}

export interface CreateDeploymentConfig {
  name: string;
  namespace?: string;
  replicas?: number;
  labels?: Record<string, string>;
  containers: ContainerSpec[];
  selector?: Record<string, string>;
}

export interface ScaleConfig {
  replicas: number;
}

export interface RolloutInfo {
  current_revision: string;
  desired_revision: string;
  ready: boolean;
  message: string;
}

// ── StatefulSets / DaemonSets / ReplicaSets ───────────────────────────────────

export interface StatefulSetInfo {
  metadata: ObjectMeta;
  replicas: number;
  ready_replicas: number;
  current_replicas: number;
  updated_replicas: number;
  service_name: string;
}

export interface DaemonSetInfo {
  metadata: ObjectMeta;
  desired_number_scheduled: number;
  current_number_scheduled: number;
  number_ready: number;
  number_available: number;
  number_unavailable: number;
}

export interface ReplicaSetInfo {
  metadata: ObjectMeta;
  replicas: number;
  ready_replicas: number;
  available_replicas: number;
}

// ── Services ──────────────────────────────────────────────────────────────────

export interface ServiceInfo {
  metadata: ObjectMeta;
  spec: ServiceSpec;
  cluster_ip?: string;
  external_ips?: string[];
  load_balancer_ingress?: string[];
}

export interface ServiceSpec {
  service_type: ServiceType;
  cluster_ip?: string;
  ports?: ServicePort[];
  selector?: Record<string, string>;
  external_traffic_policy?: string;
  session_affinity?: string;
}

export type ServiceType = "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";

export interface ServicePort {
  name?: string;
  protocol?: string;
  port: number;
  target_port?: string;
  node_port?: number;
}

export interface EndpointInfo {
  metadata: ObjectMeta;
  subsets: EndpointSubset[];
}

export interface EndpointSubset {
  addresses?: EndpointAddress[];
  ports?: EndpointPort[];
}

export interface EndpointAddress {
  ip: string;
  hostname?: string;
  node_name?: string;
}

export interface EndpointPort {
  name?: string;
  port: number;
  protocol?: string;
}

export interface CreateServiceConfig {
  name: string;
  namespace?: string;
  service_type?: ServiceType;
  ports: ServicePort[];
  selector?: Record<string, string>;
  labels?: Record<string, string>;
}

// ── ConfigMaps ────────────────────────────────────────────────────────────────

export interface ConfigMapInfo {
  metadata: ObjectMeta;
  data?: Record<string, string>;
  binary_data?: Record<string, string>;
}

export interface CreateConfigMapConfig {
  name: string;
  namespace?: string;
  data?: Record<string, string>;
  labels?: Record<string, string>;
}

// ── Secrets ───────────────────────────────────────────────────────────────────

export interface SecretInfo {
  metadata: ObjectMeta;
  secret_type: SecretType;
  data?: Record<string, string>;
}

export type SecretType =
  | "Opaque"
  | "DockerConfigJson"
  | "DockerConfig"
  | "BasicAuth"
  | "SshAuth"
  | "Tls"
  | "BootstrapToken"
  | "ServiceAccountToken"
  | "Other";

export interface CreateSecretConfig {
  name: string;
  namespace?: string;
  secret_type?: SecretType;
  data?: Record<string, string>;
  string_data?: Record<string, string>;
  labels?: Record<string, string>;
}

// ── Ingress ───────────────────────────────────────────────────────────────────

export interface IngressInfo {
  metadata: ObjectMeta;
  spec: IngressSpec;
  load_balancer_ingress?: string[];
}

export interface IngressSpec {
  ingress_class_name?: string;
  default_backend?: Record<string, unknown>;
  tls?: IngressTls[];
  rules?: IngressRule[];
}

export interface IngressTls {
  hosts?: string[];
  secret_name?: string;
}

export interface IngressRule {
  host?: string;
  http?: Record<string, unknown>;
}

export interface IngressClassInfo {
  metadata: ObjectMeta;
  controller: string;
  is_default: boolean;
}

export interface CreateIngressConfig {
  name: string;
  namespace?: string;
  ingress_class_name?: string;
  rules: IngressRule[];
  tls?: IngressTls[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// ── Network Policies ──────────────────────────────────────────────────────────

export interface NetworkPolicyInfo {
  metadata: ObjectMeta;
  spec: Record<string, unknown>;
}

// ── Jobs & CronJobs ──────────────────────────────────────────────────────────

export interface JobInfo {
  metadata: ObjectMeta;
  spec: JobSpec;
  status: JobStatus;
}

export interface JobSpec {
  parallelism?: number;
  completions?: number;
  backoff_limit?: number;
  active_deadline_seconds?: number;
  ttl_seconds_after_finished?: number;
  suspend?: boolean;
}

export interface JobStatus {
  active?: number;
  succeeded?: number;
  failed?: number;
  start_time?: string;
  completion_time?: string;
  conditions?: Record<string, unknown>[];
}

export interface CreateJobConfig {
  name: string;
  namespace?: string;
  containers: ContainerSpec[];
  restart_policy?: string;
  backoff_limit?: number;
  labels?: Record<string, string>;
}

export interface CronJobInfo {
  metadata: ObjectMeta;
  schedule: string;
  suspend: boolean;
  last_schedule_time?: string;
  active_jobs: number;
}

export interface CreateCronJobConfig {
  name: string;
  namespace?: string;
  schedule: string;
  job_template: CreateJobConfig;
  concurrency_policy?: string;
  suspend?: boolean;
  labels?: Record<string, string>;
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface NodeInfo {
  metadata: ObjectMeta;
  spec: NodeSpec;
  status: NodeStatus;
}

export interface NodeSpec {
  pod_cidr?: string;
  provider_id?: string;
  unschedulable: boolean;
  taints?: Taint[];
}

export interface Taint {
  key: string;
  value?: string;
  effect: string;
  time_added?: string;
}

export interface NodeStatus {
  capacity: Record<string, string>;
  allocatable: Record<string, string>;
  conditions: Record<string, unknown>[];
  addresses: NodeAddress[];
  node_info: NodeSystemInfo;
}

export interface NodeAddress {
  address_type: string;
  address: string;
}

export interface NodeSystemInfo {
  machine_id: string;
  system_uuid: string;
  boot_id: string;
  kernel_version: string;
  os_image: string;
  container_runtime_version: string;
  kubelet_version: string;
  kube_proxy_version: string;
  operating_system: string;
  architecture: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

export interface PersistentVolumeInfo {
  metadata: ObjectMeta;
  capacity: Record<string, string>;
  access_modes: string[];
  reclaim_policy: string;
  status: string;
  storage_class?: string;
  claim_ref?: string;
}

export interface PersistentVolumeClaimInfo {
  metadata: ObjectMeta;
  status: string;
  volume_name?: string;
  storage_class?: string;
  access_modes: string[];
  capacity?: Record<string, string>;
  requested?: Record<string, string>;
}

export interface StorageClassInfo {
  metadata: ObjectMeta;
  provisioner: string;
  reclaim_policy?: string;
  volume_binding_mode?: string;
  allow_volume_expansion: boolean;
  is_default: boolean;
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

export interface RoleInfo {
  metadata: ObjectMeta;
  rules: PolicyRule[];
}

export interface PolicyRule {
  api_groups: string[];
  resources: string[];
  verbs: string[];
  resource_names?: string[];
}

export interface RoleBindingInfo {
  metadata: ObjectMeta;
  role_ref: RoleRef;
  subjects: Subject[];
}

export interface RoleRef {
  api_group: string;
  kind: string;
  name: string;
}

export interface Subject {
  kind: string;
  name: string;
  namespace?: string;
  api_group?: string;
}

export interface ServiceAccountInfo {
  metadata: ObjectMeta;
  secrets?: string[];
  automount_token?: boolean;
}

// ── Helm ──────────────────────────────────────────────────────────────────────

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
}

export interface HelmReleaseDetail {
  release: HelmRelease;
  info: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface HelmReleaseHistory {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export interface HelmInstallConfig {
  release_name: string;
  chart: string;
  namespace?: string;
  values?: Record<string, unknown>;
  values_files?: string[];
  version?: string;
  create_namespace?: boolean;
  wait?: boolean;
  timeout?: string;
}

export interface HelmUpgradeConfig {
  release_name: string;
  chart: string;
  namespace?: string;
  values?: Record<string, unknown>;
  values_files?: string[];
  version?: string;
  reuse_values?: boolean;
  reset_values?: boolean;
  wait?: boolean;
  timeout?: string;
}

export interface HelmRepo {
  name: string;
  url: string;
}

export interface HelmChart {
  name: string;
  chart_version: string;
  app_version: string;
  description: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface K8sEvent {
  metadata: ObjectMeta;
  involved_object: ObjectReference;
  reason?: string;
  message?: string;
  event_type?: string;
  count?: number;
  first_timestamp?: string;
  last_timestamp?: string;
  source?: EventSource;
}

export interface ObjectReference {
  kind: string;
  namespace?: string;
  name: string;
  uid?: string;
  api_version?: string;
  field_path?: string;
}

export interface EventSource {
  component?: string;
  host?: string;
}

export interface EventFilter {
  namespace?: string;
  field_selector?: string;
  label_selector?: string;
  event_type?: string;
  involved_object_kind?: string;
  involved_object_name?: string;
  reason?: string;
}

// ── CRDs & HPAs ───────────────────────────────────────────────────────────────

export interface CrdInfo {
  metadata: ObjectMeta;
  group: string;
  names: Record<string, unknown>;
  scope: string;
  versions: Record<string, unknown>[];
}

export interface HpaInfo {
  metadata: ObjectMeta;
  spec: Record<string, unknown>;
  status: Record<string, unknown>;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface NodeMetrics {
  name: string;
  timestamp: string;
  cpu_usage: string;
  memory_usage: string;
  cpu_millicores?: number;
  memory_bytes?: number;
}

export interface PodMetrics {
  name: string;
  namespace: string;
  timestamp: string;
  containers: ContainerMetrics[];
}

export interface ContainerMetrics {
  name: string;
  cpu_usage: string;
  memory_usage: string;
  cpu_millicores?: number;
  memory_bytes?: number;
}

export interface ClusterResourceSummary {
  total_nodes: number;
  total_cpu_millicores: number;
  total_memory_bytes: number;
  used_cpu_millicores: number;
  used_memory_bytes: number;
  cpu_utilization_percent: number;
  memory_utilization_percent: number;
}

// ── Kubeconfig ────────────────────────────────────────────────────────────────

export interface KubeconfigInfo {
  current_context?: string;
  clusters: ClusterEndpoint[];
  contexts: ContextSpec[];
  users: string[];
}

export interface ClusterEndpoint {
  name: string;
  server: string;
  certificate_authority?: string;
  certificate_authority_data?: string;
  insecure_skip_tls_verify?: boolean;
}

export interface ContextSpec {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
}

// ── Generic ───────────────────────────────────────────────────────────────────

export interface K8sListResponse<T> {
  items: T[];
  metadata: { resource_version?: string; continue_token?: string };
}

export interface ListOptions {
  label_selector?: string;
  field_selector?: string;
  limit?: number;
  continue_token?: string;
}
