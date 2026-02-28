import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

export interface SSHKey {
  id: string;
  name: string;
  type: "ed25519" | "rsa";
  publicKey: string;
  privateKeyPath: string;
  fingerprint: string;
  createdAt: Date;
  hasPassphrase: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const getKeysDirectory = async (): Promise<string> => {
  const appData = await appDataDir();
  const keysDir = await join(appData, "ssh-keys");
  if (!(await exists(keysDir))) {
    await mkdir(keysDir, { recursive: true });
  }
  return keysDir;
};

const calculateFingerprint = (publicKey: string): string => {
  const hash = publicKey
    .split("")
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `SHA256:${hex.substring(0, 2)}:${hex.substring(2, 4)}:${hex.substring(4, 6)}:${hex.substring(6, 8)}`;
};

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useSSHKeyManager(
  isOpen: boolean,
  onClose: () => void,
  onSelectKey?: (keyPath: string) => void,
) {
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Generate form state
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyType, setNewKeyType] = useState<"ed25519" | "rsa">("ed25519");
  const [newKeyPassphrase, setNewKeyPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [generating, setGenerating] = useState(false);

  /* ---- persistence ---- */
  const saveKeysMetadata = useCallback(async (keysToSave: SSHKey[]) => {
    const keysDir = await getKeysDirectory();
    const metadataPath = await join(keysDir, "keys.json");
    await writeTextFile(metadataPath, JSON.stringify(keysToSave, null, 2));
  }, []);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const keysDir = await getKeysDirectory();
      const metadataPath = await join(keysDir, "keys.json");

      if (await exists(metadataPath)) {
        const content = await readTextFile(metadataPath);
        const savedKeys = JSON.parse(content) as SSHKey[];

        const validKeys: SSHKey[] = [];
        for (const key of savedKeys) {
          if (await exists(key.privateKeyPath)) {
            validKeys.push({
              ...key,
              createdAt: new Date(key.createdAt),
            });
          }
        }
        setKeys(validKeys);
      } else {
        setKeys([]);
      }
    } catch (err) {
      setError(`Failed to load SSH keys: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadKeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* ---- generate to file ---- */
  const handleGenerateToFile = useCallback(async () => {
    setGenerating(true);
    setError(null);

    try {
      const selectedPath = await save({
        title: "Save SSH Private Key",
        defaultPath: "id_ed25519",
        filters: [
          { name: "SSH Key", extensions: [""] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!selectedPath) {
        setGenerating(false);
        return;
      }

      const [privateKey, publicKey] = await invoke<[string, string]>(
        "generate_ssh_key",
        { keyType: "ed25519", bits: undefined, passphrase: undefined },
      );

      await writeTextFile(selectedPath, privateKey);
      await writeTextFile(`${selectedPath}.pub`, publicKey);

      setError(`Key saved to: ${selectedPath}`);
      setTimeout(() => setError(null), 3000);
    } catch (err) {
      setError(`Failed to generate key: ${err}`);
    } finally {
      setGenerating(false);
    }
  }, []);

  /* ---- generate key (managed) ---- */
  const handleGenerateKey = useCallback(async () => {
    if (!newKeyName.trim()) {
      setError("Key name is required");
      return;
    }

    if (newKeyPassphrase && newKeyPassphrase !== confirmPassphrase) {
      setError("Passphrases do not match");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const [privateKey, publicKey] = await invoke<[string, string]>(
        "generate_ssh_key",
        {
          keyType: newKeyType,
          bits: newKeyType === "rsa" ? 4096 : undefined,
          passphrase: newKeyPassphrase || undefined,
        },
      );

      const keysDir = await getKeysDirectory();
      const sanitizedName = newKeyName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const privateKeyPath = await join(keysDir, `${sanitizedName}`);
      const publicKeyPath = await join(keysDir, `${sanitizedName}.pub`);

      await writeTextFile(privateKeyPath, privateKey);
      await writeTextFile(publicKeyPath, publicKey);

      const newKey: SSHKey = {
        id: crypto.randomUUID(),
        name: newKeyName,
        type: newKeyType,
        publicKey,
        privateKeyPath,
        fingerprint: calculateFingerprint(publicKey),
        createdAt: new Date(),
        hasPassphrase: !!newKeyPassphrase,
      };

      const updatedKeys = [...keys, newKey];
      setKeys(updatedKeys);
      await saveKeysMetadata(updatedKeys);

      // Reset form
      setShowGenerateForm(false);
      setNewKeyName("");
      setNewKeyType("ed25519");
      setNewKeyPassphrase("");
      setConfirmPassphrase("");
    } catch (err) {
      setError(`Failed to generate key: ${err}`);
    } finally {
      setGenerating(false);
    }
  }, [
    newKeyName,
    newKeyType,
    newKeyPassphrase,
    confirmPassphrase,
    keys,
    saveKeysMetadata,
  ]);

  /* ---- import ---- */
  const handleImportKey = useCallback(async () => {
    try {
      const filePath = await open({
        title: "Select SSH Private Key",
        filters: [{ name: "All Files", extensions: ["*"] }],
      });

      if (!filePath) return;

      const privateKey = await readTextFile(filePath as string);

      let publicKey = "";
      const pubKeyPath = `${filePath}.pub`;
      if (await exists(pubKeyPath)) {
        publicKey = await readTextFile(pubKeyPath);
      } else {
        publicKey = "(Public key not available)";
      }

      const isValid = await invoke<boolean>("validate_ssh_key_file", {
        keyPath: filePath,
        passphrase: null,
      });

      if (!isValid) {
        // Key might need passphrase - import anyway
      }

      const keysDir = await getKeysDirectory();
      const fileName =
        (filePath as string).split(/[\\/]/).pop() || "imported_key";
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const newPrivateKeyPath = await join(keysDir, sanitizedName);
      const newPublicKeyPath = await join(keysDir, `${sanitizedName}.pub`);

      await writeTextFile(newPrivateKeyPath, privateKey);
      if (publicKey && publicKey !== "(Public key not available)") {
        await writeTextFile(newPublicKeyPath, publicKey);
      }

      let keyType: "ed25519" | "rsa" = "ed25519";
      if (privateKey.includes("RSA") || privateKey.includes("rsa")) {
        keyType = "rsa";
      }

      const newKey: SSHKey = {
        id: crypto.randomUUID(),
        name: sanitizedName,
        type: keyType,
        publicKey,
        privateKeyPath: newPrivateKeyPath,
        fingerprint:
          publicKey !== "(Public key not available)"
            ? calculateFingerprint(publicKey)
            : "Unknown",
        createdAt: new Date(),
        hasPassphrase: !isValid,
      };

      const updatedKeys = [...keys, newKey];
      setKeys(updatedKeys);
      await saveKeysMetadata(updatedKeys);
    } catch (err) {
      setError(`Failed to import key: ${err}`);
    }
  }, [keys, saveKeysMetadata]);

  /* ---- export ---- */
  const handleExportKey = useCallback(async (key: SSHKey) => {
    try {
      const filePath = await save({
        title: "Export SSH Key",
        defaultPath: key.name,
      });

      if (!filePath) return;

      const privateKey = await readTextFile(key.privateKeyPath);
      await writeTextFile(filePath, privateKey);

      if (key.publicKey && key.publicKey !== "(Public key not available)") {
        await writeTextFile(`${filePath}.pub`, key.publicKey);
      }
    } catch (err) {
      setError(`Failed to export key: ${err}`);
    }
  }, []);

  /* ---- delete ---- */
  const handleDeleteKey = useCallback(
    async (key: SSHKey) => {
      if (!confirm(`Are you sure you want to delete the key "${key.name}"?`)) {
        return;
      }

      try {
        if (await exists(key.privateKeyPath)) {
          await remove(key.privateKeyPath);
        }
        const pubKeyPath = `${key.privateKeyPath}.pub`;
        if (await exists(pubKeyPath)) {
          await remove(pubKeyPath);
        }

        const updatedKeys = keys.filter((k) => k.id !== key.id);
        setKeys(updatedKeys);
        await saveKeysMetadata(updatedKeys);
      } catch (err) {
        setError(`Failed to delete key: ${err}`);
      }
    },
    [keys, saveKeysMetadata],
  );

  /* ---- copy public key ---- */
  const handleCopyPublicKey = useCallback(async (key: SSHKey) => {
    try {
      await navigator.clipboard.writeText(key.publicKey);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setError(`Failed to copy: ${err}`);
    }
  }, []);

  /* ---- select key ---- */
  const handleSelectKey = useCallback(
    (key: SSHKey) => {
      if (onSelectKey) {
        onSelectKey(key.privateKeyPath);
        onClose();
      }
    },
    [onSelectKey, onClose],
  );

  /* ---- form reset ---- */
  const resetGenerateForm = useCallback(() => {
    setShowGenerateForm(false);
    setNewKeyName("");
    setNewKeyPassphrase("");
    setConfirmPassphrase("");
  }, []);

  return {
    /* keys */
    keys,
    loading,
    error,
    setError,

    /* generate form */
    showGenerateForm,
    setShowGenerateForm,
    newKeyName,
    setNewKeyName,
    newKeyType,
    setNewKeyType,
    newKeyPassphrase,
    setNewKeyPassphrase,
    confirmPassphrase,
    setConfirmPassphrase,
    generating,
    resetGenerateForm,

    /* visibility */
    showPrivateKey,
    setShowPrivateKey,
    copiedId,

    /* actions */
    loadKeys,
    handleGenerateToFile,
    handleGenerateKey,
    handleImportKey,
    handleExportKey,
    handleDeleteKey,
    handleCopyPublicKey,
    handleSelectKey,
    hasOnSelectKey: !!onSelectKey,
  };
}
