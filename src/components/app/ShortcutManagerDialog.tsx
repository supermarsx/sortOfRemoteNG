import React, { useEffect, useState } from "react";
import {
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
  Keyboard,
  List,
  Save,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from '../ui/display';
import { useShortcutManager, FolderPreset } from "../../hooks/window/useShortcutManager";
import { useConnections } from "../../contexts/useConnections";
import { createToolSession } from "./toolSession";
import { Select } from '../ui/forms';

interface ShortcutManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ManagerTab = 'shortcuts' | 'scan';

/* ── Shortcuts List Tab ─────────────────────────────────── */

function ShortcutsListTab({ mgr, t, onOpenCreateTab }: { mgr: ReturnType<typeof useShortcutManager>; t: ReturnType<typeof useTranslation>['t']; onOpenCreateTab: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-textSecondary)]">
          {mgr.shortcuts.length} shortcut{mgr.shortcuts.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          {mgr.shortcuts.some((s) => !s.exists) && (
            <button onClick={mgr.cleanupShortcuts} className="sor-btn sor-btn-warning sor-btn-xs">
              <AlertTriangle size={12} />
              {t("shortcuts.cleanupMissing", "Clean up missing")}
            </button>
          )}
          <button onClick={onOpenCreateTab} className="sor-btn sor-btn-primary sor-btn-xs">
            <Plus size={12} />
            {t("shortcuts.createShortcut", "New Shortcut")}
          </button>
        </div>
      </div>

      {mgr.shortcuts.length === 0 ? (
        <EmptyState
          icon={Keyboard}
          message={t("shortcuts.noShortcuts", "No shortcuts created yet")}
          hint={t("shortcuts.createHint", "Click 'New Shortcut' to get started")}
          className="py-12"
        />
      ) : (
        <div className="space-y-2">
          {mgr.shortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                shortcut.exists
                  ? "bg-[var(--color-input)] border-[var(--color-border)]"
                  : "bg-error/20 border-error/40"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link size={14} className={shortcut.exists ? "text-primary" : "text-error"} />
                  <span className="font-medium text-[var(--color-text)] truncate">{shortcut.name}</span>
                  {!shortcut.exists && (
                    <span className="text-xs text-error px-2 py-0.5 bg-error/30 rounded">{t("shortcuts.missing", "Missing")}</span>
                  )}
                </div>
                <div className="text-xs text-[var(--color-textSecondary)] mt-1 truncate">{shortcut.path}</div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-textMuted)] mt-1">
                  {shortcut.connectionId && <span>🔌 {mgr.getConnectionName(shortcut.connectionId)}</span>}
                  {shortcut.collectionId && <span>📁 {mgr.getCollectionName(shortcut.collectionId)}</span>}
                  <span>{new Date(shortcut.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                {shortcut.exists && (
                  <button onClick={() => mgr.openShortcutLocation(shortcut.path)} className="sor-icon-btn" data-tooltip={t("shortcuts.openLocation", "Open Location")}>
                    <ExternalLink size={14} />
                  </button>
                )}
                <button onClick={() => mgr.handleEditShortcut(shortcut)} className="sor-icon-btn" data-tooltip={t("shortcuts.edit", "Edit")}>
                  <Edit size={14} />
                </button>
                <button onClick={() => mgr.handleDeleteShortcut(shortcut)} className="sor-icon-btn-danger" data-tooltip={t("shortcuts.delete", "Delete")}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Scan Tab ───────────────────────────────────────────── */

function ScanTab({ mgr, t }: { mgr: ReturnType<typeof useShortcutManager>; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-textSecondary)]">
          {t("shortcuts.scanDescription", "Scan desktop, documents, and custom folders for existing sortOfRemoteNG shortcuts.")}
        </p>
        <button onClick={mgr.handleScanShortcuts} disabled={mgr.isScanning} className="sor-btn sor-btn-primary sor-btn-sm flex-shrink-0">
          {mgr.isScanning ? <><RefreshCw size={14} className="animate-spin" />{t("shortcuts.scanning", "Scanning...")}</> : <><Search size={14} />{t("shortcuts.scan", "Scan")}</>}
        </button>
      </div>

      {mgr.showScanResults && mgr.scannedShortcuts.length === 0 && (
        <EmptyState icon={Search} iconSize={24} message={t("shortcuts.noShortcutsFound", "No sortOfRemoteNG shortcuts found")} hint={t("shortcuts.allTracked", "All shortcuts may already be tracked")} className="py-8" />
      )}

      {mgr.scannedShortcuts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-[var(--color-textMuted)]">
            {t("shortcuts.foundShortcuts", { count: mgr.scannedShortcuts.length, defaultValue: `Found ${mgr.scannedShortcuts.length} shortcut(s)` })}
          </div>
          {mgr.scannedShortcuts.map((scanned, index) => (
            <div key={scanned.path ?? index} className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/30">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link size={14} className="text-primary" />
                  <span className="font-medium text-[var(--color-text)] truncate">{scanned.name}</span>
                  <span className="text-xs text-primary px-2 py-0.5 bg-primary/20 rounded">{t("shortcuts.discovered", "Discovered")}</span>
                </div>
                <div className="text-xs text-[var(--color-textSecondary)] mt-1 truncate">{scanned.path}</div>
                {scanned.target && <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">→ {scanned.target}</div>}
              </div>
              <button onClick={() => mgr.handleImportScannedShortcut(scanned)} className="sor-btn sor-btn-primary sor-btn-xs ml-2">
                <Plus size={14} /> {t("shortcuts.import", "Import")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Root ────────────────────────────────────────────────── */

export const ShortcutManagerDialog: React.FC<ShortcutManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useShortcutManager(isOpen);
  const { dispatch } = useConnections();
  const [activeTab, setActiveTab] = useState<ManagerTab>('shortcuts');

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

  const TABS: { id: ManagerTab; label: string; icon: React.FC<any> }[] = [
    { id: 'shortcuts', label: t("shortcuts.createdShortcuts", "Shortcuts"), icon: List },
    { id: 'scan', label: t("shortcuts.scanForShortcuts", "Scan"), icon: Search },
  ];

  const handleOpenCreateTab = () => {
    const session = createToolSession('shortcutCreator', { name: 'New Shortcut' });
    dispatch({ type: 'ADD_SESSION', payload: session });
  };

  return (
    <div className="h-full flex bg-[var(--color-surface)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
        <div className="p-3 space-y-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`sor-sidebar-tab w-full flex items-center gap-2 ${active ? 'sor-sidebar-tab-active' : ''}`}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.id === 'shortcuts' && mgr.shortcuts.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none bg-[var(--color-border)]">{mgr.shortcuts.length}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-auto p-3 border-t border-[var(--color-border)]">
          <button onClick={mgr.refreshShortcuts} disabled={mgr.isLoading} className={`sor-btn sor-btn-secondary sor-btn-xs w-full ${mgr.isLoading ? 'animate-spin' : ''}`}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mgr.errorMessage && (
          <div className="mx-4 mt-3 rounded-md border border-error/60 bg-error/20 px-3 py-2 text-sm text-error">{mgr.errorMessage}</div>
        )}
        {mgr.statusMessage && (
          <div className="mx-4 mt-3 rounded-md border border-primary/60 bg-primary/20 px-3 py-2 text-sm text-primary">{mgr.statusMessage}</div>
        )}
        {activeTab === 'shortcuts' && <ShortcutsListTab mgr={mgr} t={t} onOpenCreateTab={handleOpenCreateTab} />}
        {activeTab === 'scan' && <ScanTab mgr={mgr} t={t} />}
      </div>
    </div>
  );
};

/* ── Standalone Shortcut Creator Tab ────────────────────── */

export const ShortcutCreator: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const mgr = useShortcutManager(isOpen);

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto w-full p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{t("shortcuts.shortcutName", "Shortcut Name")}</label>
            <input type="text" value={mgr.shortcutName} onChange={(e) => mgr.setShortcutName(e.target.value)} placeholder={t("shortcuts.namePlaceholder", "My Server Connection")} className="sor-form-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{t("shortcuts.folder", "Folder")}</label>
            <Select value={mgr.selectedFolder} onChange={(v: string) => mgr.setSelectedFolder(v as FolderPreset)} variant="form" options={[{ value: "desktop", label: t("shortcuts.desktop", "Desktop") }, { value: "documents", label: t("shortcuts.documents", "Documents") }, { value: "appdata", label: t("shortcuts.appdata", "AppData (Start Menu)") }, { value: "custom", label: t("shortcuts.customFolder", "Custom Folder...") }]} />
          </div>
          {mgr.selectedFolder === "custom" && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{t("shortcuts.customPath", "Custom Folder Path")}</label>
              <div className="flex gap-2">
                <input type="text" value={mgr.customFolderPath} onChange={(e) => mgr.setCustomFolderPath(e.target.value)} placeholder="C:\\Users\\Me\\Shortcuts" className="sor-form-input flex-1" />
                <button type="button" onClick={mgr.browseCustomFolder} className="sor-btn sor-btn-secondary">
                  <Folder size={14} /> {t("shortcuts.browse", "Browse")}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{t("shortcuts.collection", "Collection")} ({t("common.optional", "Optional")})</label>
            <Select value={mgr.selectedCollectionId} onChange={(v: string) => mgr.setSelectedCollectionId(v)} variant="form" options={[{ value: '', label: t("shortcuts.selectCollection", "Select a collection...") }, ...mgr.collections.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{t("shortcuts.connection", "Connection")} ({t("common.optional", "Optional")})</label>
            <Select value={mgr.selectedConnectionId} onChange={(v: string) => mgr.setSelectedConnectionId(v)} variant="form" options={[{ value: '', label: t("shortcuts.selectConnection", "Select a connection...") }, ...mgr.connections.filter((c) => !c.isGroup).map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          {mgr.errorMessage && <div className="rounded-md border border-error/60 bg-error/20 px-3 py-2 text-sm text-error">{mgr.errorMessage}</div>}
          {mgr.statusMessage && <div className="rounded-md border border-primary/60 bg-primary/20 px-3 py-2 text-sm text-primary">{mgr.statusMessage}</div>}
        </div>
      </div>
      <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-3 flex-shrink-0">
        <button onClick={onClose} className="sor-btn sor-btn-secondary">Cancel</button>
        <button onClick={mgr.handleCreateShortcut} disabled={mgr.isLoading} className="sor-btn sor-btn-primary">
          <Save size={14} /> {t("shortcuts.createShortcut", "Create Shortcut")}
        </button>
      </div>
    </div>
  );
};
