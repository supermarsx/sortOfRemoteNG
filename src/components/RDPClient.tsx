import React, { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession } from '../types/connection';
import { DEFAULT_RDP_SETTINGS, RdpConnectionSettings } from '../types/connection';
import {
  Monitor,
  Maximize2,
  Minimize2,
  Settings,
  Wifi,
  WifiOff,
  MousePointer,
  Keyboard,
  Volume2,
  VolumeX,
  Copy,
  Activity,
  X,
  Search,
  ZoomIn,
  Camera,
  ClipboardCopy,
  Circle,
  Square,
  Pause,
  Play,
} from 'lucide-react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { useConnections } from '../contexts/useConnections';
import RdpErrorScreen from './RdpErrorScreen';
import { useSettings } from '../contexts/SettingsContext';
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
import { useSessionRecorder, formatDuration } from '../hooks/useSessionRecorder';

interface RDPClientProps {
  session: ConnectionSession;
}

interface RdpStatusEvent {
  session_id: string;
  status: string;
  message: string;
  desktop_width?: number;
  desktop_height?: number;
}

interface RdpPointerEvent {
  session_id: string;
  pointer_type: string;
  x?: number;
  y?: number;
}

interface RdpStatsEvent {
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
}

interface RdpCertFingerprintEvent {
  session_id: string;
  fingerprint: string;
  host: string;
  port: number;
}

