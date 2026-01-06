import React, { useEffect, useState, useCallback } from "react";
import { X, Link, Plus, Trash2, RefreshCw, Edit, FolderOpen, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { useConnections } from "../contexts/useConnections";
import { CollectionManager } from "../utils/collectionManager";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface ShortcutInfo {
  id: string;
  name: string;
  path: string;
  collectionId?: string;
  connectionId?: string;
  createdAt: string;
  exists: boolean;
}

interface ShortcutManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type FolderPreset = 'desktop' | 'documents' | 'appdata' | 'custom';

const STORAGE_KEY = 'sortofremoteng-shortcuts';

export const ShortcutManagerDialog: React.FC<ShortcutManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { state } = useConnections();
  const collectionManager = CollectionManager.getInstance();
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  
  // Form state
  const [shortcutName, setShortcutName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<FolderPreset>('desktop');
  const [customFolderPath, setCustomFolderPath] = useState("");
  
  // UI state
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<ShortcutInfo | null>(null);

  // Load shortcuts from storage
  const loadShortcuts = useCallback(async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: ShortcutInfo[] = JSON.parse(stored);
        // Check if shortcuts still exist
        const isTauri = typeof window !== "undefined" &&
          Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
        
        if (isTauri) {
          const checked = await Promise.all(
            parsed.map(async (shortcut) => {
              try {
                const exists = await invoke<boolean>('check_file_exists', { path: shortcut.path });
                return { ...shortcut, exists };
              } catch {
                return { ...shortcut, exists: false };
              }
            })
          );
          setShortcuts(checked);
          // Update storage with existence status
          localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
        } else {
          setShortcuts(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load shortcuts:', error);
    }
  }, []);

  // Save shortcuts to storage
  const saveShortcuts = useCallback((newShortcuts: ShortcutInfo[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newShortcuts));
    setShortcuts(newShortcuts);
  }, []);

  // Auto-cleanup shortcuts that no longer exist
  const cleanupShortcuts = useCallback(() => {
    const existing = shortcuts.filter(s => s.exists);
    if (existing.length !== shortcuts.length) {
      saveShortcuts(existing);
      setStatusMessage(t('shortcuts.cleanedUp', { count: shortcuts.length - existing.length, defaultValue: `Cleaned up ${shortcuts.length - existing.length} missing shortcut(s)` }));
      setTimeout(() => setStatusMessage(""), 3000);
    }
  }, [shortcuts, saveShortcuts, t]);

  useEffect(() => {
    if (!isOpen) return;
    collectionManager
      .getAllCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
    loadShortcuts();
  }, [collectionManager, isOpen, loadShortcuts]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editingShortcut) {
          setEditingShortcut(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, editingShortcut]);

  const getFolderPath = async (preset: FolderPreset): Promise<string | null> => {
    try {
      switch (preset) {
        case 'desktop':
          return await invoke<string>('get_desktop_path');
        case 'documents':
          return await invoke<string>('get_documents_path');
        case 'appdata':
          return await invoke<string>('get_appdata_path');
        case 'custom':
          return customFolderPath || null;
        default:
          return null;
      }
    } catch (error) {
      console.error('Failed to get folder path:', error);
      return null;
    }
  };

  const handleCreateShortcut = async () => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setErrorMessage(t('shortcuts.notAvailable', 'Desktop shortcuts are only available in the Tauri app.'));
      return;
    }
    if (!shortcutName.trim()) {
      setErrorMessage(t('shortcuts.nameRequired', 'Shortcut name is required.'));
      return;
    }

    const folderPath = await getFolderPath(selectedFolder);
    if (!folderPath) {
      setErrorMessage(t('shortcuts.invalidFolder', 'Please select a valid folder.'));
      return;
    }

    setErrorMessage("");
    setStatusMessage(t('shortcuts.creating', 'Creating shortcut...'));
    setIsLoading(true);
    
    try {
      const path = await invoke<string>("create_desktop_shortcut", {
        name: shortcutName.trim(),
        collectionId: selectedCollectionId || null,
        connectionId: selectedConnectionId || null,
        description: selectedConnectionId
          ? `Open connection ${shortcutName.trim()}`
          : "Launch sortOfRemoteNG",
        folderPath: folderPath,
      });
      
      // Add to tracked shortcuts
      const newShortcut: ShortcutInfo = {
        id: Date.now().toString(),
        name: shortcutName.trim(),
        path,
        collectionId: selectedCollectionId || undefined,
        connectionId: selectedConnectionId || undefined,
        createdAt: new Date().toISOString(),
        exists: true,
      };
      
      saveShortcuts([...shortcuts, newShortcut]);
      setStatusMessage(t('shortcuts.created', { path, defaultValue: `Shortcut created at: ${path}` }));
      
      // Reset form
      setShortcutName("");
      setSelectedCollectionId("");
      setSelectedConnectionId("");
    } catch (error) {
      console.error("Failed to create shortcut:", error);
      setErrorMessage(
        error instanceof Error ? error.message : t('shortcuts.createFailed', 'Failed to create shortcut.'),
      );
      setStatusMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteShortcut = async (shortcut: ShortcutInfo) => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    
    if (isTauri && shortcut.exists) {
      try {
        await invoke('delete_file', { path: shortcut.path });
      } catch (error) {
        console.warn('Failed to delete shortcut file:', error);
      }
    }
    
    // Remove from list
    saveShortcuts(shortcuts.filter(s => s.id !== shortcut.id));
    setStatusMessage(t('shortcuts.deleted', { name: shortcut.name, defaultValue: `Shortcut "${shortcut.name}" removed` }));
    setTimeout(() => setStatusMessage(""), 3000);
  };

  const handleEditShortcut = (shortcut: ShortcutInfo) => {
    setEditingShortcut(shortcut);
    setShortcutName(shortcut.name);
    setSelectedCollectionId(shortcut.collectionId || "");
    setSelectedConnectionId(shortcut.connectionId || "");
  };

  const handleUpdateShortcut = async () => {
    if (!editingShortcut) return;
    
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setErrorMessage(t('shortcuts.notAvailable', 'Desktop shortcuts are only available in the Tauri app.'));
      return;
    }
    if (!shortcutName.trim()) {
      setErrorMessage(t('shortcuts.nameRequired', 'Shortcut name is required.'));
      return;
    }

    setErrorMessage("");
    setStatusMessage(t('shortcuts.updating', 'Updating shortcut...'));
    setIsLoading(true);
    
    try {
      // Delete old shortcut
      if (editingShortcut.exists) {
        try {
          await invoke('delete_file', { path: editingShortcut.path });
        } catch (error) {
          console.warn('Failed to delete old shortcut:', error);
        }
      }
      
      // Create new shortcut with same folder
      const folderPath = editingShortcut.path.substring(0, editingShortcut.path.lastIndexOf('\\'));
      
      const path = await invoke<string>("create_desktop_shortcut", {
        name: shortcutName.trim(),
        collectionId: selectedCollectionId || null,
        connectionId: selectedConnectionId || null,
        description: selectedConnectionId
          ? `Open connection ${shortcutName.trim()}`
          : "Launch sortOfRemoteNG",
        folderPath: folderPath,
      });
      
      // Update tracked shortcut
      const updatedShortcut: ShortcutInfo = {
        ...editingShortcut,
        name: shortcutName.trim(),
        path,
        collectionId: selectedCollectionId || undefined,
        connectionId: selectedConnectionId || undefined,
        exists: true,
      };
      
      saveShortcuts(shortcuts.map(s => s.id === editingShortcut.id ? updatedShortcut : s));
      setStatusMessage(t('shortcuts.updated', 'Shortcut updated successfully'));
      
      // Reset form and editing state
      setEditingShortcut(null);
      setShortcutName("");
      setSelectedCollectionId("");
      setSelectedConnectionId("");
    } catch (error) {
      console.error("Failed to update shortcut:", error);
      setErrorMessage(
        error instanceof Error ? error.message : t('shortcuts.updateFailed', 'Failed to update shortcut.'),
      );
      setStatusMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  const openShortcutLocation = async (path: string) => {
    try {
      const folder = path.substring(0, path.lastIndexOf('\\'));
      await invoke('open_folder', { path: folder });
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };

  const refreshShortcuts = async () => {
    setIsLoading(true);
    await loadShortcuts();
    setIsLoading(false);
    setStatusMessage(t('shortcuts.refreshed', 'Shortcut list refreshed'));
    setTimeout(() => setStatusMessage(""), 3000);
  };

  if (!isOpen) return null;

  const getConnectionName = (connectionId?: string) => {
    if (!connectionId) return null;
    const conn = state.connections.find(c => c.id === connectionId);
    return conn?.name || t('common.unknown', 'Unknown');
  };

  const getCollectionName = (collectionId?: string) => {
    if (!collectionId) return null;
    const coll = collections.find(c => c.id === collectionId);
    return coll?.name || t('common.unknown', 'Unknown');
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-3xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Link size={16} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t('shortcuts.title', 'Shortcut Manager')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshShortcuts}
              disabled={isLoading}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
              data-tooltip={t('shortcuts.refresh', 'Refresh')}
              aria-label={t('shortcuts.refresh', 'Refresh')}
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              data-tooltip={t('common.close', 'Close')}
              aria-label={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Create/Edit Form */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4 flex items-center gap-2">
              {editingShortcut ? (
                <>
                  <Edit size={14} />
                  {t('shortcuts.editShortcut', 'Edit Shortcut')}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {t('shortcuts.createShortcut', 'Create Shortcut')}
                </>
              )}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('shortcuts.shortcutName', 'Shortcut Name')}
                </label>
                <input
                  type="text"
                  value={shortcutName}
                  onChange={(e) => setShortcutName(e.target.value)}
                  placeholder={t('shortcuts.namePlaceholder', 'My Server Connection')}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              {!editingShortcut && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('shortcuts.folder', 'Folder')}
                  </label>
                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value as FolderPreset)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="desktop">{t('shortcuts.desktop', 'Desktop')}</option>
                    <option value="documents">{t('shortcuts.documents', 'Documents')}</option>
                    <option value="appdata">{t('shortcuts.appdata', 'AppData (Start Menu)')}</option>
                    <option value="custom">{t('shortcuts.customFolder', 'Custom Folder...')}</option>
                  </select>
                </div>
              )}
              
              {!editingShortcut && selectedFolder === 'custom' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('shortcuts.customPath', 'Custom Folder Path')}
                  </label>
                  <input
                    type="text"
                    value={customFolderPath}
                    onChange={(e) => setCustomFolderPath(e.target.value)}
                    placeholder="C:\Users\Me\Shortcuts"
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('shortcuts.collection', 'Collection')} ({t('common.optional', 'Optional')})
                </label>
                <select
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('shortcuts.selectCollection', 'Select a collection...')}</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('shortcuts.connection', 'Connection')} ({t('common.optional', 'Optional')})
                </label>
                <select
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('shortcuts.selectConnection', 'Select a connection...')}</option>
                  {state.connections
                    .filter((conn) => !conn.isGroup)
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              {editingShortcut && (
                <button
                  onClick={() => {
                    setEditingShortcut(null);
                    setShortcutName("");
                    setSelectedCollectionId("");
                    setSelectedConnectionId("");
                  }}
                  className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
              )}
              <button
                onClick={editingShortcut ? handleUpdateShortcut : handleCreateShortcut}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
              >
                {editingShortcut ? (
                  <>
                    <Check size={14} />
                    {t('shortcuts.updateShortcut', 'Update Shortcut')}
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    {t('shortcuts.createShortcut', 'Create Shortcut')}
                  </>
                )}
              </button>
            </div>
            {errorMessage && (
              <div className="mt-4 rounded-md border border-red-600/60 bg-red-900/20 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </div>
            )}
            {statusMessage && (
              <div className="mt-4 rounded-md border border-blue-600/60 bg-blue-900/20 px-3 py-2 text-sm text-blue-200">
                {statusMessage}
              </div>
            )}
          </div>

          {/* Shortcuts List */}
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 flex items-center gap-2">
                <FolderOpen size={14} />
                {t('shortcuts.createdShortcuts', 'Created Shortcuts')} ({shortcuts.length})
              </h3>
              {shortcuts.some(s => !s.exists) && (
                <button
                  onClick={cleanupShortcuts}
                  className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
                >
                  <AlertTriangle size={12} />
                  {t('shortcuts.cleanupMissing', 'Clean up missing')}
                </button>
              )}
            </div>
            
            {shortcuts.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <Link size={32} className="mx-auto mb-3 opacity-50" />
                <p>{t('shortcuts.noShortcuts', 'No shortcuts created yet')}</p>
                <p className="text-sm mt-1">{t('shortcuts.createHint', 'Create a shortcut above to get started')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      shortcut.exists 
                        ? 'bg-gray-800/50 border-gray-600' 
                        : 'bg-red-900/20 border-red-600/40'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link size={14} className={shortcut.exists ? 'text-blue-400' : 'text-red-400'} />
                        <span className="font-medium text-white truncate">{shortcut.name}</span>
                        {!shortcut.exists && (
                          <span className="text-xs text-red-400 px-2 py-0.5 bg-red-900/30 rounded">
                            {t('shortcuts.missing', 'Missing')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {shortcut.path}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        {shortcut.connectionId && (
                          <span>🔌 {getConnectionName(shortcut.connectionId)}</span>
                        )}
                        {shortcut.collectionId && (
                          <span>📁 {getCollectionName(shortcut.collectionId)}</span>
                        )}
                        <span>
                          {new Date(shortcut.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {shortcut.exists && (
                        <button
                          onClick={() => openShortcutLocation(shortcut.path)}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                          data-tooltip={t('shortcuts.openLocation', 'Open Location')}
                        >
                          <ExternalLink size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditShortcut(shortcut)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        data-tooltip={t('shortcuts.edit', 'Edit')}
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteShortcut(shortcut)}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                        data-tooltip={t('shortcuts.delete', 'Delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-5 text-sm text-gray-400">
            {t('shortcuts.description', 'Shortcuts can open a collection or a specific connection when the app starts. They are tracked automatically and you can clean up any that have been manually deleted.')}
          </div>
        </div>
      </div>
    </div>
  );
};
