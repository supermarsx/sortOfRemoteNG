import type { Mgr } from './types';
import { PasswordInput, Textarea} from '../../ui/forms';
import { Copy, Database, Download, Edit, Eye, EyeOff, FolderOpen, Lock, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { Checkbox } from "../../ui/forms";
import { useTranslation } from "react-i18next";
import MenuSurface from "../../ui/overlays/MenuSurface";

function CollectionsTab({ mgr }: { mgr: Mgr }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Create Collection Form */}
      {mgr.showCreateForm && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            {t("collectionCenter.collections.createTitle")}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-error text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.nameLabel")}
              </label>
              <input
                type="text"
                value={mgr.newCollection.name}
                onChange={(e) =>
                  mgr.setNewCollection({
                    ...mgr.newCollection,
                    name: e.target.value,
                  })
                }
                className="sor-form-input w-full"
                placeholder={t("collectionCenter.collections.namePlaceholder")}
                data-testid="collection-name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.descriptionLabel")}
              </label>
              <Textarea
                value={mgr.newCollection.description}
                onChange={(v) =>
                  mgr.setNewCollection({
                    ...mgr.newCollection,
                    description: v,
                  })
                }
                className="sor-form-input resize-none w-full"
                rows={3}
                placeholder={t("collectionCenter.collections.descriptionPlaceholder")}
              />
            </div>
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.newCollection.isEncrypted} onChange={(v: boolean) => mgr.setNewCollection({
                    ...mgr.newCollection,
                    isEncrypted: v,
                  })} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
              <span className="text-[var(--color-textSecondary)]">
                {t("collectionCenter.collections.encryptToggle")}
              </span>
            </label>
            {mgr.newCollection.isEncrypted && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.passwordLabel")}
                  </label>
                  <PasswordInput
                    value={mgr.newCollection.password}
                    onChange={(e) =>
                      mgr.setNewCollection({
                        ...mgr.newCollection,
                        password: e.target.value,
                      })
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.passwordPlaceholder")}
                    data-testid="collection-password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.confirmPasswordLabel")}
                  </label>
                  <PasswordInput
                    value={mgr.newCollection.confirmPassword}
                    onChange={(e) =>
                      mgr.setNewCollection({
                        ...mgr.newCollection,
                        confirmPassword: e.target.value,
                      })
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.confirmPasswordPlaceholder")}
                    revealable={false}
                  />
                </div>
              </>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setShowCreateForm(false);
                  mgr.setError("");
                }}
                className="sor-btn sor-btn-secondary"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={mgr.handleCreateCollection}
                className="sor-btn sor-btn-primary"
                data-testid="collection-confirm"
              >
                {t("collectionCenter.collections.createAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Dialog */}
      {mgr.showPasswordDialog && mgr.selectedCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            {mgr.passwordDialogMode === "clone"
              ? t("collectionCenter.collections.cloneTitle", {
                  name: mgr.selectedCollection.name,
                })
              : t("collectionCenter.collections.unlockTitle", {
                  name: mgr.selectedCollection.name,
                })}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-error text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {mgr.passwordDialogMode === "clone"
                  ? t("collectionCenter.collections.sourcePasswordLabel")
                  : t("collectionCenter.collections.passwordInputLabel")}
              </label>
              <div className="relative">
                <input
                  type={mgr.showPassword ? "text" : "password"}
                  value={mgr.password}
                  onChange={(e) => mgr.setPassword(e.target.value)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && mgr.handlePasswordSubmit()
                  }
                  disabled={mgr.isWorking}
                  className="sor-form-input w-full pr-10"
                  placeholder={
                    mgr.passwordDialogMode === "clone"
                      ? t("collectionCenter.collections.sourcePasswordPlaceholder")
                      : t("collectionCenter.collections.unlockPasswordPlaceholder")
                  }
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                  disabled={mgr.isWorking}
                  className="sor-search-clear"
                >
                  {mgr.showPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.closePasswordDialog();
                  mgr.setError("");
                }}
                disabled={mgr.isWorking}
                className="sor-btn sor-btn-secondary"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={mgr.handlePasswordSubmit}
                disabled={mgr.isWorking}
                className="sor-btn sor-btn-primary"
              >
                {mgr.isWorking
                  ? mgr.passwordDialogMode === "clone"
                    ? t("collectionCenter.collections.cloning")
                    : t("collectionCenter.collections.unlocking")
                  : mgr.passwordDialogMode === "clone"
                    ? t("collectionCenter.collections.cloneAction")
                    : t("collectionCenter.collections.unlockAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Collection Form */}
      {mgr.exportingCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            {t("collectionCenter.collections.exportTitle", {
              name: mgr.exportingCollection.name,
            })}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-error text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            {mgr.exportingCollection.isEncrypted && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("collectionCenter.collections.collectionPasswordLabel")}
                </label>
                <input
                  type={mgr.showPassword ? "text" : "password"}
                  value={mgr.collectionPassword}
                  onChange={(e) => mgr.setCollectionPassword(e.target.value)}
                  className="sor-form-input w-full"
                  placeholder={t("collectionCenter.collections.passwordPlaceholder")}
                />
              </div>
            )}
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.includePasswords} onChange={(v: boolean) => mgr.setIncludePasswords(v)} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
              <span className="text-[var(--color-textSecondary)]">
                {t("collectionCenter.collections.includePasswords")}
              </span>
            </label>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.exportPasswordLabel")}
              </label>
              <input
                type={mgr.showPassword ? "text" : "password"}
                value={mgr.exportPassword}
                onChange={(e) => mgr.setExportPassword(e.target.value)}
                className="sor-form-input w-full"
                placeholder={t("collectionCenter.collections.exportPasswordPlaceholder")}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setExportingCollection(null);
                  mgr.setError("");
                }}
                className="sor-btn sor-btn-secondary"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={mgr.handleExportDownload}
                className="sor-btn sor-btn-primary"
              >
                <Download size={14} />
                <span>{t("collectionCenter.actions.export")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Collection Form */}
      {mgr.showImportForm && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            {t("collectionCenter.collections.importTitle")}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-error text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.fileLabel")}
              </label>
              <input
                type="file"
                accept=".json"
                onChange={(e) =>
                  mgr.setImportFile(e.target.files?.[0] ?? null)
                }
                className="sor-form-input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.optionalNameLabel")}
              </label>
              <input
                type="text"
                value={mgr.importCollectionName}
                onChange={(e) => mgr.setImportCollectionName(e.target.value)}
                className="sor-form-input w-full"
                placeholder={t("collectionCenter.collections.optionalNamePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.importPasswordLabel")}
              </label>
              <input
                type={mgr.showPassword ? "text" : "password"}
                value={mgr.importPassword}
                onChange={(e) => mgr.setImportPassword(e.target.value)}
                className="sor-form-input w-full"
                placeholder={t("collectionCenter.collections.passwordPlaceholder")}
              />
            </div>
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.encryptImport} onChange={(v: boolean) => mgr.setEncryptImport(v)} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
              <span className="text-[var(--color-textSecondary)]">
                {t("collectionCenter.collections.encryptImportToggle")}
              </span>
            </label>
            {mgr.encryptImport && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.newPasswordLabel")}
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.importEncryptPassword}
                    onChange={(e) =>
                      mgr.setImportEncryptPassword(e.target.value)
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.newPasswordPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.confirmPasswordShortLabel")}
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.importEncryptConfirmPassword}
                    onChange={(e) =>
                      mgr.setImportEncryptConfirmPassword(e.target.value)
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.confirmPasswordPlaceholder")}
                  />
                </div>
              </>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setShowImportForm(false);
                  mgr.setError("");
                }}
                className="sor-btn sor-btn-secondary"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={mgr.handleImportCollection}
                className="sor-btn sor-btn-primary"
              >
                <Upload size={14} />
                <span>{t("collectionCenter.actions.import")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Collection Form */}
      {mgr.editingCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            {t("collectionCenter.collections.editTitle")}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-error text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.nameLabel")}
              </label>
              <input
                type="text"
                value={mgr.editingCollection.name}
                onChange={(e) =>
                  mgr.setEditingCollection({
                    ...mgr.editingCollection!,
                    name: e.target.value,
                  })
                }
                className="sor-form-input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t("collectionCenter.collections.descriptionLabel")}
              </label>
              <Textarea
                value={mgr.editingCollection.description || ""}
                onChange={(v) =>
                  mgr.setEditingCollection({
                    ...mgr.editingCollection!,
                    description: v,
                  })
                }
                className="sor-form-input resize-none w-full"
                rows={3}
              />
            </div>
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.editPassword.enableEncryption} onChange={(v: boolean) => mgr.setEditPassword((prev) => ({
                    ...prev,
                    enableEncryption: v,
                  }))} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
              <span className="text-[var(--color-textSecondary)]">
                {t("collectionCenter.collections.encryptToggle")}
              </span>
            </label>
            {(mgr.editingCollection.isEncrypted ||
              mgr.editPassword.enableEncryption) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.currentPasswordLabel")}
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.editPassword.current}
                    onChange={(e) =>
                      mgr.setEditPassword((prev) => ({
                        ...prev,
                        current: e.target.value,
                      }))
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.currentPasswordPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.newPasswordLabel")}
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.editPassword.next}
                    onChange={(e) =>
                      mgr.setEditPassword((prev) => ({
                        ...prev,
                        next: e.target.value,
                      }))
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.newPasswordPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    {t("collectionCenter.collections.confirmPasswordShortLabel")}
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.editPassword.confirm}
                    onChange={(e) =>
                      mgr.setEditPassword((prev) => ({
                        ...prev,
                        confirm: e.target.value,
                      }))
                    }
                    className="sor-form-input w-full"
                    placeholder={t("collectionCenter.collections.confirmPasswordPlaceholder")}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                    className="sor-btn sor-btn-secondary w-full"
                  >
                    {mgr.showPassword ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                    <span>
                      {mgr.showPassword
                        ? t("collectionCenter.collections.hidePassword")
                        : t("collectionCenter.collections.showPassword")}
                    </span>
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setEditingCollection(null);
                  mgr.setError("");
                }}
                className="sor-btn sor-btn-secondary"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={mgr.handleUpdateCollection}
                className="sor-btn sor-btn-primary"
              >
                {t("collectionCenter.collections.updateAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collections List */}
      <div className="space-y-3">
        {mgr.collections.length === 0 ? (
          <div className="text-center py-12">
            <Database size={48} className="mx-auto text-[var(--color-textMuted)] mb-4" />
            <p className="text-[var(--color-textSecondary)] mb-2">
              {t("collectionCenter.collections.emptyTitle")}
            </p>
            <p className="text-[var(--color-textMuted)] text-sm">
              {t("collectionCenter.collections.emptyDescription")}
            </p>
          </div>
        ) : (
          mgr.collections.map((collection) => (
            <div
              key={collection.id}
              className={`bg-[var(--color-border)]/60 rounded-lg p-4 hover:bg-[var(--color-border)]/80 hover:shadow-lg hover:shadow-primary/30 border border-transparent hover:border-[var(--color-border)] transition-all duration-200 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                mgr.highlightedCollectionId === collection.id
                  ? "sor-tree-item-blink border-primary/60"
                  : ""
              }`}
              onClick={() => {
                void mgr.handleSelectCollection(collection);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                mgr.openCollectionMenu(collection, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void mgr.handleSelectCollection(collection);
                }

                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.preventDefault();
                  mgr.openCollectionMenu(collection, {
                    x: rect.right - 24,
                    y: rect.top + 24,
                  });
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={t("collectionCenter.collections.openCollectionLabel", {
                name: collection.name,
              })}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <Database
                      size={20}
                      className="text-primary group-hover:text-primary transition-colors"
                    />
                    {collection.isEncrypted && (
                      <Lock size={16} className="text-warning" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-[var(--color-text)] font-medium group-hover:text-primary transition-colors">
                      {collection.name}
                    </h4>
                    {collection.description && (
                      <p className="text-[var(--color-textSecondary)] text-sm">
                        {collection.description}
                      </p>
                    )}
                    <p className="text-[var(--color-textMuted)] text-xs">
                      {t("collectionCenter.collections.lastAccessed")}: {" "}
                      {new Date(collection.lastAccessed).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const isOpen = mgr.collectionMenu?.collection.id === collection.id;
                      if (isOpen) {
                        mgr.closeCollectionMenu();
                        return;
                      }

                      mgr.openCollectionMenu(collection, {
                        x: rect.left,
                        y: rect.bottom + 4,
                      });
                    }}
                    aria-label={`Actions for ${collection.name}`}
                    aria-haspopup="menu"
                    aria-expanded={mgr.collectionMenu?.collection.id === collection.id}
                    className="sor-icon-btn-sm"
                    title={t("collectionCenter.actions.moreActions")}
                    data-testid="collection-actions-trigger"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <MenuSurface
        isOpen={Boolean(mgr.collectionMenu)}
        onClose={mgr.closeCollectionMenu}
        position={mgr.collectionMenu?.position ?? null}
        className="min-w-[180px]"
        dataTestId="collection-action-menu"
        ariaLabel={
          mgr.collectionMenu
            ? t("collectionCenter.collections.actionsLabel", {
                name: mgr.collectionMenu.collection.name,
              })
            : t("collectionCenter.actions.moreActions")
        }
      >
        {mgr.collectionMenu && (
          <>
            <button
              type="button"
              onClick={() => {
                void mgr.handleSelectCollection(mgr.collectionMenu!.collection);
              }}
              className="sor-menu-item"
              disabled={mgr.isWorking}
            >
              <FolderOpen size={14} className="mr-2" />
              {mgr.collectionMenu.collection.isEncrypted
                ? t("collectionCenter.actions.unlock")
                : t("collectionCenter.actions.open")}
            </button>
            <button
              type="button"
              onClick={() => {
                void mgr.handleCloneCollection(mgr.collectionMenu!.collection);
              }}
              className="sor-menu-item"
              disabled={mgr.isWorking}
            >
              <Copy size={14} className="mr-2" />
              {t("collectionCenter.actions.clone")}
            </button>
            <div className="sor-menu-divider" />
            <button
              type="button"
              onClick={() => {
                mgr.handleExportCollection(mgr.collectionMenu!.collection);
                mgr.closeCollectionMenu();
              }}
              className="sor-menu-item"
            >
              <Download size={14} className="mr-2" />
              {t("collectionCenter.actions.export")}
            </button>
            <button
              type="button"
              onClick={() => {
                mgr.handleEditCollection(mgr.collectionMenu!.collection);
              }}
              className="sor-menu-item"
            >
              <Edit size={14} className="mr-2" />
              {t("collectionCenter.actions.edit")}
            </button>
            <div className="sor-menu-divider" />
            <button
              type="button"
              onClick={() => {
                void mgr.handleDeleteCollection(mgr.collectionMenu!.collection);
              }}
              className="sor-menu-item sor-menu-item-danger"
            >
              <Trash2 size={14} className="mr-2" />
              {t("collectionCenter.actions.delete")}
            </button>
          </>
        )}
      </MenuSurface>
    </div>
  );
}

export default CollectionsTab;
