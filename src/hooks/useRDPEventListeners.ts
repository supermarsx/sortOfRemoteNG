import { useEffect, useState } from 'react';
import { debugLog } from '../utils/debugLogger';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { RdpStatusEvent, RdpPointerEvent, RdpStatsEvent, RdpCertFingerprintEvent, RdpTimingEvent } from '../types/rdpEvents';
import type { Connection } from '../types/connection';
import type { Settings } from '../types/settings';
import { FrameBuffer } from '../components/rdpCanvas';
import { createFrameRenderer, type FrameRenderer, type FrontendRendererType } from '../components/rdpRenderers';
import {
  verifyIdentity,
  trustIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../utils/trustStore';

interface UseRDPEventListenersArgs {
  sessionIdRef: React.MutableRefObject<string | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  frameBufferRef: React.MutableRefObject<FrameBuffer | null>;
  rendererRef: React.MutableRefObject<FrameRenderer | null>;
  frontendRendererTypeRef: React.MutableRefObject<FrontendRendererType>;
  connectionRef: React.MutableRefObject<Connection | undefined>;
  settingsRef: React.MutableRefObject<Settings>;
  setIsConnected: (v: boolean) => void;
  setConnectionStatus: React.Dispatch<React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>>;
  setStatusMessage: (v: string) => void;
  setDesktopSize: (v: { width: number; height: number }) => void;
  setPointerStyle: (v: string) => void;
  setRdpSessionId: (v: string | null) => void;
  setActiveFrontendRenderer: (v: string) => void;
  setActiveRenderBackend: (v: string) => void;
}

export function useRDPEventListeners({
  sessionIdRef,
  canvasRef,
  frameBufferRef,
  rendererRef,
  frontendRendererTypeRef,
  connectionRef,
  settingsRef,
  setIsConnected,
  setConnectionStatus,
  setStatusMessage,
  setDesktopSize,
  setPointerStyle,
  setRdpSessionId,
  setActiveFrontendRenderer,
  setActiveRenderBackend,
}: UseRDPEventListenersArgs) {
  const [stats, setStats] = useState<RdpStatsEvent | null>(null);
  const [certFingerprint, setCertFingerprint] = useState<string | null>(null);
  const [certIdentity, setCertIdentity] = useState<CertIdentity | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const [connectTiming, setConnectTiming] = useState<RdpTimingEvent | null>(null);

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
          setConnectionStatus('connecting');
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

    // Listen for certificate fingerprint -> verify against trust store
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

    // Listen for connection timing breakdown
    listen<RdpTimingEvent>('rdp://timing', (event) => {
      const t = event.payload;
      if (t.session_id !== sessionIdRef.current) return;
      setConnectTiming(t);
    }).then(fn => unlisteners.push(fn));

    // Listen for render backend selection
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

  return {
    stats,
    certFingerprint,
    certIdentity,
    trustPrompt,
    setTrustPrompt,
    connectTiming,
  };
}
