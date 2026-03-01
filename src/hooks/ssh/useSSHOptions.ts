import { useState, useCallback } from 'react';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Connection } from '../../types/connection';

export function useSSHOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const [showKeyManager, setShowKeyManager] = useState(false);

  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');

  const handlePrivateKeyFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        setFormData((prev) => ({ ...prev, privateKey: text }));
      }
    },
    [setFormData],
  );

  const handleSelectKey = useCallback(
    async (keyPath: string) => {
      try {
        const keyContent = await readTextFile(keyPath);
        setFormData((prev) => ({ ...prev, privateKey: keyContent }));
      } catch (err) {
        console.error('Failed to read selected key:', err);
      }
    },
    [setFormData],
  );

  return {
    showKeyManager,
    setShowKeyManager,
    isHttpProtocol,
    handlePrivateKeyFileChange,
    handleSelectKey,
  };
}
