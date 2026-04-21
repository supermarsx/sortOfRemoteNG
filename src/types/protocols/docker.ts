// ── TypeScript types for sorng-docker crate ──────────────────────────────────

// ── Connection ────────────────────────────────────────────────────────────────

export type DockerEndpoint =
  | { type: "Unix"; path: string }
  | { type: "NamedPipe"; path: string }
  | { type: "Tcp"; host: string; port: number }
  | { type: "Ssh"; host: string; port?: number; user?: string; key_path?: string };

export interface DockerTlsConfig {
  ca_cert_path?: string;
  cert_path?: string;
  key_path?: string;
  verify: boolean;
}

export interface DockerConnectionConfig {
  name: string;
  endpoint: DockerEndpoint;
  tls?: DockerTlsConfig;
  api_version?: string;
  timeout_seconds?: number;
}

// ── System ────────────────────────────────────────────────────────────────────

export interface DockerSystemInfo {
  id?: string;
  name?: string;
  server_version?: string;
  api_version?: string;
  os?: string;
  arch?: string;
  kernel_version?: string;
  total_memory?: number;
  cpus?: number;
  containers?: number;
  containers_running?: number;
  containers_paused?: number;
  containers_stopped?: number;
  images?: number;
  driver?: string;
  docker_root_dir?: string;
  operating_system?: string;
  swarm_status?: string;
}

export interface DockerVersionInfo {
  version?: string;
  api_version?: string;
  min_api_version?: string;
  git_commit?: string;
  go_version?: string;
  os?: string;
  arch?: string;
  build_time?: string;
}

export interface DockerDiskUsage {
  layers_size?: number;
  images_count?: number;
  images_size?: number;
  containers_count?: number;
  containers_size?: number;
  volumes_count?: number;
  volumes_size?: number;
  build_cache_size?: number;
}

export interface PruneResult {
  items_deleted?: string[];
  space_reclaimed?: number;
}

// ── Containers ────────────────────────────────────────────────────────────────

export interface ContainerSummary {
  id: string;
  names: string[];
  image: string;
  image_id: string;
  command?: string;
  created?: number;
  state: ContainerState;
  status?: string;
  ports?: PortBinding[];
  labels?: Record<string, string>;
  size_rw?: number;
  size_root_fs?: number;
  network_mode?: string;
}

export type ContainerState =
  | "Created"
  | "Running"
  | "Paused"
  | "Restarting"
  | "Removing"
  | "Exited"
  | "Dead";

export interface ContainerInspect {
  id: string;
  name: string;
  created: string;
  path: string;
  args: string[];
  state: ContainerStateDetail;
  image: string;
  config: ContainerConfig;
  host_config: HostConfig;
  network_settings: NetworkSettings;
  mounts: MountPoint[];
  platform?: string;
}

export interface ContainerStateDetail {
  status: ContainerState;
  running: boolean;
  paused: boolean;
  restarting: boolean;
  oom_killed: boolean;
  dead: boolean;
  pid: number;
  exit_code: number;
  error?: string;
  started_at?: string;
  finished_at?: string;
  health?: HealthStatus;
}

export type HealthStatus = "None" | "Starting" | "Healthy" | "Unhealthy";

export interface ContainerConfig {
  hostname?: string;
  domainname?: string;
  user?: string;
  image?: string;
  env?: string[];
  cmd?: string[];
  entrypoint?: string[];
  working_dir?: string;
  labels?: Record<string, string>;
  exposed_ports?: Record<string, Record<string, never>>;
  volumes?: Record<string, Record<string, never>>;
}

export interface HostConfig {
  binds?: string[];
  network_mode?: string;
  port_bindings?: Record<string, HostPortBinding[]>;
  restart_policy?: RestartPolicy;
  auto_remove?: boolean;
  privileged?: boolean;
  publish_all_ports?: boolean;
  dns?: string[];
  extra_hosts?: string[];
  memory?: number;
  memory_swap?: number;
  cpu_shares?: number;
  cpu_quota?: number;
  cpu_period?: number;
  nano_cpus?: number;
  devices?: DeviceMapping[];
  log_config?: LogConfig;
  ulimits?: Ulimit[];
  pid_mode?: string;
  ipc_mode?: string;
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  shm_size?: number;
}

export interface RestartPolicy {
  name: RestartPolicyType;
  maximum_retry_count?: number;
}

