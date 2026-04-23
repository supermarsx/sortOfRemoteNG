/**
 * TypeScript mirrors of the Rust `sorng-probes` shapes emitted by the
 * backend `check_all_connections` bulk orchestrator (t5-e1).
 *
 * Rust `ProbeStatus` is `#[serde(tag = "status", content = "detail", rename_all = "snake_case")]`
 * → discriminated union on `status` with an optional `detail` payload on `other_error`.
 *
 * Rust `PerResult` is `#[serde(tag = "kind", rename_all = "snake_case")]` with the probe
 * fields flattened into the outer object → discriminated union on `kind`.
 */

export type ProbeStatus =
  | { status: 'reachable' }
  | { status: 'refused' }
  | { status: 'timeout' }
  | { status: 'dns_failed' }
  | { status: 'other_error'; detail: string };

export interface ProbeResult {
  status: ProbeStatus;
  elapsed_ms: number;
}

export interface SshProbeResult {
  status: ProbeStatus;
  banner: string | null;
  elapsed_ms: number;
}

export interface RdpProbeResult {
  status: ProbeStatus;
  reachable: boolean;
  nla_required: boolean | null;
  negotiated_protocol: number | null;
  elapsed_ms: number;
}

export type PerResult =
  | ({ kind: 'tcp' } & ProbeResult)
  | ({ kind: 'ssh' } & SshProbeResult)
  | ({ kind: 'rdp' } & RdpProbeResult);

export interface CheckProgressEvent {
  run_id: string;
  connection_id: string;
  index: number;
  total: number;
  result: PerResult;
  elapsed_ms: number;
}

export interface CheckCompleteEvent {
  run_id: string;
  total: number;
  completed: number;
  cancelled: boolean;
}

export interface CheckRequest {
  connection_id: string;
  host: string;
  port: number;
  protocol: string;
}

export type RowState = 'pending' | 'probing' | 'done';

export interface CheckRow {
  connectionId: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  state: RowState;
  result?: PerResult;
  elapsedMs?: number;
}
