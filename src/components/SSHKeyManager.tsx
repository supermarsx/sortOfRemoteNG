import React, { useState, useEffect } from 'react';
import { PasswordInput } from './ui/PasswordInput';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  Eye,
  EyeOff,
  Check,
  X,
  FileKey,
  Shield,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SSHKey {
  id: string;
  name: string;
  type: 'ed25519' | 'rsa';
  publicKey: string;
  privateKeyPath: string;
  fingerprint: string;
  createdAt: Date;
  hasPassphrase: boolean;
}

interface SSHKeyManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKey?: (keyPath: string) => void;
}

export const SSHKeyManager: React.FC<SSHKeyManagerProps> = ({
  isOpen,
  onClose,
  onSelectKey,
}) => {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Generate form state
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyType, setNewKeyType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [newKeyPassphrase, setNewKeyPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [generating, setGenerating] = useState(false);

  const getKeysDirectory = async (): Promise<string> => {
    const appData = await appDataDir();
    const keysDir = await join(appData, 'ssh-keys');
    if (!(await exists(keysDir))) {
      await mkdir(keysDir, { recursive: true });
    }
    return keysDir;
  };

  const calculateFingerprint = (publicKey: string): string => {
    // Simple hash for display purposes
    const hash = publicKey
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `SHA256:${hex.substring(0, 2)}:${hex.substring(2, 4)}:${hex.substring(4, 6)}:${hex.substring(6, 8)}`;
  };

  const loadKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const keysDir = await getKeysDirectory();
      const metadataPath = await join(keysDir, 'keys.json');

      if (await exists(metadataPath)) {
        const content = await readTextFile(metadataPath);
        const savedKeys = JSON.parse(content) as SSHKey[];
        
        // Verify keys still exist
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
  };

  const saveKeysMetadata = async (keysToSave: SSHKey[]) => {
    const keysDir = await getKeysDirectory();
    const metadataPath = await join(keysDir, 'keys.json');
    await writeTextFile(metadataPath, JSON.stringify(keysToSave, null, 2));
  };

  useEffect(() => {
    if (isOpen) {
      loadKeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleGenerateToFile = async () => {
    // Generate key and save directly to user-selected location
    setGenerating(true);
    setError(null);

    try {
      // Ask user where to save the key
      const selectedPath = await save({
        title: 'Save SSH Private Key',
        defaultPath: 'id_ed25519',
        filters: [{ name: 'SSH Key', extensions: [''] }, { name: 'All Files', extensions: ['*'] }],
      });

      if (!selectedPath) {
        setGenerating(false);
        return;
      }

      // Generate key using Tauri backend (default to ed25519)
      const [privateKey, publicKey] = await invoke<[string, string]>('generate_ssh_key', {
        keyType: 'ed25519',
        bits: undefined,
        passphrase: undefined,
      });

      // Save private key to selected location
      await writeTextFile(selectedPath, privateKey);
      
      // Save public key with .pub extension
      await writeTextFile(`${selectedPath}.pub`, publicKey);

      setError(null);
      // Show success message briefly
      setError(`Key saved to: ${selectedPath}`);
      setTimeout(() => setError(null), 3000);
    } catch (err) {
      setError(`Failed to generate key: ${err}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) {
      setError('Key name is required');
      return;
    }

    if (newKeyPassphrase && newKeyPassphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // Generate key using Tauri backend
      const [privateKey, publicKey] = await invoke<[string, string]>('generate_ssh_key', {
        keyType: newKeyType,
        bits: newKeyType === 'rsa' ? 4096 : undefined,
        passphrase: newKeyPassphrase || undefined,
      });

      // Save keys to files
      const keysDir = await getKeysDirectory();
      const sanitizedName = newKeyName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const privateKeyPath = await join(keysDir, `${sanitizedName}`);
      const publicKeyPath = await join(keysDir, `${sanitizedName}.pub`);

      await writeTextFile(privateKeyPath, privateKey);
      await writeTextFile(publicKeyPath, publicKey);

      // Create key metadata
      const newKey: SSHKey = {
        id: crypto.randomUUID(),
        name: newKeyName,
        type: newKeyType,
        publicKey: publicKey,
        privateKeyPath: privateKeyPath,
        fingerprint: calculateFingerprint(publicKey),
        createdAt: new Date(),
        hasPassphrase: !!newKeyPassphrase,
      };

      const updatedKeys = [...keys, newKey];
      setKeys(updatedKeys);
      await saveKeysMetadata(updatedKeys);

      // Reset form
      setShowGenerateForm(false);
      setNewKeyName('');
      setNewKeyType('ed25519');
      setNewKeyPassphrase('');
      setConfirmPassphrase('');
    } catch (err) {
      setError(`Failed to generate key: ${err}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleImportKey = async () => {
    try {
      const filePath = await open({
        title: 'Select SSH Private Key',
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });

      if (!filePath) return;

      // Read the private key
      const privateKey = await readTextFile(filePath as string);
      
      // Try to read corresponding public key
      let publicKey = '';
      const pubKeyPath = `${filePath}.pub`;
      if (await exists(pubKeyPath)) {
        publicKey = await readTextFile(pubKeyPath);
      } else {
        // Generate public key from private (would need backend support)
        publicKey = '(Public key not available)';
      }

      // Validate the key
      const isValid = await invoke<boolean>('validate_ssh_key_file', {
        keyPath: filePath,
        passphrase: null,
      });

      if (!isValid) {
        // Key might need passphrase - we'll import anyway
      }

      // Copy key to our managed directory
      const keysDir = await getKeysDirectory();
      const fileName = (filePath as string).split(/[\\/]/).pop() || 'imported_key';
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const newPrivateKeyPath = await join(keysDir, sanitizedName);
      const newPublicKeyPath = await join(keysDir, `${sanitizedName}.pub`);

      await writeTextFile(newPrivateKeyPath, privateKey);
      if (publicKey && publicKey !== '(Public key not available)') {
        await writeTextFile(newPublicKeyPath, publicKey);
      }

      // Determine key type from content
      let keyType: 'ed25519' | 'rsa' = 'ed25519';
      if (privateKey.includes('RSA') || privateKey.includes('rsa')) {
        keyType = 'rsa';
      }

      const newKey: SSHKey = {
        id: crypto.randomUUID(),
        name: sanitizedName,
        type: keyType,
        publicKey: publicKey,
        privateKeyPath: newPrivateKeyPath,
        fingerprint: publicKey !== '(Public key not available)' 
          ? calculateFingerprint(publicKey) 
          : 'Unknown',
        createdAt: new Date(),
        hasPassphrase: !isValid, // Assume passphrase if validation failed
      };

      const updatedKeys = [...keys, newKey];
      setKeys(updatedKeys);
      await saveKeysMetadata(updatedKeys);
    } catch (err) {
      setError(`Failed to import key: ${err}`);
    }
  };

  const handleExportKey = async (key: SSHKey) => {
    try {
      const filePath = await save({
        title: 'Export SSH Key',
        defaultPath: key.name,
      });

      if (!filePath) return;

      const privateKey = await readTextFile(key.privateKeyPath);
      await writeTextFile(filePath, privateKey);
      
      // Also export public key
      if (key.publicKey && key.publicKey !== '(Public key not available)') {
        await writeTextFile(`${filePath}.pub`, key.publicKey);
      }
    } catch (err) {
      setError(`Failed to export key: ${err}`);
    }
  };

  const handleDeleteKey = async (key: SSHKey) => {
    if (!confirm(`Are you sure you want to delete the key "${key.name}"?`)) {
      return;
    }

    try {
      // Delete files
      if (await exists(key.privateKeyPath)) {
        await remove(key.privateKeyPath);
      }
      const pubKeyPath = `${key.privateKeyPath}.pub`;
      if (await exists(pubKeyPath)) {
        await remove(pubKeyPath);
      }

      // Update metadata
      const updatedKeys = keys.filter(k => k.id !== key.id);
      setKeys(updatedKeys);
      await saveKeysMetadata(updatedKeys);
    } catch (err) {
      setError(`Failed to delete key: ${err}`);
    }
  };

  const handleCopyPublicKey = async (key: SSHKey) => {
    try {
      await navigator.clipboard.writeText(key.publicKey);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setError(`Failed to copy: ${err}`);
    }
  };

  const handleSelectKey = (key: SSHKey) => {
    if (onSelectKey) {
      onSelectKey(key.privateKeyPath);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {t('sshKeyManager.title', 'SSH Key Manager')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setShowGenerateForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('sshKeyManager.generate', 'Generate Key')}
            </button>
            <button
              onClick={handleGenerateToFile}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-[var(--color-text)] rounded-md hover:bg-emerald-500 transition-colors disabled:opacity-50"
              title="Generate a key and save directly to a custom location"
            >
              <FileKey className="w-4 h-4" />
              {t('sshKeyManager.generateToFile', 'Generate to File')}
            </button>
            <button
              onClick={handleImportKey}
              className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {t('sshKeyManager.import', 'Import Key')}
            </button>
            <button
              onClick={loadKeys}
              className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors ml-auto"
            >
              <RefreshCw className="w-4 h-4" />
              {t('sshKeyManager.refresh', 'Refresh')}
            </button>
          </div>

          {/* Generate Key Form */}
          {showGenerateForm && (
            <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
              <h3 className="text-sm font-medium mb-4">
                {t('sshKeyManager.generateNew', 'Generate New SSH Key')}
              </h3>
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('sshKeyManager.keyName', 'Key Name')}
                  </label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="my-server-key"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('sshKeyManager.keyType', 'Key Type')}
                  </label>
                  <select
                    value={newKeyType}
                    onChange={(e) => setNewKeyType(e.target.value as 'ed25519' | 'rsa')}
                    className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="ed25519">Ed25519 (Recommended)</option>
                    <option value="rsa">RSA (4096-bit)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('sshKeyManager.passphrase', 'Passphrase (Optional)')}
                  </label>
                  <PasswordInput
                    value={newKeyPassphrase}
                    onChange={(e) => setNewKeyPassphrase(e.target.value)}
                    placeholder="Optional passphrase"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {newKeyPassphrase && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('sshKeyManager.confirmPassphrase', 'Confirm Passphrase')}
                    </label>
                    <PasswordInput
                      value={confirmPassphrase}
                      onChange={(e) => setConfirmPassphrase(e.target.value)}
                      placeholder="Confirm passphrase"
                      className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowGenerateForm(false);
                      setNewKeyName('');
                      setNewKeyPassphrase('');
                      setConfirmPassphrase('');
                    }}
                    className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    onClick={handleGenerateKey}
                    disabled={generating || !newKeyName.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {generating ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    {t('sshKeyManager.generate', 'Generate')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Keys List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileKey className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t('sshKeyManager.noKeys', 'No SSH keys found')}</p>
              <p className="text-sm">
                {t('sshKeyManager.noKeysHint', 'Generate or import a key to get started')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <FileKey className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium">{key.name}</h4>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            {key.type.toUpperCase()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(key.createdAt).toLocaleDateString()}
                          </span>
                          {key.hasPassphrase && (
                            <span className="flex items-center gap-1 text-yellow-600">
                              <Key className="w-3 h-3" />
                              Protected
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {onSelectKey && (
                        <button
                          onClick={() => handleSelectKey(key)}
                          className="p-2 hover:bg-primary/10 text-primary rounded-md transition-colors"
                          title="Use this key"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleCopyPublicKey(key)}
                        className="p-2 hover:bg-muted rounded-md transition-colors"
                        title="Copy public key"
                      >
                        {copiedId === key.id ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setShowPrivateKey(showPrivateKey === key.id ? null : key.id)}
                        className="p-2 hover:bg-muted rounded-md transition-colors"
                        title="Show/hide public key"
                      >
                        {showPrivateKey === key.id ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleExportKey(key)}
                        className="p-2 hover:bg-muted rounded-md transition-colors"
                        title="Export key"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteKey(key)}
                        className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
                        title="Delete key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {showPrivateKey === key.id && key.publicKey && (
                    <div className="mt-3 p-3 bg-muted/50 rounded-md">
                      <p className="text-xs font-medium mb-1 text-muted-foreground">
                        Public Key:
                      </p>
                      <code className="text-xs break-all font-mono">
                        {key.publicKey}
                      </code>
                      <p className="text-xs text-muted-foreground mt-2">
                        Fingerprint: {key.fingerprint}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-md transition-colors"
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SSHKeyManager;