export type RestartPolicyType = "no" | "always" | "unless-stopped" | "on-failure";

export interface DeviceMapping {
  path_on_host: string;
  path_in_container: string;
  cgroup_permissions: string;
}

export interface LogConfig {
  log_type: string;
  config?: Record<string, string>;
}

export interface Ulimit {
  name: string;
  soft: number;
  hard: number;
}

export interface PortBinding {
  ip?: string;
  private_port: number;
  public_port?: number;
  port_type?: string;
}

export interface HostPortBinding {
  host_ip?: string;
  host_port?: string;
}

export interface MountPoint {
  mount_type?: string;
  name?: string;
  source?: string;
  destination?: string;
  driver?: string;
  mode?: string;
  rw?: boolean;
  propagation?: string;
}

export interface NetworkSettings {
  bridge?: string;
  gateway?: string;
  ip_address?: string;
  ip_prefix_len?: number;
  mac_address?: string;
  networks?: Record<string, ContainerNetwork>;
}

export interface ContainerNetwork {
  network_id?: string;
  endpoint_id?: string;
  gateway?: string;
  ip_address?: string;
  ip_prefix_len?: number;
  ipv6_gateway?: string;
  global_ipv6_address?: string;
  mac_address?: string;
}

export interface CreateContainerConfig {
  name?: string;
  image: string;
  cmd?: string[];
  entrypoint?: string[];
  env?: string[];
  working_dir?: string;
  user?: string;
  hostname?: string;
  domainname?: string;
  labels?: Record<string, string>;
  exposed_ports?: Record<string, Record<string, never>>;
  volumes?: Record<string, Record<string, never>>;
  host_config?: HostConfig;
  networking_config?: Record<string, unknown>;
  stop_signal?: string;
  stop_timeout?: number;
  tty?: boolean;
  open_stdin?: boolean;
  stdin_once?: boolean;
  attach_stdin?: boolean;
  attach_stdout?: boolean;
  attach_stderr?: boolean;
  healthcheck?: HealthCheckConfig;
}

export interface HealthCheckConfig {
  test?: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  start_period?: number;
}

export interface CreateContainerResponse {
  id: string;
  warnings?: string[];
}

export interface ContainerLogOptions {
  stdout?: boolean;
  stderr?: boolean;
  since?: string;
  until?: string;
  timestamps?: boolean;
  tail?: string;
  follow?: boolean;
}

export interface ExecConfig {
  cmd: string[];
  attach_stdin?: boolean;
  attach_stdout?: boolean;
  attach_stderr?: boolean;
  tty?: boolean;
  env?: string[];
  working_dir?: string;
  user?: string;
  privileged?: boolean;
}

export interface ContainerStats {
  cpu_percent: number;
  memory_usage: number;
  memory_limit: number;
  memory_percent: number;
  network_rx: number;
  network_tx: number;
  block_read: number;
  block_write: number;
  pids: number;
}

export interface ContainerChange {
  path: string;
  kind: number;
}

export interface ContainerTop {
  titles: string[];
  processes: string[][];
}

export interface ContainerWaitResult {
  status_code: number;
  error?: string;
}

export interface ListContainersOptions {
  all?: boolean;
  limit?: number;
  size?: boolean;
  filters?: Record<string, string[]>;
}

// ── Images ────────────────────────────────────────────────────────────────────

export interface ImageSummary {
  id: string;
  parent_id?: string;
  repo_tags?: string[];
  repo_digests?: string[];
  created?: number;
  size?: number;
  virtual_size?: number;
  shared_size?: number;
  labels?: Record<string, string>;
  containers?: number;
}

export interface ImageInspect {
  id: string;
  repo_tags?: string[];
  repo_digests?: string[];
  parent?: string;
  comment?: string;
  created?: string;
  container?: string;
  docker_version?: string;
  author?: string;
  config?: ImageConfig;
  architecture?: string;
  os?: string;
  size?: number;
  virtual_size?: number;
  root_fs?: ImageRootFs;
}

export interface ImageConfig {
  hostname?: string;
  user?: string;
  env?: string[];
  cmd?: string[];
  entrypoint?: string[];
  working_dir?: string;
  labels?: Record<string, string>;
  volumes?: Record<string, Record<string, never>>;
  exposed_ports?: Record<string, Record<string, never>>;
}

export interface ImageRootFs {
  root_fs_type: string;
  layers?: string[];
}

