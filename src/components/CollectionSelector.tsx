import React, { useState, useEffect, useCallback } from "react";
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
import { ConnectionCollection } from "../types/connection";
import { SavedProxyProfile, SavedProxyChain } from "../types/settings";
import { CollectionManager } from "../utils/collectionManager";
import { proxyCollectionManager } from "../utils/proxyCollectionManager";
import { ImportExport } from "./ImportExport";
import { ProxyProfileEditor } from "./ProxyProfileEditor";
import { ProxyChainEditor } from "./ProxyChainEditor";
import { Modal } from "./ui/Modal";

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
  const [collections, setCollections] = useState<ConnectionCollection[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] =
    useState<ConnectionCollection | null>(null);
  const [newCollection, setNewCollection] = useState({
    name: "",
    description: "",
    isEncrypted: false,
    password: "",
    confirmPassword: "",
  });
  const [editingCollection, setEditingCollection] =
    useState<ConnectionCollection | null>(null);
  const [editPassword, setEditPassword] = useState({
    current: "",
    next: "",
    confirm: "",
    enableEncryption: false,
  });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importCollectionName, setImportCollectionName] = useState("");
  const [encryptImport, setEncryptImport] = useState(false);
  const [importEncryptPassword, setImportEncryptPassword] = useState("");
  const [importEncryptConfirmPassword, setImportEncryptConfirmPassword] =
    useState("");
  const [exportingCollection, setExportingCollection] =
    useState<ConnectionCollection | null>(null);
  const [includePasswords, setIncludePasswords] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [collectionPassword, setCollectionPassword] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "collections" | "connections" | "proxies"
  >("collections");

  const collectionManager = CollectionManager.getInstance();

  // Proxy/VPN profiles state
  const [savedProfiles, setSavedProfiles] = useState<SavedProxyProfile[]>([]);
  const [savedChains, setSavedChains] = useState<SavedProxyChain[]>([]);
  const [profileSearch, setProfileSearch] = useState("");
  const [chainSearch, setChainSearch] = useState("");
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showChainEditor, setShowChainEditor] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SavedProxyProfile | null>(null);
  const [editingChain, setEditingChain] = useState<SavedProxyChain | null>(
    null,
  );

  const loadCollections = useCallback(async () => {
    const allCollections = await collectionManager.getAllCollections();
    setCollections(allCollections);
  }, [collectionManager]);

  useEffect(() => {
    if (isOpen) {
      loadCollections();
      // Load proxy profiles and chains
      setSavedProfiles(proxyCollectionManager.getProfiles());
      setSavedChains(proxyCollectionManager.getChains());
    }
  }, [isOpen, loadCollections]);

  const handleCreateCollection = async () => {
    if (!newCollection.name.trim()) {
      setError("Collection name is required");
      return;
    }

    if (newCollection.isEncrypted) {
      if (!newCollection.password) {
        setError("Password is required for encrypted collections");
        return;
      }
      if (newCollection.password !== newCollection.confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (newCollection.password.length < 4) {
        setError("Password must be at least 4 characters");
        return;
      }
    }

    try {
      const collection = await collectionManager.createCollection(
        newCollection.name,
        newCollection.description,
        newCollection.isEncrypted,
        newCollection.password || undefined,
      );

      setCollections([...collections, collection]);
      setShowCreateForm(false);
      setNewCollection({
        name: "",
        description: "",
        isEncrypted: false,
        password: "",
        confirmPassword: "",
      });
      setError("");

      // Auto-select the new collection
      onCollectionSelect(collection.id, newCollection.password || undefined);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create collection",
      );
    }
  };

  const handleImportCollection = async () => {
    if (!importFile) {
      setError("Select a collection file to import");
      return;
    }

    if (encryptImport) {
      if (!importEncryptPassword) {
        setError("Password is required to encrypt the imported collection");
        return;
      }
      if (importEncryptPassword !== importEncryptConfirmPassword) {
        setError("Encryption passwords do not match");
        return;
      }
    }

    try {
      const content = await importFile.text();
      const collection = await collectionManager.importCollection(content, {
        importPassword: importPassword || undefined,
        collectionName: importCollectionName.trim() || undefined,
        encryptPassword: encryptImport ? importEncryptPassword : undefined,
      });

      setCollections([...collections, collection]);
      setShowImportForm(false);
      setImportFile(null);
      setImportPassword("");
      setImportCollectionName("");
      setEncryptImport(false);
      setImportEncryptPassword("");
      setImportEncryptConfirmPassword("");
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to import collection",
      );
    }
  };

  const handleExportCollection = (collection: ConnectionCollection) => {
    setExportingCollection(collection);
    setIncludePasswords(false);
    setExportPassword("");
    setCollectionPassword("");
    setError("");
  };

  const handleExportDownload = async () => {
    if (!exportingCollection) return;

    try {
      const content = await collectionManager.exportCollection(
        exportingCollection.id,
        includePasswords,
        exportPassword || undefined,
        collectionPassword || undefined,
      );
      const filename = collectionManager.generateExportFilename();
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportingCollection(null);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to export collection",
      );
    }
  };

  const handleSelectCollection = (collection: ConnectionCollection) => {
    if (collection.isEncrypted) {
      setSelectedCollection(collection);
      setShowPasswordDialog(true);
      setPassword("");
      setError("");
    } else {
      onCollectionSelect(collection.id);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!selectedCollection) return;

    try {
      onCollectionSelect(selectedCollection.id, password);
      setShowPasswordDialog(false);
      setPassword("");
      setError("");
    } catch (error) {
      setError("Invalid password");
    }
  };

  const handleDeleteCollection = async (collection: ConnectionCollection) => {
    if (
      confirm(
        `Are you sure you want to delete the collection "${collection.name}"? This action cannot be undone.`,
      )
    ) {
      try {
        await collectionManager.deleteCollection(collection.id);
        setCollections(collections.filter((c) => c.id !== collection.id));
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Failed to delete collection",
        );
      }
    }
  };

  const handleEditCollection = (collection: ConnectionCollection) => {
    setEditingCollection({ ...collection });
    setEditPassword({
      current: "",
      next: "",
      confirm: "",
      enableEncryption: collection.isEncrypted,
    });
    setError("");
  };

  const handleUpdateCollection = async () => {
    if (!editingCollection) return;
    if (!editingCollection.name.trim()) {
      setError("Collection name is required");
      return;
    }

    const wantsEncryption = editPassword.enableEncryption;
    const wantsPasswordChange = Boolean(editPassword.next);

    if (wantsEncryption) {
      if (!editingCollection.isEncrypted && !wantsPasswordChange) {
        setError("Password is required to encrypt this collection");
        return;
      }
      if (wantsPasswordChange) {
        if (editPassword.next !== editPassword.confirm) {
          setError("New passwords do not match");
          return;
        }
        if (editPassword.next.length < 4) {
          setError("Password must be at least 4 characters");
          return;
        }
        if (editingCollection.isEncrypted && !editPassword.current) {
          setError("Current password is required");
          return;
        }
      }
    } else if (editingCollection.isEncrypted && !editPassword.current) {
      setError("Current password is required to remove encryption");
      return;
    }

    try {
      let updatedCollection = {
        ...editingCollection,
        isEncrypted: wantsEncryption,
      };

      if (editingCollection.isEncrypted && !wantsEncryption) {
        await collectionManager.removePasswordFromCollection(
          editingCollection.id,
          editPassword.current,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: false };
      }

      if (wantsEncryption && wantsPasswordChange) {
        await collectionManager.changeCollectionPassword(
          editingCollection.id,
          editingCollection.isEncrypted ? editPassword.current : undefined,
          editPassword.next,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: true };
      }

      await collectionManager.updateCollection(updatedCollection);
      setCollections(
        collections.map((c) =>
          c.id === editingCollection.id ? updatedCollection : c,
        ),
      );
      setEditingCollection(null);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to update collection",
      );
    }
  };

  // Proxy Profile handlers
  const handleNewProfile = () => {
    setEditingProfile(null);
    setShowProfileEditor(true);
  };

  const handleEditProfile = (profile: SavedProxyProfile) => {
    setEditingProfile(profile);
    setShowProfileEditor(true);
  };

  const handleSaveProfile = async (
    profileData: Omit<SavedProxyProfile, "id" | "createdAt" | "updatedAt">,
  ) => {
    try {
      if (editingProfile) {
        await proxyCollectionManager.updateProfile(
          editingProfile.id,
          profileData,
        );
      } else {
        await proxyCollectionManager.createProfile(
          profileData.name,
          profileData.config,
          {
            description: profileData.description,
            tags: profileData.tags,
            isDefault: profileData.isDefault,
          },
        );
      }
      setShowProfileEditor(false);
      setEditingProfile(null);
      setSavedProfiles(proxyCollectionManager.getProfiles());
    } catch (error) {
      console.error("Failed to save proxy profile:", error);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (confirm("Are you sure you want to delete this proxy profile?")) {
      try {
        await proxyCollectionManager.deleteProfile(profileId);
        setSavedProfiles(proxyCollectionManager.getProfiles());
      } catch (error) {
        alert(
          error instanceof Error ? error.message : "Failed to delete profile",
        );
      }
    }
  };

  const handleDuplicateProfile = async (profileId: string) => {
    try {
      await proxyCollectionManager.duplicateProfile(profileId);
      setSavedProfiles(proxyCollectionManager.getProfiles());
    } catch (error) {
      console.error("Failed to duplicate profile:", error);
    }
  };

  // Proxy Chain handlers
  const handleNewChain = () => {
    setEditingChain(null);
    setShowChainEditor(true);
  };

  const handleEditChain = (chain: SavedProxyChain) => {
    setEditingChain(chain);
    setShowChainEditor(true);
  };

  const handleSaveChain = async (
    chainData: Omit<SavedProxyChain, "id" | "createdAt" | "updatedAt">,
  ) => {
    try {
      if (editingChain) {
        await proxyCollectionManager.updateChain(editingChain.id, chainData);
      } else {
        await proxyCollectionManager.createChain(
          chainData.name,
          chainData.layers,
          {
            description: chainData.description,
            tags: chainData.tags,
          },
        );
      }
      setShowChainEditor(false);
      setEditingChain(null);
      setSavedChains(proxyCollectionManager.getChains());
    } catch (error) {
      console.error("Failed to save proxy chain:", error);
    }
  };

  const handleDeleteChain = async (chainId: string) => {
    if (confirm("Are you sure you want to delete this proxy chain?")) {
      try {
        await proxyCollectionManager.deleteChain(chainId);
        setSavedChains(proxyCollectionManager.getChains());
      } catch (error) {
        alert(
          error instanceof Error ? error.message : "Failed to delete chain",
        );
      }
    }
  };

  const handleDuplicateChain = async (chainId: string) => {
    try {
      await proxyCollectionManager.duplicateChain(chainId);
      setSavedChains(proxyCollectionManager.getChains());
    } catch (error) {
      console.error("Failed to duplicate chain:", error);
    }
  };

  const handleExportProxies = async () => {
    try {
      const data = await proxyCollectionManager.exportData();
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "proxy-profiles.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export profiles:", error);
    }
  };

  const handleImportProxies = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          await proxyCollectionManager.importData(text, true);
          setSavedProfiles(proxyCollectionManager.getProfiles());
          setSavedChains(proxyCollectionManager.getChains());
        } catch (error) {
          alert(
            "Failed to import profiles: " +
              (error instanceof Error ? error.message : "Unknown error"),
          );
        }
      }
    };
    input.click();
  };

  const filteredProfiles = profileSearch.trim()
    ? proxyCollectionManager.searchProfiles(profileSearch)
    : savedProfiles;

  const filteredChains = chainSearch.trim()
    ? proxyCollectionManager.searchChains(chainSearch)
    : savedChains;

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
            {activeTab === "collections" && (
              <>
                <button
                  onClick={() => setShowImportForm(true)}
                  className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Upload size={14} />
                  <span>Import</span>
                </button>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Plus size={14} />
                  <span>New</span>
                </button>
              </>
            )}
            {activeTab === "proxies" && (
              <>
                <button
                  onClick={handleImportProxies}
                  className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Upload size={14} />
                  <span>Import</span>
                </button>
                <button
                  onClick={handleExportProxies}
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
          <div className="w-60 bg-[var(--color-background)] border-r border-[var(--color-border)] p-4 space-y-2">
            <button
              onClick={() => setActiveTab("collections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "collections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Database size={16} />
              <span>Collections</span>
            </button>
            <button
              onClick={() => setActiveTab("connections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "connections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Layers size={16} />
              <span>Connections</span>
            </button>
            <button
              onClick={() => setActiveTab("proxies")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "proxies"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Network size={16} />
              <span>Proxy/VPN Profiles</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {activeTab === "collections" && (
                <div className="space-y-6">
                  {/* Create Collection Form */}
                  {showCreateForm && (
                    <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
                      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                        Create New Collection
                      </h3>

                      {error && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                          <p className="text-red-300 text-sm">{error}</p>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                            Collection Name *
                          </label>
                          <input
                            type="text"
                            value={newCollection.name}
                            onChange={(e) =>
                              setNewCollection({
                                ...newCollection,
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
                            value={newCollection.description}
                            onChange={(e) =>
                              setNewCollection({
                                ...newCollection,
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
                            checked={newCollection.isEncrypted}
                            onChange={(e) =>
                              setNewCollection({
                                ...newCollection,
                                isEncrypted: e.target.checked,
                              })
                            }
                            className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                          />
                          <span className="text-[var(--color-textSecondary)]">
                            Encrypt this collection
                          </span>
                        </label>

                        {newCollection.isEncrypted && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                                Password *
                              </label>
                              <PasswordInput
                                value={newCollection.password}
                                onChange={(e) =>
                                  setNewCollection({
                                    ...newCollection,
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
                                value={newCollection.confirmPassword}
                                onChange={(e) =>
                                  setNewCollection({
                                    ...newCollection,
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
                              setShowCreateForm(false);
                              setError("");
                            }}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleCreateCollection}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Create Collection
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Password Dialog */}
                  {showPasswordDialog && selectedCollection && (
                    <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
                      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                        Unlock Collection: {selectedCollection.name}
                      </h3>

                      {error && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                          <p className="text-red-300 text-sm">{error}</p>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                            Password
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              onKeyPress={(e) =>
                                e.key === "Enter" && handlePasswordSubmit()
                              }
                              className="w-full px-3 py-2 pr-10 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                              placeholder="Enter collection password"
                              autoFocus
                            />
                            <button
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                            >
                              {showPassword ? (
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
                              setShowPasswordDialog(false);
                              setError("");
                            }}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handlePasswordSubmit}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Unlock
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Export Collection Form */}
                  {exportingCollection && (
                    <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
                      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                        Export Collection: {exportingCollection.name}
                      </h3>

                      {error && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                          <p className="text-red-300 text-sm">{error}</p>
                        </div>
                      )}

                      <div className="space-y-4">
                        {exportingCollection.isEncrypted && (
                          <div>
                            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                              Collection Password
                            </label>
                            <input
                              type={showPassword ? "text" : "password"}
                              value={collectionPassword}
                              onChange={(e) =>
                                setCollectionPassword(e.target.value)
                              }
                              className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                              placeholder="Password"
                            />
                          </div>
                        )}

                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={includePasswords}
                            onChange={(e) =>
                              setIncludePasswords(e.target.checked)
                            }
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
                            type={showPassword ? "text" : "password"}
                            value={exportPassword}
                            onChange={(e) => setExportPassword(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                            placeholder="Encrypt export"
                          />
                        </div>

                        <div className="flex justify-end space-x-3">
                          <button
                            onClick={() => {
                              setExportingCollection(null);
                              setError("");
                            }}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleExportDownload}
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
                  {showImportForm && (
                    <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
                      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                        Import Collection
                      </h3>

                      {error && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                          <p className="text-red-300 text-sm">{error}</p>
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
                              setImportFile(e.target.files?.[0] ?? null)
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
                            value={importCollectionName}
                            onChange={(e) =>
                              setImportCollectionName(e.target.value)
                            }
                            className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                            placeholder="Leave blank to use the export name"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                            Import Password (if encrypted)
                          </label>
                          <input
                            type={showPassword ? "text" : "password"}
                            value={importPassword}
                            onChange={(e) => setImportPassword(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                            placeholder="Password"
                          />
                        </div>

                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={encryptImport}
                            onChange={(e) => setEncryptImport(e.target.checked)}
                            className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                          />
                          <span className="text-[var(--color-textSecondary)]">
                            Encrypt imported collection
                          </span>
                        </label>

                        {encryptImport && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                                New Password
                              </label>
                              <input
                                type={showPassword ? "text" : "password"}
                                value={importEncryptPassword}
                                onChange={(e) =>
                                  setImportEncryptPassword(e.target.value)
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
                                type={showPassword ? "text" : "password"}
                                value={importEncryptConfirmPassword}
                                onChange={(e) =>
                                  setImportEncryptConfirmPassword(
                                    e.target.value,
                                  )
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
                              setShowImportForm(false);
                              setError("");
                            }}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleImportCollection}
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
                  {editingCollection && (
                    <div className="bg-[var(--color-border)] rounded-lg p-6 mb-6">
                      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                        Edit Collection
                      </h3>

                      {error && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                          <p className="text-red-300 text-sm">{error}</p>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                            Collection Name *
                          </label>
                          <input
                            type="text"
                            value={editingCollection.name}
                            onChange={(e) =>
                              setEditingCollection({
                                ...editingCollection,
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
                            value={editingCollection.description || ""}
                            onChange={(e) =>
                              setEditingCollection({
                                ...editingCollection,
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
                            checked={editPassword.enableEncryption}
                            onChange={(e) =>
                              setEditPassword((prev) => ({
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

                        {(editingCollection.isEncrypted ||
                          editPassword.enableEncryption) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                                Current Password
                              </label>
                              <input
                                type={showPassword ? "text" : "password"}
                                value={editPassword.current}
                                onChange={(e) =>
                                  setEditPassword((prev) => ({
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
                                type={showPassword ? "text" : "password"}
                                value={editPassword.next}
                                onChange={(e) =>
                                  setEditPassword((prev) => ({
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
                                type={showPassword ? "text" : "password"}
                                value={editPassword.confirm}
                                onChange={(e) =>
                                  setEditPassword((prev) => ({
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
                                onClick={() => setShowPassword(!showPassword)}
                                className="w-full px-3 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors flex items-center justify-center space-x-2"
                              >
                                {showPassword ? (
                                  <EyeOff size={16} />
                                ) : (
                                  <Eye size={16} />
                                )}
                                <span>{showPassword ? "Hide" : "Show"}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-end space-x-3">
                          <button
                            onClick={() => {
                              setEditingCollection(null);
                              setError("");
                            }}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleUpdateCollection}
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
                    {collections.length === 0 ? (
                      <div className="text-center py-12">
                        <Database
                          size={48}
                          className="mx-auto text-gray-500 mb-4"
                        />
                        <p className="text-[var(--color-textSecondary)] mb-2">
                          No collections found
                        </p>
                        <p className="text-gray-500 text-sm">
                          Create your first connection collection to get started
                        </p>
                      </div>
                    ) : (
                      collections.map((collection) => (
                        <div
                          key={collection.id}
                          className="bg-[var(--color-border)]/60 rounded-lg p-4 hover:bg-[var(--color-border)]/80 hover:shadow-lg hover:shadow-blue-500/5 border border-transparent hover:border-[var(--color-border)] transition-all duration-200 cursor-pointer group"
                          onClick={() => handleSelectCollection(collection)}
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
                                  handleExportCollection(collection);
                                }}
                                className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                                title="Export"
                              >
                                <Download size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditCollection(collection);
                                }}
                                className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteCollection(collection);
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
              )}

              {activeTab === "connections" && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-4">
                    <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
                      Connection Import / Export
                    </h3>
                    <p className="text-sm text-[var(--color-textSecondary)] mb-4">
                      Manage connection backups and transfers without leaving
                      the collection center.
                    </p>
                    <ImportExport isOpen onClose={() => undefined} embedded />
                  </div>
                </div>
              )}

              {activeTab === "proxies" && (
                <div className="space-y-6">
                  {/* Proxy Profiles Section */}
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-[var(--color-text)]">
                        Proxy Profiles
                      </h3>
                      <button
                        onClick={handleNewProfile}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
                      >
                        <Plus size={14} />
                        New Profile
                      </button>
                    </div>
                    <p className="text-sm text-[var(--color-textSecondary)] mb-4">
                      Create and manage reusable proxy configurations that can
                      be used across connections and chains.
                    </p>

                    {/* Search */}
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
                      <input
                        type="text"
                        value={profileSearch}
                        onChange={(e) => setProfileSearch(e.target.value)}
                        placeholder="Search profiles..."
                        className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* Profile List */}
                    <div className="space-y-2">
                      {filteredProfiles.length === 0 ? (
                        <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
                          {profileSearch
                            ? "No profiles match your search."
                            : 'No proxy profiles saved. Click "New Profile" to create one.'}
                        </div>
                      ) : (
                        filteredProfiles.map((profile) => (
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
                                onClick={() =>
                                  handleDuplicateProfile(profile.id)
                                }
                                className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                                title="Duplicate"
                              >
                                <Copy size={14} />
                              </button>
                              <button
                                onClick={() => handleEditProfile(profile)}
                                className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                                title="Edit"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteProfile(profile.id)}
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
                        onClick={handleNewChain}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
                      >
                        <Plus size={14} />
                        New Chain
                      </button>
                    </div>
                    <p className="text-sm text-[var(--color-textSecondary)] mb-4">
                      Create reusable proxy chains that route traffic through
                      multiple layers.
                    </p>

                    {/* Search */}
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
                      <input
                        type="text"
                        value={chainSearch}
                        onChange={(e) => setChainSearch(e.target.value)}
                        placeholder="Search chains..."
                        className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* Chain List */}
                    <div className="space-y-2">
                      {filteredChains.length === 0 ? (
                        <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
                          {chainSearch
                            ? "No chains match your search."
                            : 'No proxy chains saved. Click "New Chain" to create one.'}
                        </div>
                      ) : (
                        filteredChains.map((chain) => (
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
                                    ? savedProfiles.find(
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
                                onClick={() => handleDuplicateChain(chain.id)}
                                className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                                title="Duplicate"
                              >
                                <Copy size={14} />
                              </button>
                              <button
                                onClick={() => handleEditChain(chain)}
                                className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                                title="Edit"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteChain(chain.id)}
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
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Proxy Profile Editor Dialog */}
      <ProxyProfileEditor
        isOpen={showProfileEditor}
        onClose={() => {
          setShowProfileEditor(false);
          setEditingProfile(null);
        }}
        onSave={handleSaveProfile}
        editingProfile={editingProfile}
      />

      {/* Proxy Chain Editor Dialog */}
      <ProxyChainEditor
        isOpen={showChainEditor}
        onClose={() => {
          setShowChainEditor(false);
          setEditingChain(null);
        }}
        onSave={handleSaveChain}
        editingChain={editingChain}
      />
    </Modal>
  );
};
