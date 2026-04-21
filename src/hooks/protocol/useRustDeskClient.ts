import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionSession } from '../../types/connection/connection';

// ─── Types mirroring the Rust backend (see sorng-rustdesk/src/rustdesk/types.rs) ──

export type RustDeskQuality = 'best' | 'balanced' | 'low' | 'custom';
export type RustDeskCodec = 'auto' | 'vp8' | 'vp9' | 'av1' | 'h264' | 'h265';
export type RustDeskConnectionType =
  | 'remote_desktop'
  | 'file_transfer'
  | 'port_forward'
  | 'view_camera'
  | 'terminal';

export interface RustDeskConnectRequest {
  remote_id: string;
  password?: string | null;
  connection_type: RustDeskConnectionType;
  quality?: RustDeskQuality | null;
  view_only?: boolean | null;
  enable_audio?: boolean | null;
  enable_clipboard?: boolean | null;
  enable_file_transfer?: boolean | null;
  codec?: RustDeskCodec | null;
  force_relay?: boolean | null;
  tunnel_local_port?: number | null;
  tunnel_remote_port?: number | null;
}

export interface RustDeskSession {
  id: string;
  remote_id: string;
  connection_type: RustDeskConnectionType;
  connected: boolean;
  quality: RustDeskQuality;
  codec: RustDeskCodec;
  view_only: boolean;
  enable_audio: boolean;
  enable_clipboard: boolean;
  enable_file_transfer: boolean;
  force_relay: boolean;
  password_protected: boolean;
  remote_device_name?: string | null;
  remote_os?: string | null;
}

export interface RustDeskBinaryInfo {
  path: string;
  version?: string | null;
  installed: boolean;
  service_running: boolean;
  platform: string;
}

interface ClientSettings {
  quality: RustDeskQuality;
  viewOnly: boolean;
  showCursor: boolean;
  enableAudio: boolean;
  enableClipboard: boolean;
  enableFileTransfer: boolean;
}

const DEFAULT_SETTINGS: ClientSettings = {
  quality: 'balanced',
  viewOnly: false,
  showCursor: true,
  enableAudio: true,
  enableClipboard: true,
  enableFileTransfer: true,
};

/**
 * Pull the RustDesk remote ID from the session's connection record.
 * Falls back to hostname if no explicit ID was configured.
 */
function resolveRemoteId(session: ConnectionSession): string {
  const conn = (session as unknown as { connection?: { rustdeskId?: string } }).connection;
  return conn?.rustdeskId || session.hostname;
}

function resolveRemotePassword(session: ConnectionSession): string | undefined {
  const conn = (session as unknown as {
    connection?: { rustdeskPassword?: string; password?: string };
  }).connection;
  return conn?.rustdeskPassword || conn?.password || undefined;
}

export function useRustDeskClient(session: ConnectionSession) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettingsState] = useState<ClientSettings>(DEFAULT_SETTINGS);
  const [binaryInfo, setBinaryInfo] = useState<RustDeskBinaryInfo | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Lifecycle guard — prevents state updates after unmount and gates parallel
  // connect/disconnect invocations triggered by React StrictMode double-effect.
  const activeRef = useRef(true);

  // Keep a stable settings updater so downstream callers can dispatch partial
  // updates. When a session is live, push each change to the backend.
  const setSettings = useCallback<
    React.Dispatch<React.SetStateAction<ClientSettings>>
  >((next) => {
    setSettingsState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const liveSessionId = sessionIdRef.current;
      if (liveSessionId) {
        // Fire-and-forget; errors are logged but do not toggle connection status.
        invoke('rustdesk_update_session_settings', {
          sessionId: liveSessionId,
          update: {
            quality: resolved.quality,
            view_only: resolved.viewOnly,
            enable_audio: resolved.enableAudio,
            enable_clipboard: resolved.enableClipboard,
            enable_file_transfer: resolved.enableFileTransfer,
          },
        }).catch((err) => {
          console.warn('[RustDesk] failed to push session settings:', err);
        });
      }
      return resolved;
    });
  }, []);

  const initializeRustDeskConnection = useCallback(async () => {
    setConnectionStatus('connecting');
    setErrorMessage(null);

    try {
      // 1) Make sure the local RustDesk binary is installed before we try to
      //    dial out. This is a cheap guard that gives the user a clear error.
      const info = await invoke<RustDeskBinaryInfo>('rustdesk_get_binary_info');
      if (!activeRef.current) return;
      setBinaryInfo(info);
      if (!info.installed) {
        throw new Error(
          'RustDesk client is not installed on this system. Please install RustDesk first.',
        );
      }

      // 2) Build the connect request from the current session + defaults.
      const request: RustDeskConnectRequest = {
        remote_id: resolveRemoteId(session),
        password: resolveRemotePassword(session) ?? null,
        connection_type: 'remote_desktop',
        quality: settings.quality,
        view_only: settings.viewOnly,
        enable_audio: settings.enableAudio,
        enable_clipboard: settings.enableClipboard,
        enable_file_transfer: settings.enableFileTransfer,
        codec: 'auto',
        force_relay: false,
        tunnel_local_port: null,
        tunnel_remote_port: null,
      };

      // 3) Ask the backend to spawn the RustDesk process for us.
      const sessionId = await invoke<string>('rustdesk_connect', { request });
      if (!activeRef.current) {
        // Race: component unmounted while awaiting. Clean up.
        invoke('rustdesk_disconnect', { sessionId }).catch(() => {});
        return;
      }

      sessionIdRef.current = sessionId;
      setIsConnected(true);
      setConnectionStatus('connected');
    } catch (err) {
      if (!activeRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[RustDesk] connection failed:', msg);
      setErrorMessage(msg);
      setConnectionStatus('error');
      setIsConnected(false);
    }
  }, [session, settings]);

  const cleanup = useCallback(async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    setIsConnected(false);
    setConnectionStatus('disconnected');
    if (sid) {
      try {
        await invoke('rustdesk_disconnect', { sessionId: sid });
      } catch (err) {
        console.warn('[RustDesk] disconnect failed:', err);
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    // Only kick off a connect if we have no live session — prevents the React
    // StrictMode double-invoke from spinning up two backend sessions.
    if (!sessionIdRef.current) {
      void initializeRustDeskConnection();
    }
    return () => {
      activeRef.current = false;
      void cleanup();
    };
    // We intentionally exclude `initializeRustDeskConnection` from the dep
    // array: it closes over `settings`, and we do not want mid-session
    // setting tweaks to force a full reconnect. Settings changes are pushed
    // through `rustdesk_update_session_settings` in `setSettings`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const getStatusColor = useCallback(() => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-400';
      case 'connecting':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-[var(--color-textSecondary)]';
    }
  }, [connectionStatus]);

  return {
    isConnected,
    connectionStatus,
    errorMessage,
    isFullscreen,
    setIsFullscreen,
    showSettings,
    setShowSettings,
    settings,
    setSettings,
    getStatusColor,
    binaryInfo,
    sessionId: sessionIdRef.current,
    reconnect: initializeRustDeskConnection,
    disconnect: cleanup,
  };
}
