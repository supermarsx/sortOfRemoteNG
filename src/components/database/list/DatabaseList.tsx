import React, { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Database,
  Download,
  Edit,
  Eye,
  EyeOff,
  FolderOpen,
  Lock,
  Plus,
  Search,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Mgr } from "./types";
import type { ConnectionDatabase } from "../../../types/connection/connection";
import { Checkbox, PasswordInput, Textarea } from "../../ui/forms";
import { EmptyState, LoadingElement } from "../../ui/display";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import { useSettings } from "../../../contexts/SettingsContext";

interface DatabaseListProps {
  mgr: Mgr;
  onClose: () => void;
}

/**
 * Tab-format database list — mirrors the visual language of
 * TabGroupManager / TagManagerDialog.
 *
 * Layout:
 *  - Heading row with title and a primary "+ New Database" action.
 *  - Two-paragraph description.
 *  - Search filter input.
 *  - Inline create / import / edit / export / unlock cards that slide in
 *    just below the search row when the corresponding manager state is
 *    active. No more modal-stacking.
 *  - A list of database rows; each row shows the icon, encryption badge,
 *    description and last-accessed date, plus an always-visible toolbar
 *    of Open / Edit / Clone / Export / Delete buttons. Clicking a row
 *    body (off the toolbar) opens the database.
 *  - Footer line with stats.
 */
