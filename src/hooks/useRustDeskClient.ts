import { useState, useEffect, useCallback } from 'react';
import { ConnectionSession } from '../types/connection';

export function useRustDeskClient(session: ConnectionSession) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('connecting');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    quality: 'balanced',
    viewOnly: false,
    showCursor: true,
    enableAudio: true,
    enableClipboard: true,
    enableFileTransfer: true,
  });

  const initializeRustDeskConnection = useCallback(async () => {
    try {
      setConnectionStatus('connecting');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsConnected(true);
      setConnectionStatus('connected');
    } catch (error) {
      setConnectionStatus('error');
      console.error('RustDesk connection failed:', error);
    }
  }, []);

  const cleanup = useCallback(() => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  useEffect(() => {
    initializeRustDeskConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeRustDeskConnection, cleanup]);

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
    isFullscreen,
    setIsFullscreen,
    showSettings,
    setShowSettings,
    settings,
    setSettings,
    getStatusColor,
  };
}
