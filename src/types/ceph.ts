// Ceph types — align with sorng-ceph crate DTOs.

export interface CephConnectionConfig {
  host: string;
  port: number;
  apiToken?: string;
  username?: string;
  password?: string;
  verifyTls?: boolean;
}

export interface CephSession {
  id: string;
  clusterId?: string;
  clusterName?: string;
  connectedAt: string;
}

export interface ClusterHealth {
  status: string;
  checks?: Record<string, unknown>;
  summary?: string;
}

export interface ClusterStatus {
  fsid?: string;
  health?: ClusterHealth;
  monmap?: unknown;
  osdmap?: unknown;
  pgmap?: unknown;
  mgrmap?: unknown;
  fsmap?: unknown;
}

export interface ClusterDf {
  stats?: Record<string, number>;
  pools?: Array<Record<string, unknown>>;
}

export interface OsdInfo {
  id: number;
  uuid?: string;
  up: boolean;
  in: boolean;
  weight?: number;
  reweight?: number;
  deviceClass?: string;
  host?: string;
}

export interface PoolInfo {
  id: number;
  name: string;
  size?: number;
  minSize?: number;
  pgNum?: number;
  pgpNum?: number;
  type?: string;
  erasureCodeProfile?: string;
}

export interface RbdImage {
  name: string;
  pool: string;
  sizeBytes: number;
  objects?: number;
  features?: string[];
}

export interface FilesystemInfo {
  name: string;
  id?: number;
  metadataPool?: string;
  dataPools?: string[];
  maxMds?: number;
}

export interface RgwUser {
  userId: string;
  displayName?: string;
  email?: string;
  suspended?: boolean;
  accessKeys?: Array<{ user: string; accessKey: string; secretKey?: string }>;
  keys?: unknown[];
}

export interface RgwBucket {
  bucket: string;
  owner?: string;
  numObjects?: number;
  sizeKb?: number;
}

export interface MonitorInfo {
  name: string;
  rank: number;
  address?: string;
  publicAddr?: string;
}

export interface MdsInfo {
  name: string;
  rank?: number;
  state?: string;
  address?: string;
}

export interface PgInfo {
  pgid: string;
  state: string;
  upPrimary?: number;
  actingPrimary?: number;
  up?: number[];
  acting?: number[];
}

export interface HealthCheck {
  severity: string;
  code: string;
  summary: string;
  detail?: string[];
  muted?: boolean;
}

export interface CephAlert {
  id: string;
  severity: string;
  summary: string;
  raised: string;
  acknowledged?: boolean;
  cleared?: boolean;
}

export interface PerfMetrics {
  iops?: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
  readLatencyMs?: number;
  writeLatencyMs?: number;
  samples?: Record<string, unknown>;
}

export interface RecoveryProgress {
  percent: number;
  objectsRecovered?: number;
  objectsTotal?: number;
  bytesRecovered?: number;
  bytesTotal?: number;
  misplacedObjects?: number;
}
