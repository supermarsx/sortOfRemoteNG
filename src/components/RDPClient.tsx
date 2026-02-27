import React, { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession } from '../types/connection';
import { RdpConnectionSettings, DEFAULT_RDP_SETTINGS } from '../types/connection';
import { mergeRdpSettings } from '../utils/rdpSettingsMerge';
import {
  Monitor,
  Settings,
  Wifi,
  WifiOff,
  ZoomIn,
} from 'lucide-react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { useConnections } from '../contexts/useConnections';
import RdpErrorScreen from './RdpErrorScreen';
import { useSettings } from '../contexts/SettingsContext';
import { useToastContext } from '../contexts/ToastContext';
import {
  verifyIdentity,
  trustIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../utils/trustStore';
import { TrustWarningDialog } from './TrustWarningDialog';
import { FrameBuffer } from './rdpCanvas';
import { createFrameRenderer, type FrameRenderer, type FrontendRendererType } from './rdpRenderers';
import { useSessionRecorder } from '../hooks/useSessionRecorder';
import { RDPInternalsPanel } from './rdp/RDPInternalsPanel';
import { RDPStatusBar } from './rdp/RDPStatusBar';
import RDPClientHeader from './rdp/RDPClientHeader';
import { RDPSettingsPanel } from './rdp/RDPSettingsPanel';

interface RDPClientProps {
  session: ConnectionSession;
}

import type { RdpStatusEvent, RdpPointerEvent, RdpStatsEvent, RdpCertFingerprintEvent, RdpTimingEvent } from '../types/rdpEvents';
import { formatBytes, formatUptime } from '../utils/rdpFormatters';
import { mouseButtonCode, keyToScancode } from '../utils/rdpKeyboard';

const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();
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
   * once per vsync.  This ensures perfectly smooth frame pacing —
   * no matter how bursty the incoming updates are, the user sees exactly
   * one evenly-timed render per display refresh.
   */
  const frameQueueRef = useRef<ArrayBuffer[]>([]);

  // ── Demand-driven rAF render callback ──────────────────────────────
  // This is called only when there are frames in the queue.  The Channel
  // callback schedules a rAF; this drains the queue and paints directly
  // to the visible canvas.  Zero CPU when idle.
  /** Cached visible-canvas 2D context (set on first render). */
  const visCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** Cached ImageData for offscreen mirror (avoids per-frame allocation). */
  const offImgCacheRef = useRef<{ img: ImageData; w: number; h: number } | null>(null);

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
      // Parse multi-rect messages: each ArrayBuffer may contain multiple
      // concatenated rects [hdr0][pixels0][hdr1][pixels1]...
      // This replaces the old 1-message-per-rect protocol.
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

  // Screenshot handler
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

  // Screenshot to clipboard handler
  // When using GPU renderers (WebGL/WebGPU) the visible canvas has
  // preserveDrawingBuffer=false, so toBlob() returns a blank image.
  // We work around this by compositing from the offscreen framebuffer
  // (which always keeps the latest content) onto a temporary canvas.
  const handleScreenshotToClipboard = useCallback(async () => {
    if (desktopSize.width === 0) return;
    try {
      const fb = frameBufferRef.current;
      const canvas = canvasRef.current;

      // Build a temporary canvas with the current frame content
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = desktopSize.width;
      tmpCanvas.height = desktopSize.height;
      const tmpCtx = tmpCanvas.getContext('2d');
      if (!tmpCtx) return;

      if (fb && fb.hasPainted && canvas) {
        // Sync offscreen cache from the visible canvas first (captures GPU-rendered content)
        fb.syncFromVisible(canvas);
        tmpCtx.drawImage(fb.offscreen, 0, 0);
      } else if (canvas) {
        // Fallback: try direct canvas copy (works for Canvas2D renderer)
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

  // Recording save handler
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

  // ─── Disconnect handler ───────────────────────────────────────────
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
    // Release GPU / Worker resources
    if (rafPendingRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafPendingRef.current = false;
    }
    visCtxRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;
  }, []);

  // ─── Copy to clipboard (text from clipboard redirection) ──────────
  const handleCopyToClipboard = useCallback(async () => {
    // Copy the current screen as an image (same as screenshot to clipboard)
    await handleScreenshotToClipboard();
  }, [handleScreenshotToClipboard]);

  // ─── Paste from clipboard ─────────────────────────────────────────
  const handlePasteFromClipboard = useCallback(async () => {
    if (!isConnected || !sessionIdRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      // Send each character as Unicode input events
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

  // ─── Send special key combos ──────────────────────────────────────
  const handleSendKeys = useCallback((combo: string) => {
    if (!isConnected || !sessionIdRef.current) return;
    // Define key combo sequences as scancode press/release pairs
    const combos: Record<string, { scancode: number; extended: boolean }[]> = {
      'ctrl-alt-del': [
        { scancode: 0x1D, extended: false },  // Ctrl down
        { scancode: 0x38, extended: false },  // Alt down
        { scancode: 0x53, extended: true },   // Delete down
      ],
      'alt-tab': [
        { scancode: 0x38, extended: false },  // Alt down
        { scancode: 0x0F, extended: false },  // Tab down
      ],
      'win': [
        { scancode: 0x5B, extended: true },   // Win down
      ],
      'alt-f4': [
        { scancode: 0x38, extended: false },  // Alt down
        { scancode: 0x3E, extended: false },  // F4 down
      ],
      'print-screen': [
        { scancode: 0x37, extended: true },   // PrintScreen down
      ],
      'win-l': [
        { scancode: 0x5B, extended: true },   // Win down
        { scancode: 0x26, extended: false },  // L down
      ],
      'win-r': [
        { scancode: 0x5B, extended: true },   // Win down
        { scancode: 0x13, extended: false },  // R down
      ],
    };

    const keys = combos[combo];
    if (!keys) return;

    // Press all keys, then release in reverse order
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

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

  // Deep-merge: global rdpDefaults → compile-time defaults → per-connection overrides.
  // This ensures global settings from the Settings dialog are used as a baseline, 
  // while per-connection settings can override any individual field.
  const rdpSettings: RdpConnectionSettings = React.useMemo(
    () => mergeRdpSettings(connection?.rdpSettings, settings.rdpDefaults),
    [connection?.rdpSettings, settings.rdpDefaults],
  );
  const magnifierEnabled = rdpSettings.display?.magnifierEnabled ?? false;
  const magnifierZoom = rdpSettings.display?.magnifierZoom ?? 3;

  // Refs for values used inside stable event listeners and the connection
  // effect.  By reading from refs, the heavy connect/cleanup callbacks never
  // need to list these objects as deps, which means React won't re-fire the
  // connection effect when the parent re-renders with a new object reference.
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

  // ─── Initialize RDP connection ─────────────────────────────────────
  // Reads all mutable values from refs so the callback identity is fully
  // stable (no deps on session/connection/rdpSettings objects).

  const initializeRDPConnection = useCallback(async () => {
    const conn = connectionRef.current;
    const sess = sessionRef.current;
    const rdpCfg = rdpSettingsRef.current;
    if (!conn) return;

    try {
      setConnectionStatus('connecting');
      setStatusMessage('Initiating connection...');

      // Create the frame channel for receiving binary RGBA data
      const frameChannel = new Channel<ArrayBuffer>((data: ArrayBuffer) => {
        if (data.byteLength >= 8) {
          frameQueueRef.current.push(data);
          if (!rafPendingRef.current) {
            rafPendingRef.current = true;
            rafIdRef.current = requestAnimationFrame(renderFrames);
          }
        }
      });

      // Check if there is an existing backend session for this connection
      // that we can re-attach to (session persistence).
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
            // Create the pluggable renderer for the visible canvas
            const rendererType = (rdpCfg.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;
            rendererRef.current?.destroy();
            rendererRef.current = createFrameRenderer(rendererType, canvas);
            setActiveFrontendRenderer(rendererRef.current.name);
          }

          setIsConnected(true);
          setConnectionStatus('connected');
          setStatusMessage(`Re-attached (${sessionInfo.desktop_width}x${sessionInfo.desktop_height})`);

          // Update the session in context so tab title, backendSessionId, and
          // status are all correct for other components.
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

      // The backend handles eviction of any stale session for this connectionId,
      // so we don't need generation counters or duplicate guards on the frontend.
      const sessionId = await invoke('connect_rdp', connectionDetails) as string;

      debugLog(`RDP session created: ${sessionId}`);
      setRdpSessionId(sessionId);
      sessionIdRef.current = sessionId;

      // Persist the backend session ID and connection name into the context
      // so tab titles, detach/reattach, and other components work correctly.
      dispatch({
        type: 'UPDATE_SESSION',
        payload: {
          ...sess,
          backendSessionId: sessionId,
          name: conn.name || sess.name,
          status: 'connecting',
        },
      });

      // Set canvas to requested resolution initially
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = resW;
        canvas.height = resH;
        // NOTE: We intentionally do NOT call canvas.getContext('2d') here.
        // Doing so would permanently lock the canvas to a 2D context and
        // prevent WebGL / WebGPU renderers from acquiring their own context
        // later.  The "Connecting..." feedback is shown via a CSS overlay.
      }
    } catch (error) {
      setConnectionStatus('error');
      setStatusMessage(`Connection failed: ${error}`);
      console.error('RDP initialization failed:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- all mutable values read from refs
  }, []);

  // ─── Reconnect handler ────────────────────────────────────────────
  const handleReconnect = useCallback(async () => {
    const sid = sessionIdRef.current;
    // If we have an active backend session, tell it to reconnect in-place
    // (the backend will drop TCP and re-establish without killing the session).
    if (sid && connectionStatus === 'reconnecting') {
      try {
        await invoke('reconnect_rdp_session', { sessionId: sid });
      } catch { /* ignore — the backend reconnect loop handles retries */ }
      return;
    }
    // Otherwise do a full disconnect + fresh connect
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
    // Re-run the full connection flow
    initializeRDPConnection();
  }, [initializeRDPConnection, connectionStatus]);

  // ─── Disconnect ────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    sessionIdRef.current = null;
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setRdpSessionId(null);
    // Cancel any pending rAF
    if (rafPendingRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafPendingRef.current = false;
    }
    visCtxRef.current = null;
    // Release GPU / Worker resources
    rendererRef.current?.destroy();
    rendererRef.current = null;
    // Detach the viewer — the backend session continues running headless.
    // Use disconnect_rdp only for explicit user-initiated disconnects.
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
    // Disconnect on rejection
    cleanup();
  }, [cleanup]);

  // ─── Event listeners for RDP status/pointer (frames come via Channel) ──

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    // Listen for status updates
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
              // Auto-focus canvas so keyboard/mouse events are captured immediately
              canvas.focus();
            }
            // Initialize (or reinitialize) the offscreen frame buffer
            frameBufferRef.current = new FrameBuffer(status.desktop_width, status.desktop_height);
            // Create (or recreate) the pluggable renderer
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
          // Preserve the error screen – don't overwrite 'error' with 'disconnected'
          setConnectionStatus((prev) => {
            if (prev === 'error') return 'error';
            setRdpSessionId(null);
            sessionIdRef.current = null;
            return 'disconnected';
          });
          break;
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for pointer updates
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

    // Listen for session statistics
    listen<RdpStatsEvent>('rdp://stats', (event) => {
      const s = event.payload;
      if (s.session_id !== sessionIdRef.current) return;
      setStats(s);
    }).then(fn => unlisteners.push(fn));

    // Listen for certificate fingerprint → verify against trust store
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

      // Prompt the user for first-use (always-ask/strict) or mismatch
      setTrustPrompt(result);
    }).then(fn => unlisteners.push(fn));

    // Listen for connection timing breakdown
    listen<RdpTimingEvent>('rdp://timing', (event) => {
      const t = event.payload;
      if (t.session_id !== sessionIdRef.current) return;
      setConnectTiming(t);
    }).then(fn => unlisteners.push(fn));

    // Listen for render backend selection (native renderers)
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
  // Depends ONLY on session.id (a stable string primitive).
  // initializeRDPConnection and cleanup are now stable (empty deps)
  // so they won't cause spurious re-fires.

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session.id is the only meaningful trigger
  }, [session.id]);

  // ─── Cleanup: cancel any pending rAF on unmount ─────────────────────

  useEffect(() => {
    return () => {
      if (rafPendingRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafPendingRef.current = false;
      }
    };
  }, []);

  // ─── Resize to window support ──────────────────────────────────────
  // Debounced ResizeObserver: on resize, immediately scale the cached
  // offscreen buffer to the new dimensions for instant visual feedback,
  // then update state after a short debounce to avoid rapid thrashing.

  useEffect(() => {
    if (!rdpSettings.display?.resizeToWindow) return;
    const container = containerRef.current;
    if (!container) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver((entries) => {
      // Invalidate cached bounding rect on resize.
      cachedRectRef.current = null;
      const entry = entries[0];
      if (!entry || !isConnected) return;
      const { width, height } = entry.contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (w <= 100 || h <= 100) return;

      // Immediately scale the cached frame into the visible canvas at
      // the new dimensions so the user sees instant feedback.
      const canvas = canvasRef.current;
      const fb = frameBufferRef.current;
      if (canvas && fb && fb.hasPainted) {
        if (rendererRef.current && rendererRef.current.type !== 'canvas2d') {
          // GPU renderer owns the visible canvas context — we can't call
          // getContext('2d') on it.  Just resize the canvas; the renderer's
          // resize() + next present() will repaint from the GPU texture.
          canvas.width = w;
          canvas.height = h;
        } else {
          // Canvas 2D path — sync offscreen cache then scale to new size.
          fb.syncFromVisible(canvas);
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(fb.offscreen, 0, 0, fb.offscreen.width, fb.offscreen.height, 0, 0, w, h);
          }
        }
      }

      // Debounce the actual state update + offscreen resize
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setDesktopSize({ width: w, height: h });
        const c = canvasRef.current;
        if (c) {
          c.width = w;
          c.height = h;
        }
        // Resize the offscreen buffer (scales cached content)
        if (frameBufferRef.current) {
          frameBufferRef.current.resize(w, h, c || undefined);
          // Blit the scaled cache to visible canvas immediately
          if (c) frameBufferRef.current.blitFull(c);
        }
        // Resize the pluggable renderer surface
        rendererRef.current?.resize(w, h);
      }, 150);
    });

    observer.observe(container);

    // Invalidate cached bounding rect on scroll (affects canvas position).
    const invalidateRect = () => { cachedRectRef.current = null; };
    window.addEventListener('scroll', invalidateRect, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', invalidateRect);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isConnected, rdpSettings.display?.resizeToWindow]);

  // ─── Input handlers ────────────────────────────────────────────────

  // Mouse move events fire at ~200 Hz on modern browsers.  Sending each
  // one through Tauri IPC individually is prohibitively expensive (+4ms
  // per round-trip from serialisation, Rust Mutex lock, channel send).
  //
  // Strategy:
  //   • Buffer non-priority events (mouse moves).
  //   • Coalesce: only keep the *latest* MouseMove per flush interval
  //     (intermediate positions are skipped — the server only cares
  //     about the current pointer position for absolute mode).
  //   • Flush via setTimeout(0) (~4 ms on most browsers — significantly
  //     faster than requestAnimationFrame's ~16 ms).
  //   • Priority events (clicks, keys, wheel) flush the buffer
  //     immediately so they are never delayed.
  const inputBufferRef = useRef<Record<string, unknown>[]>([]);
  /** Index of the current MouseMove event in the buffer (-1 = none).
   *  Overwrites in-place so flush never needs Array.filter(). */
  const pendingMoveIdxRef = useRef(-1);
  /** Boolean flag for queueMicrotask scheduling (not cancelable like setTimeout). */
  const flushScheduledRef = useRef(false);

  const flushInputBuffer = useCallback(() => {
    flushScheduledRef.current = false;
    const sid = sessionIdRef.current;
    const buf = inputBufferRef.current;
    if (!sid || buf.length === 0) return;
    // Buffer already coalesced — at most one MouseMove at pendingMoveIdx.
    inputBufferRef.current = [];
    pendingMoveIdxRef.current = -1;
    invoke('rdp_send_input', { sessionId: sid, events: buf }).catch(e => {
      debugLog(`Input send error: ${e}`);
    });
  }, []);

  const sendInput = useCallback((events: Record<string, unknown>[], immediate = false) => {
    if (!isConnected || !sessionIdRef.current) return;
    if (immediate) {
      // Mark flush as not scheduled so the microtask (if queued) is a no-op.
      flushScheduledRef.current = false;
      const buf = inputBufferRef.current;
      inputBufferRef.current = [];
      pendingMoveIdxRef.current = -1;
      const sid = sessionIdRef.current;
      // Append immediate events to any buffered ones — reuse buf to avoid spread allocation.
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
    // Buffer events.  MouseMove is overwritten in-place (last-write-wins)
    // so flush never needs to filter — zero allocation coalescing.
    const buf = inputBufferRef.current;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'MouseMove') {
        const idx = pendingMoveIdxRef.current;
        if (idx >= 0) {
          buf[idx] = ev; // overwrite previous MouseMove
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
    // Use cached rect (invalidated by ResizeObserver + scroll listener).
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

  // ─── Magnifier Glass ───────────────────────────────────────────────

  const updateMagnifier = useCallback((mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current;
    const magCanvas = magnifierCanvasRef.current;
    if (!canvas || !magCanvas) return;

    const magCtx = magCanvas.getContext('2d');
    if (!magCtx) return;

    // Read from the offscreen FrameBuffer cache when a GPU renderer owns
    // the visible canvas (getContext('2d') would return null on it).
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

    // Clip to circle
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

    // Draw border
    magCtx.beginPath();
    magCtx.arc(magSize / 2, magSize / 2, magSize / 2 - 2, 0, Math.PI * 2);
    magCtx.strokeStyle = '#3b82f6';
    magCtx.lineWidth = 2;
    magCtx.stroke();

    // Draw crosshair
    magCtx.beginPath();
    magCtx.moveTo(magSize / 2 - 8, magSize / 2);
    magCtx.lineTo(magSize / 2 + 8, magSize / 2);
    magCtx.moveTo(magSize / 2, magSize / 2 - 8);
    magCtx.lineTo(magSize / 2, magSize / 2 + 8);
    magCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    magCtx.lineWidth = 1;
    magCtx.stroke();
  }, [magnifierZoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseMove', x, y }]);

    // Update magnifier position (use cached rect to avoid forced reflow at 200 Hz)
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
    // Ensure the canvas has keyboard focus (e.g. after clicking toolbar)
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

  // Prevent default context menu on right-click
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'reconnecting': return 'text-amber-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      case 'reconnecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  const perfLabel = rdpSettings.performance?.connectionSpeed ?? 'broadband-high';
  const audioEnabled = rdpSettings.audio?.playbackMode !== 'disabled';
  const clipboardEnabled = rdpSettings.deviceRedirection?.clipboard ?? true;
  const colorDepth = rdpSettings.display?.colorDepth ?? 32;

  return (
    <div className={`flex flex-col bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full overflow-hidden'}`}>
      <RDPClientHeader
        sessionName={session.name}
        sessionHostname={session.hostname}
        connectionStatus={connectionStatus}
        statusMessage={statusMessage}
        desktopSize={desktopSize}
        colorDepth={colorDepth}
        perfLabel={perfLabel}
        magnifierEnabled={magnifierEnabled}
        magnifierActive={magnifierActive}
        showInternals={showInternals}
        showSettings={showSettings}
        isFullscreen={isFullscreen}
        recState={recState}
        getStatusColor={getStatusColor}
        getStatusIcon={getStatusIcon}
        setMagnifierActive={setMagnifierActive}
        setShowInternals={setShowInternals}
        setShowSettings={setShowSettings}
        handleScreenshot={handleScreenshot}
        handleScreenshotToClipboard={handleScreenshotToClipboard}
        handleStopRecording={handleStopRecording}
        toggleFullscreen={toggleFullscreen}
        startRecording={startRecording}
        pauseRecording={pauseRecording}
        resumeRecording={resumeRecording}
        handleReconnect={handleReconnect}
        handleDisconnect={handleDisconnect}
        handleCopyToClipboard={handleCopyToClipboard}
        handlePasteFromClipboard={handlePasteFromClipboard}
        handleSendKeys={handleSendKeys}
        handleSignOut={handleSignOut}
        handleForceReboot={handleForceReboot}
        connectionId={session.connectionId}
        certFingerprint={certFingerprint ?? ''}
        connectionName={connection?.name || session.name}
        onRenameConnection={(name) => {
          if (connection) {
            dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, name } });
          }
        }}
        totpConfigs={connection?.totpConfigs}
        onUpdateTotpConfigs={(configs) => {
          if (connection) {
            dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, totpConfigs: configs } });
          }
        }}
      />

      {showSettings && (
        <RDPSettingsPanel
          rdpSettings={rdpSettings}
          colorDepth={colorDepth}
          audioEnabled={audioEnabled}
          clipboardEnabled={clipboardEnabled}
          perfLabel={perfLabel}
          certFingerprint={certFingerprint}
        />
      )}

      {/* RDP Internals Panel */}
      {showInternals && (
        <RDPInternalsPanel
          stats={stats}
          connectTiming={connectTiming}
          rdpSettings={rdpSettings}
          activeRenderBackend={activeRenderBackend}
          activeFrontendRenderer={activeFrontendRenderer}
          onClose={() => setShowInternals(false)}
        />
      )}

      {/* RDP Canvas */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center bg-black p-1 relative min-h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="border border-gray-600 max-w-full max-h-full"
          style={{
            cursor: magnifierActive ? 'crosshair' : pointerStyle,
            imageRendering: 'auto',
            objectFit: 'contain',
            display: connectionStatus !== 'disconnected'
              ? 'block'
              : 'none',
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={handleContextMenu}
          tabIndex={0}
          width={desktopSize.width}
          height={desktopSize.height}
        />

        {/* Magnifier Glass Overlay */}
        {magnifierEnabled && magnifierActive && isConnected && (
          <canvas
            ref={magnifierCanvasRef}
            className="absolute pointer-events-none border-2 border-blue-500 rounded-full shadow-lg shadow-blue-900/50"
            style={{
              left: `${magnifierPos.x - 80}px`,
              top: `${magnifierPos.y - 80}px`,
              width: '160px',
              height: '160px',
            }}
            width={160}
            height={160}
          />
        )}

        {/* Magnifier zoom indicator */}
        {magnifierEnabled && magnifierActive && isConnected && (
          <div className="absolute top-2 right-2 bg-blue-600 bg-opacity-80 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <ZoomIn size={12} />
            {magnifierZoom}x
          </div>
        )}
        
        {connectionStatus === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <p className="text-gray-400">Connecting to RDP server...</p>
              <p className="text-gray-500 text-sm mt-2">
                {session.name !== session.hostname ? `${session.name} (${session.hostname})` : session.hostname}
              </p>
              {statusMessage && <p className="text-gray-600 text-xs mt-1">{statusMessage}</p>}
            </div>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <RdpErrorScreen
            sessionId={rdpSessionId || session.id}
            hostname={session.hostname}
            errorMessage={statusMessage || `Unable to connect to ${session.hostname}`}
            onRetry={() => {
              setConnectionStatus('disconnected');
              setStatusMessage('');
              setRdpSessionId(null);
              sessionIdRef.current = null;
              // Backend evicts the old session automatically when connectionId matches
              initializeRDPConnection();
            }}
            connectionDetails={{
              port: connection?.port || 3389,
              username: connection?.username || '',
              password: connection?.password || '',
              domain: (connection as Record<string, unknown> | undefined)?.domain as string | undefined,
              rdpSettings,
            }}
          />
        )}

        {connectionStatus === 'disconnected' && (
          <div className="text-center">
            <Monitor size={48} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Disconnected</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <RDPStatusBar
        rdpSessionId={rdpSessionId}
        sessionId={session.id}
        isConnected={isConnected}
        desktopSize={desktopSize}
        stats={stats}
        certFingerprint={certFingerprint}
        audioEnabled={audioEnabled}
        clipboardEnabled={clipboardEnabled}
        magnifierActive={magnifierActive}
      />

      {/* Trust Warning Dialog */}
      {trustPrompt && certIdentity && (
        <TrustWarningDialog
          type="tls"
          host={session.hostname}
          port={connection?.port || 3389}
          reason={trustPrompt.status === 'mismatch' ? 'mismatch' : 'first-use'}
          receivedIdentity={certIdentity}
          storedIdentity={trustPrompt.status === 'mismatch' ? trustPrompt.stored : undefined}
          onAccept={handleTrustAccept}
          onReject={handleTrustReject}
        />
      )}
    </div>
  );
};

export default RDPClient;
