import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConnections } from "../../contexts/useConnections";
import { CollectionManager } from "../../utils/collectionManager";
import { useTranslation } from "react-i18next";

// ─── Types ─────────────────────────────────────────────────────────

export interface ShortcutInfo {
  id: string;
  name: string;
  path: string;
  collectionId?: string;
  connectionId?: string;
  createdAt: string;
  exists: boolean;
}

export interface ScannedShortcut {
  name: string;
  path: string;
  target: string | null;
  arguments: string | null;
  is_sortofremoteng: boolean;
}

export type FolderPreset = "desktop" | "documents" | "appdata" | "custom";

const STORAGE_KEY = "sortofremoteng-shortcuts";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useShortcutManager(isOpen: boolean) {
  const { t } = useTranslation();
  const { state } = useConnections();
  const collectionManager = CollectionManager.getInstance();

  const [collections, setCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);

  // Form state
  const [shortcutName, setShortcutName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedFolder, setSelectedFolder] =
    useState<FolderPreset>("desktop");
  const [customFolderPath, setCustomFolderPath] = useState("");

  // UI state
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<ShortcutInfo | null>(
    null,
  );
  const [isScanning, setIsScanning] = useState(false);
  const [scannedShortcuts, setScannedShortcuts] = useState<ScannedShortcut[]>(
    [],
  );
  const [showScanResults, setShowScanResults] = useState(false);

  // ─── Persistence helpers ────────────────────────────────────────

  const saveShortcuts = useCallback((newShortcuts: ShortcutInfo[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newShortcuts));
    setShortcuts(newShortcuts);
  }, []);

  const loadShortcuts = useCallback(async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: ShortcutInfo[] = JSON.parse(stored);
        if (isTauri()) {
          const checked = await Promise.all(
            parsed.map(async (shortcut) => {
              try {
                const exists = await invoke<boolean>("check_file_exists", {
                  path: shortcut.path,
                });
                return { ...shortcut, exists };
              } catch {
                return { ...shortcut, exists: false };
              }
            }),
          );
          setShortcuts(checked);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
        } else {
          setShortcuts(parsed);
        }
      }
    } catch (error) {
      console.error("Failed to load shortcuts:", error);
    }
  }, []);

  // ─── Cleanup ────────────────────────────────────────────────────

  const cleanupShortcuts = useCallback(() => {
    const existing = shortcuts.filter((s) => s.exists);
    if (existing.length !== shortcuts.length) {
      saveShortcuts(existing);
      setStatusMessage(
        t("shortcuts.cleanedUp", {
          count: shortcuts.length - existing.length,
          defaultValue: `Cleaned up ${shortcuts.length - existing.length} missing shortcut(s)`,
        }),
      );
      setTimeout(() => setStatusMessage(""), 3000);
    }
  }, [shortcuts, saveShortcuts, t]);

  // ─── Scan external shortcuts ────────────────────────────────────

  const handleScanShortcuts = useCallback(async () => {
    if (!isTauri()) {
      setErrorMessage(
        t(
          "shortcuts.notAvailable",
          "This feature is only available in the Tauri app.",
        ),
      );
      return;
    }
    setIsScanning(true);
    setErrorMessage("");
    setStatusMessage(t("shortcuts.scanning", "Scanning for shortcuts..."));

    try {
      const foldersToScan: string[] = [];
      try {
        const desktop = await invoke<string>("get_desktop_path");
        if (desktop) foldersToScan.push(desktop);
      } catch {
        /* ignore */
      }
      try {
        const documents = await invoke<string>("get_documents_path");
        if (documents) foldersToScan.push(documents);
      } catch {
        /* ignore */
      }
      try {
        const appdata = await invoke<string>("get_appdata_path");
        if (appdata) foldersToScan.push(appdata);
      } catch {
        /* ignore */
      }
      if (customFolderPath) foldersToScan.push(customFolderPath);

      if (foldersToScan.length === 0) {
        setErrorMessage(
          t("shortcuts.noFoldersToScan", "No folders available to scan."),
        );
        return;
      }

      const results = await invoke<ScannedShortcut[]>("scan_shortcuts", {
        folders: foldersToScan,
      });
      const sortofremotengShortcuts = results.filter(
        (s) => s.is_sortofremoteng,
      );

      setScannedShortcuts(sortofremotengShortcuts);
      setShowScanResults(true);
      setStatusMessage(
        t("shortcuts.scanComplete", {
          found: sortofremotengShortcuts.length,
          total: results.length,
          defaultValue: `Found ${sortofremotengShortcuts.length} sortOfRemoteNG shortcut(s) out of ${results.length} total`,
        }),
      );
      setTimeout(() => setStatusMessage(""), 5000);
    } catch (error) {
      console.error("Failed to scan shortcuts:", error);
      setErrorMessage(
        t("shortcuts.scanFailed", "Failed to scan for shortcuts."),
      );
    } finally {
      setIsScanning(false);
    }
  }, [customFolderPath, t]);

  const handleImportScannedShortcut = useCallback(
    (scanned: ScannedShortcut) => {
      const alreadyTracked = shortcuts.some((s) => s.path === scanned.path);
      if (alreadyTracked) {
        setErrorMessage(
          t("shortcuts.alreadyTracked", "This shortcut is already tracked."),
        );
        setTimeout(() => setErrorMessage(""), 3000);
        return;
      }

      let collectionId: string | undefined;
      let connectionId: string | undefined;
      if (scanned.arguments) {
        const collectionMatch =
          scanned.arguments.match(/--collection\s+(\S+)/);
        const connectionMatch =
          scanned.arguments.match(/--connection\s+(\S+)/);
        if (collectionMatch) collectionId = collectionMatch[1];
        if (connectionMatch) connectionId = connectionMatch[1];
      }

      const newShortcut: ShortcutInfo = {
        id: Date.now().toString(),
        name: scanned.name,
        path: scanned.path,
        collectionId,
        connectionId,
        createdAt: new Date().toISOString(),
        exists: true,
      };

      saveShortcuts([...shortcuts, newShortcut]);
      setStatusMessage(
        t("shortcuts.imported", {
          name: scanned.name,
          defaultValue: `Imported "${scanned.name}" to tracked shortcuts`,
        }),
      );
      setTimeout(() => setStatusMessage(""), 3000);
      setScannedShortcuts((prev) =>
        prev.filter((s) => s.path !== scanned.path),
      );
    },
    [shortcuts, saveShortcuts, t],
  );

  // ─── Folder path resolver ──────────────────────────────────────

  const getFolderPath = async (
    preset: FolderPreset,
  ): Promise<string | null> => {
    try {
      switch (preset) {
        case "desktop":
          return await invoke<string>("get_desktop_path");
        case "documents":
          return await invoke<string>("get_documents_path");
        case "appdata":
          return await invoke<string>("get_appdata_path");
        case "custom":
          return customFolderPath || null;
        default:
          return null;
      }
    } catch (error) {
      console.error("Failed to get folder path:", error);
      return null;
    }
  };

  const browseCustomFolder = async () => {
    try {
      const selected = await openDialog({
        title: t("shortcuts.selectFolder", "Select Folder"),
        directory: true,
        multiple: false,
        defaultPath: customFolderPath || undefined,
      });
      if (selected && typeof selected === "string") {
        setCustomFolderPath(selected);
      }
    } catch (error) {
      console.error("Failed to open folder dialog:", error);
    }
  };

  // ─── CRUD ───────────────────────────────────────────────────────

  const resetForm = () => {
    setShortcutName("");
    setSelectedCollectionId("");
    setSelectedConnectionId("");
  };

  const handleCreateShortcut = async () => {
    if (!isTauri()) {
      setErrorMessage(
        t(
          "shortcuts.notAvailable",
          "Desktop shortcuts are only available in the Tauri app.",
        ),
      );
      return;
    }
    if (!shortcutName.trim()) {
      setErrorMessage(
        t("shortcuts.nameRequired", "Shortcut name is required."),
      );
      return;
    }

    const folderPath = await getFolderPath(selectedFolder);
    if (!folderPath) {
      setErrorMessage(
        t("shortcuts.invalidFolder", "Please select a valid folder."),
      );
      return;
    }

    setErrorMessage("");
    setStatusMessage(t("shortcuts.creating", "Creating shortcut..."));
    setIsLoading(true);

    try {
      const path = await invoke<string>("create_desktop_shortcut", {
        name: shortcutName.trim(),
        collectionId: selectedCollectionId || null,
        connectionId: selectedConnectionId || null,
        description: selectedConnectionId
          ? `Open connection ${shortcutName.trim()}`
          : "Launch sortOfRemoteNG",
        folderPath,
      });

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
      setStatusMessage(
        t("shortcuts.created", {
          path,
          defaultValue: `Shortcut created at: ${path}`,
        }),
      );
      resetForm();
    } catch (error) {
      console.error("Failed to create shortcut:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("shortcuts.createFailed", "Failed to create shortcut."),
      );
      setStatusMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteShortcut = async (shortcut: ShortcutInfo) => {
    if (isTauri() && shortcut.exists) {
      try {
        await invoke("delete_file", { path: shortcut.path });
      } catch (error) {
        console.warn("Failed to delete shortcut file:", error);
      }
    }
    saveShortcuts(shortcuts.filter((s) => s.id !== shortcut.id));
    setStatusMessage(
      t("shortcuts.deleted", {
        name: shortcut.name,
        defaultValue: `Shortcut "${shortcut.name}" removed`,
      }),
    );
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
    if (!isTauri()) {
      setErrorMessage(
        t(
          "shortcuts.notAvailable",
          "Desktop shortcuts are only available in the Tauri app.",
        ),
      );
      return;
    }
    if (!shortcutName.trim()) {
      setErrorMessage(
        t("shortcuts.nameRequired", "Shortcut name is required."),
      );
      return;
    }

    setErrorMessage("");
    setStatusMessage(t("shortcuts.updating", "Updating shortcut..."));
    setIsLoading(true);

    try {
      if (editingShortcut.exists) {
        try {
          await invoke("delete_file", { path: editingShortcut.path });
        } catch (error) {
          console.warn("Failed to delete old shortcut:", error);
        }
      }

      const folderPath = editingShortcut.path.substring(
        0,
        editingShortcut.path.lastIndexOf("\\"),
      );
      const path = await invoke<string>("create_desktop_shortcut", {
        name: shortcutName.trim(),
        collectionId: selectedCollectionId || null,
        connectionId: selectedConnectionId || null,
        description: selectedConnectionId
          ? `Open connection ${shortcutName.trim()}`
          : "Launch sortOfRemoteNG",
        folderPath,
      });

      const updatedShortcut: ShortcutInfo = {
        ...editingShortcut,
        name: shortcutName.trim(),
        path,
        collectionId: selectedCollectionId || undefined,
        connectionId: selectedConnectionId || undefined,
        exists: true,
      };

      saveShortcuts(
        shortcuts.map((s) =>
          s.id === editingShortcut.id ? updatedShortcut : s,
        ),
      );
      setStatusMessage(
        t("shortcuts.updated", "Shortcut updated successfully"),
      );
      setEditingShortcut(null);
      resetForm();
    } catch (error) {
      console.error("Failed to update shortcut:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("shortcuts.updateFailed", "Failed to update shortcut."),
      );
      setStatusMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  const openShortcutLocation = async (path: string) => {
    try {
      const folder = path.substring(0, path.lastIndexOf("\\"));
      await invoke("open_folder", { path: folder });
    } catch (error) {
      console.error("Failed to open folder:", error);
    }
  };

  const refreshShortcuts = async () => {
    setIsLoading(true);
    await loadShortcuts();
    setIsLoading(false);
    setStatusMessage(t("shortcuts.refreshed", "Shortcut list refreshed"));
    setTimeout(() => setStatusMessage(""), 3000);
  };

  const cancelEditing = () => {
    setEditingShortcut(null);
    resetForm();
  };

  // ─── Name resolvers ────────────────────────────────────────────

  const getConnectionName = (connectionId?: string) => {
    if (!connectionId) return null;
    const conn = state.connections.find((c) => c.id === connectionId);
    return conn?.name || t("common.unknown", "Unknown");
  };

  const getCollectionName = (collectionId?: string) => {
    if (!collectionId) return null;
    const coll = collections.find((c) => c.id === collectionId);
    return coll?.name || t("common.unknown", "Unknown");
  };

  // ─── Effects ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    collectionManager
      .getAllCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
    loadShortcuts();
  }, [collectionManager, isOpen, loadShortcuts]);

  // ─── Return ─────────────────────────────────────────────────────

  return {
    // Data
    collections,
    shortcuts,
    connections: state.connections,
    scannedShortcuts,
    showScanResults,

    // Form state
    shortcutName,
    setShortcutName,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedConnectionId,
    setSelectedConnectionId,
    selectedFolder,
    setSelectedFolder,
    customFolderPath,
    setCustomFolderPath,

    // UI state
    statusMessage,
    errorMessage,
    isLoading,
    editingShortcut,
    isScanning,

    // Actions
    handleCreateShortcut,
    handleDeleteShortcut,
    handleEditShortcut,
    handleUpdateShortcut,
    handleScanShortcuts,
    handleImportScannedShortcut,
    openShortcutLocation,
    refreshShortcuts,
    cleanupShortcuts,
    cancelEditing,
    browseCustomFolder,

    // Name resolvers
    getConnectionName,
    getCollectionName,
  };
}
