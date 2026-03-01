import { useState, useCallback, useMemo } from 'react';
import { Connection } from '../types/connection';
import { TOTPConfig } from '../types/settings';
import { TOTPService } from '../utils/totpService';

export function useBackupCodesSection(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [addSingleTarget, setAddSingleTarget] = useState<string | null>(null);
  const [singleCode, setSingleCode] = useState('');

  const totpService = useMemo(() => new TOTPService(), []);
  const configs = useMemo(() => formData.totpConfigs ?? [], [formData.totpConfigs]);

  const shouldHide = formData.isGroup || configs.length === 0;

  const configsWithBackup = configs.filter(c => c.backupCodes && c.backupCodes.length > 0);
  const totalBackupCodes = configsWithBackup.reduce((sum, c) => sum + (c.backupCodes?.length ?? 0), 0);

  const updateConfigs = useCallback(
    (newConfigs: TOTPConfig[]) => {
      setFormData(prev => ({ ...prev, totpConfigs: newConfigs }));
    },
    [setFormData],
  );

  const parseCodes = useCallback((text: string): string[] => {
    return text
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }, []);

  const handlePasteCodes = useCallback(
    (secret: string) => {
      const codes = parseCodes(pasteText);
      if (codes.length === 0) return;
      const updated = configs.map(cfg =>
        cfg.secret === secret
          ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), ...codes] }
          : cfg,
      );
      updateConfigs(updated);
      setPasteText('');
      setPasteTarget(null);
    },
    [pasteText, configs, updateConfigs, parseCodes],
  );

  const handleAddSingleCode = useCallback(
    (secret: string) => {
      const code = singleCode.trim();
      if (!code) return;
      const updated = configs.map(cfg =>
        cfg.secret === secret
          ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), code] }
          : cfg,
      );
      updateConfigs(updated);
      setSingleCode('');
      setAddSingleTarget(null);
    },
    [singleCode, configs, updateConfigs],
  );

  const removeCode = useCallback(
    (secret: string, index: number) => {
      const updated = configs.map(cfg => {
        if (cfg.secret !== secret || !cfg.backupCodes) return cfg;
        const newCodes = [...cfg.backupCodes];
        newCodes.splice(index, 1);
        return { ...cfg, backupCodes: newCodes.length > 0 ? newCodes : undefined };
      });
      updateConfigs(updated);
    },
    [configs, updateConfigs],
  );

  const generateBackupFor = useCallback(
    (secret: string) => {
      const backupCodes = totpService.generateBackupCodes(10);
      const updated = configs.map(cfg =>
        cfg.secret === secret
          ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), ...backupCodes] }
          : cfg,
      );
      updateConfigs(updated);
    },
    [configs, updateConfigs, totpService],
  );

  const clearBackupFor = useCallback(
    (secret: string) => {
      const updated = configs.map(cfg =>
        cfg.secret === secret ? { ...cfg, backupCodes: undefined } : cfg,
      );
      updateConfigs(updated);
    },
    [configs, updateConfigs],
  );

  const copyAll = useCallback((codes: string[], key: string) => {
    navigator.clipboard.writeText(codes.join('\n'));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  const togglePasteTarget = useCallback(
    (secret: string) => {
      setPasteTarget(pasteTarget === secret ? null : secret);
      setAddSingleTarget(null);
      setPasteText('');
    },
    [pasteTarget],
  );

  const toggleAddSingleTarget = useCallback(
    (secret: string) => {
      setAddSingleTarget(addSingleTarget === secret ? null : secret);
      setPasteTarget(null);
      setSingleCode('');
    },
    [addSingleTarget],
  );

  const cancelPaste = useCallback(() => {
    setPasteTarget(null);
    setPasteText('');
  }, []);

  const cancelAddSingle = useCallback(() => {
    setAddSingleTarget(null);
    setSingleCode('');
  }, []);

  return {
    expanded,
    setExpanded,
    copiedKey,
    pasteTarget,
    pasteText,
    setPasteText,
    addSingleTarget,
    singleCode,
    setSingleCode,
    configs,
    shouldHide,
    totalBackupCodes,
    parseCodes,
    handlePasteCodes,
    handleAddSingleCode,
    removeCode,
    generateBackupFor,
    clearBackupFor,
    copyAll,
    togglePasteTarget,
    toggleAddSingleTarget,
    cancelPaste,
    cancelAddSingle,
  };
}
