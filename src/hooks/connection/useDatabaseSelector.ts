import { useState, useCallback, useEffect } from "react";
import { ConnectionDatabase } from "../../types/connection/connection";
import { defaultExportSecuritySettings, SavedProxyProfile, SavedProxyChain } from "../../types/settings/settings";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { proxyCollectionManager } from "../../utils/connection/proxyCollectionManager";
import { InvalidPasswordError } from "../../utils/core/errors";
import { useConnections } from "../../contexts/useConnections";
import { useTranslation } from "react-i18next";

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

type PasswordDialogMode = "unlock" | "clone";

interface CollectionActionMenuState {
  collection: ConnectionDatabase;
  position: {
    x: number;
    y: number;
  };
}

function getCollectionActionError(
  error: unknown,
  fallbackMessage: string,
  invalidPasswordMessage: string,
): string {
  if (error instanceof InvalidPasswordError) {
    return invalidPasswordMessage;
  }

  return error instanceof Error ? error.message : fallbackMessage;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useDatabaseSelector(
  isOpen: boolean,
  onDatabaseSelect: (
    collectionId: string,
    password?: string,
  ) => Promise<void> | void,
  /**
   * Called when the user closes the currently-open database via the
   * row's close button. Lets the host clear connection state, drop
   * the auto-open-last-collection pointer, and re-show the picker.
   * No-op when omitted (used in tests / inline contexts that don't
   * need to react).
   */
  onDatabaseClose?: () => Promise<void> | void,
) {
  const databaseManager = DatabaseManager.getInstance();
  const { saveData } = useConnections();
  const { t } = useTranslation();

  // Collections
  const [collections, setCollections] = useState<ConnectionDatabase[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] =
    useState<ConnectionDatabase | null>(null);
  const [passwordDialogMode, setPasswordDialogMode] =
    useState<PasswordDialogMode>("unlock");
  const [newCollection, setNewCollection] =
    useState<NewCollectionForm>(EMPTY_NEW_COLLECTION);
  const [editingCollection, setEditingCollection] =
    useState<ConnectionDatabase | null>(null);
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
    useState<ConnectionDatabase | null>(null);
  const [includePasswords, setIncludePasswords] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [collectionPassword, setCollectionPassword] = useState("");

  // Password unlock
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [collectionMenu, setCollectionMenu] =
    useState<CollectionActionMenuState | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [highlightedCollectionId, setHighlightedCollectionId] = useState<
    string | null
  >(null);

  // Shared UI state
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "collections" | "proxies"
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

  const loadDatabases = useCallback(async () => {
    const allCollections = await databaseManager.getAllDatabases();
    setCollections(allCollections);
  }, [databaseManager]);

  useEffect(() => {
    if (isOpen) {
      loadDatabases();
      setSavedProfiles(proxyCollectionManager.getProfiles());
      setSavedChains(proxyCollectionManager.getChains());
    }
  }, [isOpen, loadDatabases]);

  useEffect(() => {
    if (!highlightedCollectionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedCollectionId(null);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [highlightedCollectionId]);

  const closePasswordDialog = useCallback(() => {
    setShowPasswordDialog(false);
    setSelectedCollection(null);
    setPassword("");
    setPasswordDialogMode("unlock");
  }, []);

  const openCollectionMenu = useCallback(
    (
      collection: ConnectionDatabase,
      position: CollectionActionMenuState["position"],
    ) => {
      setCollectionMenu({ collection, position });
      setError("");
    },
    [],
  );

  const closeCollectionMenu = useCallback(() => {
    setCollectionMenu(null);
  }, []);

  // ─── Collection CRUD ────────────────────────────────────────────

  const handleCreateCollection = async () => {
    if (!newCollection.name.trim()) {
      setError(t("databaseCenter.collections.errors.nameRequired"));
      return;
    }
    if (newCollection.isEncrypted) {
      if (!newCollection.password) {
        setError(
          t("databaseCenter.collections.errors.passwordRequiredForEncrypted"),
        );
        return;
      }
      if (newCollection.password !== newCollection.confirmPassword) {
        setError(t("databaseCenter.collections.errors.passwordsDoNotMatch"));
        return;
      }
      if (newCollection.password.length < 4) {
        setError(t("databaseCenter.collections.errors.passwordTooShort"));
        return;
      }
    }

    try {
      const collection = await databaseManager.createDatabase(
        newCollection.name,
        newCollection.description,
        newCollection.isEncrypted,
        newCollection.password || undefined,
      );
      setCollections((currentCollections) => [...currentCollections, collection]);
      setShowCreateForm(false);
      setNewCollection(EMPTY_NEW_COLLECTION);
      setError("");
      await Promise.resolve(
        onDatabaseSelect(collection.id, newCollection.password || undefined),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("databaseCenter.collections.errors.createFailed"),
      );
    }
  };

  const handleDeleteCollection = async (collection: ConnectionDatabase) => {
    if (
      confirm(
        t("databaseCenter.collections.deleteConfirm", {
          name: collection.name,
        }),
      )
    ) {
      try {
        closeCollectionMenu();
        await databaseManager.deleteDatabase(collection.id);
        setCollections(collections.filter((c) => c.id !== collection.id));
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : t("databaseCenter.collections.errors.deleteFailed"),
        );
      }
    }
  };

  const handleEditCollection = (collection: ConnectionDatabase) => {
    closeCollectionMenu();
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
      setError(t("databaseCenter.collections.errors.nameRequired"));
      return;
    }

    const wantsEncryption = editPassword.enableEncryption;
    const wantsPasswordChange = Boolean(editPassword.next);

    if (wantsEncryption) {
      if (!editingCollection.isEncrypted && !wantsPasswordChange) {
        setError(
          t("databaseCenter.collections.errors.passwordRequiredToEncrypt"),
        );
        return;
      }
      if (wantsPasswordChange) {
        if (editPassword.next !== editPassword.confirm) {
          setError(
            t("databaseCenter.collections.errors.newPasswordsDoNotMatch"),
          );
          return;
        }
        if (editPassword.next.length < 4) {
          setError(t("databaseCenter.collections.errors.passwordTooShort"));
          return;
        }
        if (editingCollection.isEncrypted && !editPassword.current) {
          setError(
            t("databaseCenter.collections.errors.currentPasswordRequired"),
          );
          return;
        }
      }
    } else if (editingCollection.isEncrypted && !editPassword.current) {
      setError(
        t(
          "databaseCenter.collections.errors.currentPasswordRequiredToRemoveEncryption",
        ),
      );
      return;
    }

    try {
      let updatedCollection = {
        ...editingCollection,
        isEncrypted: wantsEncryption,
      };

      if (editingCollection.isEncrypted && !wantsEncryption) {
        await databaseManager.removePasswordFromDatabase(
          editingCollection.id,
          editPassword.current,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: false };
      }

      if (wantsEncryption && wantsPasswordChange) {
        await databaseManager.changeDatabasePassword(
          editingCollection.id,
          editingCollection.isEncrypted ? editPassword.current : undefined,
          editPassword.next,
        );
        updatedCollection = { ...updatedCollection, isEncrypted: true };
      }

      await databaseManager.updateDatabase(updatedCollection);
      setCollections(
        collections.map((c) =>
          c.id === editingCollection.id ? updatedCollection : c,
        ),
      );
      setEditingCollection(null);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("databaseCenter.collections.errors.updateFailed"),
      );
    }
  };

  const runCloneCollection = useCallback(
    async (
      collection: ConnectionDatabase,
      sourcePassword?: string,
    ): Promise<ConnectionDatabase> => {
      setIsWorking(true);
      try {
        if (databaseManager.getCurrentDatabase()?.id === collection.id) {
          await saveData();
        }

        const duplicate = await databaseManager.duplicateDatabase(collection.id, {
          password: sourcePassword,
        });
        await loadDatabases();
        setHighlightedCollectionId(duplicate.id);
        setError("");
        closePasswordDialog();
        closeCollectionMenu();
        return duplicate;
      } catch (error) {
        setError(
          getCollectionActionError(
            error,
            t("databaseCenter.collections.errors.cloneFailed"),
            t("databaseCenter.collections.errors.invalidPassword"),
          ),
        );
        throw error;
      } finally {
        setIsWorking(false);
      }
    },
    [
      closeCollectionMenu,
      closePasswordDialog,
      databaseManager,
      loadDatabases,
      saveData,
      t,
    ],
  );

  const handleCloneCollection = useCallback(
    async (collection: ConnectionDatabase) => {
      const isCurrentEncryptedCollection =
        collection.isEncrypted &&
        databaseManager.getCurrentDatabase()?.id === collection.id;

      if (collection.isEncrypted && !isCurrentEncryptedCollection) {
        closeCollectionMenu();
        setSelectedCollection(collection);
        setPassword("");
        setPasswordDialogMode("clone");
        setShowPasswordDialog(true);
        setError("");
        return;
      }

      await runCloneCollection(collection);
    },
    [closeCollectionMenu, databaseManager, runCloneCollection],
  );

  // ─── Collection Selection ──────────────────────────────────────

  const handleSelectCollection = async (collection: ConnectionDatabase) => {
    closeCollectionMenu();
    setError("");

    if (collection.isEncrypted) {
      setSelectedCollection(collection);
      setPasswordDialogMode("unlock");
      setShowPasswordDialog(true);
      setPassword("");
    } else {
      await Promise.resolve(onDatabaseSelect(collection.id));
    }
  };

  /**
   * Inverse of `handleSelectCollection`. Used by the per-row close
   * button when the row is the currently-open database (closes +
   * locks) or when it's an encrypted-but-unlocked side row (locks
   * only). Triggers `onDatabaseClose` so the host can clear its
   * connection panel / auto-open setting.
   */
  const handleCloseCollection = useCallback(
    async (collection: ConnectionDatabase) => {
      closeCollectionMenu();
      setError("");

      const currentId = databaseManager.getCurrentDatabase()?.id;
      const isCurrent = currentId === collection.id;

      if (isCurrent) {
        // Flush any pending edits BEFORE detaching the manager —
        // ConnectionProvider's debouncer runs on a 500ms timer and
        // would throw "No collection selected" if it fires after
        // closeCurrentDatabase nulls the manager. saveData() is
        // a no-op when nothing changed, so this is safe to call
        // unconditionally.
        try {
          await saveData();
        } catch (error) {
          console.error("Failed to flush pending edits before close:", error);
        }
        databaseManager.closeCurrentDatabase();
        await Promise.resolve(onDatabaseClose?.());
      } else if (collection.isEncrypted) {
        databaseManager.lockDatabase(collection.id);
      }

      // Refresh so any `isCurrent`/`isUnlocked` consumers in the row
      // re-render against the new state.
      await loadDatabases();
    },
    [closeCollectionMenu, databaseManager, loadDatabases, onDatabaseClose, saveData],
  );

  const handlePasswordSubmit = async () => {
    if (!selectedCollection) return;

    setIsWorking(true);
    try {
      if (passwordDialogMode === "clone") {
        await runCloneCollection(selectedCollection, password);
        return;
      }

      await databaseManager.loadDatabaseData(selectedCollection.id, password);
      await Promise.resolve(onDatabaseSelect(selectedCollection.id, password));
      closePasswordDialog();
      setError("");
    } catch (error) {
      setError(
        getCollectionActionError(
          error,
          t("databaseCenter.collections.errors.accessFailed"),
          t("databaseCenter.collections.errors.invalidPassword"),
        ),
      );
    } finally {
      setIsWorking(false);
    }
  };

  // ─── Import / Export ───────────────────────────────────────────

  const handleImportCollection = async () => {
    if (!importFile) {
      setError(t("databaseCenter.collections.errors.fileRequired"));
      return;
    }
    if (encryptImport) {
      if (!importEncryptPassword) {
        setError(
          t("databaseCenter.collections.errors.passwordRequiredToEncryptImport"),
        );
        return;
      }
      if (importEncryptPassword !== importEncryptConfirmPassword) {
        setError(
          t(
            "databaseCenter.collections.errors.encryptionPasswordsDoNotMatch",
          ),
        );
        return;
      }
    }

    try {
      const content = await importFile.text();
      const collection = await databaseManager.importDatabase(content, {
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
        error instanceof Error
          ? error.message
          : t("databaseCenter.collections.errors.importFailed"),
      );
    }
  };

  const handleExportCollection = (collection: ConnectionDatabase) => {
    setExportingCollection(collection);
    setIncludePasswords(false);
    setExportPassword("");
    setCollectionPassword("");
    setError("");
  };

  const handleExportDownload = async () => {
    if (!exportingCollection) return;
    try {
      const content = await databaseManager.exportDatabase(
        exportingCollection.id,
        includePasswords,
        exportPassword || undefined,
        collectionPassword || undefined,
        {
          iterations:
            SettingsManager.getInstance().getSettings().exportSecurity
              ?.keyDerivationIterations ??
            defaultExportSecuritySettings.keyDerivationIterations,
        },
      );
      const filename = databaseManager.generateExportFilename();
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
        error instanceof Error
          ? error.message
          : t("databaseCenter.collections.errors.exportFailed"),
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
    if (confirm(t("databaseCenter.proxies.deleteProfileConfirm"))) {
      try {
        await proxyCollectionManager.deleteProfile(profileId);
        setSavedProfiles(proxyCollectionManager.getProfiles());
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : t("databaseCenter.proxies.deleteProfileFailed"),
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
    if (confirm(t("databaseCenter.proxies.deleteChainConfirm"))) {
      try {
        await proxyCollectionManager.deleteChain(chainId);
        setSavedChains(proxyCollectionManager.getChains());
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : t("databaseCenter.proxies.deleteChainFailed"),
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
            t("databaseCenter.proxies.importFailed", {
              message: error instanceof Error
                ? error.message
                : t("databaseCenter.proxies.unknownError"),
            }),
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

  // The row UI needs to know whether a given collection is the
  // currently-open one and (for encrypted rows) whether its password
  // is cached, so it can decide whether to render a close/lock button.
  // The manager is a singleton — these read straight from it on each
  // render. Re-renders triggered by `collections` (after open/close)
  // pick up the new value naturally.
  const isCurrentDatabase = (id: string) =>
    databaseManager.getCurrentDatabase()?.id === id;
  const isDatabaseUnlocked = (id: string) =>
    databaseManager.isDatabaseUnlocked(id);

  return {
    // Collections
    collections,
    isCurrentDatabase,
    isDatabaseUnlocked,
    showCreateForm,
    setShowCreateForm,
    showImportForm,
    setShowImportForm,
    showPasswordDialog,
    closePasswordDialog,
    selectedCollection,
    passwordDialogMode,
    newCollection,
    setNewCollection,
    editingCollection,
    setEditingCollection,
    editPassword,
    setEditPassword,
    loadDatabases,
    handleCreateCollection,
    handleDeleteCollection,
    handleEditCollection,
    handleUpdateCollection,
    handleSelectCollection,
    handleCloseCollection,
    handleCloneCollection,
    handlePasswordSubmit,
    collectionMenu,
    openCollectionMenu,
    closeCollectionMenu,
    isWorking,
    highlightedCollectionId,

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