export interface ImageHistoryEntry {
  id?: string;
  created?: number;
  created_by?: string;
  tags?: string[];
  size?: number;
  comment?: string;
}

export interface ListImagesOptions {
  all?: boolean;
  digests?: boolean;
  filters?: Record<string, string[]>;
}

// ── Volumes ───────────────────────────────────────────────────────────────────

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint?: string;
  created_at?: string;
  labels?: Record<string, string>;
  options?: Record<string, string>;
  scope?: string;
  status?: Record<string, unknown>;
  usage_data?: VolumeUsage;
}

export interface VolumeUsage {
  size?: number;
  ref_count?: number;
}

export interface CreateVolumeConfig {
  name?: string;
  driver?: string;
  driver_opts?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ListVolumesOptions {
  filters?: Record<string, string[]>;
}

// ── Networks ──────────────────────────────────────────────────────────────────

export interface NetworkInfo {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
  internal?: boolean;
  attachable?: boolean;
  ingress?: boolean;
  enableIPv6?: boolean;
  ipam?: IpamConfig;
  options?: Record<string, string>;
  labels?: Record<string, string>;
  containers?: Record<string, NetworkContainer>;
  created?: string;
}

export interface IpamConfig {
  driver?: string;
  config?: IpamPoolConfig[];
  options?: Record<string, string>;
}

export interface IpamPoolConfig {
  subnet?: string;
  ip_range?: string;
  gateway?: string;
  aux_addresses?: Record<string, string>;
}

export interface NetworkContainer {
  name?: string;
  endpoint_id?: string;
  mac_address?: string;
  ipv4_address?: string;
  ipv6_address?: string;
}

export interface CreateNetworkConfig {
  name: string;
  driver?: string;
  internal?: boolean;
  attachable?: boolean;
  enable_ipv6?: boolean;
  ipam?: IpamConfig;
  options?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface CreateNetworkResponse {
  id: string;
  warning?: string;
}

export interface ConnectNetworkConfig {
  container: string;
  endpoint_config?: EndpointConfig;
}

export interface EndpointConfig {
  ipam_config?: EndpointIpamConfig;
  links?: string[];
  aliases?: string[];
}

export interface EndpointIpamConfig {
  ipv4_address?: string;
  ipv6_address?: string;
}

export interface ListNetworksOptions {
  filters?: Record<string, string[]>;
}

// ── Compose ───────────────────────────────────────────────────────────────────

export interface ComposeProject {
  name: string;
  status?: string;
  config_files?: string[];
}

export interface ComposePsItem {
  id?: string;
  name?: string;
  command?: string;
  state?: string;
  ports?: string;
  service?: string;
}

export interface ComposeUpConfig {
  files: string[];
  project_name?: string;
  services?: string[];
  detach?: boolean;
  build?: boolean;
  remove_orphans?: boolean;
  force_recreate?: boolean;
  no_deps?: boolean;
  timeout?: number;
}

export interface ComposeDownConfig {
  files: string[];
  project_name?: string;
  remove_orphans?: boolean;
  remove_volumes?: boolean;
  remove_images?: string;
  timeout?: number;
}

export interface ComposeLogsConfig {
  files: string[];
  project_name?: string;
  services?: string[];
  follow?: boolean;
  tail?: string;
  timestamps?: boolean;
  since?: string;
}

export interface ComposeBuildConfig {
  files: string[];
  project_name?: string;
  services?: string[];
  no_cache?: boolean;
  pull?: boolean;
  build_args?: Record<string, string>;
}

export interface ComposePullConfig {
  files: string[];
  project_name?: string;
  services?: string[];
  ignore_pull_failures?: boolean;
  quiet?: boolean;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface RegistryCredentials {
  server_address: string;
  username: string;
  password: string;
  email?: string;
}

export interface RegistryAuthResult {
  status: string;
  identity_token?: string;
}

export interface RegistrySearchResult {
  name?: string;
  description?: string;
  star_count?: number;
  is_official?: boolean;
  is_automated?: boolean;
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface DockerEvent {
  event_type?: string;
  action?: string;
  actor?: DockerEventActor;
  time?: number;
  time_nano?: number;
}

export interface DockerEventActor {
  id?: string;
  attributes?: Record<string, string>;
}

export interface DockerEventFilter {
  event_type?: string;
  action?: string;
  container?: string;
  image?: string;
  label?: string[];
  since?: string;
  until?: string;
}
