import { useState, useCallback, useContext, useMemo } from "react";
import { Connection } from "../../types/connection/connection";
import { TOTPConfig } from "../../types/settings/settings";
import { totpApi } from "../../hooks/totp/useTOTP";
import { ToastContext } from "../../contexts/ToastContext";
import { useSecretCopy } from "./useSecretCopy";

export function useBackupCodesSection(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  // Absent only where the editor is rendered without the app's providers.
  const toast = useContext(ToastContext)?.toast;
  const [expanded, setExpanded] = useState(false);
  const { copied: copiedKey, copy } = useSecretCopy();
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [addSingleTarget, setAddSingleTarget] = useState<string | null>(null);
  const [singleCode, setSingleCode] = useState("");

  const configs = useMemo(
    () => formData.totpConfigs ?? [],
    [formData.totpConfigs],
  );

  const shouldHide = formData.isGroup || configs.length === 0;

  const configsWithBackup = configs.filter(
    (c) => c.backupCodes && c.backupCodes.length > 0,
  );
  const totalBackupCodes = configsWithBackup.reduce(
    (sum, c) => sum + (c.backupCodes?.length ?? 0),
    0,
  );

  const updateConfigs = useCallback(
    (newConfigs: TOTPConfig[]) => {
      setFormData((prev) => ({ ...prev, totpConfigs: newConfigs }));
    },
    [setFormData],
  );

  const parseCodes = useCallback((text: string): string[] => {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, []);

  const handlePasteCodes = useCallback(
    (secret: string) => {
      const codes = parseCodes(pasteText);
      if (codes.length === 0) return;
      const updated = configs.map((cfg) =>
        cfg.secret === secret
          ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), ...codes] }
          : cfg,
      );
      updateConfigs(updated);
      setPasteText("");
      setPasteTarget(null);
    },
    [pasteText, configs, updateConfigs, parseCodes],
  );

  const handleAddSingleCode = useCallback(
    (secret: string) => {
      const code = singleCode.trim();
      if (!code) return;
      const updated = configs.map((cfg) =>
        cfg.secret === secret
          ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), code] }
          : cfg,
      );
      updateConfigs(updated);
      setSingleCode("");
      setAddSingleTarget(null);
    },
    [singleCode, configs, updateConfigs],
  );

  const removeCode = useCallback(
    (secret: string, index: number) => {
      const updated = configs.map((cfg) => {
        if (cfg.secret !== secret || !cfg.backupCodes) return cfg;
        const newCodes = [...cfg.backupCodes];
        newCodes.splice(index, 1);
        return {
          ...cfg,
          backupCodes: newCodes.length > 0 ? newCodes : undefined,
        };
      });
      updateConfigs(updated);
    },
    [configs, updateConfigs],
  );

  const generateBackupFor = useCallback(
    async (secret: string) => {
      const backupCodes = await totpApi.generateBackupCodes(10);
      const updated = configs.map((cfg) =>
        cfg.secret === secret
          ? {
              ...cfg,
              backupCodes: [...(cfg.backupCodes ?? []), ...backupCodes],
            }
          : cfg,
      );
      updateConfigs(updated);
    },
    [configs, updateConfigs],
  );

  const clearBackupFor = useCallback(
    (secret: string) => {
      const updated = configs.map((cfg) =>
        cfg.secret === secret ? { ...cfg, backupCodes: undefined } : cfg,
      );
      updateConfigs(updated);
    },
    [configs, updateConfigs],
  );

  const copyAll = useCallback(
    async (codes: string[], key: string) => {
      const outcome = await copy(key, codes.join("\n"), "recoveryCode");
      // The toast outlives this section, so a failure is still reported when
      // the section was closed while the write was pending.
      if (outcome && !outcome.ok) toast?.error(outcome.message);
    },
    [copy, toast],
  );

  const togglePasteTarget = useCallback(
    (secret: string) => {
      setPasteTarget(pasteTarget === secret ? null : secret);
      setAddSingleTarget(null);
      setPasteText("");
    },
    [pasteTarget],
  );

  const toggleAddSingleTarget = useCallback(
    (secret: string) => {
      setAddSingleTarget(addSingleTarget === secret ? null : secret);
      setPasteTarget(null);
      setSingleCode("");
    },
    [addSingleTarget],
  );

  const cancelPaste = useCallback(() => {
    setPasteTarget(null);
    setPasteText("");
  }, []);

  const cancelAddSingle = useCallback(() => {
    setAddSingleTarget(null);
    setSingleCode("");
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
