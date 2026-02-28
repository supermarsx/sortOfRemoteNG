import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession, Connection } from '../types/connection';
import { RdpConnectionSettings, DEFAULT_RDP_SETTINGS } from '../types/connection';
import { mergeRdpSettings } from '../utils/rdpSettingsMerge';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { useConnections } from '../contexts/useConnections';
import { useSettings } from '../contexts/SettingsContext';
import { useToastContext } from '../contexts/ToastContext';
import {
  verifyIdentity,
  trustIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../utils/trustStore';
import { FrameBuffer } from '../components/rdpCanvas';
import { createFrameRenderer, type FrameRenderer, type FrontendRendererType } from '../components/rdpRenderers';
import { useSessionRecorder } from './useSessionRecorder';
import type { RdpStatusEvent, RdpPointerEvent, RdpStatsEvent, RdpCertFingerprintEvent, RdpTimingEvent } from '../types/rdpEvents';
import { mouseButtonCode, keyToScancode } from '../utils/rdpKeyboard';

// ─── Hook ────────────────────────────────────────────────────────────

export function useRDPClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();

  // ─── Refs ──────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Offscreen double-buffer / wallpaper cache */
  const frameBufferRef = useRef<FrameBuffer | null>(null);
  /** Pluggable GPU/CPU frame renderer (Canvas 2D, WebGL, WebGPU, Worker). */
  const rendererRef = useRef<FrameRenderer | null>(null);
  /** Stable ref for the configured renderer type (avoids stale closure in event listeners). */
  const frontendRendererTypeRef = useRef<FrontendRendererType>('auto');
  /** rAF handle for the blit loop */
  const rafIdRef = useRef<number>(0);
  /** Whether a rAF callback is already scheduled (avoids redundant requests). */
  const rafPendingRef = useRef(false);
  /**
   * Incoming frame queue: Channel pushes raw ArrayBuffer messages here.
   * The rAF loop drains the queue, applies all pending paints, and blits
   * once per vsync.
   */
  const frameQueueRef = useRef<ArrayBuffer[]>([]);

  /** Cached visible-canvas 2D context (set on first render). */
  const visCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** Cached ImageData for offscreen mirror (avoids per-frame allocation). */
  const offImgCacheRef = useRef<{ img: ImageData; w: number; h: number } | null>(null);

  // ─── Render callback (ref-stable) ─────────────────────────────────

  /** Render callback stored in a ref so the Channel closure (created once
   *  during connect) can always reach it via stable indirection. */
  const renderFramesRef = useRef<() => void>(() => {});
  renderFramesRef.current = () => {
    rafPendingRef.current = false;
    const queue = frameQueueRef.current;
    const fb = frameBufferRef.current;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;

    if (queue.length > 0 && fb && canvas) {
      if (renderer) {
        const needsOffscreen = magnifierActiveRef.current;
        const offCtx = needsOffscreen ? fb.offscreen.getContext('2d') : null;
        for (let i = 0; i < queue.length; i++) {
          const data = queue[i];
          const view = new DataView(data);
          let offset = 0;
          while (offset + 8 <= data.byteLength) {
            const x = view.getUint16(offset, true);
            const y = view.getUint16(offset + 2, true);
            const w = view.getUint16(offset + 4, true);
            const h = view.getUint16(offset + 6, true);
            const pixelBytes = w * h * 4;
            if (offset + 8 + pixelBytes > data.byteLength) break;
            const rgba = new Uint8ClampedArray(data, offset + 8, pixelBytes);
            renderer.paintRegion(x, y, w, h, rgba);
            if (offCtx && w > 0 && h > 0) {
              let cache = offImgCacheRef.current;
              if (!cache || cache.w !== w || cache.h !== h) {
                cache = { img: new ImageData(w, h), w, h };
                offImgCacheRef.current = cache;
              }
              cache.img.data.set(rgba);
              offCtx.putImageData(cache.img, x, y);
              fb.hasPainted = true;
            }
            offset += 8 + pixelBytes;
          }
        }
        renderer.present();
      } else {
        if (!visCtxRef.current) visCtxRef.current = canvas.getContext('2d');
        const ctx = visCtxRef.current;
        if (ctx) {
          for (let i = 0; i < queue.length; i++) {
            const data = queue[i];
            const view = new DataView(data);
            let offset = 0;
            while (offset + 8 <= data.byteLength) {
              const x = view.getUint16(offset, true);
              const y = view.getUint16(offset + 2, true);
              const w = view.getUint16(offset + 4, true);
              const h = view.getUint16(offset + 6, true);
              const pixelBytes = w * h * 4;
              if (offset + 8 + pixelBytes > data.byteLength) break;
              const rgba = new Uint8ClampedArray(data, offset + 8, pixelBytes);
              fb.paintDirect(ctx, x, y, w, h, rgba);
              offset += 8 + pixelBytes;
            }
          }
        }
      }
      queue.length = 0;
    }
  };
  /** Stable wrapper that never changes identity — safe to pass to rAF. */
  const renderFrames = useCallback(() => renderFramesRef.current(), []);

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
  const [stats, setStats] = useState<RdpStatsEvent | null>(null);
  const [magnifierActive, setMagnifierActive] = useState(false);
  /** Ref mirror of magnifierActive — accessible in the render callback closure. */
  const magnifierActiveRef = useRef(false);
  magnifierActiveRef.current = magnifierActive;
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const [certFingerprint, setCertFingerprint] = useState<string | null>(null);
  const [certIdentity, setCertIdentity] = useState<CertIdentity | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const [connectTiming, setConnectTiming] = useState<RdpTimingEvent | null>(null);
  /** Which render backend the session is actually using (set from Rust event). */
  const [activeRenderBackend, setActiveRenderBackend] = useState<string>('webview');
  /** Which frontend renderer is actually active (may differ from config if fallback). */
  const [activeFrontendRenderer, setActiveFrontendRenderer] = useState<string>('canvas2d');

  // Track current session ID for event filtering
  const sessionIdRef = useRef<string | null>(null);

  // Session recording
  const { state: recState, startRecording, stopRecording, pauseRecording, resumeRecording } = useSessionRecorder(canvasRef);

  // ─── Derived values ────────────────────────────────────────────────

  const connection = state.connections.find(c => c.id === session.connectionId);

  const rdpSettings: RdpConnectionSettings = useMemo(
    () => mergeRdpSettings(connection?.rdpSettings, settings.rdpDefaults),
    [connection?.rdpSettings, settings.rdpDefaults],
  );
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

  const handleStopRecording = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob) return;
    try {
      const ext = recState.format || 'webm';
      const filePath = await saveDialog({
        defaultPath: `recording-${session.name || 'rdp'}-${Date.now()}.${ext}`,
        filters: [
          { name: 'WebM Video', extensions: ['webm'] },
          { name: 'MP4 Video', extensions: ['mp4'] },
        ],
      });
      if (filePath) {
        const buffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(buffer));
      }
    } catch (error) {
      console.error('Recording save failed:', error);
    }
  }, [stopRecording, recState.format, session]);

  const handleDisconnect = useCallback(async () => {
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
    if (rafPendingRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafPendingRef.current = false;
    }
    visCtxRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    await handleScreenshotToClipboard();
  }, [handleScreenshotToClipboard]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (!isConnected || !sessionIdRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
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
  }, [isConnected]);

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
    const conn = connectionRef.current;
    const sess = sessionRef.current;
    const rdpCfg = rdpSettingsRef.current;
    if (!conn) return;

    try {
      setConnectionStatus('connecting');
      setStatusMessage('Initiating connection...');

      const frameChannel = new Channel<ArrayBuffer>((data: ArrayBuffer) => {
        if (data.byteLength >= 8) {
          frameQueueRef.current.push(data);
          if (!rafPendingRef.current) {
            rafPendingRef.current = true;
            rafIdRef.current = requestAnimationFrame(renderFrames);
          }
        }
      });

      // Check for existing backend session to re-attach
      try {
        const existingSessions = await invoke<Array<{
          id: string;
          connection_id?: string;
          host: string;
          port: number;
          connected: boolean;
          desktop_width: number;
          desktop_height: number;
        }>>('list_rdp_sessions');

        const existing = existingSessions.find(
          s => s.connection_id === conn.id && s.connected
        );

        if (existing) {
          debugLog(`Re-attaching to existing session ${existing.id} for ${conn.id}`);
          setStatusMessage('Re-attaching to existing session...');

          const sessionInfo = await invoke<{
            id: string;
            desktop_width: number;
            desktop_height: number;
          }>('attach_rdp_session', {
            connectionId: conn.id,
            frameChannel,
          });

          setRdpSessionId(sessionInfo.id);
          sessionIdRef.current = sessionInfo.id;
          setDesktopSize({
            width: sessionInfo.desktop_width,
            height: sessionInfo.desktop_height,
          });

          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = sessionInfo.desktop_width;
            canvas.height = sessionInfo.desktop_height;
            frameBufferRef.current = new FrameBuffer(
              sessionInfo.desktop_width,
              sessionInfo.desktop_height
            );
            const rendererType = (rdpCfg.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;
            rendererRef.current?.destroy();
            rendererRef.current = createFrameRenderer(rendererType, canvas);
            setActiveFrontendRenderer(rendererRef.current.name);
          }

          setIsConnected(true);
          setConnectionStatus('connected');
          setStatusMessage(`Re-attached (${sessionInfo.desktop_width}x${sessionInfo.desktop_height})`);

          dispatch({
            type: 'UPDATE_SESSION',
            payload: {
              ...sess,
              backendSessionId: sessionInfo.id,
              name: conn.name || sess.name,
              status: 'connected',
            },
          });
          return;
        }
      } catch {
        // No existing session or list failed — proceed with new connection
      }

      // Auto-detect keyboard layout from the OS if configured
      let effectiveSettings = rdpCfg;
      if (rdpCfg.input?.autoDetectLayout !== false) {
        try {
          const detectedLayout = await invoke<number>('detect_keyboard_layout');
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

      debugLog(`Attempting RDP connection to ${connectionDetails.host}:${connectionDetails.port}`);

      const sessionId = await invoke('connect_rdp', connectionDetails) as string;

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

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = resW;
        canvas.height = resH;
      }
    } catch (error) {
      setConnectionStatus('error');
      setStatusMessage(`Connection failed: ${error}`);
      console.error('RDP initialization failed:', error);
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
      rendererRef.current?.destroy();
      rendererRef.current = null;
      visCtxRef.current = null;
    }
    setConnectionStatus('connecting');
    setStatusMessage('Reconnecting...');
    initializeRDPConnection();
  }, [initializeRDPConnection, connectionStatus]);

  const cleanup = useCallback(async () => {
    sessionIdRef.current = null;
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setRdpSessionId(null);
    if (rafPendingRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafPendingRef.current = false;
    }
    visCtxRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;
    const conn = connectionRef.current;
    if (conn) {
      try {
        await invoke('detach_rdp_session', { connectionId: conn.id });
      } catch {
        // ignore — session may already have ended
      }
    }
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
    const unlisteners: UnlistenFn[] = [];

    listen<RdpStatusEvent>('rdp://status', (event) => {
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
              canvas.width = status.desktop_width;
              canvas.height = status.desktop_height;
              canvas.focus();
            }
            frameBufferRef.current = new FrameBuffer(status.desktop_width, status.desktop_height);
            rendererRef.current?.destroy();
            if (canvas) {
              rendererRef.current = createFrameRenderer(frontendRendererTypeRef.current, canvas);
              setActiveFrontendRenderer(rendererRef.current.name);
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
    }).then(fn => unlisteners.push(fn));

    listen<RdpPointerEvent>('rdp://pointer', (event) => {
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
    }).then(fn => unlisteners.push(fn));

    listen<RdpStatsEvent>('rdp://stats', (event) => {
      const s = event.payload;
      if (s.session_id !== sessionIdRef.current) return;
      setStats(s);
    }).then(fn => unlisteners.push(fn));

    listen<RdpCertFingerprintEvent>('rdp://cert-fingerprint', (event) => {
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
    }).then(fn => unlisteners.push(fn));

    listen<RdpTimingEvent>('rdp://timing', (event) => {
      const t = event.payload;
      if (t.session_id !== sessionIdRef.current) return;
      setConnectTiming(t);
    }).then(fn => unlisteners.push(fn));

    listen<{ session_id: string; backend: string }>('rdp://render-backend', (event) => {
      const rb = event.payload;
      if (rb.session_id !== sessionIdRef.current) return;
      setActiveRenderBackend(rb.backend);
      debugLog(`Render backend: ${rb.backend}`);
    }).then(fn => unlisteners.push(fn));

    return () => {
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

  // ─── Cancel pending rAF on unmount ─────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafPendingRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafPendingRef.current = false;
      }
    };
  }, []);

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
      if (canvas && fb && fb.hasPainted) {
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
        const c = canvasRef.current;
        if (c) {
          c.width = w;
          c.height = h;
        }
        if (frameBufferRef.current) {
          frameBufferRef.current.resize(w, h, c || undefined);
          if (c) frameBufferRef.current.blitFull(c);
        }
        rendererRef.current?.resize(w, h);
      }, 150);
    });

    observer.observe(container);

    const invalidateRect = () => { cachedRectRef.current = null; };
    window.addEventListener('scroll', invalidateRect, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', invalidateRect);
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

  /** Cached canvas bounding rect — invalidated on resize/scroll. */
  const cachedRectRef = useRef<DOMRect | null>(null);
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
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseMove', x, y }]);

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
  }, [isConnected, scaleCoords, sendInput, magnifierEnabled, magnifierActive, updateMagnifier]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).focus();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: true }], true);
  }, [isConnected, scaleCoords, sendInput]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: false }], true);
  }, [isConnected, scaleCoords, sendInput]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    e.preventDefault();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    const delta = Math.sign(e.deltaY) * -120;
    sendInput([{ type: 'Wheel', x, y, delta, horizontal: e.shiftKey }], true);
  }, [isConnected, scaleCoords, sendInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isConnected) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: true, extended: scan.extended }], true);
    }
  }, [isConnected, sendInput]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (!isConnected) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: false, extended: scan.extended }], true);
    }
  }, [isConnected, sendInput]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const toggleFullscreen = useCallback(() => {
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
    startRecording,
    pauseRecording,
    resumeRecording,
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
