import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Database,
  FolderX,
  Power,
  Loader2,
} from "lucide-react";
import { IndexedDbService } from "../../../utils/indexedDbService";
import { SettingsManager } from "../../../utils/settingsManager";
import { invoke } from "@tauri-apps/api/core";

interface RecoverySettingsProps {
  onClose?: () => void;
}

export const RecoverySettings: React.FC<RecoverySettingsProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDeleteAppData = async (includeCollections: boolean) => {
    setIsLoading(true);
    try {
      // Get all IndexedDB keys
      const keysToDelete = [
        "mremote-settings",
        "mremote-theme",
        "mremote-color-scheme",
        "mremote-custom-themes",
        "mremote-custom-color-schemes",
        "mremote-action-log",
        "mremote-clean-exit",
        "mremote-last-session-time",
      ];

      if (includeCollections) {
        keysToDelete.push(
          "mremote-collections",
          "mremote-current-collection",
          "mremote-encryption-salt",
          "mremote-encryption-verify"
        );
      }

      // Delete from IndexedDB
      for (const key of keysToDelete) {
        await IndexedDbService.removeItem(key);
      }

      // Clear localStorage
      const localStorageKeys = Object.keys(localStorage).filter(
        (key) => key.startsWith("mremote-") || key.startsWith("wol-")
      );
      for (const key of localStorageKeys) {
        localStorage.removeItem(key);
      }

      // Clear sessionStorage
      sessionStorage.clear();

      alert(
        includeCollections
          ? "All app data including collections has been deleted. The app will now reload."
          : "App data has been deleted (collections preserved). The app will now reload."
      );
      
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete app data:", error);
      alert(`Failed to delete app data: ${error}`);
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  };

  const handleResetSettings = async () => {
    setIsLoading(true);
    try {
      await IndexedDbService.removeItem("mremote-settings");
      await SettingsManager.getInstance().initialize();
      alert("Settings have been reset to defaults. The app will now reload.");
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset settings:", error);
      alert(`Failed to reset settings: ${error}`);
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  };

  const handleSoftRestart = () => {
    window.location.reload();
  };

  const handleHardRestart = async () => {
    setIsLoading(true);
    try {
      // Try to restart via Tauri
      await invoke("restart_app");
    } catch {
      // Fallback to soft restart if Tauri command fails
      window.location.reload();
    } finally {
      setIsLoading(false);
    }
  };

  const renderConfirmDialog = () => {
    if (!confirmAction) return null;

    const actions: Record<string, { title: string; description: string; onConfirm: () => void; danger: boolean }> = {
      deleteData: {
        title: "Delete App Data",
        description: "This will delete all app settings, preferences, and cached data. Your collections will be preserved.",
        onConfirm: () => handleDeleteAppData(false),
        danger: true,
      },
      deleteAll: {
        title: "Delete All Data",
        description: "This will permanently delete ALL app data including your collections, passwords, and settings. This action cannot be undone!",
        onConfirm: () => handleDeleteAppData(true),
        danger: true,
      },
      resetSettings: {
        title: "Reset Settings",
        description: "This will reset all settings to their default values. Your collections will not be affected.",
        onConfirm: handleResetSettings,
        danger: false,
      },
    };

    const action = actions[confirmAction];
    if (!action) return null;

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
        <div className="bg-[var(--color-surface)] rounded-xl p-6 max-w-md w-full mx-4 border border-[var(--color-border)] shadow-2xl">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full ${action.danger ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}>
              <AlertTriangle className={`w-6 h-6 ${action.danger ? 'text-red-400' : 'text-yellow-400'}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">{action.title}</h3>
              <p className="text-sm text-[var(--color-textSecondary)] mb-4">{action.description}</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmAction(null)}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={action.onConfirm}
                  disabled={isLoading}
                  className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 ${
                    action.danger
                      ? 'bg-red-600 text-[var(--color-text)] hover:bg-red-700'
                      : 'bg-yellow-600 text-[var(--color-text)] hover:bg-yellow-700'
                  }`}
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <RotateCcw className="w-5 h-5" />
        Recovery
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Use these options to troubleshoot issues or reset the application to a clean state.
      </p>

      {/* Data Management */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-400" />
          Data Management
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <FolderX className="w-4 h-4 text-orange-400" />
                Delete App Data
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Delete settings, theme preferences, and cached data. Collections are preserved.
              </p>
            </div>
            <button
              onClick={() => setConfirmAction("deleteData")}
              className="px-4 py-2 text-sm rounded-lg bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 border border-orange-600/30 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>

          <div className="border-t border-[var(--color-border)]/50 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  Delete All Data & Collections
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Permanently delete everything including collections and passwords. Cannot be undone!
                </p>
              </div>
              <button
                onClick={() => setConfirmAction("deleteAll")}
                className="px-4 py-2 text-sm rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/30 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-yellow-400" />
          Reset Options
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <RotateCcw className="w-4 h-4 text-yellow-400" />
                Reset All Settings
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Reset all settings to their default values. Your collections will not be affected.
              </p>
            </div>
            <button
              onClick={() => setConfirmAction("resetSettings")}
              className="px-4 py-2 text-sm rounded-lg bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 border border-yellow-600/30 transition-colors flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Restart Options */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-green-400" />
          Restart Options
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <RefreshCw className="w-4 h-4 text-blue-400" />
                Soft Restart
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Reload the frontend without restarting the application. Quick way to apply changes.
              </p>
            </div>
            <button
              onClick={handleSoftRestart}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-600/30 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reload
            </button>
          </div>

          <div className="border-t border-[var(--color-border)]/50 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                  <Power className="w-4 h-4 text-green-400" />
                  Hard Restart
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Completely restart the application including the backend.
                </p>
              </div>
              <button
                onClick={handleHardRestart}
                disabled={isLoading}
                className="px-4 py-2 text-sm rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/30 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                Restart
              </button>
            </div>
          </div>
        </div>
      </div>

      {renderConfirmDialog()}
    </div>
  );
};

export default RecoverySettings;
