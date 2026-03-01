import { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../../utils/debugLogger';
import { ConnectionSession, Connection, DEFAULT_RDP_SETTINGS, RdpConnectionSettings } from '../../types/connection';
import { invoke, Channel } from '@tauri-apps/api/core';
import { FrameBuffer } from '../../components/rdpCanvas';
import { createFrameRenderer, type FrameRenderer, type FrontendRendererType } from '../../components/rdpRenderers';

interface UseRDPConnectionArgs {
  session: ConnectionSession;
  connection: Connection | undefined;
  rdpSettings: RdpConnectionSettings;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  frameBufferRef: React.MutableRefObject<FrameBuffer | null>;
  rendererRef: React.MutableRefObject<FrameRenderer | null>;
  frameQueueRef: React.MutableRefObject<ArrayBuffer[]>;
  rafPendingRef: React.MutableRefObject<boolean>;
  rafIdRef: React.MutableRefObject<number>;
  renderFrames: () => void;
  frontendRendererTypeRef: React.MutableRefObject<FrontendRendererType>;
  visCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
}

export function useRDPConnection({
  session,
  connection,
  rdpSettings,
  canvasRef,
  frameBufferRef,
  rendererRef,
  frameQueueRef,
  rafPendingRef,
  rafIdRef,
  renderFrames,
  frontendRendererTypeRef,
  visCtxRef,
}: UseRDPConnectionArgs) {
  const [rdpSessionId, setRdpSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [desktopSize, setDesktopSize] = useState({ width: 1920, height: 1080 });

  // Refs for stable closures
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const rdpSettingsRef = useRef(rdpSettings);
  rdpSettingsRef.current = rdpSettings;
  const sessionIdRef = useRef<string | null>(null);

  // ── Initialize RDP connection ─────────────────────────────────────
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
          }

          setIsConnected(true);
          setConnectionStatus('connected');
          setStatusMessage(`Re-attached (${sessionInfo.desktop_width}x${sessionInfo.desktop_height})`);
          return;
        }
      } catch {
        // No existing session or list failed — proceed with new connection
      }

      // Auto-detect keyboard layout
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
          // Detection not available
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

  // ── Disconnect ────────────────────────────────────────────────────
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
        // ignore
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reads connection from ref
  }, []);

  // ── Connect on mount, disconnect on unmount ───────────────────────
  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session.id is the only meaningful trigger
  }, [session.id]);

  // ── Cancel pending rAF on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafPendingRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafPendingRef.current = false;
      }
    };
  }, []);

  return {
    rdpSessionId,
    isConnected,
    connectionStatus,
    statusMessage,
    desktopSize,
    setDesktopSize,
    sessionIdRef,
    sessionRef,
    connectionRef,
    rdpSettingsRef,
    cleanup,
    initializeRDPConnection,
    setConnectionStatus,
    setStatusMessage,
    setIsConnected,
    setRdpSessionId,
  };
}
