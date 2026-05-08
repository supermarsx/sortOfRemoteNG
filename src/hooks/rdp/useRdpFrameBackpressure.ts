import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RdpFrameBackpressureUpdate,
  RdpFramePipelineMetrics,
  RdpFramePressureState,
  RdpFrameTelemetrySender,
} from '../../types/rdp/rdpEvents';

export interface RdpFrameBackpressureWatermarks {
  highQueueDepth: number;
  lowQueueDepth: number;
  highAverageRenderMs: number;
  lowAverageRenderMs: number;
}

export interface UseRdpFrameBackpressureOptions {
  sessionId: string | null;
  getMetrics: () => RdpFramePipelineMetrics | null | undefined;
  sender?: RdpFrameTelemetrySender;
  enabled?: boolean;
  renderer?: string;
  isVisible?: boolean;
  isDetached?: boolean;
  activeCadenceMs?: number;
  quietCadenceMs?: number;
  watermarks?: Partial<RdpFrameBackpressureWatermarks>;
  nowMs?: () => number;
}

export interface UseRdpFrameBackpressureResult {
  pressureState: RdpFramePressureState;
  lastUpdate: RdpFrameBackpressureUpdate | null;
  sampleNow: () => Promise<RdpFrameBackpressureUpdate | null>;
  reset: () => void;
}

interface NormalizedBackpressureOptions {
  sessionId: string | null;
  getMetrics: () => RdpFramePipelineMetrics | null | undefined;
  sender: RdpFrameTelemetrySender;
  enabled: boolean;
  renderer: string | undefined;
  isVisible: boolean;
  isDetached: boolean;
  activeCadenceMs: number;
  quietCadenceMs: number;
  watermarks: RdpFrameBackpressureWatermarks;
  nowMs: () => number;
}

export const DEFAULT_RDP_FRAME_BACKPRESSURE_WATERMARKS: RdpFrameBackpressureWatermarks = {
  highQueueDepth: 9,
  lowQueueDepth: 3,
  highAverageRenderMs: 32,
  lowAverageRenderMs: 20,
};

const DEFAULT_ACTIVE_CADENCE_MS = 250;
const DEFAULT_QUIET_CADENCE_MS = 1000;

const noopSender: RdpFrameTelemetrySender = () => undefined;

export function resolveRdpFramePressureState(
  metrics: RdpFramePipelineMetrics,
  currentState: RdpFramePressureState,
  watermarks: RdpFrameBackpressureWatermarks = DEFAULT_RDP_FRAME_BACKPRESSURE_WATERMARKS,
): RdpFramePressureState {
  if (currentState === 'backpressured') {
    const queueRecovered = metrics.queuedFrames <= watermarks.lowQueueDepth;
    const renderRecovered = metrics.averageRenderMs <= watermarks.lowAverageRenderMs;
    return queueRecovered && renderRecovered ? 'healthy' : 'backpressured';
  }

  const queuePressured = metrics.queuedFrames >= watermarks.highQueueDepth;
  const renderPressured = metrics.averageRenderMs >= watermarks.highAverageRenderMs;
  return queuePressured || renderPressured ? 'backpressured' : 'healthy';
}

export function buildRdpFrameBackpressureUpdate(
  sessionId: string,
  metrics: RdpFramePipelineMetrics,
  pressureState: RdpFramePressureState,
  options: Pick<NormalizedBackpressureOptions, 'renderer' | 'isVisible' | 'isDetached' | 'nowMs'>,
): RdpFrameBackpressureUpdate {
  return {
    sessionId,
    queuedFrames: metrics.queuedFrames,
    droppedFrames: metrics.droppedFrames,
    coalescedFrames: metrics.coalescedFrames,
    averageRenderMs: metrics.averageRenderMs,
    renderer: options.renderer ?? metrics.renderer,
    queueDepth: metrics.queuedFrames,
    queuedBytes: metrics.queuedBytes,
    lastFrameRenderMs: metrics.lastFrameRenderMs,
    p95RenderMs: metrics.p95RenderMs,
    presentedFrames: metrics.presentedFrames,
    isVisible: options.isVisible,
    isDetached: options.isDetached,
    pressureState,
    timestampMs: options.nowMs(),
  };
}

