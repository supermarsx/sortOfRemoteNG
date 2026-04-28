import { useState, useCallback } from 'react';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Connection } from '../../types/connection/connection';

export function useSSHOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
  setPrivateKey?: (value: string) => void,
) {
  const [showKeyManager, setShowKeyManager] = useState(false);

  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');

  const applyPrivateKey = useCallback(
    (value: string) => {
      if (setPrivateKey) {
        setPrivateKey(value);
        return;
      }

      setFormData((prev) => ({ ...prev, privateKey: value }));
    },
    [setFormData, setPrivateKey],
  );

  const handlePrivateKeyFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        applyPrivateKey(text);
      }
    },
    [applyPrivateKey],
  );

  const handleSelectKey = useCallback(
    async (keyPath: string) => {
      try {
        const keyContent = await readTextFile(keyPath);
        applyPrivateKey(keyContent);
      } catch (err) {
        console.error('Failed to read selected key:', err);
      }
    },
    [applyPrivateKey],
  );

  return {
    showKeyManager,
    setShowKeyManager,
    isHttpProtocol,
    handlePrivateKeyFileChange,
    handleSelectKey,
  };
}
