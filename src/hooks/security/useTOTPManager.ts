import { useState, useEffect, useCallback, useRef } from 'react';
import { totpApi } from '../totp/useTOTP';
import type { TotpEntry } from '../../types/totp';

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
  issuer: 'sortOfRemoteNG',
  account: '',
  digits: 6,
  period: 30,
};

export function useTOTPManager(isOpen: boolean, _connectionId?: string) {
  void _connectionId;
  const [totpConfigs, setTotpConfigs] = useState<TotpEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState<NewTOTPForm>(DEFAULT_NEW_CONFIG);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});
  const [timeRemaining, setTimeRemaining] = useState<number>(30);

  const totpConfigsRef = useRef<TotpEntry[]>([]);

  const updateCurrentCodes = useCallback(async () => {
    try {
      const generated = await totpApi.generateAllCodes();
      const codes: Record<string, string> = {};
      let remaining = 30;
      for (const g of generated) {
        codes[g.entry_id] = g.code;
        remaining = g.remaining_seconds;
      }
      setCurrentCodes(codes);
      setTimeRemaining(remaining);
    } catch (err) {
      console.error('Failed to generate TOTP codes:', err);
    }
  }, []);

  const loadTOTPConfigs = useCallback(async () => {
    try {
      const entries = await totpApi.listEntries();
      setTotpConfigs(entries);
    } catch (err) {
      console.error('Failed to load TOTP entries:', err);
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
        newConfig.issuer || 'sortOfRemoteNG',
        'SHA1',
        newConfig.digits || 6,
        newConfig.period || 30,
      );

      try {
        const qrUrl = await totpApi.entryQrDataUri(entry.id);
        setQrCodeUrl(qrUrl);
      } catch (err) {
        console.error('Failed to generate QR code:', err);
      }

      await loadTOTPConfigs();
      setNewConfig(DEFAULT_NEW_CONFIG);
      setShowAddForm(false);
    } catch (err) {
      console.error('Failed to add TOTP entry:', err);
    }
  }, [newConfig, loadTOTPConfigs]);

  const handleDeleteConfig = useCallback(
    async (id: string) => {
      if (confirm('Are you sure you want to delete this TOTP configuration?')) {
        try {
          await totpApi.removeEntry(id);
          setTotpConfigs((prev) => prev.filter((e) => e.id !== id));
        } catch (err) {
          console.error('Failed to delete TOTP entry:', err);
        }
      }
    },
    [],
  );

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const getTimeRemaining = useCallback(() => timeRemaining, [timeRemaining]);

  const clearQrCode = useCallback(() => setQrCodeUrl(''), []);

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
    copyToClipboard,
    getTimeRemaining,
    clearQrCode,
  };
}
