import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useConnections } from '../../contexts/useConnections';
import type { Connection, ConnectionSession } from '../../types/connection/connection';

interface AnyDeskBackendSession {
  id: string;
  anydesk_id: string;
  password?: string | null;
  connected: boolean;
  start_time: string;
}

const getLaunchTarget = (connection: Connection | undefined) =>
  connection?.hostname?.trim() || connection?.name?.trim() || '';

export function useAnyDeskClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = useMemo(
    () => state.connections.find((item) => item.id === session.connectionId),
    [state.connections, session.connectionId],
  );

  const [isLaunching, setIsLaunching] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendSession, setBackendSession] = useState<AnyDeskBackendSession | null>(null);
  const [launchMode, setLaunchMode] = useState<'managed' | 'external' | null>(null);

  const anydeskId = getLaunchTarget(connection);

  const updateSession = useCallback((payload: Partial<ConnectionSession>) => {
    dispatch({
      type: 'UPDATE_SESSION',
      payload: {
        ...session,
        ...payload,
      },
    });
  }, [dispatch, session]);

  const refreshSession = useCallback(async () => {
    if (!session.backendSessionId) {
      setBackendSession(null);
      return null;
    }

    try {
      const data = await invoke<AnyDeskBackendSession | null>('get_anydesk_session', {
        sessionId: session.backendSessionId,
      });

      setBackendSession(data);
      if (!data) {
        updateSession({ backendSessionId: undefined });
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    }
  }, [session.backendSessionId, updateSession]);

  const launchExternalScheme = useCallback(() => {
    if (!anydeskId) {
      throw new Error('Missing AnyDesk ID or hostname.');
    }

    window.open(`anydesk://${anydeskId}`, '_blank', 'noopener,noreferrer');
    setLaunchMode('external');
  }, [anydeskId]);

  const launch = useCallback(async () => {
    if (!connection) {
      setError('The connection for this session could not be found.');
      return;
    }

    if (!anydeskId) {
      setError('Add an AnyDesk ID or hostname before launching this session.');
      return;
    }

    setIsLaunching(true);
    setError(null);

    try {
      const sessionId = await invoke<string>('launch_anydesk', {
        anydeskId,
        password: connection.password || null,
      });

      updateSession({ backendSessionId: sessionId, status: 'connected', errorMessage: undefined });
      setLaunchMode('managed');

      const managedSession = await invoke<AnyDeskBackendSession | null>('get_anydesk_session', {
        sessionId,
      });
      setBackendSession(managedSession);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      try {
        launchExternalScheme();
        setError(`Native AnyDesk launch failed. Falling back to the URL scheme. ${message}`);
      } catch (schemeError) {
        const schemeMessage = schemeError instanceof Error ? schemeError.message : String(schemeError);
        setError(`Failed to launch AnyDesk. ${message}. ${schemeMessage}`);
      }
    } finally {
      setIsLaunching(false);
    }
  }, [anydeskId, connection, launchExternalScheme, updateSession]);

  const disconnect = useCallback(async () => {
    if (!session.backendSessionId) {
      setLaunchMode(null);
      updateSession({ status: 'disconnected', backendSessionId: undefined });
      return;
    }

    setIsDisconnecting(true);
    setError(null);

    try {
      await invoke<void>('disconnect_anydesk', { sessionId: session.backendSessionId });
      setBackendSession(null);
      setLaunchMode(null);
      updateSession({ status: 'disconnected', backendSessionId: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDisconnecting(false);
    }
  }, [session.backendSessionId, updateSession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!session.backendSessionId) return undefined;

    const interval = window.setInterval(() => {
      refreshSession();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshSession, session.backendSessionId]);

  return {
    connection,
    anydeskId,
    backendSession,
    launchMode,
    isLaunching,
    isDisconnecting,
    error,
    canLaunch: Boolean(connection && anydeskId),
    launch,
    disconnect,
    refreshSession,
  };
}

export default useAnyDeskClient;