function DatabaseList({ mgr }: DatabaseListProps) {
  const { t } = useTranslation();
  const [searchFilter, setSearchFilter] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<ConnectionDatabase | null>(
    null,
  );

  const filteredCollections = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return mgr.collections;
    return mgr.collections.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [mgr.collections, searchFilter]);

  const stats = useMemo(() => {
    const total = mgr.collections.length;
    const encrypted = mgr.collections.filter((c) => c.isEncrypted).length;
    return { total, encrypted };
  }, [mgr.collections]);

  // One announcement for the whole list, not one per row: a switch lights up
  // two rows (incoming + outgoing) and per-row regions would announce twice.
  const loading = mgr.loadingCollection;
  const loadingAnnouncement = loading
    ? (t(`databaseCenter.collections.loading.${loading.mode}`, {
        name: loading.name,
      }) as string)
    : "";

  const anyFormOpen =
    mgr.showCreateForm ||
    mgr.showImportForm ||
    Boolean(mgr.editingCollection) ||
    Boolean(mgr.exportingCollection) ||
    mgr.showPasswordDialog;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="database-loading-announcement"
      >
        {loadingAnnouncement}
      </div>

      {/* Heading + primary action */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2 min-w-0">
            <Database className="w-5 h-5 text-primary flex-shrink-0" />
            <span className="truncate">{t("databaseCenter.title")}</span>
          </h3>
          {!anyFormOpen && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  mgr.setShowImportForm(true);
                  mgr.setError("");
                }}
                className="sor-btn-secondary-sm"
                data-testid="database-import"
              >
                <Upload size={14} />
                <span>{t("databaseCenter.actions.import")}</span>
              </button>
              <button
                onClick={() => {
                  mgr.setShowCreateForm(true);
                  mgr.setError("");
                }}
                className="sor-btn-primary-sm"
                data-testid="database-create"
              >
                <Plus size={14} />
                <span>{t("connections.new", "New")}</span>
              </button>
            </div>
          )}
        </div>
        <div className="text-xs text-[var(--color-textSecondary)] space-y-1">
          <p>{t("databaseCenter.subtitle")}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]"
        />
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
          placeholder={
            t(
              "databaseCenter.searchPlaceholder",
              "Search databases...",
            ) as string
          }
        />
      </div>

      {/* Inline forms */}
      {mgr.showCreateForm && (
        <CreateDatabaseCard
          mgr={mgr}
          onClose={() => {
            mgr.setShowCreateForm(false);
            mgr.setError("");
          }}
        />
      )}
      {mgr.showImportForm && (
        <ImportDatabaseCard
          mgr={mgr}
          onClose={() => {
            mgr.setShowImportForm(false);
            mgr.setError("");
          }}
        />
      )}
      {mgr.editingCollection && (
        <EditDatabaseCard
          mgr={mgr}
          onClose={() => {
            mgr.setEditingCollection(null);
            mgr.setError("");
          }}
        />
      )}
      {mgr.exportingCollection && (
        <ExportDatabaseCard
          mgr={mgr}
          onClose={() => {
            mgr.setExportingCollection(null);
            mgr.setError("");
          }}
        />
      )}
      {mgr.showPasswordDialog && mgr.selectedCollection && (
        <UnlockDatabaseCard mgr={mgr} />
      )}

      {/* Database list */}
      {filteredCollections.length === 0 ? (
        <EmptyState
          icon={Database}
          iconSize={48}
          message={
            mgr.collections.length === 0
              ? t("databaseCenter.collections.emptyTitle")
              : (t(
                  "databaseCenter.noResults",
                  "No databases match your search.",
                ) as string)
          }
          hint={
            mgr.collections.length === 0
              ? t("databaseCenter.collections.emptyDescription")
              : undefined
          }
          className="py-12"
        />
      ) : (
        <div className="space-y-2">
          {filteredCollections.map((collection) => (
            <DatabaseRow
              key={collection.id}
              collection={collection}
              mgr={mgr}
              highlighted={mgr.highlightedCollectionId === collection.id}
              onDelete={() => setDeleteConfirm(collection)}
            />
          ))}
        </div>
      )}

      {/* Footer stats */}
      <div className="pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)] flex items-center gap-3">
        <span>
          {stats.total} {stats.total === 1 ? "database" : "databases"}
        </span>
        {stats.encrypted > 0 && (
          <>
            <span aria-hidden>•</span>
            <span className="flex items-center gap-1">
              <Lock size={11} /> {stats.encrypted} encrypted
            </span>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title={t("databaseCenter.actions.delete")}
        variant="danger"
        confirmText={t("databaseCenter.actions.delete")}
        cancelText={t("settings.cancel", "Cancel") as string}
        message={
          deleteConfirm
            ? (t("databaseCenter.collections.deleteConfirm", {
                name: deleteConfirm.name,
              }) as string)
            : ""
        }
        onConfirm={() => {
          if (deleteConfirm) {
            void mgr.handleDeleteCollection(deleteConfirm);
          }
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

interface DatabaseRowProps {
  collection: ConnectionDatabase;
  mgr: Mgr;
  highlighted: boolean;
  onDelete: () => void;
}

const DatabaseRow: React.FC<DatabaseRowProps> = ({
  collection,
  mgr,
  highlighted,
  onDelete,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  // Gates motion only. The mode copy, aria-busy, the announcement and the
  // disabled siblings must survive with animations off.
  const animEnabled = settings.animationsEnabled;

  const loading = mgr.loadingCollection;
  const isLoadingThis = loading?.id === collection.id;
  // The row being handed away — dims and settles back while the incoming row
  // loads. Keyed on the latched `fromId` alone: it is set only when a
  // different database really was open, so it already says precisely this,
  // for an unlock-over-an-open-database as much as for a plain switch. Not
  // asking the manager who is current is deliberate — it makes the incoming
  // database current partway through the load, which would end the hand-off
  // early while the incoming row is still busy.
  const isHandoff = loading?.fromId === collection.id;
  // Rows with no part in the load. Dimming them is the visual half of the
  // hook's re-entrancy guard: a click that can't happen needs no explaining.
  const isBystander = loading !== null && !isLoadingThis && !isHandoff;

  const loadingCopy = isHandoff
    ? (t("databaseCenter.collections.loading.handoff", {
        name: collection.name,
      }) as string)
    : isLoadingThis && loading
      ? // The name comes off the loading state, not the row: the collection
        // can drop out of the list mid-load and the copy still resolves.
        (t(`databaseCenter.collections.loading.${loading.mode}`, {
          name: loading.name,
        }) as string)
      : null;

  const openLabel = collection.isEncrypted
    ? t("databaseCenter.actions.unlock")
    : t("databaseCenter.actions.open");

  // Symmetric inverses of open / unlock. The close button only shows
  // when there is something to close: the row is the currently-open
  // database (closes + locks) or it's an encrypted row whose
  // password is cached (locks only). Otherwise rendering it would be
  // a no-op the user can't usefully click.
  const isCurrent = mgr.isCurrentDatabase(collection.id);
  const isUnlocked = mgr.isDatabaseUnlocked(collection.id);
  const canClose = isCurrent || (collection.isEncrypted && isUnlocked);
  const closeLabel = isCurrent
    ? (t("databaseCenter.actions.close", "Close") as string)
    : (t("databaseCenter.actions.lock", "Lock") as string);

  return (
    <div
      aria-busy={isLoadingThis}
      className={`relative overflow-hidden rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary group ${
        highlighted
          ? "border-primary/60 bg-primary/5"
          : "border-[var(--color-border)] bg-[var(--color-border)]/30 hover:bg-[var(--color-border)]/50"
      } ${isBystander ? "opacity-50 pointer-events-none" : ""} ${
        isHandoff && animEnabled ? "animate-row-handoff" : ""
      }`}
    >
      {/* Carries its own absolute inset-0 gradient overlay; needs the
          relative + overflow-hidden container above to stay in the row. */}
      {isLoadingThis && animEnabled && (
        <span className="animate-row-sweep" aria-hidden="true" />
      )}
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => void mgr.handleSelectCollection(collection)}
          disabled={loading !== null}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          aria-label={
            t("databaseCenter.collections.openCollectionLabel", {
              name: collection.name,
            }) as string
          }
        >
          <div className="relative flex-shrink-0">
            {isLoadingThis ? (
              // `ring` is the only variant that belongs in a 20px icon slot:
              // boundsBleed 0 so it fills the box exactly, and it stays legible
              // down to 12px. aria-hidden because the variant root carries
              // role="status" — a second live region would announce twice.
              <span aria-hidden="true" className="inline-flex">
                <LoadingElement type="ring" size={20} />
              </span>
            ) : (
              <Database size={20} className="text-primary" />
            )}
            {collection.isEncrypted && (
              <Lock
                size={10}
                className="absolute -bottom-0.5 -right-1 text-warning bg-[var(--color-surface)] rounded-full"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-[var(--color-text)] truncate group-hover:text-primary transition-colors">
                {collection.name}
              </span>
              {collection.isEncrypted && (
                <span className="text-[10px] uppercase tracking-wide text-warning bg-warning/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  encrypted
                </span>
              )}
            </div>
            {collection.description && (
              <p className="text-xs text-[var(--color-textSecondary)] truncate mt-0.5">
                {collection.description}
              </p>
            )}
            {loadingCopy ? (
              <p className="text-[10px] text-primary mt-0.5">{loadingCopy}</p>
            ) : (
              <p className="text-[10px] text-[var(--color-textMuted)] mt-0.5">
                {t("databaseCenter.collections.lastAccessed")}:{" "}
                {new Date(collection.lastAccessed).toLocaleDateString()}
              </p>
            )}
          </div>
        </button>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => void mgr.handleSelectCollection(collection)}
            disabled={loading !== null}
            className="sor-icon-btn-sm"
            title={openLabel}
            aria-label={openLabel}
          >
            {collection.isEncrypted ? (
              <Unlock size={13} />
            ) : (
              <FolderOpen size={13} />
            )}
          </button>
          {canClose && (
            <button
              type="button"
              onClick={() => void mgr.handleCloseCollection(collection)}
              className="sor-icon-btn-sm"
              title={closeLabel}
              aria-label={closeLabel}
              data-testid={isCurrent ? "database-close" : "database-lock"}
            >
              {/* Current row → folder closes; unlocked-not-current → padlock. */}
              {isCurrent ? <X size={13} /> : <Lock size={13} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => mgr.handleEditCollection(collection)}
            className="sor-icon-btn-sm"
            title={t("databaseCenter.actions.edit") as string}
            aria-label={t("databaseCenter.actions.edit") as string}
          >
            <Edit size={13} />
          </button>
          <button
            type="button"
            onClick={() => void mgr.handleCloneCollection(collection)}
            className="sor-icon-btn-sm"
            title={t("databaseCenter.actions.clone") as string}
            aria-label={t("databaseCenter.actions.clone") as string}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={() => mgr.handleExportCollection(collection)}
            className="sor-icon-btn-sm"
            title={t("databaseCenter.actions.export") as string}
            aria-label={t("databaseCenter.actions.export") as string}
          >
            <Download size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="sor-icon-btn-danger"
            title={t("databaseCenter.actions.delete") as string}
            aria-label={t("databaseCenter.actions.delete") as string}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Inline cards ─────────────────────────────────────────────────────

interface CardShellProps {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  error?: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Footer area for action buttons. Rendered with right-aligned spacing
   * by the shell, so callers just pass the buttons.
   */
  footer: React.ReactNode;
}

const CardShell: React.FC<CardShellProps> = ({
  title,
  icon: Icon,
  error,
  onClose,
  children,
  footer,
}) => (
  <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3 animate-fade-in-down">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2 min-w-0">
        <Icon size={14} className="text-primary flex-shrink-0" />
        <span className="truncate">{title}</span>
      </h4>
      <button
        onClick={onClose}
        className="sor-icon-btn-sm"
        title="Cancel"
        aria-label="Cancel"
      >
        <X size={14} />
      </button>
    </div>
    {error && (
      <div className="sor-alert-error">
        <p className="text-error text-sm">{error}</p>
      </div>
    )}
    <div className="space-y-3">{children}</div>
    <div className="flex items-center justify-end gap-2 pt-1">{footer}</div>
  </div>
);

// ── Create ───────────────────────────────────────────────────────────

const CreateDatabaseCard: React.FC<{ mgr: Mgr; onClose: () => void }> = ({
  mgr,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <CardShell
      title={t("databaseCenter.collections.createTitle")}
      icon={Plus}
      error={mgr.error}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="sor-btn sor-btn-secondary">
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handleCreateCollection}
            className="sor-btn-primary-sm"
            data-testid="database-confirm"
            disabled={!mgr.newCollection.name.trim()}
          >
            <Check size={14} />
            <span>{t("databaseCenter.collections.createAction")}</span>
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.nameLabel")}
        </label>
        <input
          type="text"
          value={mgr.newCollection.name}
          onChange={(e) =>
            mgr.setNewCollection({ ...mgr.newCollection, name: e.target.value })
          }
          className="sor-form-input-xs w-full"
          placeholder={
            t("databaseCenter.collections.namePlaceholder") as string
          }
          data-testid="database-name"
          autoFocus
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.descriptionLabel")}
        </label>
        <Textarea
          value={mgr.newCollection.description}
          onChange={(v) =>
            mgr.setNewCollection({ ...mgr.newCollection, description: v })
          }
          className="sor-form-input resize-none w-full"
          rows={2}
          placeholder={
            t("databaseCenter.collections.descriptionPlaceholder") as string
          }
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={mgr.newCollection.isEncrypted}
          onChange={(v: boolean) =>
            mgr.setNewCollection({ ...mgr.newCollection, isEncrypted: v })
          }
        />
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.encryptToggle")}
        </span>
      </label>
      {mgr.newCollection.isEncrypted && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.passwordLabel")}
            </label>
            <PasswordInput
              value={mgr.newCollection.password}
              onChange={(e) =>
                mgr.setNewCollection({
                  ...mgr.newCollection,
                  password: e.target.value,
                })
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t("databaseCenter.collections.passwordPlaceholder") as string
              }
              data-testid="database-password"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.confirmPasswordLabel")}
            </label>
            <PasswordInput
              value={mgr.newCollection.confirmPassword}
              onChange={(e) =>
                mgr.setNewCollection({
                  ...mgr.newCollection,
                  confirmPassword: e.target.value,
                })
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t(
                  "databaseCenter.collections.confirmPasswordPlaceholder",
                ) as string
              }
              revealable={false}
            />
          </div>
        </div>
      )}
    </CardShell>
  );
};

// ── Edit ─────────────────────────────────────────────────────────────

const EditDatabaseCard: React.FC<{ mgr: Mgr; onClose: () => void }> = ({
  mgr,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!mgr.editingCollection) return null;
  const editing = mgr.editingCollection;
  const showPasswordRow =
    editing.isEncrypted || mgr.editPassword.enableEncryption;

  return (
    <CardShell
      title={t("databaseCenter.collections.editTitle")}
      icon={Edit}
      error={mgr.error}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="sor-btn sor-btn-secondary">
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handleUpdateCollection}
            className="sor-btn-primary-sm"
          >
            <Check size={14} />
            <span>{t("databaseCenter.collections.updateAction")}</span>
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.nameLabel")}
        </label>
        <input
          type="text"
          value={editing.name}
          onChange={(e) =>
            mgr.setEditingCollection({ ...editing, name: e.target.value })
          }
          className="sor-form-input-xs w-full"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.descriptionLabel")}
        </label>
        <Textarea
          value={editing.description || ""}
          onChange={(v) =>
            mgr.setEditingCollection({ ...editing, description: v })
          }
          className="sor-form-input resize-none w-full"
          rows={2}
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={mgr.editPassword.enableEncryption}
          onChange={(v: boolean) =>
            mgr.setEditPassword((prev) => ({ ...prev, enableEncryption: v }))
          }
        />
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.encryptToggle")}
        </span>
      </label>
      {showPasswordRow && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.currentPasswordLabel")}
            </label>
            <PasswordInput
              value={mgr.editPassword.current}
              onChange={(e) =>
                mgr.setEditPassword((prev) => ({
                  ...prev,
                  current: e.target.value,
                }))
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t(
                  "databaseCenter.collections.currentPasswordPlaceholder",
                ) as string
              }
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.newPasswordLabel")}
            </label>
            <PasswordInput
              value={mgr.editPassword.next}
              onChange={(e) =>
                mgr.setEditPassword((prev) => ({
                  ...prev,
                  next: e.target.value,
                }))
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t("databaseCenter.collections.newPasswordPlaceholder") as string
              }
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.confirmPasswordShortLabel")}
            </label>
            <PasswordInput
              value={mgr.editPassword.confirm}
              onChange={(e) =>
                mgr.setEditPassword((prev) => ({
                  ...prev,
                  confirm: e.target.value,
                }))
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t(
                  "databaseCenter.collections.confirmPasswordPlaceholder",
                ) as string
              }
            />
          </div>
        </div>
      )}
    </CardShell>
  );
};

// ── Import ───────────────────────────────────────────────────────────

const ImportDatabaseCard: React.FC<{ mgr: Mgr; onClose: () => void }> = ({
  mgr,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <CardShell
      title={t("databaseCenter.collections.importTitle")}
      icon={Upload}
      error={mgr.error}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="sor-btn sor-btn-secondary">
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handleImportCollection}
            className="sor-btn-primary-sm"
            disabled={!mgr.importFile}
          >
            <Upload size={14} />
            <span>{t("databaseCenter.actions.import")}</span>
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.fileLabel")}
        </label>
        <input
          type="file"
          accept=".json"
          onChange={(e) => mgr.setImportFile(e.target.files?.[0] ?? null)}
          className="sor-form-input-xs w-full"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
            {t("databaseCenter.collections.optionalNameLabel")}
          </label>
          <input
            type="text"
            value={mgr.importCollectionName}
            onChange={(e) => mgr.setImportCollectionName(e.target.value)}
            className="sor-form-input-xs w-full"
            placeholder={
              t("databaseCenter.collections.optionalNamePlaceholder") as string
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
            {t("databaseCenter.collections.importPasswordLabel")}
          </label>
          <PasswordInput
            value={mgr.importPassword}
            onChange={(e) => mgr.setImportPassword(e.target.value)}
            className="sor-form-input-xs w-full"
            placeholder={
              t("databaseCenter.collections.passwordPlaceholder") as string
            }
          />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={mgr.encryptImport}
          onChange={(v: boolean) => mgr.setEncryptImport(v)}
        />
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.encryptImportToggle")}
        </span>
      </label>
      {mgr.encryptImport && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.newPasswordLabel")}
            </label>
            <PasswordInput
              value={mgr.importEncryptPassword}
              onChange={(e) => mgr.setImportEncryptPassword(e.target.value)}
              className="sor-form-input-xs w-full"
              placeholder={
                t("databaseCenter.collections.newPasswordPlaceholder") as string
              }
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
              {t("databaseCenter.collections.confirmPasswordShortLabel")}
            </label>
            <PasswordInput
              value={mgr.importEncryptConfirmPassword}
              onChange={(e) =>
                mgr.setImportEncryptConfirmPassword(e.target.value)
              }
              className="sor-form-input-xs w-full"
              placeholder={
                t(
                  "databaseCenter.collections.confirmPasswordPlaceholder",
                ) as string
              }
              revealable={false}
            />
          </div>
        </div>
      )}
    </CardShell>
  );
};

// ── Export ───────────────────────────────────────────────────────────

const ExportDatabaseCard: React.FC<{ mgr: Mgr; onClose: () => void }> = ({
  mgr,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!mgr.exportingCollection) return null;
  const target = mgr.exportingCollection;

  return (
    <CardShell
      title={t("databaseCenter.collections.exportTitle", { name: target.name })}
      icon={Download}
      error={mgr.error}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="sor-btn sor-btn-secondary">
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handleExportDownload}
            className="sor-btn-primary-sm"
          >
            <Download size={14} />
            <span>{t("databaseCenter.actions.export")}</span>
          </button>
        </>
      }
    >
      {target.isEncrypted && (
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
            {t("databaseCenter.collections.collectionPasswordLabel")}
          </label>
          <PasswordInput
            value={mgr.collectionPassword}
            onChange={(e) => mgr.setCollectionPassword(e.target.value)}
            className="sor-form-input-xs w-full"
            placeholder={
              t("databaseCenter.collections.passwordPlaceholder") as string
            }
          />
        </div>
      )}
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={mgr.includePasswords}
          onChange={(v: boolean) => mgr.setIncludePasswords(v)}
        />
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.includePasswords")}
        </span>
      </label>
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {t("databaseCenter.collections.exportPasswordLabel")}
        </label>
        <PasswordInput
          value={mgr.exportPassword}
          onChange={(e) => mgr.setExportPassword(e.target.value)}
          className="sor-form-input-xs w-full"
          placeholder={
            t("databaseCenter.collections.exportPasswordPlaceholder") as string
          }
        />
      </div>
    </CardShell>
  );
};

// ── Unlock / clone-source ────────────────────────────────────────────

const UnlockDatabaseCard: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  if (!mgr.selectedCollection) return null;
  const target = mgr.selectedCollection;
  const isClone = mgr.passwordDialogMode === "clone";

  return (
    <CardShell
      title={
        isClone
          ? (t("databaseCenter.collections.cloneTitle", {
              name: target.name,
            }) as string)
          : (t("databaseCenter.collections.unlockTitle", {
              name: target.name,
            }) as string)
      }
      icon={isClone ? Copy : Unlock}
      error={mgr.error}
      onClose={() => {
        mgr.closePasswordDialog();
        mgr.setError("");
      }}
      footer={
        <>
          <button
            onClick={() => {
              mgr.closePasswordDialog();
              mgr.setError("");
            }}
            disabled={mgr.isWorking}
            className="sor-btn sor-btn-secondary"
          >
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            onClick={mgr.handlePasswordSubmit}
            disabled={mgr.isWorking}
            className="sor-btn-primary-sm"
          >
            {isClone ? <Copy size={14} /> : <Unlock size={14} />}
            <span>
              {mgr.isWorking
                ? isClone
                  ? t("databaseCenter.collections.cloning")
                  : t("databaseCenter.collections.unlocking")
                : isClone
                  ? t("databaseCenter.collections.cloneAction")
                  : t("databaseCenter.collections.unlockAction")}
            </span>
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
          {isClone
            ? t("databaseCenter.collections.sourcePasswordLabel")
            : t("databaseCenter.collections.passwordInputLabel")}
        </label>
        <div className="relative">
          <input
            type={mgr.showPassword ? "text" : "password"}
            value={mgr.password}
            onChange={(e) => mgr.setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void mgr.handlePasswordSubmit();
              }
            }}
            disabled={mgr.isWorking}
            className="sor-form-input-xs w-full pr-9"
            placeholder={
              isClone
                ? (t(
                    "databaseCenter.collections.sourcePasswordPlaceholder",
                  ) as string)
                : (t(
                    "databaseCenter.collections.unlockPasswordPlaceholder",
                  ) as string)
            }
            autoFocus
          />
          <button
            type="button"
            onClick={() => mgr.setShowPassword(!mgr.showPassword)}
            disabled={mgr.isWorking}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            aria-label={
              mgr.showPassword
                ? (t("databaseCenter.collections.hidePassword") as string)
                : (t("databaseCenter.collections.showPassword") as string)
            }
          >
            {mgr.showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    </CardShell>
  );
};

export default DatabaseList;
