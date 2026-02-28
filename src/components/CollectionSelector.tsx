import React from "react";
import { PasswordInput } from "./ui/PasswordInput";
import {
  Database,
  Plus,
  Lock,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Download,
  Upload,
  X,
  Layers,
  Network,
  Link2,
  Copy,
  Search,
} from "lucide-react";
import { ImportExport } from "./ImportExport";
import { ProxyProfileEditor } from "./ProxyProfileEditor";
import { ProxyChainEditor } from "./ProxyChainEditor";
import { Modal } from "./ui/Modal";
import { useCollectionSelector } from "../hooks/useCollectionSelector";

interface CollectionSelectorProps {
  isOpen: boolean;
  onCollectionSelect: (collectionId: string, password?: string) => void;
  onClose: () => void;
}

export const CollectionSelector: React.FC<CollectionSelectorProps> = ({
  isOpen,
  onCollectionSelect,
  onClose,
}) => {
  const mgr = useCollectionSelector(isOpen, onCollectionSelect);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-5xl h-[90vh] rounded-lg overflow-hidden"
      contentClassName="bg-[var(--color-surface)]"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Database size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                Collection Center
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Manage your connection collections
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {mgr.activeTab === "collections" && (
              <>
                <button
                  onClick={() => mgr.setShowImportForm(true)}
                  className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Upload size={14} />
                  <span>Import</span>
                </button>
                <button
                  onClick={() => mgr.setShowCreateForm(true)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Plus size={14} />
                  <span>New</span>
                </button>
              </>
            )}
            {mgr.activeTab === "proxies" && (
              <>
                <button
                  onClick={mgr.handleImportProxies}
                  className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Upload size={14} />
                  <span>Import</span>
                </button>
                <button
                  onClick={mgr.handleExportProxies}
                  className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Download size={14} />
                  <span>Export</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-60 bg-[var(--color-background)] border-r border-[var(--color-border)] p-4 space-y-2">
            <button
              onClick={() => mgr.setActiveTab("collections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "collections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Database size={16} />
              <span>Collections</span>
            </button>
            <button
              onClick={() => mgr.setActiveTab("connections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "connections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Layers size={16} />
              <span>Connections</span>
            </button>
            <button
              onClick={() => mgr.setActiveTab("proxies")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "proxies"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Network size={16} />
              <span>Proxy/VPN Profiles</span>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {mgr.activeTab === "collections" && (
                <CollectionsTab mgr={mgr} />
              )}
              {mgr.activeTab === "connections" && <ConnectionsTab />}
              {mgr.activeTab === "proxies" && <ProxiesTab mgr={mgr} />}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-dialogs */}
      <ProxyProfileEditor
        isOpen={mgr.showProfileEditor}
        onClose={mgr.closeProfileEditor}
        onSave={mgr.handleSaveProfile}
        editingProfile={mgr.editingProfile}
      />
      <ProxyChainEditor
        isOpen={mgr.showChainEditor}
        onClose={mgr.closeChainEditor}
        onSave={mgr.handleSaveChain}
        editingChain={mgr.editingChain}
      />
    </Modal>
  );
};

// ─── Tab sub-components ──────────────────────────────────────────

type Mgr = ReturnType<typeof useCollectionSelector>;

function CollectionsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Create Collection Form */}
      {mgr.showCreateForm && (
        <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Create New Collection
          </h3>
          {mgr.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)] resize-none"
                rows={3}
                placeholder="Optional description"
              />
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={mgr.newCollection.isEncrypted}
                onChange={(e) =>
                  mgr.setNewCollection({
                    ...mgr.newCollection,
                    isEncrypted: e.target.checked,
                  })
                }
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
              />
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleCreateCollection}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
              >
                Create Collection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Dialog */}
      {mgr.showPasswordDialog && mgr.selectedCollection && (
        <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Unlock Collection: {mgr.selectedCollection.name}
          </h3>
          {mgr.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
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
                  className="w-full px-3 py-2 pr-10 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handlePasswordSubmit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Collection Form */}
      {mgr.exportingCollection && (
        <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Export Collection: {mgr.exportingCollection.name}
          </h3>
          {mgr.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
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
                  className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  placeholder="Password"
                />
              </div>
            )}
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={mgr.includePasswords}
                onChange={(e) => mgr.setIncludePasswords(e.target.checked)}
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
              />
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                placeholder="Encrypt export"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  mgr.setExportingCollection(null);
                  mgr.setError("");
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleExportDownload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
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
        <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Import Collection
          </h3>
          {mgr.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                placeholder="Password"
              />
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={mgr.encryptImport}
                onChange={(e) => mgr.setEncryptImport(e.target.checked)}
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
              />
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleImportCollection}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
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
        <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
            Edit Collection
          </h3>
          {mgr.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)] resize-none"
                rows={3}
              />
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={mgr.editPassword.enableEncryption}
                onChange={(e) =>
                  mgr.setEditPassword((prev) => ({
                    ...prev,
                    enableEncryption: e.target.checked,
                  }))
                }
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
              />
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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
                    className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                    placeholder="Confirm password"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                    className="w-full px-3 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors flex items-center justify-center space-x-2"
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={mgr.handleUpdateCollection}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
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
            <Database size={48} className="mx-auto text-gray-500 mb-4" />
            <p className="text-[var(--color-textSecondary)] mb-2">
              No collections found
            </p>
            <p className="text-gray-500 text-sm">
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
                    <p className="text-gray-500 text-xs">
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
                    className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    title="Export"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      mgr.handleEditCollection(collection);
                    }}
                    className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      mgr.handleDeleteCollection(collection);
                    }}
                    className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-red-400 hover:text-red-300"
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

function ConnectionsTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-4">
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
          Connection Import / Export
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Manage connection backups and transfers without leaving the collection
          center.
        </p>
        <ImportExport isOpen onClose={() => undefined} embedded />
      </div>
    </div>
  );
}

function ProxiesTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Proxy Profiles Section */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Proxy Profiles
          </h3>
          <button
            onClick={mgr.handleNewProfile}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
          >
            <Plus size={14} />
            New Profile
          </button>
        </div>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Create and manage reusable proxy configurations that can be used
          across connections and chains.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.profileSearch}
            onChange={(e) => mgr.setProfileSearch(e.target.value)}
            placeholder="Search profiles..."
            className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Profile List */}
        <div className="space-y-2">
          {mgr.filteredProfiles.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.profileSearch
                ? "No profiles match your search."
                : 'No proxy profiles saved. Click "New Profile" to create one.'}
            </div>
          ) : (
            mgr.filteredProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {profile.name}
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 uppercase">
                      {profile.config.type}
                    </span>
                    {profile.isDefault && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                    {profile.config.host}:{profile.config.port}
                    {profile.config.username &&
                      ` (${profile.config.username})`}
                  </div>
                  {profile.description && (
                    <div className="text-xs text-gray-500 mt-1">
                      {profile.description}
                    </div>
                  )}
                  {profile.tags && profile.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {profile.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => mgr.handleDuplicateProfile(profile.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleEditProfile(profile)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Edit"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteProfile(profile.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Proxy Chains Section */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Proxy Chains
          </h3>
          <button
            onClick={mgr.handleNewChain}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
          >
            <Plus size={14} />
            New Chain
          </button>
        </div>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Create reusable proxy chains that route traffic through multiple
          layers.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.chainSearch}
            onChange={(e) => mgr.setChainSearch(e.target.value)}
            placeholder="Search chains..."
            className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Chain List */}
        <div className="space-y-2">
          {mgr.filteredChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.chainSearch
                ? "No chains match your search."
                : 'No proxy chains saved. Click "New Chain" to create one.'}
            </div>
          ) : (
            mgr.filteredChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {chain.name}
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                      {chain.layers.length} layer
                      {chain.layers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {chain.description && (
                    <div className="text-xs text-gray-500 mt-1">
                      {chain.description}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                    {chain.layers.map((layer, i) => {
                      const profile = layer.proxyProfileId
                        ? mgr.savedProfiles.find(
                            (p) => p.id === layer.proxyProfileId,
                          )
                        : null;
                      return (
                        <span key={i}>
                          {i > 0 && " → "}
                          {layer.type === "proxy" && profile
                            ? profile.name
                            : layer.type}
                        </span>
                      );
                    })}
                  </div>
                  {chain.tags && chain.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {chain.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => mgr.handleDuplicateChain(chain.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleEditChain(chain)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Edit"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteChain(chain.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
