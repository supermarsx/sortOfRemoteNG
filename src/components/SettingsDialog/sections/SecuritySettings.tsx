import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../../types/settings';
import { SecureStorage } from '../../../utils/storage';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import {
  Shield,
  Lock,
  Key,
  Timer,
  Gauge,
  Clock,
  ShieldCheck,
  Loader2,
  FileKey,
  Download,
  CheckCircle,
  Database,
  Copy,
} from 'lucide-react';

interface SecuritySettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
}

// Valid block cipher modes for each encryption algorithm
const VALID_CIPHER_MODES: Record<string, { value: string; label: string }[]> = {
  'AES-256-GCM': [
    { value: 'GCM', label: 'GCM (Galois/Counter Mode)' },
  ],
  'AES-256-CBC': [
    { value: 'CBC', label: 'CBC (Cipher Block Chaining)' },
  ],
  'ChaCha20-Poly1305': [
    // ChaCha20-Poly1305 is a stream cipher with built-in AEAD, no block cipher mode needed
  ],
};

const ENCRYPTION_ALGORITHMS = [
  { value: 'AES-256-GCM', label: 'AES-256-GCM', description: 'Industry standard, hardware accelerated', recommended: true },
  { value: 'AES-256-CBC', label: 'AES-256-CBC', description: 'Classic block cipher mode', recommended: false },
  { value: 'ChaCha20-Poly1305', label: 'ChaCha20-Poly1305', description: 'Modern stream cipher, mobile friendly', recommended: false },
];

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
}) => {
  const { t } = useTranslation();
  const [hasPassword, setHasPassword] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [keyGenSuccess, setKeyGenSuccess] = useState<string | null>(null);
  const [keyGenError, setKeyGenError] = useState<string | null>(null);
  const [keyType, setKeyType] = useState<'ed25519' | 'rsa'>('ed25519');
  
  // Collection key file generation state
  const [isGeneratingCollectionKey, setIsGeneratingCollectionKey] = useState(false);
  const [collectionKeySuccess, setCollectionKeySuccess] = useState<string | null>(null);
  const [collectionKeyError, setCollectionKeyError] = useState<string | null>(null);
  const [collectionKeyLength, setCollectionKeyLength] = useState<32 | 64>(32);

  // Get valid modes for current algorithm
  const validModes = useMemo(() => {
    return VALID_CIPHER_MODES[settings.encryptionAlgorithm] || [];
  }, [settings.encryptionAlgorithm]);

  // Auto-update block cipher mode when algorithm changes
  useEffect(() => {
    const modes = VALID_CIPHER_MODES[settings.encryptionAlgorithm] || [];
    if (modes.length > 0) {
      const currentModeValid = modes.some(m => m.value === settings.blockCipherMode);
      if (!currentModeValid) {
        updateSettings({ blockCipherMode: modes[0].value as any });
      }
    }
  }, [settings.encryptionAlgorithm, settings.blockCipherMode, updateSettings]);

  useEffect(() => {
    let isMounted = true;
    SecureStorage.isStorageEncrypted()
      .then((encrypted) => {
        if (isMounted) {
          setHasPassword(encrypted);
        }
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Shield className="w-5 h-5" />
        {t('security.title')}
      </h3>

      {/* Encryption Algorithm Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-400" />
          {t('security.algorithm')}
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {ENCRYPTION_ALGORITHMS.map((algo) => (
              <button
                key={algo.value}
                onClick={() => updateSettings({ encryptionAlgorithm: algo.value as any })}
                className={`relative flex flex-col items-center p-4 rounded-lg border transition-all ${
                  settings.encryptionAlgorithm === algo.value
                    ? 'border-blue-500 bg-blue-600/20 text-white ring-1 ring-blue-500/50'
                    : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                }`}
              >
                {algo.recommended && (
                  <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-green-600/30 text-green-400 rounded">
                    Recommended
                  </span>
                )}
                <Lock className={`w-6 h-6 mb-2 ${settings.encryptionAlgorithm === algo.value ? 'text-blue-400' : ''}`} />
                <span className="text-sm font-medium">{algo.label}</span>
                <span className="text-xs text-gray-400 mt-1 text-center">{algo.description}</span>
              </button>
            ))}
          </div>

          {/* Block Cipher Mode */}
          {validModes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <label className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                <ShieldCheck className="w-4 h-4" />
                {t('security.blockCipher')}
              </label>
              <select
                value={settings.blockCipherMode}
                onChange={(e) => updateSettings({ blockCipherMode: e.target.value as any })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                disabled={validModes.length === 1}
              >
                {validModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
              {validModes.length === 1 && (
                <p className="text-xs text-gray-500 mt-1">
                  Mode is determined by the algorithm
                </p>
              )}
            </div>
          )}

          {settings.encryptionAlgorithm === 'ChaCha20-Poly1305' && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-gray-400 text-sm">
                <ShieldCheck className="w-4 h-4" />
                Stream cipher with built-in AEAD (no block mode needed)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Key Derivation Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Key className="w-4 h-4 text-purple-400" />
          Key Derivation (PBKDF2)
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <Gauge className="w-4 h-4" />
                {t('security.iterations')}
              </label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  value={settings.keyDerivationIterations}
                  onChange={(e) => updateSettings({ keyDerivationIterations: parseInt(e.target.value) })}
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                  min="10000"
                  max="1000000"
                />
                <button
                  onClick={handleBenchmark}
                  disabled={isBenchmarking}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
                >
                  {isBenchmarking ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <Gauge className="w-4 h-4" />
                      <span>Benchmark</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Higher values = more secure but slower. Benchmark to find optimal value.
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <Timer className="w-4 h-4" />
                {t('security.benchmarkTime')}
              </label>
              <input
                type="number"
                value={settings.benchmarkTimeSeconds}
                onChange={(e) => updateSettings({ benchmarkTimeSeconds: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                min="0.5"
                max="10"
                step="0.5"
              />
              <p className="text-xs text-gray-500">
                Target time for key derivation during benchmark
              </p>
            </div>
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group pt-2">
            <input
              type="checkbox"
              checked={settings.autoBenchmarkIterations}
              onChange={(e) => updateSettings({ autoBenchmarkIterations: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Gauge className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">{t('security.autoBenchmark')}</span>
          </label>
        </div>
      </div>

      {/* Auto Lock Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-400" />
          Auto Lock
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
          {!hasPassword && (
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-700/50 rounded-md text-yellow-400 text-sm">
              <Lock className="w-4 h-4" />
              Set a storage password to enable auto lock.
            </div>
          )}

          <label className={`flex items-center space-x-3 cursor-pointer group ${!hasPassword ? 'opacity-50' : ''}`}>
            <input
              type="checkbox"
              checked={settings.autoLock.enabled && hasPassword}
              onChange={(e) =>
                updateSettings({
                  autoLock: { ...settings.autoLock, enabled: e.target.checked },
                })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
              disabled={!hasPassword}
            />
            <Clock className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">
              Enable auto lock after inactivity
            </span>
          </label>

          <div className={`space-y-2 ${!hasPassword || !settings.autoLock.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Timer className="w-4 h-4" />
              Auto lock timeout (minutes)
            </label>
            <input
              type="number"
              value={settings.autoLock.timeoutMinutes}
              onChange={(e) =>
                updateSettings({
                  autoLock: {
                    ...settings.autoLock,
                    timeoutMinutes: parseInt(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              min="1"
              max="240"
              disabled={!hasPassword}
            />
          </div>
        </div>
      </div>

      {/* Generate Key File Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <FileKey className="w-4 h-4 text-emerald-400" />
          Generate SSH Key File
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
          <p className="text-sm text-gray-400">
            Generate a new SSH key pair and save it to a file. The private key will be saved to your chosen location, and the public key will be saved with a .pub extension.
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Key className="w-4 h-4" />
              Key Type
            </label>
            <div className="flex space-x-3">
              <button
                onClick={() => setKeyType('ed25519')}
                className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                  keyType === 'ed25519'
                    ? 'bg-emerald-600/30 border border-emerald-500 text-emerald-300'
                    : 'bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Ed25519 (Recommended)
              </button>
              <button
                onClick={() => setKeyType('rsa')}
                className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                  keyType === 'rsa'
                    ? 'bg-emerald-600/30 border border-emerald-500 text-emerald-300'
                    : 'bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                RSA (4096-bit)
              </button>
            </div>
          </div>

          <button
            onClick={async () => {
              setIsGeneratingKey(true);
              setKeyGenError(null);
              setKeyGenSuccess(null);
              try {
                const selectedPath = await save({
                  title: 'Save SSH Private Key',
                  defaultPath: keyType === 'ed25519' ? 'id_ed25519' : 'id_rsa',
                  filters: [{ name: 'SSH Key', extensions: [''] }, { name: 'All Files', extensions: ['*'] }],
                });
                if (!selectedPath) {
                  setIsGeneratingKey(false);
                  return;
                }
                const [privateKey, publicKey] = await invoke<[string, string]>('generate_ssh_key', {
                  keyType,
                  bits: keyType === 'rsa' ? 4096 : undefined,
                  passphrase: undefined,
                });
                await writeTextFile(selectedPath, privateKey);
                await writeTextFile(`${selectedPath}.pub`, publicKey);
                setKeyGenSuccess(`Key saved to: ${selectedPath}`);
                setTimeout(() => setKeyGenSuccess(null), 5000);
              } catch (err) {
                setKeyGenError(`Failed to generate key: ${err}`);
              } finally {
                setIsGeneratingKey(false);
              }
            }}
            disabled={isGeneratingKey}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
          >
            {isGeneratingKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Generate & Save Key File</span>
              </>
            )}
          </button>

          {keyGenSuccess && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/30 border border-emerald-700/50 rounded-md text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              {keyGenSuccess}
            </div>
          )}

          {keyGenError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-md text-red-400 text-sm">
              <Lock className="w-4 h-4" />
              {keyGenError}
            </div>
          )}
        </div>
      </div>

      {/* Generate Collection Encryption Key File Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-400" />
          Generate Collection Encryption Key File
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
          <p className="text-sm text-gray-400">
            Generate a secure encryption key file that can be used to encrypt your connection collections. 
            This key file can be used instead of a password when creating or opening encrypted collections.
            <span className="text-yellow-400 block mt-2">
              ⚠️ Keep this file secure! Anyone with access to it can decrypt your collections.
            </span>
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Key className="w-4 h-4" />
              Key Strength
            </label>
            <div className="flex space-x-3">
              <button
                onClick={() => setCollectionKeyLength(32)}
                className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                  collectionKeyLength === 32
                    ? 'bg-blue-600/30 border border-blue-500 text-blue-300'
                    : 'bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                256-bit (Standard)
              </button>
              <button
                onClick={() => setCollectionKeyLength(64)}
                className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                  collectionKeyLength === 64
                    ? 'bg-blue-600/30 border border-blue-500 text-blue-300'
                    : 'bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                512-bit (High Security)
              </button>
            </div>
          </div>

          <button
            onClick={async () => {
              setIsGeneratingCollectionKey(true);
              setCollectionKeyError(null);
              setCollectionKeySuccess(null);
              try {
                const selectedPath = await save({
                  title: 'Save Collection Encryption Key',
                  defaultPath: 'collection.key',
                  filters: [
                    { name: 'Key File', extensions: ['key'] },
                    { name: 'All Files', extensions: ['*'] }
                  ],
                });
                if (!selectedPath) {
                  setIsGeneratingCollectionKey(false);
                  return;
                }
                
                // Generate cryptographically secure random bytes
                const keyBytes = new Uint8Array(collectionKeyLength);
                crypto.getRandomValues(keyBytes);
                
                // Convert to base64 for storage
                const keyBase64 = btoa(String.fromCharCode(...keyBytes));
                
                // Create key file content with header
                const keyFileContent = [
                  '-----BEGIN SORTOFREMOTENG COLLECTION KEY-----',
                  `Version: 1`,
                  `Algorithm: AES-256`,
                  `Bits: ${collectionKeyLength * 8}`,
                  `Generated: ${new Date().toISOString()}`,
                  '',
                  keyBase64,
                  '-----END SORTOFREMOTENG COLLECTION KEY-----',
                ].join('\n');
                
                await writeTextFile(selectedPath, keyFileContent);
                setCollectionKeySuccess(`Key file saved to: ${selectedPath}`);
                setTimeout(() => setCollectionKeySuccess(null), 5000);
              } catch (err) {
                setCollectionKeyError(`Failed to generate key file: ${err}`);
              } finally {
                setIsGeneratingCollectionKey(false);
              }
            }}
            disabled={isGeneratingCollectionKey}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
          >
            {isGeneratingCollectionKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <FileKey className="w-4 h-4" />
                <span>Generate & Save Collection Key File</span>
              </>
            )}
          </button>

          {collectionKeySuccess && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/30 border border-blue-700/50 rounded-md text-blue-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              {collectionKeySuccess}
            </div>
          )}

          {collectionKeyError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-md text-red-400 text-sm">
              <Lock className="w-4 h-4" />
              {collectionKeyError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SecuritySettings;
