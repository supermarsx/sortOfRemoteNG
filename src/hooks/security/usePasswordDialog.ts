import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type AuthMethod = 'password' | 'passkey' | 'keyfile';

interface UsePasswordDialogOptions {
  isOpen: boolean;
  mode: 'setup' | 'unlock';
  onSubmit: (password: string, method?: AuthMethod) => void;
  onCancel: () => void;
  noCollectionSelected?: boolean;
}

export function usePasswordDialog({
  isOpen,
  mode,
  onSubmit,
  onCancel,
  noCollectionSelected = false,
}: UsePasswordDialogOptions) {
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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
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
    },
    [noCollectionSelected, authMethod, mode, password, confirmPassword, keyFileContent, onSubmit],
  );

  const handlePasskeyAuth = useCallback(async () => {
    if (noCollectionSelected) {
      setPasswordError('Please select a collection first');
      return;
    }

    setPasskeyLoading(true);
    setPasswordError('');
    try {
      const reason =
        mode === 'setup'
          ? 'sortOfRemoteNG: Create encryption key'
          : 'sortOfRemoteNG: Unlock storage';
      const derivedKey = await invoke<string>('passkey_authenticate', { reason });
      onSubmit(derivedKey, 'passkey');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Passkey authentication failed');
    } finally {
      setPasskeyLoading(false);
    }
  }, [noCollectionSelected, mode, onSubmit]);

  const handleKeyFileSelect = useCallback(async () => {
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
            setKeyFileContent(content);
          };
          reader.readAsText(file);
        }
      };
      input.click();
    } catch {
      setPasswordError('Failed to read key file');
    }
  }, []);

  const handleCancel = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setKeyFilePath('');
    setKeyFileContent(null);
    setAuthMethod('password');
    onCancel();
  }, [onCancel]);

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

  const passwordSubmitDisabled =
    noCollectionSelected || (mode === 'setup' && (password !== confirmPassword || password.length < 4));
  const passwordsMismatch = !!(password && confirmPassword && password !== confirmPassword);

  return {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    showPassword,
    setShowPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    passwordError,
    authMethod,
    setAuthMethod,
    passkeyAvailable,
    passkeyLoading,
    keyFilePath,
    keyFileContent,
    handleSubmit,
    handlePasskeyAuth,
    handleKeyFileSelect,
    handleCancel,
    passwordSubmitDisabled,
    passwordsMismatch,
  };
}
