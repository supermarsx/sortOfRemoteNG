import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { debugLog } from '../../utils/core/debugLogger';
import { ConnectionSession, Connection } from '../../types/connection/connection';
import { RDPConnectionSettings, DEFAULT_RDP_SETTINGS } from '../../types/connection/connection';
import { mergeRdpSettings } from '../../utils/rdp/rdpSettingsMerge';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import * as macroService from '../../utils/recording/macroService';
import { useConnections } from '../../contexts/useConnections';
import { useSettings } from '../../contexts/SettingsContext';
import { useToastContext } from '../../contexts/ToastContext';
import {
  verifyIdentity,
  trustIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../../utils/auth/trustStore';
import type { FrontendRendererType } from '../../components/rdp/rdpRenderers';
import { RdpFramePipeline, type FrameSchedulingMode } from '../../components/rdp/rdpFramePipeline';
import { useSessionRecorder } from '../recording/useSessionRecorder';
import type { RDPStatusEvent, RDPPointerEvent, RDPStatsEvent, RdpCertFingerprintEvent, RDPTimingEvent } from '../../types/rdp/rdpEvents';
import { mouseButtonCode, keyToScancode } from '../../utils/rdp/rdpKeyboard';

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

  const connection = state.connections.find(c => c.id === session.connectionId);

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
  const frameBufferRef = { get current() { return pipelineRef.current?.getFrameBuffer() ?? null; } };
  const rendererRef = { get current() { return pipelineRef.current?.getRenderer() ?? null; } };

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

  // Track current session ID for event filtering
  const sessionIdRef = useRef<string | null>(null);
  // Generation counter to detect stale async continuations (StrictMode double-mount).
  // Each initializeRDPConnection call increments this; after every await, we check
  // if it still matches to avoid overwriting state from a newer init.
  const initGenRef = useRef(0);

  // Session recording
  const { state: recState, startRecording, stopRecording, pauseRecording, resumeRecording } = useSessionRecorder(canvasRef);

  const magnifierEnabled = rdpSettings.display?.magnifierEnabled ?? false;
  const magnifierZoom = rdpSettings.display?.magnifierZoom ?? 3;

  // Refs for values used inside stable event listeners / connection effect.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const rdpSettingsRef = useRef(rdpSettings);
  rdpSettingsRef.current = rdpSettings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Keep the renderer type ref in sync with the resolved settings
  frontendRendererTypeRef.current = (rdpSettings.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;

  const mouseEnabled = rdpSettings.input?.mouseEnabled ?? true;
  const keyboardEnabled = rdpSettings.input?.keyboardEnabled ?? true;
  const scrollSpeed = rdpSettings.input?.scrollSpeed ?? 1.0;
  const smoothScroll = rdpSettings.input?.smoothScroll ?? true;

  const perfLabel = rdpSettings.performance?.connectionSpeed ?? 'broadband-high';
  const audioEnabled = rdpSettings.audio?.playbackMode !== 'disabled';
  const clipboardEnabled = rdpSettings.deviceRedirection?.clipboard ?? true;
  const colorDepth = rdpSettings.display?.colorDepth ?? 32;

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
      toast.error(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
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
      toast.error(`Screenshot to clipboard failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [desktopSize, toast]);

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
    if (!sid) return;
    try {
      await invoke('disconnect_rdp', { sessionId: sid });
    } catch (e) {
      debugLog(`Disconnect error: ${e}`);
    }
    sessionIdRef.current = null;
    setRdpSessionId(null);
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setStatusMessage('Disconnected by user');
    pipelineRef.current!.destroy();
    {
      const perf = rdpSettingsRef.current.performance;
      pipelineRef.current = new RdpFramePipeline({
        scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
        tripleBuffering: perf?.tripleBuffering ?? true,
      });
    }
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    // If CLIPRDR is active, request clipboard text from the remote session.
    // The response arrives as an rdp://clipboard-data event which writes to
    // navigator.clipboard automatically.  Fall back to screenshot capture.
    if (isConnected && sessionIdRef.current && clipboardEnabled) {
      try {
        await invoke('rdp_clipboard_paste', { sessionId: sessionIdRef.current });
        return;
      } catch {
        // CLIPRDR not available — fall back to screenshot
      }
    }
    await handleScreenshotToClipboard();
  }, [handleScreenshotToClipboard, isConnected, clipboardEnabled]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (!isConnected || !sessionIdRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      // Use CLIPRDR protocol when available (proper clipboard redirection)
      if (clipboardEnabled) {
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
  }, [isConnected, clipboardEnabled]);

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
    console.log(`[RDP init gen=${gen}] session=${sess?.id}, backendSessionId=${sess?.backendSessionId}, connectionId=${sess?.connectionId}, conn=${conn?.id ?? 'NULL'}`);
    // For reattach-only scenarios (e.g. RDP sessions panel), conn may be
    // null but backendSessionId is set.  We still proceed to attempt reattach.
    if (!conn && !sess.backendSessionId) return;

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

        if (stale()) { console.log(`[RDP init gen=${gen}] STALE after list_rdp_sessions, aborting`); return; }

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
        toast.error(`Failed to list RDP sessions: ${listErr instanceof Error ? listErr.message : String(listErr)}`, 4000);
      }

      if (stale()) { console.log(`[RDP init gen=${gen}] STALE before connect/reattach, aborting`); return; }

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

          if (stale()) { console.log(`[RDP init gen=${gen}] STALE after attach, aborting`); return; }

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

          dispatch({
            type: 'UPDATE_SESSION',
            payload: {
              ...sess,
              backendSessionId: sessionInfo.id,
              name: conn?.name || sess.name,
              status: 'connected',
            },
          });
          return;
        } catch (attachErr) {
          console.error(`RDP reattach failed for session ${reattachId}:`, attachErr);
          toast.error(`Reattach failed: ${attachErr instanceof Error ? attachErr.message : String(attachErr)}`, 4000);
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

      if (stale()) { console.log(`[RDP init gen=${gen}] STALE before connect, aborting`); return; }

      // Auto-detect keyboard layout from the OS if configured
      let effectiveSettings = rdpCfg;
      if (rdpCfg.input?.autoDetectLayout !== false) {
        try {
          const detectedLayout = await invoke<number>('detect_keyboard_layout');
          if (stale()) return;
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

      const display = effectiveSettings.display ?? DEFAULT_RDP_SETTINGS.display;
      const resW = display?.width ?? 1920;
      const resH = display?.height ?? 1080;

      const connectionDetails = {
        connectionId: conn.id,
        host: sess.hostname,
        port: conn.port || 3389,
        username: conn.username || '',
        password: conn.password || '',
        domain: conn.domain,
        width: resW,
        height: resH,
        rdpSettings: effectiveSettings,
        frameChannel,
      };

      console.log(`[RDP init gen=${gen}] creating NEW connection to ${connectionDetails.host}:${connectionDetails.port}`);

      const sessionId = await invoke('connect_rdp', connectionDetails) as string;

      if (stale()) {
        // A newer init is running — we must NOT overwrite sessionIdRef.
        // Try to clean up this orphaned backend session.
        console.log(`[RDP init gen=${gen}] STALE after connect_rdp (sessionId=${sessionId}), aborting`);
        invoke('disconnect_rdp', { sessionId }).catch(() => {});
        return;
      }

      debugLog(`RDP session created: ${sessionId}`);
      setRdpSessionId(sessionId);
      sessionIdRef.current = sessionId;

      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          ...sess,
          backendSessionId: sessionId,
          name: conn.name || sess.name,
          status: 'connecting',
        },
      });

      // Don't attach the pipeline here — the rdp://status 'connected'
      // handler is the single canonical attach point.  Attaching early
      // caused a double-attach race: the status handler would create a
      // *new* blank renderer, discarding any frames already painted.
    } catch (error) {
      if (stale()) return; // Don't clobber error state from a newer init
      setConnectionStatus('error');
      setStatusMessage(`Connection failed: ${error}`);
      console.error('RDP initialization failed:', error);
      toast.error(`RDP connection failed: ${error instanceof Error ? error.message : String(error)}`, 5000);
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
      } catch { /* ignore */ }
      sessionIdRef.current = null;
      setRdpSessionId(null);
      pipelineRef.current!.destroy();
      {
      const perf = rdpSettingsRef.current.performance;
      pipelineRef.current = new RdpFramePipeline({
        scheduling: (perf?.frameScheduling ?? 'adaptive') as FrameSchedulingMode,
        tripleBuffering: perf?.tripleBuffering ?? true,
      });
    }
    }
    setConnectionStatus('connecting');
    setStatusMessage('Reconnecting...');
    initializeRDPConnection();
  }, [initializeRDPConnection, connectionStatus]);

  const cleanup = useCallback(async () => {
    // Bump generation so any in-flight initializeRDPConnection aborts
    initGenRef.current++;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reads connection from ref
  }, []);

  // ─── Trust accept / reject ─────────────────────────────────────────

  const handleTrustAccept = useCallback(() => {
    const conn = connectionRef.current;
    const sess = sessionRef.current;
    if (certIdentity && conn) {
      const port = conn.port || 3389;
      trustIdentity(sess.hostname, port, 'tls', certIdentity, true, conn.id);
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
          setConnectionStatus((prev) => {
            if (prev === 'error') return 'error';
            setRdpSessionId(null);
            sessionIdRef.current = null;
            return 'disconnected';
          });
          break;
      }
    }));

    track(listen<RDPPointerEvent>('rdp://pointer', (event) => {
      const ptr = event.payload;
      if (ptr.session_id !== sessionIdRef.current) return;

      switch (ptr.pointer_type) {
        case 'default':
          setPointerStyle('default');
          break;
        case 'hidden':
          setPointerStyle('none');
          break;
        case 'position':
          break;
      }
    }));

    track(listen<RDPStatsEvent>('rdp://stats', (event) => {
      const s = event.payload;
      if (s.session_id !== sessionIdRef.current) return;
      setStats(s);
    }));

    track(listen<RdpCertFingerprintEvent>('rdp://cert-fingerprint', (event) => {
      const fp = event.payload;
      if (fp.session_id !== sessionIdRef.current) return;
      setCertFingerprint(fp.fingerprint);

      const now = new Date().toISOString();
      const identity: CertIdentity = {
        fingerprint: fp.fingerprint,
        subject: fp.host,
        firstSeen: now,
        lastSeen: now,
      };
      setCertIdentity(identity);

      const conn = connectionRef.current;
      const connId = conn?.id;
      const policy = getEffectiveTrustPolicy(conn?.rdpTrustPolicy, settingsRef.current.tlsTrustPolicy);
      const result = verifyIdentity(fp.host, fp.port, 'tls', identity, connId);

      if (result.status === 'trusted') return;

      if (result.status === 'first-use' && policy === 'tofu') {
        trustIdentity(fp.host, fp.port, 'tls', identity, false, connId);
        return;
      }

      if (result.status === 'first-use' && policy === 'always-trust') {
        trustIdentity(fp.host, fp.port, 'tls', identity, false, connId);
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
      if (cf.has_text) {
        // Auto-request the text data from the remote clipboard
        invoke('rdp_clipboard_paste', { sessionId: cf.session_id }).catch(() => {});
      }
    }));

    // CLIPRDR: when remote clipboard data arrives, write to local clipboard
    track(listen<{ session_id: string; text: string }>('rdp://clipboard-data', (event) => {
      const cd = event.payload;
      if (cd.session_id !== sessionIdRef.current) return;
      if (cd.text) {
        navigator.clipboard.writeText(cd.text).catch((e) => {
          console.warn('Failed to write remote clipboard to local:', e);
        });
      }
    }));

    return () => {
      cleaned = true;
      unlisteners.forEach(fn => fn());
    };
  }, []);

  // ─── Connect on mount, disconnect on unmount ───────────────────────

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session.id is the only meaningful trigger
  }, [session.id]);

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
        setDesktopSize({ width: w, height: h });
        pipelineRef.current!.resize(w, h);
        if (!pipelineRef.current!.isCanvasTransferred()) {
          const c = canvasRef.current;
          const fb = pipelineRef.current!.getFrameBuffer();
          if (c && fb) fb.blitFull(c);
        }
      }, 150);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isConnected, rdpSettings.display?.resizeToWindow]);

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

    const magSize = 160;
    magCanvas.width = magSize;
    magCanvas.height = magSize;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const srcX = mouseX * scaleX;
    const srcY = mouseY * scaleY;
    const srcSize = magSize / magnifierZoom;

    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, magSize, magSize);

    magCtx.save();
    magCtx.beginPath();
    magCtx.arc(magSize / 2, magSize / 2, magSize / 2 - 2, 0, Math.PI * 2);
    magCtx.clip();

    magCtx.drawImage(
      source,
      srcX - srcSize / 2,
      srcY - srcSize / 2,
      srcSize,
      srcSize,
      0,
      0,
      magSize,
      magSize,
    );
    magCtx.restore();

    magCtx.beginPath();
    magCtx.arc(magSize / 2, magSize / 2, magSize / 2 - 2, 0, Math.PI * 2);
    magCtx.strokeStyle = '#3b82f6';
    magCtx.lineWidth = 2;
    magCtx.stroke();

    magCtx.beginPath();
    magCtx.moveTo(magSize / 2 - 8, magSize / 2);
    magCtx.lineTo(magSize / 2 + 8, magSize / 2);
    magCtx.moveTo(magSize / 2, magSize / 2 - 8);
    magCtx.lineTo(magSize / 2, magSize / 2 + 8);
    magCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    magCtx.lineWidth = 1;
    magCtx.stroke();
  }, [magnifierZoom]);

  // ─── Mouse / keyboard handlers ─────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    if (mouseEnabled) {
      const { x, y } = scaleCoords(e.clientX, e.clientY);
      sendInput([{ type: 'MouseMove', x, y }]);
    }

    if (magnifierEnabled && magnifierActive) {
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
    }
  }, [isConnected, mouseEnabled, scaleCoords, sendInput, magnifierEnabled, magnifierActive, updateMagnifier]);

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
    if (!isConnected || !keyboardEnabled) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: true, extended: scan.extended }], true);
    }
  }, [isConnected, keyboardEnabled, sendInput]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (!isConnected || !keyboardEnabled) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: false, extended: scan.extended }], true);
    }
  }, [isConnected, keyboardEnabled, sendInput]);

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
    pointerStyle,
    showInternals,
    setShowInternals,
    stats,
    magnifierActive,
    setMagnifierActive,
    magnifierPos,
    certFingerprint,
    certIdentity,
    trustPrompt,
    connectTiming,
    activeRenderBackend,
    activeFrontendRenderer,
    activeScheduling: pipelineRef.current?.getActiveScheduling() ?? 'vsync',
    tripleBuffered: pipelineRef.current?.getRenderer()?.tripleBuffered ?? false,
    // Derived
    connection,
    rdpSettings,
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
