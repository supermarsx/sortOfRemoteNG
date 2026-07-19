import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { debugLog } from '../../utils/core/debugLogger';
import { ConnectionSession, Connection } from '../../types/connection/connection';
import { ClipboardDirection, RDPConnectionSettings, DEFAULT_RDP_SETTINGS } from '../../types/connection/connection';
import { mergeRdpSettings } from '../../utils/rdp/rdpSettingsMerge';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import * as macroService from '../../utils/recording/macroService';
import { useConnections } from '../../contexts/useConnections';
import { resolveRuntimeConnection } from '../../utils/session/runtimeConnectionRegistry';
import { useSettings } from '../../contexts/SettingsContext';
import { useToastContext } from '../../contexts/ToastContext';
import {
  verifyIdentity,
  trustIdentity,
  resolveEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../../utils/auth/trustStore';
import type { FrontendRendererType } from '../../components/rdp/rdpRenderers';
import { RdpFramePipeline, type FrameSchedulingMode } from '../../components/rdp/rdpFramePipeline';
import { useRdpFrameBackpressure } from './useRdpFrameBackpressure';
import { useSessionRecorder } from '../recording/useSessionRecorder';
import type { RDPStatusEvent, RDPPointerEvent, RDPStatsEvent, RdpCertFingerprintEvent, RDPTimingEvent, RDPLifecycleEvent } from '../../types/rdp/rdpEvents';
import { mouseButtonCode, keyToScancode } from '../../utils/rdp/rdpKeyboard';
import {
  formatRuntimeNetworkPathError,
  resolveRuntimeNetworkPath,
  type RuntimeNetworkPath,
} from '../../utils/network/resolveRuntimeNetworkPath';
import {
  acquireSessionVpnLeases,
  createVpnLeaseAttemptOwnerId,
  releaseSessionVpnLeases,
  vpnLeaseCleanupError,
} from '../../utils/network/vpnSessionLeases';

const asImageDataArray = (data: Uint8ClampedArray): ImageDataArray =>
  data as Uint8ClampedArray<ArrayBuffer>;

interface VpnLeaseOwnerTracker {
  current: string | null;
  persisted: string | null;
  pending: Set<string>;
}

const MAX_TRACKED_VPN_LEASE_OWNERS = 32;

const trackedVpnLeaseOwnerIds = (tracker: VpnLeaseOwnerTracker): string[] => {
  const owners = new Set<string>(tracker.pending);
  if (tracker.current) owners.add(tracker.current);
  if (tracker.persisted) owners.add(tracker.persisted);
  return [...owners];
};

const trackPendingVpnLeaseOwner = (
  tracker: VpnLeaseOwnerTracker,
  ownerId: string,
): void => {
  if (trackedVpnLeaseOwnerIds(tracker).includes(ownerId)) {
    tracker.pending.add(ownerId);
    return;
  }
  if (trackedVpnLeaseOwnerIds(tracker).length >= MAX_TRACKED_VPN_LEASE_OWNERS) {
    throw new Error(
      'VPN cleanup is still pending for too many RDP attempts. Retry disconnect before reconnecting.',
    );
  }
  tracker.pending.add(ownerId);
};

const persistTrackedVpnLeaseOwners = (
  tracker: VpnLeaseOwnerTracker,
): Pick<ConnectionSession, 'vpnLeaseOwnerId' | 'vpnLeaseOwnerIds'> => {
  const ownerIds = trackedVpnLeaseOwnerIds(tracker).slice(
    0,
    MAX_TRACKED_VPN_LEASE_OWNERS,
  );
  const primaryOwnerId =
    tracker.current ?? tracker.persisted ?? ownerIds[0] ?? null;
  tracker.persisted = primaryOwnerId;
  return {
    vpnLeaseOwnerId: primaryOwnerId ?? undefined,
    vpnLeaseOwnerIds: ownerIds.length > 0 ? ownerIds : undefined,
  };
};

// ─── Hook ────────────────────────────────────────────────────────────

export function useRDPClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();

  // ─── Refs ──────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Stable ref for the configured renderer type (avoids stale closure in event listeners). */
  const frontendRendererTypeRef = useRef<FrontendRendererType>('auto');
  /** Accumulates fractional wheel deltas for smooth scrolling. */
  const wheelAccumRef = useRef({ v: 0, h: 0 });

  // ─── Derived values (needed before pipeline init) ─────────────────

  const connection = resolveRuntimeConnection(state.connections, session.connectionId);

  const rdpSettings: RDPConnectionSettings = useMemo(
    () => mergeRdpSettings(connection?.rdpSettings, settings.rdpDefaults),
    [connection?.rdpSettings, settings.rdpDefaults],
  );

  // ─── Frame pipeline (lives entirely outside React) ────────────────

  /** The pipeline owns the frame queue, render loop, renderer, and canvas
   *  context.  It never triggers React re-renders. */
  const pipelineRef = useRef<RdpFramePipeline | null>(null);
  if (!pipelineRef.current) {
    const perf = rdpSettings.performance;
    pipelineRef.current = new RdpFramePipeline({
      scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
      tripleBuffering: perf?.tripleBuffering ?? true,
    });
  }
  // Legacy compat shims so the rest of the hook can still reach these.
  // Always go through pipelineRef so we never read from a stale/destroyed pipeline.
  // Wrapped in useMemo so they are referentially stable across renders.
  const frameBufferRef = useMemo(() => ({ get current() { return pipelineRef.current?.getFrameBuffer() ?? null; } }), []);
  const rendererRef = useMemo(() => ({ get current() { return pipelineRef.current?.getRenderer() ?? null; } }), []);

  // ─── State ─────────────────────────────────────────────────────────

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rdpSessionId, setRdpSessionId] = useState<string | null>(null);
  const [desktopSize, setDesktopSize] = useState({ width: 1920, height: 1080 });
  const [pointerStyle, setPointerStyle] = useState<string>('default');
  const [showInternals, setShowInternals] = useState(false);
  const [stats, setStats] = useState<RDPStatsEvent | null>(null);
  const [lifecycle, setLifecycle] = useState<RDPLifecycleEvent | null>(null);
  const [magnifierActive, setMagnifierActive] = useState(false);
  // Sync magnifier state into the pipeline (outside React render cycle).
  pipelineRef.current?.setMagnifierActive(magnifierActive);
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const [certFingerprint, setCertFingerprint] = useState<string | null>(null);
  const [certIdentity, setCertIdentity] = useState<CertIdentity | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const [connectTiming, setConnectTiming] = useState<RDPTimingEvent | null>(null);
  /** Which render backend the session is actually using (set from Rust event). */
  const [activeRenderBackend, setActiveRenderBackend] = useState<string>('webview');
  /** Which frontend renderer is actually active (may differ from config if fallback). */
  const [activeFrontendRenderer, setActiveFrontendRenderer] = useState<string>('canvas2d');

  const {
    pressureState: framePressureState,
    lastUpdate: frameBackpressureTelemetry,
    reset: resetFrameBackpressure,
  } = useRdpFrameBackpressure({
    sessionId: rdpSessionId,
    enabled: isConnected && !!rdpSessionId,
    getMetrics: () => pipelineRef.current?.getMetrics() ?? null,
    renderer: activeFrontendRenderer,
    isDetached: !isConnected,
    sender: async (update) => {
      await invoke('rdp_report_frame_telemetry', {
        payload: {
          sessionId: update.sessionId,
          queuedFrames: update.queuedFrames,
          droppedFrames: update.droppedFrames,
          coalescedFrames: update.coalescedFrames,
          averageRenderMs: update.averageRenderMs,
        },
      });
    },
  });

  // Track current session ID for event filtering
  const sessionIdRef = useRef<string | null>(null);
  const pendingRdpBackendCleanupRef = useRef(new Set<string>());
  const pendingRdpBackendOwnersRef = useRef(new Map<string, string>());
  const protectedVpnLeaseOwnersRef = useRef(new Set<string>());
  // VPN ownership persists with a backend RDP session so a view-only unmount
  // can reattach without tearing down the path that session still needs.
  const initialVpnLeaseOwners = [
    ...new Set(
      [...(session.vpnLeaseOwnerIds ?? []), session.vpnLeaseOwnerId].filter(
        (ownerId): ownerId is string => Boolean(ownerId),
      ),
    ),
  ].slice(0, MAX_TRACKED_VPN_LEASE_OWNERS);
  const initialVpnLeaseOwner =
    session.vpnLeaseOwnerId ?? initialVpnLeaseOwners[0] ?? null;
  const vpnLeaseOwnersRef = useRef<VpnLeaseOwnerTracker>({
    current: initialVpnLeaseOwner,
    persisted: initialVpnLeaseOwner,
    pending: new Set(
      initialVpnLeaseOwners.filter(
        (ownerId) => ownerId !== initialVpnLeaseOwner,
      ),
    ),
  });
  const vpnLeaseReleasesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  // Tracks an SSH local-forward tunnel established for an imported mRemoteNG
  // SSH-tunnel/jump connection (RDP-through-SSH). Holds the backend SSH session
  // id and the RDP tunnel id so they can be torn down on disconnect/unmount.
  // Null when the RDP connection is direct (no imported tunnel layer).
  const rdpTunnelRef = useRef<{ sshSessionId: string; tunnelId: string } | null>(null);
  // Stable indirection so callbacks defined before teardownRdpTunnel (handleDisconnect,
  // cleanup) can trigger tunnel teardown without a temporal-dead-zone reference.
  const teardownRdpTunnelRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Generation counter to detect stale async continuations (StrictMode double-mount).
  // Each initializeRDPConnection call increments this; after every await, we check
  // if it still matches to avoid overwriting state from a newer init.
  const initGenRef = useRef(0);

  // Session recording
  const { state: recState, startRecording, stopRecording, pauseRecording, resumeRecording } = useSessionRecorder(canvasRef);

  const magnifierEnabled = rdpSettings.display?.magnifierEnabled ?? false;
  const [magnifierZoomOverride, setMagnifierZoomOverride] = useState<number | null>(null);
  const magnifierZoom = magnifierZoomOverride ?? rdpSettings.display?.magnifierZoom ?? 3;
  const setMagnifierZoom = useCallback((z: number) => {
    setMagnifierZoomOverride(Math.max(2, Math.min(8, z)));
  }, []);
  const [magnifierCorner, setMagnifierCorner] = useState<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'>('bottom-right');
  const [magnifierPipSize, setMagnifierPipSize] = useState(280);

  // Refs for values used inside stable event listeners / connection effect.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const rdpSettingsRef = useRef(rdpSettings);
  rdpSettingsRef.current = rdpSettings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Live connection-store snapshot for chain/tunnel resolution inside the
  // stable (deps: []) tunnel-establishment callback.
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;
  // Keep the renderer type ref in sync with the resolved settings
  frontendRendererTypeRef.current = (rdpSettings.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;

  const mouseEnabled = rdpSettings.input?.mouseEnabled ?? true;
  const keyboardEnabled = rdpSettings.input?.keyboardEnabled ?? true;
  const scrollSpeed = rdpSettings.input?.scrollSpeed ?? 1.0;
  const smoothScroll = rdpSettings.input?.smoothScroll ?? true;
  const localCursorMode = rdpSettings.input?.localCursor ?? 'remote';

  const perfLabel = rdpSettings.performance?.connectionSpeed ?? 'broadband-high';
  const audioEnabled = (rdpSettings.audio?.playbackMode ?? 'local') === 'local';
  const clipboardEnabled = rdpSettings.deviceRedirection?.clipboard ?? true;
  const clipboardDirection = rdpSettings.deviceRedirection?.clipboardDirection ?? 'bidirectional';
  const clipboardCanSendToRemote = clipboardEnabled && (
    clipboardDirection === 'bidirectional' || clipboardDirection === 'client-to-server'
  );
  const clipboardCanReceiveFromRemote = clipboardEnabled && (
    clipboardDirection === 'bidirectional' || clipboardDirection === 'server-to-client'
  );
  const colorDepth = rdpSettings.display?.colorDepth ?? 32;

  const isCanvasReleaseCombo = useCallback((event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey'>) => {
    return event.ctrlKey && event.altKey && (event.code === 'End' || event.key === 'End');
  }, []);

  const isClipboardDirectionEnabled = useCallback((direction: ClipboardDirection) => {
    const current = rdpSettingsRef.current.deviceRedirection?.clipboardDirection ?? 'bidirectional';
    const enabled = rdpSettingsRef.current.deviceRedirection?.clipboard ?? true;
    if (!enabled) return false;
    return current === 'bidirectional' || current === direction;
  }, []);

  const releaseVpnLeaseOwner = useCallback(async (ownerId: string): Promise<boolean> => {
    const existing = vpnLeaseReleasesRef.current.get(ownerId);
    if (existing) return existing;

    const release = (async (): Promise<boolean> => {
      try {
        const result = await releaseSessionVpnLeases(ownerId);
        const cleanupError = vpnLeaseCleanupError(result);
        if (cleanupError) {
          toast.warning(`VPN cleanup needs attention: ${cleanupError}`, 5000);
        }
        return !cleanupError;
      } catch (error) {
        debugLog(`VPN lease release failed for ${ownerId}: ${error}`);
        toast.warning('VPN cleanup failed; it will be retried on the next disconnect', 5000);
        return false;
      }
    })();

    vpnLeaseReleasesRef.current.set(ownerId, release);
    try {
      return await release;
    } finally {
      vpnLeaseReleasesRef.current.delete(ownerId);
    }
  }, [toast]);

  const settleVpnLeaseOwner = useCallback(async (ownerId: string): Promise<boolean> => {
    const tracked = vpnLeaseOwnersRef.current;
    if (!trackedVpnLeaseOwnerIds(tracked).includes(ownerId)) {
      return true;
    }

    const confirmed = await releaseVpnLeaseOwner(ownerId);
    const tracker = vpnLeaseOwnersRef.current;
    if (!confirmed) {
      trackPendingVpnLeaseOwner(tracker, ownerId);
      const updatedSession = {
        ...sessionRef.current,
        ...persistTrackedVpnLeaseOwners(tracker),
      };
      sessionRef.current = updatedSession;
      dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
      return false;
    }

    tracker.pending.delete(ownerId);
    if (tracker.current === ownerId) tracker.current = null;
    if (tracker.persisted === ownerId) tracker.persisted = null;
    const updatedSession = {
      ...sessionRef.current,
      ...persistTrackedVpnLeaseOwners(tracker),
    };
    sessionRef.current = updatedSession;
    dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
    return true;
  }, [dispatch, releaseVpnLeaseOwner]);

  const releaseOwnedVpnLeases = useCallback(async (): Promise<boolean> => {
    const ownerIds = trackedVpnLeaseOwnerIds(vpnLeaseOwnersRef.current).filter(
      ownerId => !protectedVpnLeaseOwnersRef.current.has(ownerId),
    );
    const results: boolean[] = [];
    for (const ownerId of ownerIds) {
      results.push(await settleVpnLeaseOwner(ownerId));
    }
    return results.every(Boolean);
  }, [settleVpnLeaseOwner]);

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleScreenshot = useCallback(async () => {
    const sid = session.backendSessionId || rdpSessionId;
    if (!sid || desktopSize.width === 0) return;
    try {
      const filePath = await saveDialog({
        defaultPath: `screenshot-${session.name || 'rdp'}-${Date.now()}.png`,
        filters: [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
          { name: 'BMP Image', extensions: ['bmp'] },
        ],
      });
      if (filePath) {
        await invoke('rdp_save_screenshot', { sessionId: sid, filePath });
        toast.success('Screenshot saved to file');
      }
    } catch (error) {
      console.error('Screenshot failed:', error);
      toast.error('Screenshot failed. Check the console for details.');
    }
  }, [session, rdpSessionId, desktopSize, toast]);

  const handleScreenshotToClipboard = useCallback(async () => {
    if (desktopSize.width === 0) return;
    try {
      const fb = frameBufferRef.current;
      const canvas = canvasRef.current;

      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = desktopSize.width;
      tmpCanvas.height = desktopSize.height;
      const tmpCtx = tmpCanvas.getContext('2d');
      if (!tmpCtx) return;

      if (fb && fb.hasPainted && canvas) {
        fb.syncFromVisible(canvas);
        tmpCtx.drawImage(fb.offscreen, 0, 0);
      } else if (canvas) {
        tmpCtx.drawImage(canvas, 0, 0);
      } else {
        return;
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        tmpCanvas.toBlob(resolve, 'image/png')
      );
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        toast.success('Screenshot copied to clipboard');
      } else {
        toast.error('Screenshot failed: could not capture canvas');
      }
    } catch (error) {
      console.error('Screenshot to clipboard failed:', error);
      toast.error('Failed to copy screenshot to clipboard');
    }
  }, [desktopSize, toast, frameBufferRef]);

  const handleStartRecording = useCallback((format: string) => {
    startRecording(format);
    toast.info('Recording started', 2000);
  }, [startRecording, toast]);

  const handlePauseRecording = useCallback(() => {
    pauseRecording();
    toast.warning('Recording paused', 2000);
  }, [pauseRecording, toast]);

  const handleResumeRecording = useCallback(() => {
    resumeRecording();
    toast.info('Recording resumed', 2000);
  }, [resumeRecording, toast]);

  const handleStopRecording = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob) return;
    try {
      const format = recState.format || 'webm';
      const connName = connection?.name || session.name || 'RDP';
      const host = session.hostname;
      const name = `${connName} - ${new Date().toLocaleString()}`;

      const saved = await macroService.blobToRdpRecording(blob, {
        name,
        connectionId: session.connectionId,
        connectionName: connName,
        host,
        durationMs: recState.duration * 1000,
        format,
        width: desktopSize.width,
        height: desktopSize.height,
      });
      await macroService.saveRdpRecording(saved);

      // Enforce max recordings limit
      const maxRecordings = settings.rdpRecording?.maxStoredRdpRecordings ?? 50;
      if (maxRecordings > 0) {
        await macroService.trimRdpRecordings(maxRecordings);
      }

      toast.success('Recording saved to library', 3000);
    } catch (error) {
      console.error('Recording save failed:', error);
      toast.error('Failed to save recording', 3000);
    }
  }, [stopRecording, recState.format, recState.duration, session, connection, desktopSize, settings.rdpRecording, toast]);

  const handleDisconnect = useCallback(async () => {
    initGenRef.current++; // abort any in-flight init
    const sid = sessionIdRef.current;
    const backendSessionIds = [
      ...new Set(
        [
          ...pendingRdpBackendCleanupRef.current,
          sid,
          sessionRef.current.backendSessionId,
        ].filter((sessionId): sessionId is string => Boolean(sessionId)),
      ),
    ];
    for (const backendSessionId of backendSessionIds) {
      try {
        await invoke('disconnect_rdp', { sessionId: backendSessionId });
      } catch (e) {
        pendingRdpBackendCleanupRef.current.add(backendSessionId);
        debugLog(`Disconnect error: ${e}`);
        const message = `RDP disconnect failed: ${String(e)}`;
        const updatedSession = {
          ...sessionRef.current,
          backendSessionId,
          status: 'error' as const,
          errorMessage: message,
          ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
        };
        sessionRef.current = updatedSession;
        dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
        setConnectionStatus('error');
        setStatusMessage(message);
        return false;
      }
      pendingRdpBackendCleanupRef.current.delete(backendSessionId);
      const pendingOwnerId =
        pendingRdpBackendOwnersRef.current.get(backendSessionId);
      if (pendingOwnerId) {
        protectedVpnLeaseOwnersRef.current.delete(pendingOwnerId);
        pendingRdpBackendOwnersRef.current.delete(backendSessionId);
      }
      if (sessionIdRef.current === backendSessionId) {
        sessionIdRef.current = null;
      }
    }
    // Tear down any imported-mRemoteNG SSH tunnel backing this session.
    await teardownRdpTunnelRef.current();
    const vpnClean = await releaseOwnedVpnLeases();
    sessionIdRef.current = null;
    setRdpSessionId(null);
    setIsConnected(false);
    const cleanupMessage = vpnClean
      ? undefined
      : 'RDP disconnected, but VPN cleanup needs attention. Disconnect again to retry.';
    setConnectionStatus(vpnClean ? 'disconnected' : 'error');
    setStatusMessage(cleanupMessage ?? 'Disconnected by user');
    const updatedSession = {
      ...sessionRef.current,
      backendSessionId: undefined,
      status: vpnClean ? ('disconnected' as const) : ('error' as const),
      errorMessage: cleanupMessage,
      ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
    };
    sessionRef.current = updatedSession;
    dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
    pipelineRef.current!.destroy();
    {
      const perf = rdpSettingsRef.current.performance;
      pipelineRef.current = new RdpFramePipeline({
        scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
        tripleBuffering: perf?.tripleBuffering ?? true,
      });
    }
    return vpnClean;
  }, [releaseOwnedVpnLeases]);

  const handleCopyToClipboard = useCallback(async () => {
    // If CLIPRDR is active, request clipboard text from the remote session.
    // The response arrives as an rdp://clipboard-data event which writes to
    // navigator.clipboard automatically.  Fall back to screenshot capture.
    if (isConnected && sessionIdRef.current && clipboardCanReceiveFromRemote) {
      try {
        await invoke('rdp_clipboard_paste', { sessionId: sessionIdRef.current });
        return;
      } catch {
        // CLIPRDR not available — fall back to screenshot
      }
    }
    await handleScreenshotToClipboard();
  }, [handleScreenshotToClipboard, isConnected, clipboardCanReceiveFromRemote]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (!isConnected || !sessionIdRef.current) return;
    if (!clipboardCanSendToRemote) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      // Use CLIPRDR protocol when available (proper clipboard redirection)
      if (clipboardCanSendToRemote) {
        try {
          await invoke('rdp_clipboard_copy', { sessionId: sessionIdRef.current, text });
          return;
        } catch {
          // CLIPRDR not available — fall back to Unicode keyboard injection
        }
      }

      // Fallback: inject text as Unicode keyboard events
      const events: Record<string, unknown>[] = [];
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        events.push({ type: 'UnicodeKey', code, pressed: true });
        events.push({ type: 'UnicodeKey', code, pressed: false });
      }
      if (events.length > 0) {
        await invoke('rdp_send_input', { sessionId: sessionIdRef.current, events });
      }
    } catch (e) {
      console.error('Paste from clipboard failed:', e);
    }
  }, [isConnected, clipboardCanSendToRemote]);

  const handleSendKeys = useCallback((combo: string) => {
    if (!isConnected || !sessionIdRef.current) return;
    const combos: Record<string, { scancode: number; extended: boolean }[]> = {
      'ctrl-alt-del': [
        { scancode: 0x1D, extended: false },
        { scancode: 0x38, extended: false },
        { scancode: 0x53, extended: true },
      ],
      'alt-tab': [
        { scancode: 0x38, extended: false },
        { scancode: 0x0F, extended: false },
      ],
      'win': [
        { scancode: 0x5B, extended: true },
      ],
      'alt-f4': [
        { scancode: 0x38, extended: false },
        { scancode: 0x3E, extended: false },
      ],
      'print-screen': [
        { scancode: 0x37, extended: true },
      ],
      'win-l': [
        { scancode: 0x5B, extended: true },
        { scancode: 0x26, extended: false },
      ],
      'win-r': [
        { scancode: 0x5B, extended: true },
        { scancode: 0x13, extended: false },
      ],
    };

    const keys = combos[combo];
    if (!keys) return;

    const events: Record<string, unknown>[] = [];
    for (const k of keys) {
      events.push({ type: 'KeyboardKey', scancode: k.scancode, pressed: true, extended: k.extended });
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      events.push({ type: 'KeyboardKey', scancode: keys[i].scancode, pressed: false, extended: keys[i].extended });
    }

    invoke('rdp_send_input', { sessionId: sessionIdRef.current, events }).catch(e => {
      debugLog(`Send keys error: ${e}`);
    });
  }, [isConnected]);

  const handleSignOut = useCallback(() => {
    if (!sessionIdRef.current) return;
    invoke('rdp_sign_out', { sessionId: sessionIdRef.current }).catch(e => {
      debugLog(`Sign out error: ${e}`);
    });
  }, []);

  const handleForceReboot = useCallback(() => {
    if (!sessionIdRef.current) return;
    invoke('rdp_force_reboot', { sessionId: sessionIdRef.current }).catch(e => {
      debugLog(`Force reboot error: ${e}`);
    });
  }, []);

  const handleAutoTypeTOTP = useCallback((code: string) => {
    if (!isConnected || !sessionIdRef.current) return;
    const digitScancodes: Record<string, number> = {
      '0': 0x0B, '1': 0x02, '2': 0x03, '3': 0x04, '4': 0x05,
      '5': 0x06, '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0A,
    };
    const events: Record<string, unknown>[] = [];
    for (const ch of code) {
      const sc = digitScancodes[ch];
      if (sc !== undefined) {
        events.push({ type: 'KeyboardKey', scancode: sc, pressed: true, extended: false });
        events.push({ type: 'KeyboardKey', scancode: sc, pressed: false, extended: false });
      }
    }
    if (events.length > 0) {
      invoke('rdp_send_input', { sessionId: sessionIdRef.current, events }).catch(e => {
        debugLog(`Auto-type TOTP error: ${e}`);
      });
    }
  }, [isConnected]);

  // ─── SSH-tunnel (imported mRemoteNG RDP-through-SSH) ────────────────

  /**
   * Tear down any SSH local-forward tunnel established for this RDP session.
   * Stops the RDP port forward (`stop_rdp_tunnel`) and closes the SSH session
   * (`disconnect_ssh`). Safe to call when no tunnel is active. Never throws.
   */
  const teardownRdpTunnel = useCallback(async () => {
    const t = rdpTunnelRef.current;
    if (!t) return;
    rdpTunnelRef.current = null;
    try {
      await invoke('stop_rdp_tunnel', { tunnelId: t.tunnelId });
    } catch (e) {
      debugLog(`stop_rdp_tunnel error: ${e}`);
    }
    try {
      await invoke('disconnect_ssh', { sessionId: t.sshSessionId });
    } catch (e) {
      debugLog(`tunnel disconnect_ssh error: ${e}`);
    }
  }, []);
  teardownRdpTunnelRef.current = teardownRdpTunnel;

  /**
   * If the strict runtime path ends at an SSH bastion, establish an SSH session
   * and forward the real RDP target through it via `setup_rdp_tunnel`.
   * Returns the local `{ host, port }` that RDP should dial (127.0.0.1:<port>),
   * or null when no tunnel is needed (direct connect). Throws on tunnel failure
   * so the caller surfaces a connection error rather than silently bypassing
   * the tunnel and dialing the target directly.
   */
  const establishRdpTunnel = useCallback(
    async (
      runtimePath: RuntimeNetworkPath,
      conn: Connection,
      targetHost: string,
      targetPort: number,
    ): Promise<{ host: string; port: number } | null> => {
      if (!runtimePath.rdpTunnel) return null;

      const bastion = runtimePath.rdpTunnel.bastion;
      const resolved = runtimePath.transport;

      const sshConfig: Record<string, unknown> = {
        host: bastion.host,
        port: bastion.port || 22,
        username: bastion.username || '',
        password: bastion.password ?? null,
        private_key_path: bastion.private_key_path ?? null,
        private_key_passphrase: bastion.private_key_passphrase ?? null,
        agent_forwarding: bastion.agent_forwarding ?? false,
        jump_hosts: resolved.jump_hosts,
        proxy_config: resolved.proxy_config,
        proxy_chain: resolved.proxy_chain,
        mixed_chain: resolved.mixed_chain,
        openvpn_config: resolved.openvpn_config,
      };

      const sshSessionId = await invoke<string>('connect_ssh', { config: sshConfig });
      try {
        const status = await invoke<{ tunnel_id?: string; local_port: number }>('setup_rdp_tunnel', {
          sessionId: sshSessionId,
          config: {
            remote_rdp_host: targetHost || 'localhost',
            remote_rdp_port: targetPort,
            bind_interface: '127.0.0.1',
            label: conn.name ?? null,
          },
        });
        rdpTunnelRef.current = {
          sshSessionId,
          tunnelId: status.tunnel_id ?? `rdp_${sshSessionId}`,
        };
        debugLog(`RDP-over-SSH tunnel up: 127.0.0.1:${status.local_port} -> ${targetHost}:${targetPort} via ${bastion.host}`);
        return { host: '127.0.0.1', port: status.local_port };
      } catch (e) {
        // SSH connected but the forward failed — close the SSH session so we
        // don't leak it, then surface the error.
        invoke('disconnect_ssh', { sessionId: sshSessionId }).catch(() => {});
        rdpTunnelRef.current = null;
        throw e;
      }
    },
    [],
  );

  // ─── Connection lifecycle ──────────────────────────────────────────

  const initializeRDPConnection = useCallback(async () => {
    // Generation counter: if another init starts while we're awaiting, bail
    // out to avoid clobbering its state (happens with React StrictMode
    // double-mount in dev mode).
    const gen = ++initGenRef.current;
    const stale = () => initGenRef.current !== gen;

    const conn = connectionRef.current;
    const sess = sessionRef.current;
    const rdpCfg = rdpSettingsRef.current;
    let attemptVpnLeaseOwnerId: string | null = null;

    const releaseAttemptVpnLease = async () => {
      const ownerId = attemptVpnLeaseOwnerId;
      if (!ownerId) return;
      attemptVpnLeaseOwnerId = null;
      protectedVpnLeaseOwnersRef.current.delete(ownerId);
      await settleVpnLeaseOwner(ownerId);
    };

    const stopIfStale = async (
      cleanupTarget?: () => Promise<boolean | void>,
    ) => {
      if (!stale()) return false;
      const targetClean = cleanupTarget ? await cleanupTarget() : true;
      if (targetClean !== false) await releaseAttemptVpnLease();
      console.log(`[RDP init gen=${gen}] STALE, aborting`);
      return true;
    };

    const handoffVpnLease = async () => {
      const tracker = vpnLeaseOwnersRef.current;
      const primaryOwnerIds = [
        ...new Set(
          [tracker.current, tracker.persisted].filter(
            (ownerId): ownerId is string => Boolean(ownerId),
          ),
        ),
      ];
      const nextOwnerId = attemptVpnLeaseOwnerId;
      const previousOwnerIds = primaryOwnerIds.filter(
        ownerId => !protectedVpnLeaseOwnersRef.current.has(ownerId),
      );
      for (const previousOwnerId of primaryOwnerIds) {
        if (previousOwnerId !== nextOwnerId) {
          trackPendingVpnLeaseOwner(tracker, previousOwnerId);
        }
      }
      tracker.current = nextOwnerId;
      if (nextOwnerId) {
        tracker.pending.delete(nextOwnerId);
      }

      for (const previousOwnerId of previousOwnerIds) {
        if (previousOwnerId !== nextOwnerId) {
          await settleVpnLeaseOwner(previousOwnerId);
        }
      }
    };

    const commitVpnLeaseHandoff = () => {
      if (attemptVpnLeaseOwnerId) {
        protectedVpnLeaseOwnersRef.current.delete(attemptVpnLeaseOwnerId);
      }
      attemptVpnLeaseOwnerId = null;
    };

    console.log(`[RDP init gen=${gen}] session=${sess?.id}, backendSessionId=${sess?.backendSessionId}, connectionId=${sess?.connectionId}, conn=${conn?.id ?? 'NULL'}`);
    // For reattach-only scenarios (e.g. RDP sessions panel), conn may be
    // null but backendSessionId is set.  We still proceed to attempt reattach.
    if (!conn && !sess.backendSessionId) return;

    let runtimePath: RuntimeNetworkPath | null = null;
    try {
      setConnectionStatus('connecting');
      setStatusMessage('Initiating connection...');

      const currentPipeline = pipelineRef.current!;
      const frameChannel = new Channel<ArrayBuffer>(currentPipeline.onFrame);

      // Check for existing backend session to re-attach.
      // Try by backendSessionId first (carried through detach/reattach), then
      // fall back to scanning by connection_id.
      let reattachId: string | undefined;

      try {
        const existingSessions = await invoke<Array<{
          id: string;
          connectionId?: string;
          connected: boolean;
        }>>('list_rdp_sessions');

        if (await stopIfStale()) return;

        console.log(`[RDP reattach gen=${gen}] list_rdp_sessions: ${existingSessions.length} session(s)`, existingSessions.map(s => ({ id: s.id, cid: s.connectionId, connected: s.connected })));

        // Prefer exact match by backend session ID
        const byBackend = sess.backendSessionId
          ? existingSessions.find(s => s.id === sess.backendSessionId && s.connected)
          : undefined;
        // Fall back to connectionId match
        const connId = conn?.id ?? sess.connectionId;
        const byConnection = connId
          ? existingSessions.find(s => s.connectionId === connId && s.connected)
          : undefined;

        reattachId = byBackend?.id ?? byConnection?.id;

        if (reattachId) {
          console.log(`[RDP reattach gen=${gen}] found target: ${reattachId}`);
        } else {
          console.log(`[RDP reattach gen=${gen}] no existing backend session found`);
        }
      } catch (listErr) {
        console.error('[RDP reattach] list_rdp_sessions failed:', listErr);
        toast.error('Failed to list RDP sessions', 4000);
      }

      if (await stopIfStale()) return;

      // Resolve and acquire the complete VPN path before either attaching to
      // an existing backend session or dialing a new one. The backend command
      // owns validation, readiness, rollback, and cross-session refcounts.
      if (conn) {
        setStatusMessage('Resolving network path...');
        runtimePath = await resolveRuntimeNetworkPath(
          conn,
          connectionsRef.current,
          'rdp',
        );
        if (await stopIfStale()) return;

        if (runtimePath.transport.vpnPreSteps.length > 0) {
          setStatusMessage('Establishing VPN network path...');
          attemptVpnLeaseOwnerId = createVpnLeaseAttemptOwnerId(sess.id, 'rdp');
          protectedVpnLeaseOwnersRef.current.add(attemptVpnLeaseOwnerId);
          trackPendingVpnLeaseOwner(
            vpnLeaseOwnersRef.current,
            attemptVpnLeaseOwnerId,
          );
          const trackedSession = {
            ...sessionRef.current,
            ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
          };
          sessionRef.current = trackedSession;
          dispatch({ type: 'UPDATE_SESSION', payload: trackedSession });
          await acquireSessionVpnLeases(
            attemptVpnLeaseOwnerId,
            runtimePath.transport.vpnPreSteps,
          );
          if (await stopIfStale()) return;
        }
      }

      if (reattachId) {
        debugLog(`Re-attaching to existing session ${reattachId} for ${conn?.id ?? sess.connectionId}`);
        setStatusMessage('Re-attaching to existing session...');

        try {
          const sessionInfo = await invoke<{
            id: string;
            desktopWidth: number;
            desktopHeight: number;
            serverCertFingerprint?: string | null;
            host: string;
            port: number;
          }>('attach_rdp_session', {
            sessionId: reattachId,
            connectionId: conn?.id ?? sess.connectionId,
            frameChannel,
          });

          if (await stopIfStale()) return;

          // A connection definition means this init resolved the current path.
          // Hand off the attempt lease only after target attach succeeds; this
          // also releases an older persisted owner if the path changed.
          if (conn) {
            await handoffVpnLease();
            if (await stopIfStale()) return;
            commitVpnLeaseHandoff();
          }

          setRdpSessionId(sessionInfo.id);
          sessionIdRef.current = sessionInfo.id;
          setDesktopSize({
            width: sessionInfo.desktopWidth,
            height: sessionInfo.desktopHeight,
          });

          // Restore certificate state from the backend session
          if (sessionInfo.serverCertFingerprint) {
            setCertFingerprint(sessionInfo.serverCertFingerprint);
            const now = new Date().toISOString();
            setCertIdentity({
              fingerprint: sessionInfo.serverCertFingerprint,
              subject: sessionInfo.host,
              firstSeen: now,
              lastSeen: now,
            });
          }

          const canvas = canvasRef.current;
          if (canvas) {
            // Clear stale content before reattach to prevent ghosting
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            const rendererType = (rdpCfg.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;
            currentPipeline.attach(canvas, sessionInfo.desktopWidth, sessionInfo.desktopHeight, rendererType);
            // If the pipeline replaced a transferred canvas, sync our ref
            const currentCanvas = currentPipeline.getCanvas();
            if (currentCanvas && currentCanvas !== canvasRef.current) {
              (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = currentCanvas;
            }
            setActiveFrontendRenderer(currentPipeline.getRenderer()?.name ?? 'canvas2d');
          }

          setIsConnected(true);
          setConnectionStatus('connected');
          setStatusMessage(`Re-attached (${sessionInfo.desktopWidth}x${sessionInfo.desktopHeight})`);

          const updatedSession = {
            ...sess,
            backendSessionId: sessionInfo.id,
            name: conn?.name || sess.name,
            status: 'connected' as const,
            networkPath: runtimePath?.snapshot ?? sess.networkPath,
            ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
          };
          sessionRef.current = updatedSession;
          dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
          return;
        } catch (attachErr) {
          console.error(`RDP reattach failed for session ${reattachId}:`, attachErr);
          toast.error('Failed to reattach to session', 4000);
          // Fall through to new connection (if connection details available)
        }
      }

      // If we have no connection definition, we can't create a new session
      // (reattach-only scenario where the original connection isn't in the tree).
      if (!conn) {
        setConnectionStatus('error');
        setStatusMessage('Reattach failed — backend session not found');
        return;
      }

      if (await stopIfStale()) return;
      if (!runtimePath) {
        throw new Error('RDP network path was not resolved');
      }

      // Auto-detect keyboard layout from the OS if configured
      let effectiveSettings = rdpCfg;
      if (rdpCfg.input?.autoDetectLayout !== false) {
        try {
          const detectedLayout = await invoke<number>('detect_keyboard_layout');
          if (await stopIfStale()) return;
          const langId = detectedLayout & 0xFFFF;
          if (langId && langId !== 0) {
            effectiveSettings = {
              ...rdpCfg,
              input: { ...rdpCfg.input, keyboardLayout: langId },
            };
            debugLog(`Auto-detected keyboard layout: 0x${langId.toString(16).padStart(4, '0')}`);
          }
        } catch {
          // Detection not available — use configured layout
        }
      }

      // In local cursor mode, disable software pointer rendering so IronRDP
      // emits PointerBitmap events instead of painting the cursor into the
      // frame buffer. We convert these bitmaps to CSS cursors on the
      // frontend for zero-latency cursor shape changes (hand, loading,
      // text beam, etc.).  Server pointer stays enabled so we receive the
      // shape change events.
      // In local/dot cursor mode we need:
      //   enableServerPointer: TRUE  — so IronRDP processes pointer events at all
      //   pointerSoftwareRendering: FALSE — so IronRDP emits PointerBitmap events
      //     instead of painting cursors into the frame buffer
      const cursorMode = effectiveSettings.input?.localCursor ?? 'local';
      if (cursorMode === 'local' || cursorMode === 'dot') {
        effectiveSettings = {
          ...effectiveSettings,
          security: {
            ...effectiveSettings.security,
            enableServerPointer: true,
            pointerSoftwareRendering: false,
          },
        };
      }

      const display = effectiveSettings.display ?? DEFAULT_RDP_SETTINGS.display;
      const resW = display?.width ?? 1920;
      const resH = display?.height ?? 1080;

      // A supported socket path for RDP always terminates in an SSH bastion;
      // the adapter has already rejected paths that cannot be represented.
      const targetHost = sess.hostname;
      const targetPort = conn.port || 3389;
      let dialHost = targetHost;
      let dialPort = targetPort;
      try {
        const tunnel = await establishRdpTunnel(
          runtimePath,
          conn,
          targetHost,
          targetPort,
        );
        if (tunnel) {
          if (await stopIfStale(teardownRdpTunnel)) return;
          setStatusMessage('SSH tunnel established — connecting RDP...');
          dialHost = tunnel.host;
          dialPort = tunnel.port;
        }
      } catch (tunnelErr) {
        if (await stopIfStale(teardownRdpTunnel)) return;
        throw tunnelErr;
      }

      const connectionDetails = {
        connectionId: conn.id,
        host: dialHost,
        port: dialPort,
        username: conn.username || '',
        password: conn.password || '',
        domain: conn.domain,
        width: resW,
        height: resH,
        rdpSettings: effectiveSettings,
        frameChannel,
      };

      const mergedDrives = effectiveSettings.deviceRedirection?.drives ?? [];
      console.log(`[RDP init gen=${gen}] creating NEW connection to ${connectionDetails.host}:${connectionDetails.port}`);
      console.log(`[RDP init] drives being sent to backend (${mergedDrives.length}):`, JSON.stringify(mergedDrives));
      console.log(`[RDP init] global rdpDefaults.driveRedirections:`, JSON.stringify((settings.rdpDefaults as any)?.driveRedirections));
      console.log(`[RDP init] conn deviceRedirection.drives:`, JSON.stringify(conn.rdpSettings?.deviceRedirection?.drives));
      console.log(`[RDP init] conn inheritGlobalDrives:`, conn.rdpSettings?.deviceRedirection?.inheritGlobalDrives);

      const sessionId = await invoke('connect_rdp', connectionDetails) as string;

      const cleanupOrphanedRdp = async (): Promise<boolean> => {
        try {
          await invoke('disconnect_rdp', { sessionId });
        } catch (cleanupError) {
          pendingRdpBackendCleanupRef.current.add(sessionId);
          if (attemptVpnLeaseOwnerId) {
            pendingRdpBackendOwnersRef.current.set(
              sessionId,
              attemptVpnLeaseOwnerId,
            );
          }
          const message = `RDP stale session cleanup failed: ${String(cleanupError)}. Retry disconnect before releasing its VPN route.`;
          const updatedSession = {
            ...sessionRef.current,
            backendSessionId: sessionId,
            status: 'error' as const,
            errorMessage: message,
            ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
          };
          sessionRef.current = updatedSession;
          dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
          setConnectionStatus('error');
          setStatusMessage(message);
          return false;
        }
        pendingRdpBackendCleanupRef.current.delete(sessionId);
        pendingRdpBackendOwnersRef.current.delete(sessionId);
        await teardownRdpTunnel();
        return true;
      };
      if (await stopIfStale(cleanupOrphanedRdp)) return;

      await handoffVpnLease();
      if (await stopIfStale(cleanupOrphanedRdp)) return;
      commitVpnLeaseHandoff();

      debugLog(`RDP session created: ${sessionId}`);
      setRdpSessionId(sessionId);
      sessionIdRef.current = sessionId;

      const updatedSession = {
        ...sess,
        backendSessionId: sessionId,
        name: conn.name || sess.name,
        status: 'connecting' as const,
        networkPath: runtimePath.snapshot,
        ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
      };
      sessionRef.current = updatedSession;
      dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });

      // Don't attach the pipeline here — the rdp://status 'connected'
      // handler is the single canonical attach point.  Attaching early
      // caused a double-attach race: the status handler would create a
      // *new* blank renderer, discarding any frames already painted.
    } catch (error) {
      if (await stopIfStale(teardownRdpTunnel)) return;
      await teardownRdpTunnel();
      await releaseAttemptVpnLease();
      const safeError = formatRuntimeNetworkPathError(error, runtimePath, [
        conn?.password,
        conn?.passphrase,
      ]);
      setConnectionStatus('error');
      setStatusMessage(`Connection failed: ${safeError}`);
      console.error('RDP initialization failed:', safeError);
      toast.error('RDP connection failed', 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- all mutable values read from refs
  }, []);

  const handleReconnect = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid && connectionStatus === 'reconnecting') {
      try {
        await invoke('reconnect_rdp_session', { sessionId: sid });
      } catch { /* ignore */ }
      return;
    }
    if (sid) {
      try {
        await invoke('disconnect_rdp', { sessionId: sid });
      } catch (error) {
        const message = `RDP disconnect failed: ${String(error)}`;
        const updatedSession = {
          ...sessionRef.current,
          status: 'error' as const,
          errorMessage: message,
          ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
        };
        sessionRef.current = updatedSession;
        dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
        setConnectionStatus('error');
        setStatusMessage(message);
        return;
      }
      sessionIdRef.current = null;
      setRdpSessionId(null);
    }
    await teardownRdpTunnelRef.current();
    if (!(await releaseOwnedVpnLeases())) {
      const message =
        'RDP disconnected, but VPN cleanup needs attention. Retry reconnect to finish cleanup.';
      const updatedSession = {
        ...sessionRef.current,
        backendSessionId: undefined,
        status: 'error' as const,
        errorMessage: message,
        ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
      };
      sessionRef.current = updatedSession;
      dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
      setConnectionStatus('error');
      setStatusMessage(message);
      return;
    }
    // Always destroy and recreate the pipeline to ensure no stale state carries over
    pipelineRef.current!.destroy();
    {
      const perf = rdpSettingsRef.current.performance;
      pipelineRef.current = new RdpFramePipeline({
        scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
        tripleBuffering: perf?.tripleBuffering ?? true,
      });
    }
    setConnectionStatus('connecting');
    setStatusMessage('Reconnecting...');
    initializeRDPConnection();
  }, [initializeRDPConnection, connectionStatus, releaseOwnedVpnLeases]);

  const cleanup = useCallback(async () => {
    // Bump generation so any in-flight initializeRDPConnection aborts
    initGenRef.current++;
    // Tear down any imported-mRemoteNG SSH tunnel backing this session. The
    // backend RDP session is intentionally kept for reattach (see note below),
    // but the SSH forward is per-mount and must be released.
    void teardownRdpTunnelRef.current();
    sessionIdRef.current = null;
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setRdpSessionId(null);
    pipelineRef.current!.destroy();
    {
      const perf = rdpSettingsRef.current.performance;
      pipelineRef.current = new RdpFramePipeline({
        scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
        tripleBuffering: perf?.tripleBuffering ?? true,
      });
    }
    // Note: we intentionally do NOT call detach_rdp_session here.
    // The backend session keeps running so it can be reattached on
    // page reload, layout change, or window detach.  Explicit
    // disconnect is handled by handleDisconnect, and window detach
    // is handled by useSessionDetach which calls detach_rdp_session
    // before opening the new window.
   
  }, []);

  // ─── Trust accept / reject ─────────────────────────────────────────

  const handleTrustAccept = useCallback(() => {
    const conn = connectionRef.current;
    const sess = sessionRef.current;
    if (certIdentity && conn) {
      const port = conn.port || 3389;
      trustIdentity(sess.hostname, port, 'rdp', certIdentity, true, conn.id);
    }
    setTrustPrompt(null);
  }, [certIdentity]);

  const handleTrustReject = useCallback(() => {
    setTrustPrompt(null);
    cleanup();
  }, [cleanup]);

  /** Reset error state and re-attempt connection (used by error screen). */
  const handleRetry = useCallback(() => {
    setConnectionStatus('disconnected');
    setStatusMessage('');
    setRdpSessionId(null);
    sessionIdRef.current = null;
    initializeRDPConnection();
  }, [initializeRDPConnection]);

  // ─── Unified cursor system ─────────────────────────────────────────
  // Handles three cursor types: 'arrow' (scaled SVG), 'dot' (scaled SVG),
  // and 'bitmap' (server RGBA scaled to canvas ratio).  All are rebuilt
  // on canvas resize to maintain proportional sizing.

  // The current cursor state — either a named shape or a server bitmap.
  const cursorStateRef = useRef<
    | { type: 'arrow' | 'dot' }
    | { type: 'bitmap'; rgba: Uint8ClampedArray; w: number; h: number; hx: number; hy: number }
    | null
  >(null);

  // Compute canvas-to-desktop scale ratio
  const getScaleRatio = useCallback((): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return 1;
    const desktopW = desktopSize.width || 1920;
    return Math.max(0.25, Math.min(2.0, rect.width / desktopW));
  }, [desktopSize.width]);

  // Build CSS cursor from the current cursorStateRef, applying scale.
  const applyCursorRef = useRef<() => void>(() => {});
  applyCursorRef.current = () => {
    const state = cursorStateRef.current;
    if (!state) return;
    const scale = getScaleRatio();

    if (state.type === 'dot') {
      const size = Math.round(7 * scale);
      const r = Math.max(1.5, (size - 1) / 2);
      const c = size / 2;
      const hs = Math.round(c);
      setPointerStyle(
        'url("data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
          `<circle cx="${c}" cy="${c}" r="${r}" fill="white" stroke="black" stroke-width="0.8"/>` +
          '</svg>'
        ) + `") ${hs} ${hs}, auto`
      );
      return;
    }

    if (state.type === 'arrow') {
      const w = Math.round(20 * scale);
      const h = Math.round(20 * scale);
      if (w < 8 || w > 64) { setPointerStyle('default'); return; }
      const hx = Math.round(1 * scale);
      const hy = Math.round(1 * scale);
      setPointerStyle(
        'url("data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 20 20">` +
          '<path d="M2 1 L2 17 L6.5 12.5 L10 19 L12.5 18 L9 11.5 L15 11.5 Z" ' +
          'fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>' +
          '</svg>'
        ) + `") ${hx} ${hy}, auto`
      );
      return;
    }

    if (state.type === 'bitmap') {
      const sw = Math.max(1, Math.round(state.w * scale));
      const sh = Math.max(1, Math.round(state.h * scale));
      const shx = Math.min(Math.round(state.hx * scale), sw - 1);
      const shy = Math.min(Math.round(state.hy * scale), sh - 1);
      if (sw > 128 || sh > 128) { setPointerStyle('default'); return; }

      try {
        // Draw at original size then scale
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = state.w;
        srcCanvas.height = state.h;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) { setPointerStyle('default'); return; }
        srcCtx.putImageData(new ImageData(asImageDataArray(state.rgba), state.w, state.h), 0, 0);

        // Scale to target size
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = sw;
        dstCanvas.height = sh;
        const dstCtx = dstCanvas.getContext('2d');
        if (!dstCtx) { setPointerStyle('default'); return; }
        dstCtx.imageSmoothingEnabled = true;
        dstCtx.imageSmoothingQuality = 'high';
        dstCtx.drawImage(srcCanvas, 0, 0, sw, sh);

        const png = dstCanvas.toDataURL('image/png');
        setPointerStyle(`url("${png}") ${shx} ${shy}, auto`);
      } catch {
        setPointerStyle('default');
      }
    }
  };

  // Rebuild cursor on canvas resize and desktop size change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rebuild = () => applyCursorRef.current();
    const observer = new ResizeObserver(rebuild);
    observer.observe(canvas);
    window.addEventListener('resize', rebuild);
    rebuild();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', rebuild);
    };
  }, [desktopSize.width]);  

  // Set initial cursor on connect
  useEffect(() => {
    if (!isConnected) return;
    const mode = localCursorMode;
    if (mode === 'local' || mode === 'dot') {
      cursorStateRef.current = { type: mode === 'dot' ? 'dot' : 'arrow' };
      const timer = setTimeout(() => applyCursorRef.current(), 150);
      return () => clearTimeout(timer);
    }
  }, [isConnected, localCursorMode]);

  /** Set the cursor state and apply it immediately. */
  const setCursor = (state: NonNullable<typeof cursorStateRef.current>) => {
    cursorStateRef.current = state;
    applyCursorRef.current();
  };

  // ─── Event listeners ───────────────────────────────────────────────

  useEffect(() => {
    // Track whether this effect has been cleaned up.  Tauri's listen() is
    // async, so in StrictMode the cleanup runs before the promise resolves.
    // We use this flag to immediately unlisten when the promise does resolve.
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const track = (p: Promise<UnlistenFn>) => {
      p.then(fn => {
        if (cleaned) { fn(); return; } // already unmounted — unregister immediately
        unlisteners.push(fn);
      });
    };

    track(listen<RDPStatusEvent>('rdp://status', (event) => {
      const status = event.payload;
      if (status.session_id !== sessionIdRef.current) return;

      setStatusMessage(status.message);

      switch (status.status) {
        case 'connected':
          setIsConnected(true);
          setConnectionStatus('connected');
          if (status.desktop_width && status.desktop_height) {
            setDesktopSize({ width: status.desktop_width, height: status.desktop_height });
            const canvas = canvasRef.current;
            if (canvas) {
              // Clear stale content before attach to prevent ghosting
              const clearCtx = canvas.getContext('2d');
              if (clearCtx) clearCtx.clearRect(0, 0, canvas.width, canvas.height);
              pipelineRef.current!.attach(canvas, status.desktop_width, status.desktop_height, frontendRendererTypeRef.current);
              // If the pipeline replaced a transferred canvas with a fresh
              // element (tab reorder after OffscreenCanvas), sync our ref.
              const currentCanvas = pipelineRef.current!.getCanvas();
              if (currentCanvas && currentCanvas !== canvasRef.current) {
                (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = currentCanvas;
              }
              (canvasRef.current ?? canvas).focus();
              setActiveFrontendRenderer(pipelineRef.current!.getRenderer()?.name ?? 'canvas2d');
            }
          }
          break;
        case 'connecting':
        case 'negotiating':
          setConnectionStatus('connecting');
          break;
        case 'reconnecting':
          setConnectionStatus('reconnecting');
          break;
        case 'error':
          setConnectionStatus('error');
          break;
        case 'disconnected':
          setIsConnected(false);
          void (async () => {
            await teardownRdpTunnelRef.current();
            await releaseOwnedVpnLeases();
          })();
          setConnectionStatus((prev) => {
            if (prev === 'error') return 'error';
            setRdpSessionId(null);
            sessionIdRef.current = null;
            return 'disconnected';
          });
          break;
      }
    }));

    // Track the last bitmap fingerprint to skip redundant cursor applies.
    // The server sends the same cursor bitmap on every mouse move over the
    // same element — dedup by (width, height, hotspot, first 16 bytes).
    let lastBitmapKey = '';

    track(listen<RDPPointerEvent>('rdp://pointer', (event) => {
      const ptr = event.payload;
      if (ptr.session_id !== sessionIdRef.current) return;

      const mode = rdpSettingsRef.current.input?.localCursor ?? 'local';
      switch (ptr.pointer_type) {
        case 'default':
          lastBitmapKey = '';
          if (mode === 'local' || mode === 'dot') {
            setCursor({ type: mode === 'dot' ? 'dot' : 'arrow' });
          } else {
            setPointerStyle('default');
          }
          break;
        case 'hidden':
          lastBitmapKey = '';
          if (mode === 'local') {
            setCursor({ type: 'arrow' });
          } else if (mode === 'dot') {
            setCursor({ type: 'dot' });
          } else {
            setPointerStyle('none');
          }
          break;
        case 'bitmap':
          if (ptr.bitmap_rgba && ptr.bitmap_width && ptr.bitmap_height) {
            // Dedup: skip if this is the same cursor bitmap as last time.
            // Key on dimensions + hotspot + first 16 chars of base64 data.
            const bitmapKey = `${ptr.bitmap_width}x${ptr.bitmap_height}:${ptr.hotspot_x},${ptr.hotspot_y}:${ptr.bitmap_rgba.slice(0, 16)}`;
            if (bitmapKey === lastBitmapKey) break;
            lastBitmapKey = bitmapKey;

            try {
              const w = ptr.bitmap_width;
              const h = ptr.bitmap_height;
              const hx = Math.min(ptr.hotspot_x ?? 0, w - 1);
              const hy = Math.min(ptr.hotspot_y ?? 0, h - 1);
              if (w > 256 || h > 256 || w < 1 || h < 1) break;

              const raw = atob(ptr.bitmap_rgba);
              const expectedLen = w * h * 4;
              if (raw.length !== expectedLen) break;

              // Decode base64 to Uint8ClampedArray.
              // Accelerated mode (pointerSoftwareRendering=false) gives
              // non-premultiplied alpha — no conversion needed.
              const rgba = new Uint8ClampedArray(expectedLen);
              for (let i = 0; i < expectedLen; i++) {
                rgba[i] = raw.charCodeAt(i);
              }

              setCursor({ type: 'bitmap', rgba, w, h, hx, hy });
            } catch {
              setCursor({ type: mode === 'dot' ? 'dot' : 'arrow' });
            }
          }
          break;
        case 'position':
          break;
      }
    }));

    track(listen<RDPStatsEvent>('rdp://stats', (event) => {
      const s = event.payload;
      if (s.session_id !== sessionIdRef.current) return;
      setStats(s);
      if (s.lifecycle) setLifecycle(s.lifecycle);
    }));

    track(listen<RDPLifecycleEvent>('rdp://lifecycle', (event) => {
      const snapshot = event.payload;
      if (snapshot.sessionId !== sessionIdRef.current) return;
      setLifecycle(snapshot);
    }));

    track(listen<RdpCertFingerprintEvent>('rdp://cert-fingerprint', (event) => {
      const fp = event.payload;
      if (fp.session_id !== sessionIdRef.current) return;
      setCertFingerprint(fp.fingerprint);

      const now = new Date().toISOString();
      const identity: CertIdentity = {
        fingerprint: fp.fingerprint,
        subject: fp.subject || fp.host,
        issuer: fp.issuer,
        firstSeen: now,
        lastSeen: now,
        validFrom: fp.valid_from,
        validTo: fp.valid_to,
        serial: fp.serial,
        signatureAlgorithm: fp.signature_algorithm,
        san: fp.san,
        pem: fp.pem,
      };
      setCertIdentity(identity);

      const conn = connectionRef.current;
      const connId = conn?.id;
      const currentSettings = settingsRef.current;
      // Legacy TLS is a last-resort compatibility fallback for older settings
      // shapes that do not yet have inherited RDP/root policies.
      const policy = resolveEffectiveTrustPolicy(
        conn?.rdpTrustPolicy,
        currentSettings.rdpTrustPolicy,
        currentSettings.trustPolicy,
        currentSettings.tlsTrustPolicy ?? 'always-ask',
      );
      const result = verifyIdentity(fp.host, fp.port, 'rdp', identity, connId);

      if (result.status === 'trusted') return;

      if (result.status === 'first-use' && policy === 'tofu') {
        trustIdentity(fp.host, fp.port, 'rdp', identity, false, connId);
        return;
      }

      if (result.status === 'first-use' && policy === 'always-trust') {
        trustIdentity(fp.host, fp.port, 'rdp', identity, false, connId);
        return;
      }

      setTrustPrompt(result);
    }));

    track(listen<RDPTimingEvent>('rdp://timing', (event) => {
      const t = event.payload;
      if (t.session_id !== sessionIdRef.current) return;
      setConnectTiming(t);
    }));

    track(listen<{ session_id: string; backend: string }>('rdp://render-backend', (event) => {
      const rb = event.payload;
      if (rb.session_id !== sessionIdRef.current) return;
      setActiveRenderBackend(rb.backend);
      debugLog(`Render backend: ${rb.backend}`);
    }));

    // CLIPRDR: when remote copies text, auto-request it
    track(listen<{ session_id: string; has_text: boolean }>('rdp://clipboard-formats', (event) => {
      const cf = event.payload;
      if (cf.session_id !== sessionIdRef.current) return;
      if (cf.has_text && isClipboardDirectionEnabled('server-to-client')) {
        // Auto-request the text data from the remote clipboard
        invoke('rdp_clipboard_paste', { sessionId: cf.session_id }).catch((e) => console.error("RDP clipboard paste failed:", e));
      }
    }));

    // CLIPRDR: when remote clipboard data arrives, write to local clipboard
    track(listen<{ session_id: string; text: string }>('rdp://clipboard-data', (event) => {
      const cd = event.payload;
      if (cd.session_id !== sessionIdRef.current) return;
      if (cd.text && isClipboardDirectionEnabled('server-to-client')) {
        navigator.clipboard.writeText(cd.text).catch((e) => {
          console.warn('Failed to write remote clipboard to local:', e);
        });
      }
    }));

    // ─── Audio playback via WebAudio ──────────────────────────────────
    let audioCtx: AudioContext | null = null;
    let audioNextTime = 0;

    track(listen<{
      sessionId: string;
      pcmBase64: string;
      channels: number;
      sampleRate: number;
      bitsPerSample: number;
    }>('rdp://audio-data', (event) => {
      const d = event.payload;
      if (d.sessionId !== sessionIdRef.current) return;
      if ((rdpSettingsRef.current.audio?.playbackMode ?? 'local') !== 'local') return;

      if (!audioCtx) {
        audioCtx = new AudioContext({ sampleRate: d.sampleRate });
        audioNextTime = 0;
      }

      // Decode base64 PCM
      const raw = atob(d.pcmBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const channels = d.channels || 2;
      const bitsPerSample = d.bitsPerSample || 16;
      const bytesPerSample = bitsPerSample / 8;
      const frameCount = Math.floor(bytes.length / (channels * bytesPerSample));
      if (frameCount === 0) return;

      const buffer = audioCtx.createBuffer(channels, frameCount, d.sampleRate);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
          const offset = (i * channels + ch) * bytesPerSample;
          if (offset + 1 >= bytes.length) break;
          // 16-bit signed LE PCM → float [-1, 1]
          const sample = view.getInt16(offset, true);
          channelData[i] = sample / 32768;
        }
      }

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      // Schedule seamlessly after previous buffer
      const now = audioCtx.currentTime;
      if (audioNextTime < now) audioNextTime = now;
      source.start(audioNextTime);
      audioNextTime += buffer.duration;
    }));

    track(listen<{ sessionId: string; left: number; right: number }>('rdp://audio-volume', (event) => {
      if (event.payload.sessionId !== sessionIdRef.current) return;
      // WebAudio doesn't have per-channel volume easily; just log
      debugLog(`RDP audio volume: L=${(event.payload.left * 100).toFixed(0)}% R=${(event.payload.right * 100).toFixed(0)}%`);
    }));

    track(listen<{ sessionId: string }>('rdp://audio-close', (event) => {
      if (event.payload.sessionId !== sessionIdRef.current) return;
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
        audioNextTime = 0;
      }
    }));

    return () => {
      cleaned = true;
      unlisteners.forEach(fn => fn());
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    };
  }, [isClipboardDirectionEnabled, releaseOwnedVpnLeases]);

  // ─── Connect on mount, disconnect on unmount ───────────────────────

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
      resetFrameBackpressure();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session.id is the only meaningful trigger
  }, [session.id, resetFrameBackpressure]);

  useEffect(() => {
    if (!rdpSessionId || !isConnected) {
      resetFrameBackpressure();
    }
  }, [rdpSessionId, isConnected, resetFrameBackpressure]);

  // Pipeline cleanup is handled by the cleanup() call in the
  // connect-on-mount effect above — no separate unmount effect needed.
  // A second destroy-without-recreate was causing StrictMode to use a
  // dead pipeline on re-mount.

  // ─── Resize to window ──────────────────────────────────────────────

  useEffect(() => {
    if (!rdpSettings.display?.resizeToWindow) return;
    const container = containerRef.current;
    if (!container) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver((entries) => {
      cachedRectRef.current = null;
      const entry = entries[0];
      if (!entry || !isConnected) return;
      const { width, height } = entry.contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (w <= 100 || h <= 100) return;

      const canvas = canvasRef.current;
      const fb = frameBufferRef.current;
      const transferred = pipelineRef.current?.isCanvasTransferred();
      if (canvas && fb && fb.hasPainted && !transferred) {
        if (rendererRef.current && rendererRef.current.type !== 'canvas2d') {
          canvas.width = w;
          canvas.height = h;
        } else {
          fb.syncFromVisible(canvas);
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(fb.offscreen, 0, 0, fb.offscreen.width, fb.offscreen.height, 0, 0, w, h);
          }
        }
      }

      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const applyResize = (nextWidth: number, nextHeight: number) => {
          setDesktopSize({ width: nextWidth, height: nextHeight });

          const pipeline = pipelineRef.current;
          if (!pipeline) return;

          pipeline.resize(nextWidth, nextHeight);
          if (!pipeline.isCanvasTransferred()) {
            const c = canvasRef.current;
            const fb = pipeline.getFrameBuffer();
            if (c && fb) fb.blitFull(c);
          }
        };

        const sid = sessionIdRef.current;
        if (!sid) {
          applyResize(w, h);
          return;
        }

        invoke<{ width?: number; height?: number }>('rdp_set_desktop_size', {
          sessionId: sid,
          width: w,
          height: h,
        })
          .then((normalized) => {
            applyResize(normalized.width ?? w, normalized.height ?? h);
          })
          .catch((error) => {
            debugLog(`Desktop resize sync error: ${error}`);
            applyResize(w, h);
          });
      }, 150);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isConnected, rdpSettings.display?.resizeToWindow, frameBufferRef, rendererRef]);

  // ─── Input buffering ───────────────────────────────────────────────

  const inputBufferRef = useRef<Record<string, unknown>[]>([]);
  const pendingMoveIdxRef = useRef(-1);
  const flushScheduledRef = useRef(false);

  const flushInputBuffer = useCallback(() => {
    flushScheduledRef.current = false;
    const sid = sessionIdRef.current;
    const buf = inputBufferRef.current;
    if (!sid || buf.length === 0) return;
    inputBufferRef.current = [];
    pendingMoveIdxRef.current = -1;
    invoke('rdp_send_input', { sessionId: sid, events: buf }).catch(e => {
      debugLog(`Input send error: ${e}`);
    });
  }, []);

  const sendInput = useCallback((events: Record<string, unknown>[], immediate = false) => {
    if (!isConnected || !sessionIdRef.current) return;
    if (immediate) {
      flushScheduledRef.current = false;
      const buf = inputBufferRef.current;
      inputBufferRef.current = [];
      pendingMoveIdxRef.current = -1;
      const sid = sessionIdRef.current;
      if (buf.length > 0) {
        for (let i = 0; i < events.length; i++) buf.push(events[i]);
        invoke('rdp_send_input', { sessionId: sid!, events: buf }).catch(e => {
          debugLog(`Input send error: ${e}`);
        });
      } else {
        invoke('rdp_send_input', { sessionId: sid!, events }).catch(e => {
          debugLog(`Input send error: ${e}`);
        });
      }
      return;
    }
    const buf = inputBufferRef.current;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'MouseMove') {
        const idx = pendingMoveIdxRef.current;
        if (idx >= 0) {
          buf[idx] = ev;
        } else {
          pendingMoveIdxRef.current = buf.length;
          buf.push(ev);
        }
      } else {
        buf.push(ev);
      }
    }
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      queueMicrotask(flushInputBuffer);
    }
  }, [isConnected, flushInputBuffer]);

  /** Cached canvas bounding rect — invalidated on resize/scroll/fullscreen. */
  const cachedRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const invalidateRect = () => { cachedRectRef.current = null; };
    window.addEventListener('resize', invalidateRect, { passive: true });
    window.addEventListener('scroll', invalidateRect, { passive: true });
    document.addEventListener('fullscreenchange', invalidateRect);

    const canvas = canvasRef.current;
    let canvasObserver: ResizeObserver | undefined;
    if (canvas) {
      canvasObserver = new ResizeObserver(invalidateRect);
      canvasObserver.observe(canvas);
    }

    return () => {
      window.removeEventListener('resize', invalidateRect);
      window.removeEventListener('scroll', invalidateRect);
      document.removeEventListener('fullscreenchange', invalidateRect);
      canvasObserver?.disconnect();
    };
  }, []);
  const scaleCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    let rect = cachedRectRef.current;
    if (!rect) {
      rect = canvas.getBoundingClientRect();
      cachedRectRef.current = rect;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, []);

  // ─── Magnifier ─────────────────────────────────────────────────────

  const updateMagnifier = useCallback((mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current;
    const magCanvas = magnifierCanvasRef.current;
    if (!canvas || !magCanvas) return;

    const magCtx = magCanvas.getContext('2d');
    if (!magCtx) return;

    const fb = frameBufferRef.current;
    const source: CanvasImageSource = (rendererRef.current && rendererRef.current.type !== 'canvas2d' && fb)
      ? fb.offscreen
      : canvas;

    const magW = magnifierPipSize;
    const magH = Math.round(magnifierPipSize * 0.75);
    magCanvas.width = magW;
    magCanvas.height = magH;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const srcX = mouseX * scaleX;
    const srcY = mouseY * scaleY;
    const srcW = magW / magnifierZoom;
    const srcH = magH / magnifierZoom;

    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, magW, magH);

    magCtx.drawImage(
      source,
      srcX - srcW / 2,
      srcY - srcH / 2,
      srcW,
      srcH,
      0,
      0,
      magW,
      magH,
    );
  }, [magnifierZoom, magnifierPipSize, frameBufferRef, rendererRef]);

  // ─── Mouse / keyboard handlers ─────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    if (mouseEnabled) {
      const { x, y } = scaleCoords(e.clientX, e.clientY);
      sendInput([{ type: 'MouseMove', x, y }]);
    }

    if (magnifierActive) {
      let rect = cachedRectRef.current;
      if (!rect) {
        const canvas = canvasRef.current;
        if (canvas) {
          rect = canvas.getBoundingClientRect();
          cachedRectRef.current = rect;
        }
      }
      if (rect) {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setMagnifierPos({ x: mx, y: my });
        updateMagnifier(mx, my);
      }

      // Auto-reposition PiP when cursor approaches its corner.
      // Default: bottom-right ↔ bottom-left (same level, swap sides).
      // Fully configurable via magnifierAltCorner.
      const container = containerRef.current;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const relX = e.clientX - cRect.left;
        const relY = e.clientY - cRect.top;
        const threshold = magnifierPipSize + 40;
        const nearRight = relX > cRect.width - threshold;
        const nearBottom = relY > cRect.height - threshold;
        const nearLeft = relX < threshold;
        const nearTop = relY < threshold;

        setMagnifierCorner(prev => {
          // Check if cursor is in the current corner's zone
          const inZone =
            (prev === 'bottom-right' && nearRight && nearBottom) ||
            (prev === 'bottom-left' && nearLeft && nearBottom) ||
            (prev === 'top-right' && nearRight && nearTop) ||
            (prev === 'top-left' && nearLeft && nearTop);
          if (!inZone) return prev;

          // Move to the configured alt corner
          const altMap: Record<string, typeof prev> = {
            'bottom-right': 'bottom-left',
            'bottom-left': 'bottom-right',
            'top-right': 'top-left',
            'top-left': 'top-right',
          };
          return altMap[prev] ?? prev;
        });
      }
    }
  }, [isConnected, mouseEnabled, scaleCoords, sendInput, magnifierActive, updateMagnifier, magnifierPipSize]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected || !mouseEnabled) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).focus();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: true }], true);
  }, [isConnected, mouseEnabled, scaleCoords, sendInput]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected || !mouseEnabled) return;
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: false }], true);
  }, [isConnected, mouseEnabled, scaleCoords, sendInput]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!isConnected || !mouseEnabled) return;
    e.preventDefault();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);

    // RDP wheel units: 120 = one notch.  Positive = scroll up / left.
    // Browser deltaY: positive = scroll down, so we negate.
    // Browser deltaX: positive = scroll right, so we negate for RDP convention.
    const rawDelta = horizontal
      ? -(e.deltaX || e.deltaY)
      : -e.deltaY;

    if (smoothScroll) {
      // Accumulate fractional deltas (trackpads / high-res mice send many
      // small events).  Send an RDP wheel event only when a full notch
      // (120 units, scaled by scrollSpeed) has been accumulated.
      const accum = wheelAccumRef.current;
      const key = horizontal ? 'h' : 'v';
      // Scale: browser pixel deltas typically range 1-150 per event.
      // A standard mouse notch is ~100px in most browsers.
      // We map browser pixels → RDP wheel units with the speed multiplier.
      accum[key] += rawDelta * scrollSpeed;

      const NOTCH = 120;
      while (Math.abs(accum[key]) >= NOTCH) {
        const sign = accum[key] > 0 ? 1 : -1;
        sendInput([{ type: 'Wheel', x, y, delta: sign * NOTCH, horizontal }], true);
        accum[key] -= sign * NOTCH;
      }
    } else {
      // Legacy mode: snap each event to ±120, apply speed multiplier
      // by scaling the number of notches sent.
      const notches = Math.round((rawDelta * scrollSpeed) / 120) || Math.sign(rawDelta);
      if (notches !== 0) {
        sendInput([{ type: 'Wheel', x, y, delta: notches * 120, horizontal }], true);
      }
    }
  }, [isConnected, mouseEnabled, scaleCoords, sendInput, scrollSpeed, smoothScroll]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isCanvasReleaseCombo(e.nativeEvent)) {
      e.preventDefault();
      canvasRef.current?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }
    if (!isConnected || !keyboardEnabled) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: true, extended: scan.extended }], true);
    }
  }, [isCanvasReleaseCombo, isConnected, keyboardEnabled, sendInput]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (isCanvasReleaseCombo(e.nativeEvent)) return;
    if (!isConnected || !keyboardEnabled) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: false, extended: scan.extended }], true);
    }
  }, [isCanvasReleaseCombo, isConnected, keyboardEnabled, sendInput]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const toggleFullscreen = useCallback(() => {
    cachedRectRef.current = null;
    setIsFullscreen(prev => !prev);
  }, []);

  // ─── Update connection helper ──────────────────────────────────────

  const handleRenameConnection = useCallback((name: string) => {
    if (connection) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, name } });
    }
  }, [connection, dispatch]);

  const handleUpdateTotpConfigs = useCallback((configs: NonNullable<Connection['totpConfigs']>) => {
    if (connection) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, totpConfigs: configs } });
    }
  }, [connection, dispatch]);

  const handleUpdateServerCertValidation = useCallback((mode: 'validate' | 'warn' | 'ignore') => {
    if (connection) {
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: {
          ...connection,
          rdpSettings: {
            ...connection.rdpSettings,
            security: {
              ...connection.rdpSettings?.security,
              serverCertValidation: mode,
            },
          },
        },
      });
    }
  }, [connection, dispatch]);

  const handleToggleInput = useCallback((key: 'mouseEnabled' | 'keyboardEnabled', value: boolean) => {
    if (connection) {
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: {
          ...connection,
          rdpSettings: {
            ...connection.rdpSettings,
            input: {
              ...connection.rdpSettings?.input,
              [key]: value,
            },
          },
        },
      });
    }
  }, [connection, dispatch]);

  const handleToggleRedirection = useCallback((key: keyof NonNullable<RDPConnectionSettings['deviceRedirection']>, value: boolean) => {
    if (connection) {
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: {
          ...connection,
          rdpSettings: {
            ...connection.rdpSettings,
            deviceRedirection: {
              ...connection.rdpSettings?.deviceRedirection,
              [key]: value,
            },
          },
        },
      });
      // Send live toggle to running session for supported features
      const sid = sessionIdRef.current;
      if (sid && key === 'clipboard') {
        invoke('rdp_toggle_feature', { sessionId: sid, feature: 'clipboard', enabled: value }).catch(() => {});
      }
    }
  }, [connection, dispatch]);

  const handleToggleAudio = useCallback((enabled: boolean) => {
    if (connection) {
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: {
          ...connection,
          rdpSettings: {
            ...connection.rdpSettings,
            audio: {
              ...connection.rdpSettings?.audio,
              playbackMode: enabled ? 'local' : 'disabled',
            },
          },
        },
      });
      // Send live toggle to running session
      const sid = sessionIdRef.current;
      if (sid) {
        invoke('rdp_toggle_feature', { sessionId: sid, feature: 'audio', enabled }).catch(() => {});
      }
    }
  }, [connection, dispatch]);

  return {
    // Refs
    canvasRef,
    magnifierCanvasRef,
    containerRef,
    // State
    isConnected,
    connectionStatus,
    statusMessage,
    isFullscreen,
    showSettings,
    setShowSettings,
    rdpSessionId,
    desktopSize,
    rdpSettings,
    pointerStyle,
    showInternals,
    setShowInternals,
    stats,
    lifecycle,
    magnifierActive,
    setMagnifierActive,
    magnifierPos,
    setMagnifierZoom,
    magnifierCorner,
    magnifierPipSize,
    setMagnifierPipSize,
    certFingerprint,
    certIdentity,
    trustPrompt,
    connectTiming,
    activeRenderBackend,
    activeFrontendRenderer,
    framePressureState,
    frameBackpressureTelemetry,
    activeScheduling: pipelineRef.current?.getActiveScheduling() ?? 'vsync',
    tripleBuffered: pipelineRef.current?.getRenderer()?.tripleBuffered ?? false,
    // Derived
    connection,
    magnifierEnabled,
    magnifierZoom,
    perfLabel,
    audioEnabled,
    clipboardEnabled,
    colorDepth,
    settings,
    // Recording
    recState,
    startRecording: handleStartRecording,
    pauseRecording: handlePauseRecording,
    resumeRecording: handleResumeRecording,
    // Handlers
    handleScreenshot,
    handleScreenshotToClipboard,
    handleStopRecording,
    handleDisconnect,
    handleCopyToClipboard,
    handlePasteFromClipboard,
    handleSendKeys,
    handleSignOut,
    handleForceReboot,
    handleAutoTypeTOTP,
    handleReconnect,
    handleTrustAccept,
    handleTrustReject,
    handleRetry,
    initializeRDPConnection,
    toggleFullscreen,
    handleRenameConnection,
    handleUpdateTotpConfigs,
    handleUpdateServerCertValidation,
    handleToggleInput,
    handleToggleRedirection,
    handleToggleAudio,
    mouseEnabled,
    keyboardEnabled,
    // Input handlers
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
    handleKeyDown,
    handleKeyUp,
    handleContextMenu,
  };
}

export type RDPClientMgr = ReturnType<typeof useRDPClient>;
