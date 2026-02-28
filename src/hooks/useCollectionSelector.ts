import { useState, useCallback, useEffect } from "react";
import { ConnectionCollection } from "../types/connection";
import { SavedProxyProfile, SavedProxyChain } from "../types/settings";
import { CollectionManager } from "../utils/collectionManager";
import { proxyCollectionManager } from "../utils/proxyCollectionManager";

// ─── Types ─────────────────────────────────────────────────────────

export interface NewCollectionForm {
  name: string;
  description: string;
  isEncrypted: boolean;
  password: string;
  confirmPassword: string;
}

export interface EditPasswordForm {
  current: string;
  next: string;
  confirm: string;
  enableEncryption: boolean;
}

const EMPTY_NEW_COLLECTION: NewCollectionForm = {
  name: "",
  description: "",
  isEncrypted: false,
  password: "",
  confirmPassword: "",
};

// ─── Hook ──────────────────────────────────────────────────────────

export function useCollectionSelector(
  isOpen: boolean,
  onCollectionSelect: (collectionId: string, password?: string) => void,
) {
  const collectionManager = CollectionManager.getInstance();

  // Collections
  const [collections, setCollections] = useState<ConnectionCollection[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] =
    useState<ConnectionCollection | null>(null);
  const [newCollection, setNewCollection] =
    useState<NewCollectionForm>(EMPTY_NEW_COLLECTION);
  const [editingCollection, setEditingCollection] =
    useState<ConnectionCollection | null>(null);
  const [editPassword, setEditPassword] = useState<EditPasswordForm>({
    current: "",
    next: "",
    confirm: "",
    enableEncryption: false,
  });

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importCollectionName, setImportCollectionName] = useState("");
  const [encryptImport, setEncryptImport] = useState(false);
  const [importEncryptPassword, setImportEncryptPassword] = useState("");
  const [importEncryptConfirmPassword, setImportEncryptConfirmPassword] =
    useState("");

  // Export state
  const [exportingCollection, setExportingCollection] =
    useState<ConnectionCollection | null>(null);
  const [includePasswords, setIncludePasswords] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [collectionPassword, setCollectionPassword] = useState("");

  // Password unlock
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Shared UI state
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "collections" | "connections" | "proxies"
  >("collections");

  // Proxy/VPN profiles
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

  // ─── Data loading ───────────────────────────────────────────────

  const loadCollections = useCallback(async () => {
    const allCollections = await collectionManager.getAllCollections();
    setCollections(allCollections);
  }, [collectionManager]);

  useEffect(() => {
    if (isOpen) {
      loadCollections();
      setSavedProfiles(proxyCollectionManager.getProfiles());
      setSavedChains(proxyCollectionManager.getChains());
    }
  }, [isOpen, loadCollections]);

  // ─── Collection CRUD ────────────────────────────────────────────

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
      setNewCollection(EMPTY_NEW_COLLECTION);
      setError("");
      onCollectionSelect(collection.id, newCollection.password || undefined);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create collection",
      );
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

  // ─── Collection Selection ──────────────────────────────────────

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
    } catch {
      setError("Invalid password");
    }
  };

  // ─── Import / Export ───────────────────────────────────────────

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

  // ─── Proxy Profile handlers ────────────────────────────────────

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

  // ─── Proxy Chain handlers ─────────────────────────────────────

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

  // ─── Derived data ─────────────────────────────────────────────

  const filteredProfiles = profileSearch.trim()
    ? proxyCollectionManager.searchProfiles(profileSearch)
    : savedProfiles;

  const filteredChains = chainSearch.trim()
    ? proxyCollectionManager.searchChains(chainSearch)
    : savedChains;

  // ─── Dialog closers ───────────────────────────────────────────

  const closeProfileEditor = () => {
    setShowProfileEditor(false);
    setEditingProfile(null);
  };

  const closeChainEditor = () => {
    setShowChainEditor(false);
    setEditingChain(null);
  };

  return {
    // Collections
    collections,
    showCreateForm,
    setShowCreateForm,
    showImportForm,
    setShowImportForm,
    showPasswordDialog,
    setShowPasswordDialog,
    selectedCollection,
    newCollection,
    setNewCollection,
    editingCollection,
    setEditingCollection,
    editPassword,
    setEditPassword,
    loadCollections,
    handleCreateCollection,
    handleDeleteCollection,
    handleEditCollection,
    handleUpdateCollection,
    handleSelectCollection,
    handlePasswordSubmit,

    // Import
    importFile,
    setImportFile,
    importPassword,
    setImportPassword,
    importCollectionName,
    setImportCollectionName,
    encryptImport,
    setEncryptImport,
    importEncryptPassword,
    setImportEncryptPassword,
    importEncryptConfirmPassword,
    setImportEncryptConfirmPassword,
    handleImportCollection,

    // Export
    exportingCollection,
    setExportingCollection,
    includePasswords,
    setIncludePasswords,
    exportPassword,
    setExportPassword,
    collectionPassword,
    setCollectionPassword,
    handleExportCollection,
    handleExportDownload,

    // Password
    password,
    setPassword,
    showPassword,
    setShowPassword,

    // UI
    error,
    setError,
    activeTab,
    setActiveTab,

    // Proxy profiles
    savedProfiles,
    savedChains,
    profileSearch,
    setProfileSearch,
    chainSearch,
    setChainSearch,
    filteredProfiles,
    filteredChains,
    showProfileEditor,
    editingProfile,
    showChainEditor,
    editingChain,
    handleNewProfile,
    handleEditProfile,
    handleSaveProfile,
    handleDeleteProfile,
    handleDuplicateProfile,
    handleNewChain,
    handleEditChain,
    handleSaveChain,
    handleDeleteChain,
    handleDuplicateChain,
    handleExportProxies,
    handleImportProxies,
    closeProfileEditor,
    closeChainEditor,
  };
}
