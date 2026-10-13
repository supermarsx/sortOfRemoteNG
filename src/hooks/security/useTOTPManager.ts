import { useState, useEffect, useCallback, useContext, useRef } from "react";
import { totpApi } from "../totp/useTOTP";
import type { TotpEntry } from "../../types/totp";
import { ToastContext } from "../../contexts/ToastContext";
import { totpWindow } from "../../utils/security/totpCode";
import { useSecretCopy } from "./useSecretCopy";

/**
 * Form shape for new TOTP entries. Mirrors the legacy UI fields but
 * targets the Rust-backed `totp_*` commands via `totpApi`.
 *
 * `account` maps onto `TotpEntry.label`.
 */
export interface NewTOTPForm {
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

const DEFAULT_NEW_CONFIG: NewTOTPForm = {
  issuer: "sortOfRemoteNG",
  account: "",
  digits: 6,
  period: 30,
};

export function useTOTPManager(isOpen: boolean, _connectionId?: string) {
  void _connectionId;
  // Absent only where the dialog is rendered without the app's providers.
  const toast = useContext(ToastContext)?.toast;
  const { copy } = useSecretCopy();
  const [totpConfigs, setTotpConfigs] = useState<TotpEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState<NewTOTPForm>(DEFAULT_NEW_CONFIG);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});
  // When the time step of each shown code ends, in Unix milliseconds. A
  // counter-based code has no entry.
  const [codeExpiry, setCodeExpiry] = useState<Record<string, number>>({});
  const [timeRemaining, setTimeRemaining] = useState<number>(30);

  const totpConfigsRef = useRef<TotpEntry[]>([]);

  const updateCurrentCodes = useCallback(async () => {
    try {
      // Read before the codes are asked for: a code generated across a step
      // change then counts as the older one and is refused at copy.
      const started = Date.now();
      const generated = await totpApi.generateAllCodes();
      const codes: Record<string, string> = {};
      const expiry: Record<string, number> = {};
      let remaining = 30;
      for (const g of generated) {
        codes[g.entry_id] = g.code;
        // `period` is 0 for a counter-based code, which has no time step.
        if (g.period > 0)
          expiry[g.entry_id] = totpWindow(g.period, started).expires;
        remaining = g.remaining_seconds;
      }
      setCurrentCodes(codes);
      setCodeExpiry(expiry);
      setTimeRemaining(remaining);
    } catch (err) {
      console.error("Failed to generate TOTP codes:", err);
    }
  }, []);

  const loadTOTPConfigs = useCallback(async () => {
    try {
      const entries = await totpApi.listEntries();
      setTotpConfigs(entries);
    } catch (err) {
      console.error("Failed to load TOTP entries:", err);
      setTotpConfigs([]);
    }
  }, []);

  useEffect(() => {
    totpConfigsRef.current = totpConfigs;
  }, [totpConfigs]);

  useEffect(() => {
    if (isOpen) {
      void loadTOTPConfigs();
      void updateCurrentCodes();
      const interval = setInterval(() => {
        void updateCurrentCodes();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, loadTOTPConfigs, updateCurrentCodes]);

  const handleAddConfig = useCallback(async () => {
    if (!newConfig.account) return;

    try {
      const secret = await totpApi.generateSecret();
      const entry = await totpApi.createEntry(
        newConfig.account,
        secret,
        newConfig.issuer || "sortOfRemoteNG",
        "SHA1",
        newConfig.digits || 6,
        newConfig.period || 30,
      );

      try {
        const qrUrl = await totpApi.entryQrDataUri(entry.id);
        setQrCodeUrl(qrUrl);
      } catch (err) {
        console.error("Failed to generate QR code:", err);
      }

      await loadTOTPConfigs();
      setNewConfig(DEFAULT_NEW_CONFIG);
      setShowAddForm(false);
    } catch (err) {
      console.error("Failed to add TOTP entry:", err);
    }
  }, [newConfig, loadTOTPConfigs]);

  const handleDeleteConfig = useCallback(async (id: string) => {
    if (confirm("Are you sure you want to delete this TOTP configuration?")) {
      try {
        await totpApi.removeEntry(id);
        setTotpConfigs((prev) => prev.filter((e) => e.id !== id));
      } catch (err) {
        console.error("Failed to delete TOTP entry:", err);
      }
    }
  }, []);

  const copyOrReport = useCallback(
    async (...request: Parameters<typeof copy>) => {
      const outcome = await copy(...request);
      // The toast outlives this dialog, so a failure is still reported when
      // the dialog was closed while the write was pending.
      if (outcome && !outcome.ok) toast?.error(outcome.message);
    },
    [copy, toast],
  );

  const copyCode = useCallback(
    (entryId: string) =>
      copyOrReport(
        entryId,
        currentCodes[entryId] ?? "",
        "totpCode",
        codeExpiry[entryId],
      ),
    [copyOrReport, currentCodes, codeExpiry],
  );

  const copySecret = useCallback(
    (entryId: string) =>
      copyOrReport(
        entryId,
        totpConfigs.find((entry) => entry.id === entryId)?.secret ?? "",
        "secret",
      ),
    [copyOrReport, totpConfigs],
  );

  const getTimeRemaining = useCallback(() => timeRemaining, [timeRemaining]);

  const clearQrCode = useCallback(() => setQrCodeUrl(""), []);

  return {
    totpConfigs,
    showAddForm,
    setShowAddForm,
    newConfig,
    setNewConfig,
    qrCodeUrl,
    currentCodes,
    handleAddConfig,
    handleDeleteConfig,
    copyCode,
    copySecret,
    getTimeRemaining,
    clearQrCode,
  };
}
