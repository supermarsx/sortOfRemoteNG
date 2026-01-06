import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Eye, EyeOff, Shield, AlertCircle, X, Fingerprint, Key, FileKey, Upload, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

type AuthMethod = 'password' | 'passkey' | 'keyfile';

interface PasswordDialogProps {
  isOpen: boolean;
  mode: 'setup' | 'unlock';
  onSubmit: (password: string, method?: AuthMethod) => void;
  onCancel: () => void;
  error?: string;
  noCollectionSelected?: boolean;
}

export const PasswordDialog: React.FC<PasswordDialogProps> = ({
  isOpen,
  mode,
  onSubmit,
  onCancel,
  error,
  noCollectionSelected = false,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [keyFilePath, setKeyFilePath] = useState('');
  const [keyFileContent, setKeyFileContent] = useState<string | null>(null);

  // Check if passkey is available on mount
  useEffect(() => {
    const checkPasskey = async () => {
      try {
        const available = await invoke<boolean>('passkey_is_available');
        setPasskeyAvailable(available);
      } catch {
        setPasskeyAvailable(false);
      }
    };
    if (isOpen) {
      checkPasskey();
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (noCollectionSelected) {
      setPasswordError('Please select a collection first');
      return;
    }

    if (authMethod === 'password') {
      if (mode === 'setup' && password !== confirmPassword) {
        return;
      }
      
      if (password.length < 4) {
        setPasswordError('Password must be at least 4 characters');
        return;
      }

      setPasswordError('');
      onSubmit(password, 'password');
      setPassword('');
      setConfirmPassword('');
    } else if (authMethod === 'keyfile') {
      if (!keyFileContent) {
        setPasswordError('Please select a key file');
        return;
      }
      setPasswordError('');
      onSubmit(keyFileContent, 'keyfile');
      setKeyFilePath('');
      setKeyFileContent(null);
    }
  };

  const handlePasskeyAuth = async () => {
    if (noCollectionSelected) {
      setPasswordError('Please select a collection first');
      return;
    }

    setPasskeyLoading(true);
    setPasswordError('');
    try {
      const reason = mode === 'setup' 
        ? 'sortOfRemoteNG: Create encryption key'
        : 'sortOfRemoteNG: Unlock storage';
      
      const derivedKey = await invoke<string>('passkey_authenticate', { reason });
      onSubmit(derivedKey, 'passkey');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Passkey authentication failed');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleKeyFileSelect = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.key,.pem,.txt';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setKeyFilePath(file.name);
          const reader = new FileReader();
          reader.onload = (event) => {
            const content = event.target?.result as string;
            // Hash the key file content to use as encryption key
            setKeyFileContent(content);
          };
          reader.readAsText(file);
        }
      };
      input.click();
    } catch {
      setPasswordError('Failed to read key file');
    }
  };

  const handleCancel = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setKeyFilePath('');
    setKeyFileContent(null);
    setAuthMethod('password');
    onCancel();
  }, [onCancel]);

  // Handle ESC key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setKeyFilePath('');
      setKeyFileContent(null);
      setAuthMethod('password');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 relative animate-in fade-in zoom-in-95 duration-200">
        <div className="relative h-16 border-b border-gray-600">
          <div className="absolute left-6 top-4 flex items-center space-x-3">
            <Shield className="text-blue-400" size={24} />
            <h2 className="text-xl font-semibold text-white">
              {mode === 'setup' ? 'Secure Your Connections' : 'Unlock Connections'}
            </h2>
          </div>
          <button
            onClick={handleCancel}
            className="absolute right-4 top-3 text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {noCollectionSelected && (
            <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-warning-rgb, 245, 158, 11), 0.15)', borderColor: 'var(--color-warning)' }}>
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-yellow-400" size={16} />
                <span className="text-yellow-400 text-sm">
                  Please select a collection before setting up security.
                </span>
              </div>
            </div>
          )}

          {mode === 'setup' && !noCollectionSelected && (
            <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.15)', borderColor: 'var(--color-primary)' }}>
              <div className="flex items-start space-x-3">
                <Lock className="text-blue-400 mt-0.5" size={16} />
                <div className="text-sm text-blue-400">
                  <p className="font-medium mb-1">Secure Your Data</p>
                  <p className="text-blue-300">
                    Choose how to protect your connections. You can use a password,
                    system passkey (Windows Hello/Touch ID), or a key file.
                  </p>
                </div>
              </div>
            </div>
          )}

          {(error || passwordError) && (
            <div className="border rounded-lg p-4" style={{ backgroundColor: 'rgba(var(--color-error-rgb, 239, 68, 68), 0.15)', borderColor: 'var(--color-error)' }}>
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-400" size={16} />
                <span className="text-red-400 text-sm">{error || passwordError}</span>
              </div>
            </div>
          )}

          {/* Authentication Method Selector */}
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setAuthMethod('password')}
              disabled={noCollectionSelected}
              className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 rounded-lg border transition-all ${
                authMethod === 'password'
                  ? 'border-blue-500 text-blue-400'
                  : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
              } ${noCollectionSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={authMethod === 'password' ? { backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.2)' } : {}}
            >
              <Key size={16} />
              <span className="text-sm">Password</span>
            </button>
            {passkeyAvailable && (
              <button
                type="button"
                onClick={() => setAuthMethod('passkey')}
                disabled={noCollectionSelected}
                className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 rounded-lg border transition-all ${
                  authMethod === 'passkey'
                    ? 'border-blue-500 text-blue-400'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                } ${noCollectionSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={authMethod === 'passkey' ? { backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.2)' } : {}}
              >
                <Fingerprint size={16} />
                <span className="text-sm">Passkey</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setAuthMethod('keyfile')}
              disabled={noCollectionSelected}
              className={`flex-1 flex items-center justify-center space-x-2 px-3 py-2.5 rounded-lg border transition-all ${
                authMethod === 'keyfile'
                  ? 'border-blue-500 text-blue-400'
                  : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
              } ${noCollectionSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={authMethod === 'keyfile' ? { backgroundColor: 'rgba(var(--color-primary-rgb, 59, 130, 246), 0.2)' } : {}}
            >
              <FileKey size={16} />
              <span className="text-sm">Key File</span>
            </button>
          </div>

          {/* Password Form */}
          {authMethod === 'password' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {mode === 'setup' ? 'Create Password' : 'Enter Password'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={noCollectionSelected}
                    className="w-full px-3 py-2 pr-10 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    placeholder="Enter password"
                    minLength={4}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {mode === 'setup' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={noCollectionSelected}
                      className="w-full px-3 py-2 pr-10 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      placeholder="Confirm password"
                      minLength={4}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {password && confirmPassword && password !== confirmPassword && (
                    <p className="text-red-400 text-sm mt-1">Passwords do not match</p>
                  )}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
                >
                  {mode === 'setup' ? 'Skip' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={noCollectionSelected || (mode === 'setup' && (password !== confirmPassword || password.length < 4))}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center space-x-2"
                >
                  <Lock size={16} />
                  <span>{mode === 'setup' ? 'Secure' : 'Unlock'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Passkey Form */}
          {authMethod === 'passkey' && (
            <div className="space-y-4">
              <div className="bg-gray-700 rounded-lg p-6 text-center">
                <Fingerprint size={48} className="mx-auto mb-4 text-blue-400" />
                <p className="text-gray-300 mb-2">
                  {mode === 'setup'
                    ? 'Use Windows Hello or your device biometrics to secure your data'
                    : 'Authenticate with Windows Hello or device biometrics'}
                </p>
                <p className="text-gray-400 text-sm">
                  Your passkey is stored securely on your device
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePasskeyAuth}
                  disabled={noCollectionSelected || passkeyLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center space-x-2"
                >
                  {passkeyLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Fingerprint size={16} />
                  )}
                  <span>{passkeyLoading ? 'Authenticating...' : mode === 'setup' ? 'Set Up Passkey' : 'Authenticate'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Key File Form */}
          {authMethod === 'keyfile' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {mode === 'setup' ? 'Select Key File' : 'Select Your Key File'}
                </label>
                <div
                  onClick={noCollectionSelected ? undefined : handleKeyFileSelect}
                  className={`border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-gray-500 transition-colors ${
                    noCollectionSelected ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {keyFilePath ? (
                    <div className="flex items-center justify-center space-x-2 text-green-400">
                      <FileKey size={24} />
                      <span>{keyFilePath}</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-400 text-sm">
                        Click to select a key file (.key, .pem, .txt)
                      </p>
                    </>
                  )}
                </div>
                {mode === 'setup' && (
                  <p className="text-gray-400 text-xs mt-2">
                    Keep your key file safe! You will need it to unlock your connections.
                  </p>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={noCollectionSelected || !keyFileContent}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center space-x-2"
                >
                  <FileKey size={16} />
                  <span>{mode === 'setup' ? 'Secure' : 'Unlock'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PasswordDialog;