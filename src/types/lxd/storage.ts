// LXD / Incus integration — Storage & Cluster type slice (t42 c4).
//
// camelCase mirror of the storage / server / cluster / warning structs in
// `src-tauri/crates/sorng-lxd/src/types.rs`. Field names follow the same
// convention as the shared barrel (`./index.ts`): the Rust field identifier,
// camelCased (so `used_by` → `usedBy`, `volume_type`/serde-`type` → `volumeType`).
//
// `LxdOperation` is SHARED and is NOT redefined here — import it from `../index`.

// ─── Storage pools ──────────────────────────────────────────────────────────────

/** Mirror of `StoragePool`. */
export interface StoragePool {
  name: string;
  description?: string | null;
  driver?: string | null;
  status?: string | null;
  config?: Record<string, string> | null;
  usedBy?: string[] | null;
  locations?: string[] | null;
}

/** Mirror of `CreateStoragePoolRequest` (request body for `lxd_create_storage_pool`). */
export interface CreateStoragePoolRequest {
  name: string;
  driver: string;
  description?: string;
  config?: Record<string, string>;
}

/** Mirror of `StorageSpace`. */
export interface StorageSpace {
  used?: number | null;
  total?: number | null;
}

/** Mirror of `StorageInodes`. */
export interface StorageInodes {
  used?: number | null;
  total?: number | null;
}

/** Mirror of `StoragePoolResources`. */
export interface StoragePoolResources {
  space?: StorageSpace | null;
  inodes?: StorageInodes | null;
}

// ─── Storage volumes ────────────────────────────────────────────────────────────

/** Mirror of `StorageVolume`. `volumeType` mirrors the serde-`type` field. */
export interface StorageVolume {
  name: string;
  description?: string | null;
  volumeType?: string | null;
  contentType?: string | null;
  config?: Record<string, string> | null;
  usedBy?: string[] | null;
  location?: string | null;
  createdAt?: string | null;
}

/** Mirror of `CreateStorageVolumeRequest` (body for `lxd_create_storage_volume`). */
export interface CreateStorageVolumeRequest {
  pool: string;
  name: string;
  volumeType?: string;
  contentType?: string;
  description?: string;
  config?: Record<string, string>;
}

/** Mirror of `StorageVolumeSnapshot`. */
export interface StorageVolumeSnapshot {
  name: string;
  description?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  contentType?: string | null;
  config?: Record<string, string> | null;
}

// ─── Storage buckets (S3) ───────────────────────────────────────────────────────

/** Mirror of `StorageBucket`. */
export interface StorageBucket {
  name: string;
  description?: string | null;
  config?: Record<string, string> | null;
  location?: string | null;
  project?: string | null;
}

/** Mirror of `CreateStorageBucketRequest` (body for `lxd_create_storage_bucket`). */
export interface CreateStorageBucketRequest {
  pool: string;
  name: string;
  description?: string;
  config?: Record<string, string>;
}

/** Mirror of `StorageBucketKey`. */
export interface StorageBucketKey {
  name: string;
  description?: string | null;
  role?: string | null;
  accessKey?: string | null;
  secretKey?: string | null;
}

// ─── Server ─────────────────────────────────────────────────────────────────────

/** Mirror of `LxdServerEnvironment`. */
export interface LxdServerEnvironment {
  serverName?: string | null;
  serverVersion?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  kernel?: string | null;
  kernelVersion?: string | null;
  kernelArchitecture?: string | null;
  storage?: string | null;
  storageVersion?: string | null;
  driver?: string | null;
  driverVersion?: string | null;
  serverClustered?: boolean | null;
}

/** Mirror of `LxdServer` — returned by `lxd_get_server`. */
export interface LxdServer {
  config?: Record<string, string> | null;
  apiExtensions?: string[] | null;
  apiStatus?: string | null;
  apiVersion?: string | null;
  auth?: string | null;
  authUserName?: string | null;
  authUserMethod?: string | null;
  environment?: LxdServerEnvironment | null;
}

// ─── Server hardware resources ──────────────────────────────────────────────────

/** Mirror of `CpuResources`. */
export interface CpuResources {
  architecture?: string | null;
  sockets?: unknown[] | null;
  total?: number | null;
}

/** Mirror of `MemoryResources`. */
export interface MemoryResources {
  used?: number | null;
  total?: number | null;
  hugepagesUsed?: number | null;
  hugepagesTotal?: number | null;
}

/** Mirror of `GpuResources`. */
export interface GpuResources {
  cards?: unknown[] | null;
  total?: number | null;
}

/** Mirror of `NetworkResources`. */
export interface NetworkResources {
  cards?: unknown[] | null;
  total?: number | null;
}

/** Mirror of `StorageResources`. */
export interface StorageResources {
  disks?: unknown[] | null;
  total?: number | null;
}

/** Mirror of `SystemResources`. `systemType` mirrors the serde-`type` field. */
export interface SystemResources {
  uuid?: string | null;
  vendor?: string | null;
  product?: string | null;
  family?: string | null;
  version?: string | null;
  serial?: string | null;
  systemType?: string | null;
  firmware?: unknown;
  chassis?: unknown;
  motherboard?: unknown;
}

/** Mirror of `ServerResources` — returned by `lxd_get_server_resources`. */
export interface ServerResources {
  cpu?: CpuResources | null;
  memory?: MemoryResources | null;
  gpu?: GpuResources | null;
  network?: NetworkResources | null;
  storage?: StorageResources | null;
  system?: SystemResources | null;
}

// ─── Cluster ────────────────────────────────────────────────────────────────────

/** Mirror of `LxdCluster` — returned by `lxd_get_cluster`. */
export interface LxdCluster {
  serverName?: string | null;
  enabled: boolean;
  memberConfig?: unknown[] | null;
}

/** Mirror of `LxdClusterMember`. */
export interface LxdClusterMember {
  serverName?: string | null;
  url?: string | null;
  database?: boolean | null;
  status?: string | null;
  message?: string | null;
  architecture?: string | null;
  description?: string | null;
  roles?: string[] | null;
  failureDomain?: string | null;
  config?: Record<string, string> | null;
  groups?: string[] | null;
}

// ─── Warnings ───────────────────────────────────────────────────────────────────

/** Mirror of `LxdWarning`. `warningType` mirrors the serde-`type` field. */
export interface LxdWarning {
  uuid?: string | null;
  status?: string | null;
  severity?: string | null;
  entityUrl?: string | null;
  warningType?: string | null;
  project?: string | null;
  message?: string | null;
  count?: number | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  location?: string | null;
}
