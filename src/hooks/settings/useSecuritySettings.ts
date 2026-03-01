import { useState, useMemo, useEffect } from "react";
import { GlobalSettings } from "../../types/settings";
import { SecureStorage } from "../../utils/storage";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

// ─── Static data ───────────────────────────────────────────────────

export const VALID_CIPHER_MODES: Record<
  string,
  { value: string; label: string }[]
> = {
  "AES-256-GCM": [{ value: "GCM", label: "GCM (Galois/Counter Mode)" }],
  "AES-256-CBC": [{ value: "CBC", label: "CBC (Cipher Block Chaining)" }],
  "ChaCha20-Poly1305": [],
  "Serpent-256-GCM": [{ value: "GCM", label: "GCM (Galois/Counter Mode)" }],
  "Serpent-256-CBC": [{ value: "CBC", label: "CBC (Cipher Block Chaining)" }],
  "Twofish-256-GCM": [{ value: "GCM", label: "GCM (Galois/Counter Mode)" }],
  "Twofish-256-CBC": [{ value: "CBC", label: "CBC (Cipher Block Chaining)" }],
};

export const ENCRYPTION_ALGORITHMS = [
  {
    value: "AES-256-GCM",
    label: "AES-256-GCM",
    description: "Industry standard, hardware accelerated",
    recommended: true,
  },
  {
    value: "AES-256-CBC",
    label: "AES-256-CBC",
    description: "Classic block cipher mode",
    recommended: false,
  },
  {
    value: "ChaCha20-Poly1305",
    label: "ChaCha20-Poly1305",
    description: "Modern stream cipher, mobile friendly",
    recommended: false,
  },
  {
    value: "Serpent-256-GCM",
    label: "Serpent-256-GCM",
    description: "AES finalist, high security margin",
    recommended: false,
  },
  {
    value: "Serpent-256-CBC",
    label: "Serpent-256-CBC",
    description: "Serpent with classic CBC mode",
    recommended: false,
  },
  {
    value: "Twofish-256-GCM",
    label: "Twofish-256-GCM",
    description: "AES finalist by Schneier, very fast",
    recommended: false,
  },
  {
    value: "Twofish-256-CBC",
    label: "Twofish-256-CBC",
    description: "Twofish with classic CBC mode",
    recommended: false,
  },
];

// ─── Hook ──────────────────────────────────────────────────────────

export function useSecuritySettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const [hasPassword, setHasPassword] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [keyGenSuccess, setKeyGenSuccess] = useState<string | null>(null);
  const [keyGenError, setKeyGenError] = useState<string | null>(null);
  const [keyType, setKeyType] = useState<"ed25519" | "rsa">("ed25519");

  const [isGeneratingCollectionKey, setIsGeneratingCollectionKey] =
    useState(false);
  const [collectionKeySuccess, setCollectionKeySuccess] = useState<
    string | null
  >(null);
  const [collectionKeyError, setCollectionKeyError] = useState<string | null>(
    null,
  );
  const [collectionKeyLength, setCollectionKeyLength] = useState<32 | 64>(32);

  const validModes = useMemo(() => {
    return VALID_CIPHER_MODES[settings.encryptionAlgorithm] || [];
  }, [settings.encryptionAlgorithm]);

  // Auto-update block cipher mode when algorithm changes
  useEffect(() => {
    const modes = VALID_CIPHER_MODES[settings.encryptionAlgorithm] || [];
    if (modes.length > 0) {
      const currentModeValid = modes.some(
        (m) => m.value === settings.blockCipherMode,
      );
      if (!currentModeValid) {
        updateSettings({ blockCipherMode: modes[0].value as any });
      }
    }
  }, [settings.encryptionAlgorithm, settings.blockCipherMode, updateSettings]);

  // Check storage encryption status
  useEffect(() => {
    let isMounted = true;
    SecureStorage.isStorageEncrypted()
      .then((encrypted) => {
        if (isMounted) setHasPassword(encrypted);
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);

  // ── SSH key generation ──

  const generateSSHKey = async () => {
    setIsGeneratingKey(true);
    setKeyGenError(null);
    setKeyGenSuccess(null);
    try {
      const selectedPath = await save({
        title: "Save SSH Private Key",
        defaultPath: keyType === "ed25519" ? "id_ed25519" : "id_rsa",
        filters: [
          { name: "SSH Key", extensions: [""] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!selectedPath) {
        setIsGeneratingKey(false);
        return;
      }
      const [privateKey, publicKey] = await invoke<[string, string]>(
        "generate_ssh_key",
        {
          keyType,
          bits: keyType === "rsa" ? 4096 : undefined,
          passphrase: undefined,
        },
      );
      await writeTextFile(selectedPath, privateKey);
      await writeTextFile(`${selectedPath}.pub`, publicKey);
      setKeyGenSuccess(`Key saved to: ${selectedPath}`);
      setTimeout(() => setKeyGenSuccess(null), 5000);
    } catch (err) {
      setKeyGenError(`Failed to generate key: ${err}`);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  // ── Collection key generation ──

  const generateCollectionKey = async () => {
    setIsGeneratingCollectionKey(true);
    setCollectionKeyError(null);
    setCollectionKeySuccess(null);
    try {
      const selectedPath = await save({
        title: "Save Collection Encryption Key",
        defaultPath: "collection.key",
        filters: [
          { name: "Key File", extensions: ["key"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!selectedPath) {
        setIsGeneratingCollectionKey(false);
        return;
      }

      const keyBytes = new Uint8Array(collectionKeyLength);
      crypto.getRandomValues(keyBytes);
      const keyBase64 = btoa(String.fromCharCode(...keyBytes));

      const keyFileContent = [
        "-----BEGIN SORTOFREMOTENG COLLECTION KEY-----",
        `Version: 1`,
        `Algorithm: AES-256`,
        `Bits: ${collectionKeyLength * 8}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        keyBase64,
        "-----END SORTOFREMOTENG COLLECTION KEY-----",
      ].join("\n");

      await writeTextFile(selectedPath, keyFileContent);
      setCollectionKeySuccess(`Key file saved to: ${selectedPath}`);
      setTimeout(() => setCollectionKeySuccess(null), 5000);
    } catch (err) {
      setCollectionKeyError(`Failed to generate key file: ${err}`);
    } finally {
      setIsGeneratingCollectionKey(false);
    }
  };

  return {
    hasPassword,
    validModes,

    // SSH key gen
    isGeneratingKey,
    keyGenSuccess,
    keyGenError,
    keyType,
    setKeyType,
    generateSSHKey,

    // Collection key gen
    isGeneratingCollectionKey,
    collectionKeySuccess,
    collectionKeyError,
    collectionKeyLength,
    setCollectionKeyLength,
    generateCollectionKey,
  };
}
