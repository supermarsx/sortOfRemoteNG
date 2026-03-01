import React, { useEffect } from "react";
import {
  X,
  Keyboard,
  Plus,
  Trash2,
  RefreshCw,
  Edit,
  FolderOpen,
  Check,
  AlertTriangle,
  ExternalLink,
  Folder,
  Search,
  Link,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/overlays/Modal";import { DialogHeader } from '../ui/overlays/DialogHeader';import { EmptyState } from '../ui/display';import { useShortcutManager, FolderPreset } from "../../hooks/window/useShortcutManager";
import { Select } from '../ui/forms';

interface ShortcutManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutManagerDialog: React.FC<ShortcutManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useShortcutManager(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (mgr.editingShortcut) {
          mgr.cancelEditing();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, mgr]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/50"
      panelClassName="max-w-3xl mx-4 h-[85vh] bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-xl"
    >
      <DialogHeader
        icon={Keyboard}
        iconColor="text-blue-500"
        iconBg="bg-blue-500/20"
        title={t("shortcuts.title", "Shortcut Manager")}
        onClose={onClose}
        sticky
        actions={
          <button
            onClick={mgr.refreshShortcuts}
            disabled={mgr.isLoading}
            className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
            data-tooltip={t("shortcuts.refresh", "Refresh")}
            aria-label={t("shortcuts.refresh", "Refresh")}
          >
            <RefreshCw
              size={16}
              className={mgr.isLoading ? "animate-spin" : ""}
            />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Create/Edit Form */}
        <div className="bg-[var(--color-border)]/60 border border-[var(--color-border)] rounded-lg p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-4 flex items-center gap-2">
            {mgr.editingShortcut ? (
              <>
                <Edit size={14} />
                {t("shortcuts.editShortcut", "Edit Shortcut")}
              </>
            ) : (
              <>
                <Plus size={14} />
                {t("shortcuts.createShortcut", "Create Shortcut")}
              </>
            )}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("shortcuts.shortcutName", "Shortcut Name")}
              </label>
              <input
                type="text"
                value={mgr.shortcutName}
                onChange={(e) => mgr.setShortcutName(e.target.value)}
                placeholder={t(
                  "shortcuts.namePlaceholder",
                  "My Server Connection",
                )}
                className="sor-form-input"
              />
            </div>

            {!mgr.editingShortcut && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("shortcuts.folder", "Folder")}
                </label>
                <Select value={mgr.selectedFolder} onChange={(v: string) => mgr.setSelectedFolder(v as FolderPreset)} options={[{ value: "desktop", label: t("shortcuts.desktop", "Desktop") }, { value: "documents", label: t("shortcuts.documents", "Documents") }, { value: "appdata", label: t("shortcuts.appdata", "AppData (Start Menu)") }, { value: "custom", label: t("shortcuts.customFolder", "Custom Folder...") }]} className="sor-form-input" />
              </div>
            )}

            {!mgr.editingShortcut && mgr.selectedFolder === "custom" && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("shortcuts.customPath", "Custom Folder Path")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mgr.customFolderPath}
                    onChange={(e) => mgr.setCustomFolderPath(e.target.value)}
                    placeholder="C:\\Users\\Me\\Shortcuts"
                    className="flex-1 px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={mgr.browseCustomFolder}
                    className="px-3 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] transition-colors flex items-center gap-2"
                    title={t("shortcuts.browseFolder", "Browse...")}
                  >
                    <Folder size={16} />
                    <span className="hidden sm:inline">
                      {t("shortcuts.browse", "Browse")}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("shortcuts.collection", "Collection")} (
                {t("common.optional", "Optional")})
              </label>
              <Select value={mgr.selectedCollectionId} onChange={(v: string) => mgr.setSelectedCollectionId(v)} options={[{ value: '', label: t("shortcuts.selectCollection", "Select a collection...") }, ...mgr.collections.map((collection) => ({ value: collection.id, label: collection.name }))]} className="sor-form-input" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("shortcuts.connection", "Connection")} (
                {t("common.optional", "Optional")})
              </label>
              <Select value={mgr.selectedConnectionId} onChange={(v: string) => mgr.setSelectedConnectionId(v)} options={[{ value: '', label: t("shortcuts.selectConnection", "Select a connection...") }, ...mgr.connections.filter((conn) => !conn.isGroup).map((connection) => ({ value: connection.id, label: connection.name }))]} className="sor-form-input" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {mgr.editingShortcut && (
              <button
                onClick={mgr.cancelEditing}
                className="px-4 py-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
              >
                {t("common.cancel", "Cancel")}
              </button>
            )}
            <button
              onClick={
                mgr.editingShortcut
                  ? mgr.handleUpdateShortcut
                  : mgr.handleCreateShortcut
              }
              disabled={mgr.isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors disabled:opacity-50"
            >
              {mgr.editingShortcut ? (
                <>
                  <Check size={14} />
                  {t("shortcuts.updateShortcut", "Update Shortcut")}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {t("shortcuts.createShortcut", "Create Shortcut")}
                </>
              )}
            </button>
          </div>
          {mgr.errorMessage && (
            <div className="mt-4 rounded-md border border-red-600/60 bg-red-900/20 px-3 py-2 text-sm text-red-200">
              {mgr.errorMessage}
            </div>
          )}
          {mgr.statusMessage && (
            <div className="mt-4 rounded-md border border-blue-600/60 bg-blue-900/20 px-3 py-2 text-sm text-blue-200">
              {mgr.statusMessage}
            </div>
          )}
        </div>

        {/* Shortcuts List */}
        <div className="bg-[var(--color-border)]/60 border border-[var(--color-border)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] flex items-center gap-2">
              <FolderOpen size={14} />
              {t("shortcuts.createdShortcuts", "Created Shortcuts")} (
              {mgr.shortcuts.length})
            </h3>
            {mgr.shortcuts.some((s) => !s.exists) && (
              <button
                onClick={mgr.cleanupShortcuts}
                className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
              >
                <AlertTriangle size={12} />
                {t("shortcuts.cleanupMissing", "Clean up missing")}
              </button>
            )}
          </div>

          {mgr.shortcuts.length === 0 ? (
            <EmptyState
              icon={Keyboard}
              message={t("shortcuts.noShortcuts", "No shortcuts created yet")}
              hint={t("shortcuts.createHint", "Create a shortcut above to get started")}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {mgr.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    shortcut.exists
                      ? "bg-[var(--color-surface)]/50 border-[var(--color-border)]"
                      : "bg-red-900/20 border-red-600/40"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        size={14}
                        className={
                          shortcut.exists ? "text-blue-400" : "text-red-400"
                        }
                      />
                      <span className="font-medium text-[var(--color-text)] truncate">
                        {shortcut.name}
                      </span>
                      {!shortcut.exists && (
                        <span className="text-xs text-red-400 px-2 py-0.5 bg-red-900/30 rounded">
                          {t("shortcuts.missing", "Missing")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-textSecondary)] mt-1 truncate">
                      {shortcut.path}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--color-textMuted)] mt-1">
                      {shortcut.connectionId && (
                        <span>
                          🔌 {mgr.getConnectionName(shortcut.connectionId)}
                        </span>
                      )}
                      {shortcut.collectionId && (
                        <span>
                          📁 {mgr.getCollectionName(shortcut.collectionId)}
                        </span>
                      )}
                      <span>
                        {new Date(shortcut.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {shortcut.exists && (
                      <button
                        onClick={() =>
                          mgr.openShortcutLocation(shortcut.path)
                        }
                        className="sor-icon-btn"
                        data-tooltip={t(
                          "shortcuts.openLocation",
                          "Open Location",
                        )}
                      >
                        <ExternalLink size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => mgr.handleEditShortcut(shortcut)}
                      className="sor-icon-btn"
                      data-tooltip={t("shortcuts.edit", "Edit")}
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => mgr.handleDeleteShortcut(shortcut)}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded transition-colors"
                      data-tooltip={t("shortcuts.delete", "Delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scan for Shortcuts */}
        <div className="bg-[var(--color-border)]/60 border border-[var(--color-border)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] flex items-center gap-2">
              <Search size={14} />
              {t("shortcuts.scanForShortcuts", "Scan for Shortcuts")}
            </h3>
            <button
              onClick={mgr.handleScanShortcuts}
              disabled={mgr.isScanning}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-[var(--color-text)] text-sm rounded-md transition-colors disabled:opacity-50"
            >
              {mgr.isScanning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  {t("shortcuts.scanning", "Scanning...")}
                </>
              ) : (
                <>
                  <Search size={14} />
                  {t("shortcuts.scan", "Scan")}
                </>
              )}
            </button>
          </div>

          <p className="text-sm text-[var(--color-textSecondary)] mb-4">
            {t(
              "shortcuts.scanDescription",
              "Scan desktop, documents, and custom folders for existing sortOfRemoteNG shortcuts to import into the tracked list.",
            )}
          </p>

          {mgr.showScanResults && mgr.scannedShortcuts.length === 0 && (
            <EmptyState
              icon={Search}
              iconSize={24}
              message={t("shortcuts.noShortcutsFound", "No sortOfRemoteNG shortcuts found")}
              hint={t("shortcuts.allTracked", "All shortcuts may already be tracked")}
              className="py-4 bg-[var(--color-surface)]/50 rounded-lg border border-[var(--color-border)]"
            />
          )}

          {mgr.scannedShortcuts.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-[var(--color-textMuted)] mb-2">
                {t("shortcuts.foundShortcuts", {
                  count: mgr.scannedShortcuts.length,
                  defaultValue: `Found ${mgr.scannedShortcuts.length} shortcut(s)`,
                })}
              </div>
              {mgr.scannedShortcuts.map((scanned, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg bg-purple-900/20 border border-purple-600/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link size={14} className="text-purple-400" />
                      <span className="font-medium text-[var(--color-text)] truncate">
                        {scanned.name}
                      </span>
                      <span className="text-xs text-purple-400 px-2 py-0.5 bg-purple-900/30 rounded">
                        {t("shortcuts.discovered", "Discovered")}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--color-textSecondary)] mt-1 truncate">
                      {scanned.path}
                    </div>
                    {scanned.target && (
                      <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
                        → {scanned.target}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => mgr.handleImportScannedShortcut(scanned)}
                    className="ml-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-[var(--color-text)] text-sm rounded-md transition-colors flex items-center gap-1"
                  >
                    <Plus size={14} />
                    {t("shortcuts.import", "Import")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-background)]/40 p-5 text-sm text-[var(--color-textSecondary)]">
          {t(
            "shortcuts.description",
            "Shortcuts can open a collection or a specific connection when the app starts. They are tracked automatically and you can clean up any that have been manually deleted.",
          )}
        </div>
      </div>
    </Modal>
  );
};
