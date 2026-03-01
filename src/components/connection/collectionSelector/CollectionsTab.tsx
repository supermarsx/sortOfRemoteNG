import { PasswordInput } from "../../ui/forms/PasswordInput";
import { Database, Lock, Trash2, Edit, Eye, EyeOff, Download, Upload } from "lucide-react";
import { Checkbox } from "../../ui/forms";

function CollectionsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Create Collection Form */}
      {mgr.showCreateForm && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Create New Collection
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-red-300 text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Collection Name *
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
                placeholder="My Connections"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Description
              </label>
              <textarea
                value={mgr.newCollection.description}
                onChange={(e) =>
                  mgr.setNewCollection({
                    ...mgr.newCollection,
                    description: e.target.value,
                  })
                }
                className="sor-form-input resize-none w-full"
                rows={3}
                placeholder="Optional description"
              />
            </div>
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.newCollection.isEncrypted} onChange={(v: boolean) => mgr.setNewCollection({
                    ...mgr.newCollection,
                    isEncrypted: v,
                  })} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
              <span className="text-[var(--color-textSecondary)]">
                Encrypt this collection
              </span>
            </label>
            {mgr.newCollection.isEncrypted && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Password *
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
                    placeholder="Enter password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Confirm Password *
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
                    placeholder="Confirm password"
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
                className="sor-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleCreateCollection}
                className="sor-btn-primary"
              >
                Create Collection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Dialog */}
      {mgr.showPasswordDialog && mgr.selectedCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Unlock Collection: {mgr.selectedCollection.name}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-red-300 text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={mgr.showPassword ? "text" : "password"}
                  value={mgr.password}
                  onChange={(e) => mgr.setPassword(e.target.value)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && mgr.handlePasswordSubmit()
                  }
                  className="sor-form-input w-full pr-10"
                  placeholder="Enter collection password"
                  autoFocus
                />
                <button
                  onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
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
                  mgr.setShowPasswordDialog(false);
                  mgr.setError("");
                }}
                className="sor-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handlePasswordSubmit}
                className="sor-btn-primary"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Collection Form */}
      {mgr.exportingCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Export Collection: {mgr.exportingCollection.name}
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-red-300 text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            {mgr.exportingCollection.isEncrypted && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Collection Password
                </label>
                <input
                  type={mgr.showPassword ? "text" : "password"}
                  value={mgr.collectionPassword}
                  onChange={(e) => mgr.setCollectionPassword(e.target.value)}
                  className="sor-form-input w-full"
                  placeholder="Password"
                />
              </div>
            )}
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.includePasswords} onChange={(v: boolean) => mgr.setIncludePasswords(v)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
              <span className="text-[var(--color-textSecondary)]">
                Include passwords
              </span>
            </label>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Export Password (optional)
              </label>
              <input
                type={mgr.showPassword ? "text" : "password"}
                value={mgr.exportPassword}
                onChange={(e) => mgr.setExportPassword(e.target.value)}
                className="sor-form-input w-full"
                placeholder="Encrypt export"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setExportingCollection(null);
                  mgr.setError("");
                }}
                className="sor-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleExportDownload}
                className="sor-btn-primary"
              >
                <Download size={14} />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Collection Form */}
      {mgr.showImportForm && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Import Collection
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-red-300 text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Collection File *
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
                Collection Name (optional)
              </label>
              <input
                type="text"
                value={mgr.importCollectionName}
                onChange={(e) => mgr.setImportCollectionName(e.target.value)}
                className="sor-form-input w-full"
                placeholder="Leave blank to use the export name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Import Password (if encrypted)
              </label>
              <input
                type={mgr.showPassword ? "text" : "password"}
                value={mgr.importPassword}
                onChange={(e) => mgr.setImportPassword(e.target.value)}
                className="sor-form-input w-full"
                placeholder="Password"
              />
            </div>
            <label className="flex items-center space-x-2">
              <Checkbox checked={mgr.encryptImport} onChange={(v: boolean) => mgr.setEncryptImport(v)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
              <span className="text-[var(--color-textSecondary)]">
                Encrypt imported collection
              </span>
            </label>
            {mgr.encryptImport && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    New Password
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.importEncryptPassword}
                    onChange={(e) =>
                      mgr.setImportEncryptPassword(e.target.value)
                    }
                    className="sor-form-input w-full"
                    placeholder="New password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Confirm Password
                  </label>
                  <input
                    type={mgr.showPassword ? "text" : "password"}
                    value={mgr.importEncryptConfirmPassword}
                    onChange={(e) =>
                      mgr.setImportEncryptConfirmPassword(e.target.value)
                    }
                    className="sor-form-input w-full"
                    placeholder="Confirm password"
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
                className="sor-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleImportCollection}
                className="sor-btn-primary"
              >
                <Upload size={14} />
                <span>Import</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Collection Form */}
      {mgr.editingCollection && (
        <div className="sor-section-card p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Edit Collection
          </h3>
          {mgr.error && (
            <div className="sor-alert-error">
              <p className="text-red-300 text-sm">{mgr.error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Collection Name *
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
                Description
              </label>
              <textarea
                value={mgr.editingCollection.description || ""}
                onChange={(e) =>
                  mgr.setEditingCollection({
                    ...mgr.editingCollection!,
                    description: e.target.value,
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
                  }))} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
              <span className="text-[var(--color-textSecondary)]">
                Encrypt this collection
              </span>
            </label>
            {(mgr.editingCollection.isEncrypted ||
              mgr.editPassword.enableEncryption) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Current Password
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
                    placeholder="Current password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    New Password
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
                    placeholder="New password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Confirm Password
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
                    placeholder="Confirm password"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                    className="sor-btn-secondary w-full"
                  >
                    {mgr.showPassword ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                    <span>{mgr.showPassword ? "Hide" : "Show"}</span>
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
                className="sor-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleUpdateCollection}
                className="sor-btn-primary"
              >
                Update
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
              No collections found
            </p>
            <p className="text-[var(--color-textMuted)] text-sm">
              Create your first connection collection to get started
            </p>
          </div>
        ) : (
          mgr.collections.map((collection) => (
            <div
              key={collection.id}
              className="bg-[var(--color-border)]/60 rounded-lg p-4 hover:bg-[var(--color-border)]/80 hover:shadow-lg hover:shadow-blue-500/5 border border-transparent hover:border-[var(--color-border)] transition-all duration-200 cursor-pointer group"
              onClick={() => mgr.handleSelectCollection(collection)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <Database
                      size={20}
                      className="text-blue-400 group-hover:text-blue-300 transition-colors"
                    />
                    {collection.isEncrypted && (
                      <Lock size={16} className="text-yellow-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-[var(--color-text)] font-medium group-hover:text-blue-100 transition-colors">
                      {collection.name}
                    </h4>
                    {collection.description && (
                      <p className="text-[var(--color-textSecondary)] text-sm">
                        {collection.description}
                      </p>
                    )}
                    <p className="text-[var(--color-textMuted)] text-xs">
                      Last accessed:{" "}
                      {collection.lastAccessed.toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      mgr.handleExportCollection(collection);
                    }}
                    className="sor-icon-btn-sm"
                    title="Export"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      mgr.handleEditCollection(collection);
                    }}
                    className="sor-icon-btn-sm"
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      mgr.handleDeleteCollection(collection);
                    }}
                    className="sor-icon-btn-danger"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default CollectionsTab;
