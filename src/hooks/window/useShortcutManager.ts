import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConnections } from "../../contexts/useConnections";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { useTranslation } from "react-i18next";
import { generateId } from "../../utils/core/id";

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

/** Windows paths are case-insensitive; POSIX paths must retain their case. */
function shortcutPathKey(path: string): string {
  return /^[a-z]:[\\/]|^\\\\/i.test(path) || path.includes("\\")
    ? path.replace(/\\/g, "/").toLowerCase()
    : path;
}

function readTrackedShortcuts(): ShortcutInfo[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) =>
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.path !== "string" ||
        typeof entry.name !== "string",
    )
  ) {
    throw new Error(
      "The tracked shortcut list is invalid; it has not been overwritten.",
    );
  }
  return parsed as ShortcutInfo[];
}

function shortcutArgument(
  args: string | null,
  name: string,
): string | undefined {
  const match = args?.match(
    new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useShortcutManager(isOpen: boolean) {
  const { t } = useTranslation();
  const { state } = useConnections();
  const databaseManager = DatabaseManager.getInstance();

  const [collections, setCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);

  // Form state
  const [shortcutName, setShortcutName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<FolderPreset>("desktop");
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
  const [selectedScannedPaths, setSelectedScannedPaths] = useState<Set<string>>(
    new Set(),
  );
  const [isImporting, setIsImporting] = useState(false);
  const scanOperationRef = useRef(false);
  const scannedRef = useRef<ScannedShortcut[]>([]);
  const selectedScannedRef = useRef<Set<string>>(new Set());

  const replaceScannedResults = useCallback((results: ScannedShortcut[]) => {
    scannedRef.current = results;
    setScannedShortcuts(results);
  }, []);
  const replaceScannedSelection = useCallback((paths: Set<string>) => {
    selectedScannedRef.current = paths;
    setSelectedScannedPaths(paths);
  }, []);

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
                const exists = await invoke<boolean>("check_shortcut", {
                  path: shortcut.path,
                });
                return { ...shortcut, exists };
              } catch {
                return { ...shortcut, exists: false };
              }
            }),
          );
          // Native existence checks can finish after an import or another window's
          // edit. Never overwrite that newer tracked list with this old snapshot.
          if (localStorage.getItem(STORAGE_KEY) !== stored) {
            setShortcuts(readTrackedShortcuts());
          } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
            setShortcuts(checked);
          }
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
    if (scanOperationRef.current || isLoading) return;
    if (!isTauri()) {
      setErrorMessage(
        t(
          "shortcuts.notAvailable",
          "This feature is only available in the Tauri app.",
        ),
      );
      return;
    }
    scanOperationRef.current = true;
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
        setStatusMessage("");
        return;
      }

      const results = await invoke<ScannedShortcut[]>("scan_shortcuts", {
        folders: foldersToScan,
      });
      const seenPaths = new Set<string>();
      const sortofremotengShortcuts = results.filter((shortcut) => {
        const key = shortcutPathKey(shortcut.path);
        if (!shortcut.is_sortofremoteng || seenPaths.has(key)) return false;
        seenPaths.add(key);
        return true;
      });

      replaceScannedResults(sortofremotengShortcuts);
      replaceScannedSelection(new Set());
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
      setStatusMessage("");
    } finally {
      scanOperationRef.current = false;
      setIsScanning(false);
    }
  }, [
    customFolderPath,
    t,
    isLoading,
    replaceScannedResults,
    replaceScannedSelection,
  ]);

  const toggleScannedSelection = useCallback(
    (path: string) => {
      if (
        scanOperationRef.current ||
        isLoading ||
        !scannedRef.current.some((item) => item.path === path)
      )
        return;
      const next = new Set(selectedScannedRef.current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      replaceScannedSelection(next);
    },
    [isLoading, replaceScannedSelection],
  );

  const selectAllScanned = useCallback(
    (paths?: string[]) => {
      if (scanOperationRef.current || isLoading) return;
      const allowed = paths ? new Set(paths) : null;
      const next = new Set(selectedScannedRef.current);
      for (const item of scannedRef.current) {
        if (!allowed || allowed.has(item.path)) next.add(item.path);
      }
      replaceScannedSelection(next);
    },
    [isLoading, replaceScannedSelection],
  );

  const clearScannedSelection = useCallback(() => {
    if (!scanOperationRef.current && !isLoading)
      replaceScannedSelection(new Set());
  }, [isLoading, replaceScannedSelection]);

  const removeScannedResults = useCallback(
    (paths: Set<string>) => {
      replaceScannedResults(
        scannedRef.current.filter((item) => !paths.has(item.path)),
      );
      replaceScannedSelection(
        new Set(
          [...selectedScannedRef.current].filter((path) => !paths.has(path)),
        ),
      );
    },
    [replaceScannedResults, replaceScannedSelection],
  );

  const importScanned = useCallback(
    (paths: Set<string>) => {
      if (scanOperationRef.current || isLoading) return;
      const candidates = scannedRef.current.filter(
        (item) => item.is_sortofremoteng && paths.has(item.path),
      );
      if (candidates.length === 0) return;
      scanOperationRef.current = true;
      setIsImporting(true);
      setErrorMessage("");
      try {
        // One synchronous read/merge/write transaction, not a loop over closures
        // containing an obsolete React `shortcuts` snapshot.
        const tracked = readTrackedShortcuts();
        const knownPaths = new Set(
          tracked.map((item) => shortcutPathKey(item.path)),
        );
        const knownIds = new Set(tracked.map((item) => item.id));
        const additions: ShortcutInfo[] = [];
        for (const item of candidates) {
          const key = shortcutPathKey(item.path);
          if (knownPaths.has(key)) continue;
          const baseId = generateId();
          let id = baseId;
          for (let suffix = 1; knownIds.has(id); suffix++)
            id = `${baseId}-${suffix}`;
          knownIds.add(id);
          knownPaths.add(key);
          additions.push({
            id,
            name: item.name,
            path: item.path,
            collectionId: shortcutArgument(item.arguments, "collection"),
            connectionId: shortcutArgument(item.arguments, "connection"),
            createdAt: new Date().toISOString(),
            exists: true,
          });
        }
        if (additions.length > 0) saveShortcuts([...tracked, ...additions]);
        else setShortcuts(tracked);
        // Findings/selection change only once persistence has succeeded.
        removeScannedResults(new Set(candidates.map((item) => item.path)));
        const skipped = candidates.length - additions.length;
        setStatusMessage(
          t("shortcuts.importedBatch", {
            count: additions.length,
            skipped,
            defaultValue: `Imported ${additions.length} shortcut(s); ${skipped} already tracked.`,
          }),
        );
      } catch (error) {
        setStatusMessage("");
        setErrorMessage(
          t("shortcuts.importFailed", {
            error: String(error),
            defaultValue: `Failed to import shortcuts: ${String(error)}`,
          }),
        );
      } finally {
        scanOperationRef.current = false;
        setIsImporting(false);
      }
    },
    [isLoading, removeScannedResults, saveShortcuts, t],
  );

  const handleImportScannedShortcut = useCallback(
    (scanned: ScannedShortcut) => {
      importScanned(new Set([scanned.path]));
    },
    [importScanned],
  );
  const handleImportSelectedScanned = useCallback(() => {
    importScanned(selectedScannedRef.current);
  }, [importScanned]);
  const handleImportAllScanned = useCallback(() => {
    importScanned(new Set(scannedRef.current.map((item) => item.path)));
  }, [importScanned]);

  const discardScanned = useCallback(
    (paths: Set<string>) => {
      if (scanOperationRef.current || isLoading) return;
      const count = scannedRef.current.filter((item) =>
        paths.has(item.path),
      ).length;
      if (count === 0) return;
      removeScannedResults(paths);
      setErrorMessage("");
      setStatusMessage(
        t("shortcuts.discardedResults", {
          count,
          defaultValue: `Discarded ${count} scan result(s). No shortcut files were deleted.`,
        }),
      );
    },
    [isLoading, removeScannedResults, t],
  );
  const handleDiscardScannedShortcut = useCallback(
    (path: string) => {
      discardScanned(new Set([path]));
    },
    [discardScanned],
  );
  const handleDiscardSelectedScanned = useCallback(() => {
    discardScanned(selectedScannedRef.current);
  }, [discardScanned]);
  const handleDiscardAllScanned = useCallback(() => {
    discardScanned(new Set(scannedRef.current.map((item) => item.path)));
  }, [discardScanned]);

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
          ? t(
              "shortcuts.description.openConnection",
              "Open connection {{name}}",
              { name: shortcutName.trim() },
            )
          : t("shortcuts.description.launchApp", "Launch sortOfRemoteNG"),
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
        await invoke("delete_shortcut", { path: shortcut.path });
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
          await invoke("delete_shortcut", { path: editingShortcut.path });
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
          ? t(
              "shortcuts.description.openConnection",
              "Open connection {{name}}",
              { name: shortcutName.trim() },
            )
          : t("shortcuts.description.launchApp", "Launch sortOfRemoteNG"),
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
      setStatusMessage(t("shortcuts.updated", "Shortcut updated successfully"));
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
      const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
      if (separator < 0)
        throw new Error("Shortcut path has no containing folder.");
      const root =
        separator === 0 || (separator === 2 && /^[a-z]:/i.test(path));
      const folder = path.slice(0, separator + (root ? 1 : 0));
      await invoke("open_folder", { path: folder });
    } catch (error) {
      console.error("Failed to open folder:", error);
      setErrorMessage(
        t("shortcuts.openFolderFailed", {
          error: String(error),
          defaultValue: `Failed to open containing folder: ${String(error)}`,
        }),
      );
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
    let cancelled = false;
    databaseManager
      .getAllDatabases()
      .then((c) => {
        if (!cancelled) setCollections(c);
      })
      .catch(() => {
        if (!cancelled) setCollections([]);
      });
    loadShortcuts();
    return () => {
      cancelled = true;
    };
  }, [databaseManager, isOpen, loadShortcuts]);

  // ─── Return ─────────────────────────────────────────────────────

  return {
    // Data
    collections,
    shortcuts,
    connections: state.connections,
    scannedShortcuts,
    showScanResults,
    selectedScannedPaths,

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
    isImporting,
    scanActionsBusy: isScanning || isImporting || isLoading,

    // Actions
    handleCreateShortcut,
    handleDeleteShortcut,
    handleEditShortcut,
    handleUpdateShortcut,
    handleScanShortcuts,
    handleImportScannedShortcut,
    toggleScannedSelection,
    selectAllScanned,
    clearScannedSelection,
    handleImportSelectedScanned,
    handleImportAllScanned,
    handleDiscardSelectedScanned,
    handleDiscardAllScanned,
    handleDiscardScannedShortcut,
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