interface RdpTimingEvent {
  session_id: string;
  dns_ms: number;
  tcp_ms: number;
  negotiate_ms: number;
  tls_ms: number;
  auth_ms: number;
  total_ms: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Convert JS mouse button index to backend button code
function mouseButtonCode(jsButton: number): number {
  switch (jsButton) {
    case 0: return 0; // Left
    case 1: return 1; // Middle
    case 2: return 2; // Right
    case 3: return 3; // X1
    case 4: return 4; // X2
    default: return 0;
  }
}

// Map JS keyboard event to scancode + extended flag
function keyToScancode(e: KeyboardEvent): { scancode: number; extended: boolean } | null {
  const map: Record<string, [number, boolean]> = {
    Escape: [0x01, false], Digit1: [0x02, false], Digit2: [0x03, false],
    Digit3: [0x04, false], Digit4: [0x05, false], Digit5: [0x06, false],
    Digit6: [0x07, false], Digit7: [0x08, false], Digit8: [0x09, false],
    Digit9: [0x0A, false], Digit0: [0x0B, false], Minus: [0x0C, false],
    Equal: [0x0D, false], Backspace: [0x0E, false], Tab: [0x0F, false],
    KeyQ: [0x10, false], KeyW: [0x11, false], KeyE: [0x12, false],
    KeyR: [0x13, false], KeyT: [0x14, false], KeyY: [0x15, false],
    KeyU: [0x16, false], KeyI: [0x17, false], KeyO: [0x18, false],
    KeyP: [0x19, false], BracketLeft: [0x1A, false], BracketRight: [0x1B, false],
    Enter: [0x1C, false], ControlLeft: [0x1D, false], KeyA: [0x1E, false],
    KeyS: [0x1F, false], KeyD: [0x20, false], KeyF: [0x21, false],
    KeyG: [0x22, false], KeyH: [0x23, false], KeyJ: [0x24, false],
    KeyK: [0x25, false], KeyL: [0x26, false], Semicolon: [0x27, false],
    Quote: [0x28, false], Backquote: [0x29, false], ShiftLeft: [0x2A, false],
    Backslash: [0x2B, false], KeyZ: [0x2C, false], KeyX: [0x2D, false],
    KeyC: [0x2E, false], KeyV: [0x2F, false], KeyB: [0x30, false],
    KeyN: [0x31, false], KeyM: [0x32, false], Comma: [0x33, false],
    Period: [0x34, false], Slash: [0x35, false], ShiftRight: [0x36, false],
    NumpadMultiply: [0x37, false], AltLeft: [0x38, false], Space: [0x39, false],
    CapsLock: [0x3A, false], F1: [0x3B, false], F2: [0x3C, false],
    F3: [0x3D, false], F4: [0x3E, false], F5: [0x3F, false],
    F6: [0x40, false], F7: [0x41, false], F8: [0x42, false],
    F9: [0x43, false], F10: [0x44, false], NumLock: [0x45, false],
    ScrollLock: [0x46, false], Numpad7: [0x47, false], Numpad8: [0x48, false],
    Numpad9: [0x49, false], NumpadSubtract: [0x4A, false],
    Numpad4: [0x4B, false], Numpad5: [0x4C, false], Numpad6: [0x4D, false],
    NumpadAdd: [0x4E, false], Numpad1: [0x4F, false], Numpad2: [0x50, false],
    Numpad3: [0x51, false], Numpad0: [0x52, false], NumpadDecimal: [0x53, false],
    F11: [0x57, false], F12: [0x58, false],
    // Extended keys
    NumpadEnter: [0x1C, true], ControlRight: [0x1D, true], NumpadDivide: [0x35, true],
    PrintScreen: [0x37, true], AltRight: [0x38, true], Home: [0x47, true],
    ArrowUp: [0x48, true], PageUp: [0x49, true], ArrowLeft: [0x4B, true],
    ArrowRight: [0x4D, true], End: [0x4F, true], ArrowDown: [0x50, true],
    PageDown: [0x51, true], Insert: [0x52, true], Delete: [0x53, true],
    MetaLeft: [0x5B, true], MetaRight: [0x5C, true], ContextMenu: [0x5D, true],
  };

  const entry = map[e.code];
  if (!entry) return null;
  return { scancode: entry[0], extended: entry[1] };
}

const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const { state } = useConnections();
  const { settings } = useSettings();
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
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
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
      }
    } catch (error) {
      console.error('Screenshot failed:', error);
    }
  }, [session, rdpSessionId, desktopSize]);

  // Screenshot to clipboard handler
  const handleScreenshotToClipboard = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || desktopSize.width === 0) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
      }
    } catch (error) {
      console.error('Screenshot to clipboard failed:', error);
    }
  }, [desktopSize]);

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

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

  // Deep-merge: global rdpDefaults → compile-time defaults → per-connection overrides.
  // This ensures global settings from the Settings dialog are used as a baseline, 
  // while per-connection settings can override any individual field.
  const rdpSettings: RdpConnectionSettings = React.useMemo(() => {
    const base = DEFAULT_RDP_SETTINGS;
    const conn = connection?.rdpSettings;
    const global = settings.rdpDefaults;
    // Apply global defaults onto the compile-time defaults, then per-connection on top
    return {
      display: {
        ...base.display,
        width: global.defaultWidth ?? base.display?.width,
        height: global.defaultHeight ?? base.display?.height,
        colorDepth: global.defaultColorDepth ?? base.display?.colorDepth,
        smartSizing: global.smartSizing ?? base.display?.smartSizing,
        ...conn?.display,
      },
      audio: { ...base.audio, ...conn?.audio },
      input: { ...base.input, ...conn?.input },
      deviceRedirection: { ...base.deviceRedirection, ...conn?.deviceRedirection },
      performance: {
        ...base.performance,
        targetFps: global.targetFps ?? base.performance?.targetFps,
        frameBatching: global.frameBatching ?? base.performance?.frameBatching,
        frameBatchIntervalMs: global.frameBatchIntervalMs ?? base.performance?.frameBatchIntervalMs,
        renderBackend: global.renderBackend ?? base.performance?.renderBackend,
        frontendRenderer: (global.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType,
        codecs: {
          ...base.performance?.codecs,
          enableCodecs: global.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
          remoteFx: global.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
          remoteFxEntropy: global.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
          enableGfx: global.gfxEnabled ?? base.performance?.codecs?.enableGfx,
          h264Decoder: global.h264Decoder ?? base.performance?.codecs?.h264Decoder,
          ...conn?.performance?.codecs,
        },
        ...conn?.performance,
        // Re-apply codecs after conn spread so nested codec merge isn't overwritten
        ...(conn?.performance ? {
          codecs: {
            ...base.performance?.codecs,
            enableCodecs: global.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
            remoteFx: global.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
            remoteFxEntropy: global.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
            enableGfx: global.gfxEnabled ?? base.performance?.codecs?.enableGfx,
            h264Decoder: global.h264Decoder ?? base.performance?.codecs?.h264Decoder,
            ...conn?.performance?.codecs,
          },
        } : {}),
      },
      security: {
        ...base.security,
        useCredSsp: global.useCredSsp ?? base.security?.useCredSsp,
        enableTls: global.enableTls ?? base.security?.enableTls,
        enableNla: global.enableNla ?? base.security?.enableNla,
        autoLogon: global.autoLogon ?? base.security?.autoLogon,
        ...conn?.security,
      },
      gateway: {
        ...base.gateway,
        enabled: global.gatewayEnabled ?? base.gateway?.enabled,
        hostname: global.gatewayHostname || base.gateway?.hostname,
        port: global.gatewayPort ?? base.gateway?.port,
        authMethod: global.gatewayAuthMethod ?? base.gateway?.authMethod,
        transportMode: global.gatewayTransportMode ?? base.gateway?.transportMode,
        bypassForLocal: global.gatewayBypassLocal ?? base.gateway?.bypassForLocal,
        ...conn?.gateway,
      },
      hyperv: {
        ...base.hyperv,
        enhancedSessionMode: global.enhancedSessionMode ?? base.hyperv?.enhancedSessionMode,
        ...conn?.hyperv,
      },
      negotiation: {
        ...base.negotiation,
        autoDetect: global.autoDetect ?? base.negotiation?.autoDetect,
        strategy: global.negotiationStrategy ?? base.negotiation?.strategy,
        maxRetries: global.maxRetries ?? base.negotiation?.maxRetries,
        retryDelayMs: global.retryDelayMs ?? base.negotiation?.retryDelayMs,
        ...conn?.negotiation,
      },
      advanced: {
        ...base.advanced,
        fullFrameSyncInterval: global.fullFrameSyncInterval ?? base.advanced?.fullFrameSyncInterval,
        readTimeoutMs: global.readTimeoutMs ?? base.advanced?.readTimeoutMs,
        ...conn?.advanced,
      },
      tcp: {
        ...base.tcp,
        connectTimeoutSecs: global.tcpConnectTimeoutSecs ?? base.tcp?.connectTimeoutSecs,
        nodelay: global.tcpNodelay ?? base.tcp?.nodelay,
        keepAlive: global.tcpKeepAlive ?? base.tcp?.keepAlive,
        keepAliveIntervalSecs: global.tcpKeepAliveIntervalSecs ?? base.tcp?.keepAliveIntervalSecs,
        recvBufferSize: global.tcpRecvBufferSize ?? base.tcp?.recvBufferSize,
        sendBufferSize: global.tcpSendBufferSize ?? base.tcp?.sendBufferSize,
        ...conn?.tcp,
      },
    };
  }, [connection?.rdpSettings, settings.rdpDefaults]);
  const magnifierEnabled = rdpSettings.display?.magnifierEnabled ?? false;
  const magnifierZoom = rdpSettings.display?.magnifierZoom ?? 3;

  // Refs for values used inside stable event listeners (avoids stale closures)
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Keep the renderer type ref in sync with the resolved settings
  frontendRendererTypeRef.current = (rdpSettings.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;

  // ─── Initialize RDP connection ─────────────────────────────────────

  const initializeRDPConnection = useCallback(async () => {
    if (!connection) return;

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
          s => s.connection_id === connection.id && s.connected
        );

        if (existing) {
          debugLog(`Re-attaching to existing session ${existing.id} for ${connection.id}`);
          setStatusMessage('Re-attaching to existing session...');

          const sessionInfo = await invoke<{
            id: string;
            desktop_width: number;
            desktop_height: number;
          }>('attach_rdp_session', {
            connectionId: connection.id,
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
            const rendererType = (rdpSettings.performance?.frontendRenderer ?? 'auto') as FrontendRendererType;
            rendererRef.current?.destroy();
            rendererRef.current = createFrameRenderer(rendererType, canvas);
            setActiveFrontendRenderer(rendererRef.current.name);
          }

          setIsConnected(true);
          setConnectionStatus('connected');
          setStatusMessage(`Re-attached (${sessionInfo.desktop_width}x${sessionInfo.desktop_height})`);
          return;
        }
      } catch {
        // No existing session or list failed — proceed with new connection
      }

      // Auto-detect keyboard layout from the OS if configured
      let effectiveSettings = rdpSettings;
      if (rdpSettings.input?.autoDetectLayout !== false) {
        try {
          const detectedLayout = await invoke<number>('detect_keyboard_layout');
          const langId = detectedLayout & 0xFFFF;
          if (langId && langId !== 0) {
            effectiveSettings = {
              ...rdpSettings,
              input: { ...rdpSettings.input, keyboardLayout: langId },
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
        connectionId: connection.id,
        host: session.hostname,
        port: connection.port || 3389,
        username: connection.username || '',
        password: connection.password || '',
        domain: connection.domain,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- renderFrames is ref-stable
  }, [session, connection, rdpSettings]);

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
    if (connection) {
      try {
        await invoke('detach_rdp_session', { connectionId: connection.id });
      } catch {
        // ignore — session may already have ended
      }
    }
  }, [connection]);

  // ─── Trust accept / reject ─────────────────────────────────────────

  const handleTrustAccept = useCallback(() => {
    if (certIdentity && connection) {
      const port = connection.port || 3389;
      trustIdentity(session.hostname, port, 'tls', certIdentity, true, connection.id);
    }
    setTrustPrompt(null);
  }, [certIdentity, connection, session.hostname]);

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
          setConnectionStatus('connecting');
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

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeRDPConnection, cleanup]);

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
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  const perfLabel = rdpSettings.performance?.connectionSpeed ?? 'broadband-high';
  const audioEnabled = rdpSettings.audio?.playbackMode !== 'disabled';
  const clipboardEnabled = rdpSettings.deviceRedirection?.clipboard ?? true;
  const colorDepth = rdpSettings.display?.colorDepth ?? 32;

  return (
    <div className={`flex flex-col bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full overflow-hidden'}`}>
      {/* RDP Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-blue-400" />
          <span className="text-sm text-gray-300">
            RDP - {session.name !== session.hostname ? `${session.name} (${session.hostname})` : session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{connectionStatus}</span>
          </div>
          {statusMessage && (
            <span className="text-xs text-gray-500 ml-2 truncate max-w-xs">{statusMessage}</span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <span>{desktopSize.width}x{desktopSize.height}</span>
            <span>•</span>
            <span>{colorDepth}-bit</span>
            <span>•</span>
            <span className="capitalize">{perfLabel}</span>
          </div>

          {magnifierEnabled && (
            <button
              onClick={() => setMagnifierActive(!magnifierActive)}
              className={`p-1 hover:bg-gray-700 rounded transition-colors ${magnifierActive ? 'text-blue-400 bg-gray-700' : 'text-gray-400 hover:text-white'}`}
              title="Magnifier Glass"
            >
              <Search size={14} />
            </button>
          )}
          
          <button
            onClick={() => setShowInternals(!showInternals)}
            className={`p-1 hover:bg-gray-700 rounded transition-colors ${showInternals ? 'text-green-400 bg-gray-700' : 'text-gray-400 hover:text-white'}`}
            title="RDP Internals"
          >
            <Activity size={14} />
          </button>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="RDP Settings"
          >
            <Settings size={14} />
          </button>
          
          {/* Screenshot to file */}
          <button
            onClick={handleScreenshot}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Save screenshot to file"
          >
            <Camera size={14} />
          </button>
          {/* Screenshot to clipboard */}
          <button
            onClick={handleScreenshotToClipboard}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Copy screenshot to clipboard"
          >
            <ClipboardCopy size={14} />
          </button>

          {/* Recording */}
          {!recState.isRecording ? (
            <button
              onClick={() => startRecording('webm')}
              className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-red-400"
              title="Start recording"
            >
              <Circle size={14} className="fill-current" />
            </button>
          ) : (
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-red-400 animate-pulse font-mono">
                REC {formatDuration(recState.duration)}
              </span>
              {recState.isPaused ? (
                <button
                  onClick={resumeRecording}
                  className="p-1 hover:bg-gray-700 rounded text-yellow-400"
                  title="Resume recording"
                >
                  <Play size={12} />
                </button>
              ) : (
                <button
                  onClick={pauseRecording}
                  className="p-1 hover:bg-gray-700 rounded text-yellow-400"
                  title="Pause recording"
                >
                  <Pause size={12} />
                </button>
              )}
              <button
                onClick={handleStopRecording}
                className="p-1 hover:bg-gray-700 rounded text-red-400"
                title="Stop and save recording"
              >
                <Square size={12} className="fill-current" />
              </button>
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Resolution</div>
              <div className="text-white text-xs font-mono">{rdpSettings.display?.width ?? 1920}x{rdpSettings.display?.height ?? 1080}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Color Depth</div>
              <div className="text-white text-xs font-mono">{colorDepth}-bit</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Audio</div>
              <div className="text-white text-xs font-mono flex items-center gap-1">
                {audioEnabled ? <Volume2 size={12} className="text-green-400" /> : <VolumeX size={12} className="text-gray-600" />}
                {rdpSettings.audio?.playbackMode ?? 'local'}
              </div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Clipboard</div>
              <div className={`text-xs font-mono ${clipboardEnabled ? 'text-green-400' : 'text-gray-600'}`}>
                {clipboardEnabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Speed Preset</div>
              <div className="text-white text-xs font-mono capitalize">{perfLabel}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Frame Batching</div>
              <div className={`text-xs font-mono ${rdpSettings.performance?.frameBatching ? 'text-green-400' : 'text-yellow-400'}`}>
                {rdpSettings.performance?.frameBatching ? `On (${rdpSettings.performance?.frameBatchIntervalMs ?? 33}ms)` : 'Off'}
              </div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Security</div>
              <div className="text-white text-xs font-mono">
                {rdpSettings.security?.enableNla ? 'NLA' : ''}{rdpSettings.security?.enableTls ? '+TLS' : ''}
              </div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Keyboard</div>
              <div className="text-white text-xs font-mono">
                0x{(rdpSettings.input?.keyboardLayout ?? 0x0409).toString(16).padStart(4, '0')}
              </div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Mouse Mode</div>
              <div className="text-white text-xs font-mono capitalize">{rdpSettings.input?.mouseMode ?? 'absolute'}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-xs mb-1">Perf Flags</div>
              <div className="text-white text-xs font-mono">
                {[
                  rdpSettings.performance?.disableWallpaper && 'noWP',
                  rdpSettings.performance?.disableFullWindowDrag && 'noDrag',
                  rdpSettings.performance?.disableMenuAnimations && 'noAnim',
                  rdpSettings.performance?.disableTheming && 'noTheme',
                  rdpSettings.performance?.enableFontSmoothing && 'CT',
                  rdpSettings.performance?.enableDesktopComposition && 'Aero',
                ].filter(Boolean).join(' ')}
              </div>
            </div>
            {certFingerprint && (
              <div className="bg-gray-900 rounded p-2 col-span-2">
                <div className="text-gray-500 text-xs mb-1">Server Certificate</div>
                <div className="text-cyan-400 text-xs font-mono truncate" title={certFingerprint}>
                  SHA256:{certFingerprint.slice(0, 23)}…
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RDP Internals Panel */}
      {showInternals && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Activity size={14} className="text-green-400" />
              RDP Session Internals
            </h3>
            <button onClick={() => setShowInternals(false)} className="text-gray-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Phase</div>
                <div className="text-white font-mono capitalize">{stats.phase}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Uptime</div>
                <div className="text-white font-mono">{formatUptime(stats.uptime_secs)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">FPS</div>
                <div className={`font-mono font-bold ${stats.fps >= 20 ? 'text-green-400' : stats.fps >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {stats.fps.toFixed(1)}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Frames</div>
                <div className="text-white font-mono">{stats.frame_count.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Received</div>
                <div className="text-cyan-400 font-mono">{formatBytes(stats.bytes_received)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Sent</div>
                <div className="text-orange-400 font-mono">{formatBytes(stats.bytes_sent)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">PDUs In</div>
                <div className="text-white font-mono">{stats.pdus_received.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">PDUs Out</div>
                <div className="text-white font-mono">{stats.pdus_sent.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Input Events</div>
                <div className="text-white font-mono">{stats.input_events.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Reactivations</div>
                <div className="text-white font-mono">{stats.reactivations}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Errors (Recovered)</div>
                <div className={`font-mono ${stats.errors_recovered > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {stats.errors_recovered}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Bandwidth</div>
                <div className="text-white font-mono">
                  {stats.uptime_secs > 0 ? formatBytes(Math.round(stats.bytes_received / stats.uptime_secs)) : '0 B'}/s
                </div>
              </div>
              {/* Extended internals */}
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Avg Frame Size</div>
                <div className="text-white font-mono">
                  {stats.frame_count > 0 ? formatBytes(Math.round(stats.bytes_received / stats.frame_count)) : '–'}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">PDU Rate</div>
                <div className="text-white font-mono">
                  {stats.uptime_secs > 0 ? `${(stats.pdus_received / stats.uptime_secs).toFixed(0)}/s` : '–'}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Frame Batching</div>
                <div className={`font-mono ${rdpSettings.performance?.frameBatching ? 'text-green-400' : 'text-yellow-400'}`}>
                  {rdpSettings.performance?.frameBatching ? `On @ ${rdpSettings.performance?.frameBatchIntervalMs ?? 33}ms` : 'Off'}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Read Timeout</div>
                <div className="text-white font-mono">{rdpSettings.advanced?.readTimeoutMs ?? 16}ms</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Target FPS</div>
                <div className="text-white font-mono">{rdpSettings.performance?.targetFps ?? 30}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Sync Interval</div>
                <div className="text-white font-mono">every {rdpSettings.advanced?.fullFrameSyncInterval ?? 300} frames</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Render Backend</div>
                <div className={`font-mono font-bold ${
                  activeRenderBackend === 'wgpu' ? 'text-purple-400' :
                  activeRenderBackend === 'softbuffer' ? 'text-blue-400' : 'text-gray-300'
                }`}>
                  {activeRenderBackend}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Frontend Renderer</div>
                <div className={`font-mono font-bold ${
                  activeFrontendRenderer.includes('WebGPU') ? 'text-purple-400' :
                  activeFrontendRenderer.includes('WebGL') ? 'text-green-400' :
                  activeFrontendRenderer.includes('Worker') ? 'text-cyan-400' : 'text-blue-400'
                }`}>
                  {activeFrontendRenderer}
                </div>
              </div>
              {stats.last_error && (
                <div className="bg-gray-900 rounded p-2 col-span-2 md:col-span-4 lg:col-span-6">
                  <div className="text-gray-500 mb-1">Last Error</div>
                  <div className="text-red-400 font-mono truncate" title={stats.last_error}>{stats.last_error}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-xs">Waiting for session statistics...</p>
          )}

          {/* Connection timing breakdown */}
          {connectTiming && (
            <div className="mt-3 border-t border-gray-700 pt-3">
              <h4 className="text-xs font-semibold text-gray-300 mb-2">Connection Timing</h4>
              <div className="flex items-center gap-1 text-xs h-6">
                {[
                  { label: 'DNS', ms: connectTiming.dns_ms, color: 'bg-purple-500' },
                  { label: 'TCP', ms: connectTiming.tcp_ms, color: 'bg-blue-500' },
                  { label: 'Negotiate', ms: connectTiming.negotiate_ms, color: 'bg-cyan-500' },
                  { label: 'TLS', ms: connectTiming.tls_ms, color: 'bg-green-500' },
                  { label: 'Auth', ms: connectTiming.auth_ms, color: 'bg-orange-500' },
                ].map((phase) => {
                  const pct = connectTiming.total_ms > 0 ? Math.max((phase.ms / connectTiming.total_ms) * 100, 4) : 20;
                  return (
                    <div
                      key={phase.label}
                      className={`${phase.color} rounded h-full flex items-center justify-center text-white font-mono`}
                      style={{ width: `${pct}%`, minWidth: '40px' }}
                      title={`${phase.label}: ${phase.ms}ms`}
                    >
                      {phase.ms}ms
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                {[
                  { label: 'DNS', color: 'bg-purple-500' },
                  { label: 'TCP', color: 'bg-blue-500' },
                  { label: 'Negotiate', color: 'bg-cyan-500' },
                  { label: 'TLS', color: 'bg-green-500' },
                  { label: 'Auth', color: 'bg-orange-500' },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1">
                    <span className={`inline-block w-2 h-2 rounded-sm ${l.color}`} />
                    {l.label}
                  </span>
                ))}
                <span className="ml-auto font-mono text-gray-400">Total: {connectTiming.total_ms}ms</span>
              </div>
            </div>
          )}
        </div>
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
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-4">
          <span>Session: {(rdpSessionId || session.id).slice(0, 8)}</span>
          <span>Protocol: RDP</span>
          {isConnected && (
            <>
              <span>Desktop: {desktopSize.width}x{desktopSize.height}</span>
              <span>Encryption: TLS/NLA</span>
              {stats && (
                <>
                  <span className="text-green-400">{stats.fps.toFixed(0)} FPS</span>
                  <span>↓{formatBytes(stats.bytes_received)}</span>
                  <span>↑{formatBytes(stats.bytes_sent)}</span>
                </>
              )}
              {certFingerprint && (
                <span className="text-cyan-400" title={`SHA256:${certFingerprint}`}>
                  Cert: {certFingerprint.slice(0, 11)}…
                </span>
              )}
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <MousePointer size={12} />
          <Keyboard size={12} />
          {audioEnabled && <Volume2 size={12} />}
          {clipboardEnabled && <Copy size={12} />}
          {magnifierActive && <Search size={12} className="text-blue-400" />}
        </div>
      </div>

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