export function useRdpFrameBackpressure(
  options: UseRdpFrameBackpressureOptions,
): UseRdpFrameBackpressureResult {
  const [pressureState, setPressureState] = useState<RdpFramePressureState>('healthy');
  const [lastUpdate, setLastUpdate] = useState<RdpFrameBackpressureUpdate | null>(null);
  const pressureStateRef = useRef<RdpFramePressureState>('healthy');
  const lastSentAtMsRef = useRef(0);
  const optionsRef = useRef<NormalizedBackpressureOptions | null>(null);

  const activeCadenceMs = normalizeCadence(options.activeCadenceMs, DEFAULT_ACTIVE_CADENCE_MS);
  const quietCadenceMs = normalizeCadence(options.quietCadenceMs, DEFAULT_QUIET_CADENCE_MS);
  const watermarks = normalizeWatermarks(options.watermarks);
  const enabled = options.enabled ?? true;
  const isVisible = options.isVisible ?? true;
  const isDetached = options.isDetached ?? false;

  optionsRef.current = {
    sessionId: options.sessionId,
    getMetrics: options.getMetrics,
    sender: options.sender ?? noopSender,
    enabled,
    renderer: options.renderer,
    isVisible,
    isDetached,
    activeCadenceMs,
    quietCadenceMs,
    watermarks,
    nowMs: options.nowMs ?? Date.now,
  };

  const sampleTelemetry = useCallback(async (force: boolean) => {
    const currentOptions = optionsRef.current;
    if (!currentOptions?.enabled || !currentOptions.sessionId) return null;

    const metrics = currentOptions.getMetrics();
    if (!metrics) return null;

    const nextPressureState = resolveRdpFramePressureState(
      metrics,
      pressureStateRef.current,
      currentOptions.watermarks,
    );
    const pressureChanged = nextPressureState !== pressureStateRef.current;
    if (pressureChanged) {
      pressureStateRef.current = nextPressureState;
      setPressureState(nextPressureState);
    }

    const update = buildRdpFrameBackpressureUpdate(
      currentOptions.sessionId,
      metrics,
      nextPressureState,
      currentOptions,
    );
    const cadenceMs = currentOptions.isDetached || nextPressureState === 'backpressured'
      ? currentOptions.quietCadenceMs
      : currentOptions.activeCadenceMs;
    const canSend = force || pressureChanged || update.timestampMs - lastSentAtMsRef.current >= cadenceMs;
    if (!canSend) return null;

    lastSentAtMsRef.current = update.timestampMs;
    setLastUpdate(update);
    await currentOptions.sender(update);
    return update;
  }, []);

  useEffect(() => {
    if (!enabled || !options.sessionId || typeof window === 'undefined') return;

    let cancelled = false;
    const intervalMs = Math.min(activeCadenceMs, quietCadenceMs);
    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void sampleTelemetry(false).catch(() => undefined);
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeCadenceMs, enabled, options.sessionId, quietCadenceMs, sampleTelemetry]);

  const sampleNow = useCallback(() => sampleTelemetry(true), [sampleTelemetry]);

  const reset = useCallback(() => {
    pressureStateRef.current = 'healthy';
    lastSentAtMsRef.current = 0;
    setPressureState('healthy');
    setLastUpdate(null);
  }, []);

  return {
    pressureState,
    lastUpdate,
    sampleNow,
    reset,
  };
}

function normalizeWatermarks(
  watermarks: Partial<RdpFrameBackpressureWatermarks> | undefined,
): RdpFrameBackpressureWatermarks {
  const merged = {
    ...DEFAULT_RDP_FRAME_BACKPRESSURE_WATERMARKS,
    ...(watermarks ?? {}),
  };
  return {
    highQueueDepth: Math.max(1, Math.floor(merged.highQueueDepth)),
    lowQueueDepth: Math.max(0, Math.floor(Math.min(merged.lowQueueDepth, merged.highQueueDepth))),
    highAverageRenderMs: Math.max(1, merged.highAverageRenderMs),
    lowAverageRenderMs: Math.max(0, Math.min(merged.lowAverageRenderMs, merged.highAverageRenderMs)),
  };
}

function normalizeCadence(value: number | undefined, fallback: number): number {
  return Math.max(50, Math.floor(value ?? fallback));
}