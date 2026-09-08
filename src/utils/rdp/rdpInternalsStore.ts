import { useCallback, useSyncExternalStore } from "react";
import type {
  ConnectionSession,
  RDPConnectionSettings,
} from "../../types/connection/connection";
import type {
  RDPLifecycleEvent,
  RDPStatsEvent,
  RDPTimingEvent,
  RdpFramePressureState,
  RdpFrameBackpressureUpdate,
} from "../../types/rdp/rdpEvents";

/** Low-frequency presentation state only. No frames, connections or credentials. */
export interface RdpInternalsSnapshot {
  connectionStatus: ConnectionSession["status"];
  desktopSize: { width: number; height: number };
  renderActive: boolean;
  rdpSettings: RDPConnectionSettings;
  colorDepth: number;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  perfLabel: string;
  certFingerprint: string | null;
  stats: RDPStatsEvent | null;
  lifecycle: RDPLifecycleEvent | null;
  connectTiming: RDPTimingEvent | null;
  activeRenderBackend: string;
  activeFrontendRenderer: string;
  framePressureState: RdpFramePressureState;
  frameBackpressureTelemetry: RdpFrameBackpressureUpdate | null;
}

// Explicit allowlist: RDP settings can also contain gateway passwords and tokens.
export function internalsDisplaySettings(
  settings: RDPConnectionSettings,
): RDPConnectionSettings {
  return {
    display: {
      width: settings.display?.width,
      height: settings.display?.height,
    },
    audio: { playbackMode: settings.audio?.playbackMode },
    input: {
      keyboardLayout: settings.input?.keyboardLayout,
      mouseMode: settings.input?.mouseMode,
    },
    security: {
      enableNla: settings.security?.enableNla,
      enableTls: settings.security?.enableTls,
    },
    performance: {
      frameBatching: settings.performance?.frameBatching,
      targetFps: settings.performance?.targetFps,
      disableWallpaper: settings.performance?.disableWallpaper,
      disableFullWindowDrag: settings.performance?.disableFullWindowDrag,
      disableMenuAnimations: settings.performance?.disableMenuAnimations,
      disableTheming: settings.performance?.disableTheming,
      enableFontSmoothing: settings.performance?.enableFontSmoothing,
      enableDesktopComposition: settings.performance?.enableDesktopComposition,
    },
    advanced: {
      readTimeoutMs: settings.advanced?.readTimeoutMs,
      fullFrameSyncInterval: settings.advanced?.fullFrameSyncInterval,
    },
  };
}

const snapshots = new Map<
  string,
  { owner: symbol; value: RdpInternalsSnapshot }
>();
const subscribers = new Map<string, Set<() => void>>();
const notify = (sessionId: string) =>
  subscribers.get(sessionId)?.forEach((listener) => listener());

export const rdpInternalsStore = {
  getSnapshot: (sessionId: string): RdpInternalsSnapshot | null =>
    snapshots.get(sessionId)?.value ?? null,
  publish(sessionId: string, owner: symbol, value: RdpInternalsSnapshot) {
    const previous = snapshots.get(sessionId);
    if (previous?.owner === owner && previous.value === value) return;
    snapshots.set(sessionId, { owner, value });
    notify(sessionId);
  },
  remove(sessionId: string, owner: symbol) {
    if (snapshots.get(sessionId)?.owner !== owner) return;
    snapshots.delete(sessionId);
    notify(sessionId);
  },
  subscribe(sessionId: string, listener: () => void) {
    const listeners = subscribers.get(sessionId) ?? new Set<() => void>();
    listeners.add(listener);
    subscribers.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) subscribers.delete(sessionId);
    };
  },
};

export function useRdpInternalsSnapshot(sessionId: string, active = true) {
  const subscribe = useCallback(
    (listener: () => void) =>
      active ? rdpInternalsStore.subscribe(sessionId, listener) : () => {},
    [sessionId, active],
  );
  const getSnapshot = useCallback(
    () => rdpInternalsStore.getSnapshot(sessionId),
    [sessionId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
