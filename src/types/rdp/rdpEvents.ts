export interface RDPStatusEvent {
  session_id: string;
  status: string;
  message: string;
  desktop_width?: number;
  desktop_height?: number;
}

export interface RDPPointerEvent {
  session_id: string;
  pointer_type: string;
  x?: number;
  y?: number;
  /** Base64-encoded RGBA bitmap (for pointer_type="bitmap") */
  bitmap_rgba?: string;
  bitmap_width?: number;
  bitmap_height?: number;
  hotspot_x?: number;
  hotspot_y?: number;
}

export interface RDPStatsEvent {
  session_id: string;
  uptime_secs: number;
  bytes_received: number;
  bytes_sent: number;
  pdus_received: number;
  pdus_sent: number;
  frame_count: number;
  fps: number;
  input_events: number;
  errors_recovered: number;
  reactivations: number;
  phase: string;
  last_error: string | null;
  lifecycle?: RDPLifecycleEvent;
  /** RDPGFX (MS-RDPEGFX) graphics-pipeline diagnostics; absent when GFX is disabled. */
  gfx?: RDPGfxDiagnostics;
}

export interface RDPChannelSummary {
  enabledCount: number;
  readyCount: number;
  failedCount: number;
}

/**
 * RDPGFX graphics-pipeline diagnostics. `summary` mirrors the one-channel
 * ready/fault view that also folds into the lifecycle channel summary; the
 * remaining fields are GFX-specific (negotiated codec/cap version, surfaces,
 * frames decoded, frame-acks, pipeline errors).
 */
export interface RDPGfxDiagnostics {
  summary: RDPChannelSummary;
  /** Negotiated capability version (CAPVERSION_*), once CapsConfirm arrives. */
  capVersion?: number;
  /** Negotiated codec name ("AVC444" | "AVC420" | "uncompressed" | …). */
  codec?: string;
  /** Surfaces currently allocated by the server. */
  surfacesActive: number;
  /** Total frames decoded (or NAL-forwarded in passthrough mode). */
  framesDecoded: number;
  /** Frame-acknowledge PDUs sent back to the server. */
  frameAcksSent: number;
  /** Recoverable per-frame pipeline errors (do NOT fault the channel). */
  pipelineErrors: number;
  /** Class of the most recent pipeline error. */
  lastErrorClass?: string;
  /** When true, raw H.264 NALs are forwarded for frontend WebCodecs decode. */
  nalPassthrough: boolean;
}

export interface RDPFrameFlowSummary {
  queuedFrames: number;
  deliveredFrames: number;
  droppedFrames: number;
  coalescedFrames: number;
  averageRenderMs?: number;
}

export type RdpFramePressureState = "healthy" | "backpressured";

export type RdpH264RecoveryState = "healthy" | "awaitingRecovery" | "terminal";

export type RdpH264RecoveryReason =
  | "background"
  | "decoder-error"
  | "decoder-overflow"
  | "decoder-unavailable"
  | "malformed-access-unit"
  | "missing-keyframe"
  | "missing-parameter-sets"
  | "parameter-set-overflow"
  | "pre-attach-overflow"
  | "pre-ready-overflow"
  | "queue-overflow"
  | "recovery-timeout"
  | "renderer-reset"
  | "resize";

export interface RdpH264RecoveryEvent {
  state: RdpH264RecoveryState;
  episode: number;
  reason?: RdpH264RecoveryReason;
}

export interface RdpSessionActivityResult {
  sessionId: string;
  requestedGeneration: number;
  appliedGeneration: number;
  active: boolean;
  applied: boolean;
  stale: boolean;
  suppressOutputSupported: boolean;
  refreshRectangleSupported: boolean;
  suppressOutputSent: boolean;
  allowDisplayUpdatesSent: boolean;
  refreshRectangleSent: boolean;
}

export interface RdpFrameTelemetryEvent {
  sessionId: string;
  queuedFrames: number;
  droppedFrames: number;
  coalescedFrames: number;
  averageRenderMs?: number;
}

export type RdpFrameTelemetryRequest = RdpFrameTelemetryEvent;

export interface RdpFramePipelineMetrics {
  queuedFrames: number;
  queuedBytes: number;
  preAttachFrames: number;
  preAttachBytes: number;
  receivedFrames: number;
  presentedFrames: number;
  droppedFrames: number;
  droppedBytes: number;
  coalescedFrames: number;
  lastFrameRenderMs: number;
  averageRenderMs: number;
  p95RenderMs?: number;
  activeScheduling: "vsync" | "low-latency";
  renderer: string;
  rendererType?: string;
  canvasAttached: boolean;
  destroyed: boolean;
  lastFrameReceivedAtMs?: number;
  lastFramePresentedAtMs?: number;
  h264RecoveryState: RdpH264RecoveryState;
  h264RecoveryEpisode: number;
  h264RecoveryReason?: RdpH264RecoveryReason;
}

export interface RdpFrameBackpressureUpdate extends RdpFrameTelemetryEvent {
  renderer: string;
  queueDepth: number;
  queuedBytes?: number;
  lastFrameRenderMs: number;
  p95RenderMs?: number;
  presentedFrames: number;
  isVisible: boolean;
  isDetached: boolean;
  pressureState: RdpFramePressureState;
  timestampMs: number;
}

export type RdpFrameTelemetrySender = (
  update: RdpFrameBackpressureUpdate,
) => void | Promise<void>;

export interface RDPLifecycleEvent {
  sessionId: string;
  state: string;
  activeSubstate?: string;
  phaseStartedAtMs: number;
  transitionCount: number;
  reconnectAttempt: number;
  lastFailureClass?: string;
  channelSummary: RDPChannelSummary;
  frameFlowSummary: RDPFrameFlowSummary;
}

export interface RdpCertFingerprintEvent {
  session_id: string;
  fingerprint: string;
  host: string;
  port: number;
  /** X.509 Subject (RFC 4514 string) */
  subject?: string;
  /** X.509 Issuer (RFC 4514 string) */
  issuer?: string;
  /** Certificate validity start (ISO 8601) */
  valid_from?: string;
  /** Certificate validity end (ISO 8601) */
  valid_to?: string;
  /** Serial number (colon-separated hex) */
  serial?: string;
  /** Signature algorithm OID */
  signature_algorithm?: string;
  /** Subject Alternative Names */
  san?: string[];
  /** PEM-encoded certificate */
  pem?: string;
}

export interface RDPTimingEvent {
  session_id: string;
  dns_ms: number;
  tcp_ms: number;
  negotiate_ms: number;
  tls_ms: number;
  auth_ms: number;
  total_ms: number;
}
