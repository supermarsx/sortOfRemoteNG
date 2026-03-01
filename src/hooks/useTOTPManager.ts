import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TOTPConfig } from '../types/settings';
import { TOTPService } from '../utils/totpService';
import QRCode from 'qrcode';

export function useTOTPManager(isOpen: boolean, connectionId?: string) {
  const [totpConfigs, setTotpConfigs] = useState<TOTPConfig[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<TOTPConfig>>({
    issuer: 'sortOfRemoteNG',
    account: '',
    digits: 6,
    period: 30,
    algorithm: 'sha1',
  });
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});

  const totpService = useMemo(() => new TOTPService(), []);
  const totpConfigsRef = useRef<TOTPConfig[]>([]);

  const updateCurrentCodes = useCallback(() => {
    const codes: Record<string, string> = {};
    totpConfigsRef.current.forEach((config) => {
      if (config.secret) {
        codes[config.secret] = totpService.generateToken(config.secret, config);
      }
    });
    setCurrentCodes(codes);
  }, [totpService]);

  const loadTOTPConfigs = useCallback(async () => {
    const configs = await totpService.getAllConfigs();
    setTotpConfigs(configs);
  }, [totpService]);

  useEffect(() => {
    totpConfigsRef.current = totpConfigs;
    updateCurrentCodes();
  }, [totpConfigs, updateCurrentCodes]);

  useEffect(() => {
    if (isOpen) {
      void loadTOTPConfigs();
      const interval = setInterval(updateCurrentCodes, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, loadTOTPConfigs, updateCurrentCodes]);

  const handleAddConfig = useCallback(async () => {
    if (!newConfig.account) return;

    const secret = totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: newConfig.issuer || 'sortOfRemoteNG',
      account: newConfig.account,
      digits: newConfig.digits || 6,
      period: newConfig.period || 30,
      algorithm: newConfig.algorithm || 'sha1',
    };

    const otpAuthUrl = totpService.generateOTPAuthURL(config);
    try {
      const qrUrl = await QRCode.toDataURL(otpAuthUrl);
      setQrCodeUrl(qrUrl);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }

    await totpService.saveConfig(config);
    setTotpConfigs([...totpConfigs, config]);
    setNewConfig({
      issuer: 'sortOfRemoteNG',
      account: '',
      digits: 6,
      period: 30,
      algorithm: 'sha1',
    });
    setShowAddForm(false);
  }, [newConfig, totpConfigs, totpService]);

  const handleDeleteConfig = useCallback(
    async (secret: string) => {
      if (confirm('Are you sure you want to delete this TOTP configuration?')) {
        await totpService.deleteConfig(secret);
        setTotpConfigs(totpConfigs.filter((config) => config.secret !== secret));
      }
    },
    [totpConfigs, totpService],
  );

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const getTimeRemaining = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    const period = 30;
    return period - (now % period);
  }, []);

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
