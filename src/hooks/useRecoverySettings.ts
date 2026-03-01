import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { IndexedDbService } from '../utils/indexedDbService';
import { SettingsManager } from '../utils/settingsManager';
import { invoke } from '@tauri-apps/api/core';

export function useRecoverySettings() {
  const { t } = useTranslation();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDeleteAppData = useCallback(async (includeCollections: boolean) => {
    setIsLoading(true);
    try {
      const keysToDelete = [
        'mremote-settings', 'mremote-theme', 'mremote-color-scheme',
        'mremote-custom-themes', 'mremote-custom-color-schemes',
        'mremote-action-log', 'mremote-clean-exit', 'mremote-last-session-time',
      ];
      if (includeCollections) {
        keysToDelete.push('mremote-collections', 'mremote-current-collection', 'mremote-encryption-salt', 'mremote-encryption-verify');
      }
      for (const key of keysToDelete) {
        await IndexedDbService.removeItem(key);
      }
      const localStorageKeys = Object.keys(localStorage).filter(
        (key) => key.startsWith('mremote-') || key.startsWith('wol-'),
      );
      for (const key of localStorageKeys) {
        localStorage.removeItem(key);
      }
      sessionStorage.clear();
      alert(
        includeCollections
          ? 'All app data including collections has been deleted. The app will now reload.'
          : 'App data has been deleted (collections preserved). The app will now reload.',
      );
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete app data:', error);
      alert(`Failed to delete app data: ${error}`);
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  }, []);

  const handleResetSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      await IndexedDbService.removeItem('mremote-settings');
      await SettingsManager.getInstance().initialize();
      alert('Settings have been reset to defaults. The app will now reload.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset settings:', error);
      alert(`Failed to reset settings: ${error}`);
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  }, []);

  const handleSoftRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleHardRestart = useCallback(async () => {
    setIsLoading(true);
    try {
      await invoke('restart_app');
    } catch {
      window.location.reload();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const confirmActions: Record<string, { title: string; description: string; onConfirm: () => void; danger: boolean }> = {
    deleteData: {
      title: 'Delete App Data',
      description: 'This will delete all app settings, preferences, and cached data. Your collections will be preserved.',
      onConfirm: () => handleDeleteAppData(false),
      danger: true,
    },
    deleteAll: {
      title: 'Delete All Data',
      description: 'This will permanently delete ALL app data including your collections, passwords, and settings. This action cannot be undone!',
      onConfirm: () => handleDeleteAppData(true),
      danger: true,
    },
    resetSettings: {
      title: 'Reset Settings',
      description: 'This will reset all settings to their default values. Your collections will not be affected.',
      onConfirm: handleResetSettings,
      danger: false,
    },
  };

  return {
    t,
    confirmAction,
    setConfirmAction,
    isLoading,
    handleSoftRestart,
    handleHardRestart,
    confirmActions,
  };
}
