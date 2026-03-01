import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../types/settings';

export function useApiSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<'stopped' | 'running' | 'starting' | 'stopping'>('stopped');
  const [actualPort, setActualPort] = useState<number | null>(null);

  const updateRestApi = useCallback(
    (updates: Partial<GlobalSettings['restApi']>) => {
      updateSettings({ restApi: { ...settings.restApi, ...updates } });
    },
    [settings.restApi, updateSettings],
  );

  const generateApiKey = useCallback(() => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const key = Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('');
    updateRestApi({ apiKey: key });
  }, [updateRestApi]);

  const copyApiKey = useCallback(async () => {
    if (settings.restApi?.apiKey) {
      await navigator.clipboard.writeText(settings.restApi.apiKey);
    }
  }, [settings.restApi?.apiKey]);

  const generateRandomPort = useCallback(() => {
    const randomPort = Math.floor(Math.random() * 50000) + 10000;
    updateRestApi({ port: randomPort });
  }, [updateRestApi]);

  const handleStartServer = useCallback(async () => {
    setServerStatus('starting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (settings.restApi?.useRandomPort) {
        const randomPort = Math.floor(Math.random() * 50000) + 10000;
        setActualPort(randomPort);
      } else {
        setActualPort(settings.restApi?.port || 9876);
      }
      setServerStatus('running');
    } catch (error) {
      console.error('Failed to start API server:', error);
      setServerStatus('stopped');
    }
  }, [settings.restApi?.useRandomPort, settings.restApi?.port]);

  const handleStopServer = useCallback(async () => {
    setServerStatus('stopping');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setActualPort(null);
      setServerStatus('stopped');
    } catch (error) {
      console.error('Failed to stop API server:', error);
    }
  }, []);

  const handleRestartServer = useCallback(async () => {
    setServerStatus('stopping');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setActualPort(null);
      setServerStatus('stopped');
    } catch (error) {
      console.error('Failed to stop API server:', error);
      return;
    }
    setServerStatus('starting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (settings.restApi?.useRandomPort) {
        const randomPort = Math.floor(Math.random() * 50000) + 10000;
        setActualPort(randomPort);
      } else {
        setActualPort(settings.restApi?.port || 9876);
      }
      setServerStatus('running');
    } catch (error) {
      console.error('Failed to start API server:', error);
      setServerStatus('stopped');
    }
  }, [settings.restApi?.useRandomPort, settings.restApi?.port]);

  return {
    t,
    serverStatus,
    actualPort,
    updateRestApi,
    generateApiKey,
    copyApiKey,
    generateRandomPort,
    handleStartServer,
    handleStopServer,
    handleRestartServer,
  };
}
