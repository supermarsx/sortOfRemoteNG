import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { lookupVendor, lookupVendorLocal } from '../../utils/macVendorLookup';

interface WolDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  last_seen: string | null;
  vendor?: string | null;
  vendorSource?: 'local' | 'maclookup' | 'macvendors' | null;
}

interface StatusMessage {
  type: 'success' | 'error' | null;
  message: string;
}

export function useWOLQuickTool(onClose: () => void) {
  const [macAddress, setMacAddress] = useState('');
  const [broadcastAddress, setBroadcastAddress] = useState('255.255.255.255');
  const [port, setPort] = useState(9);
  const [password, setPassword] = useState('');
  const [useSecureOn, setUseSecureOn] = useState(false);
  const [devices, setDevices] = useState<WolDevice[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isBulkWaking, setIsBulkWaking] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({ type: null, message: '' });
  const [recentMacs, setRecentMacs] = useState<string[]>([]);
  const [currentVendor, setCurrentVendor] = useState<string | null>(null);
  const [showScheduleManager, setShowScheduleManager] = useState(false);

  // Load recent MACs from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('wol-recent-macs');
    if (saved) {
      try {
        setRecentMacs(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  // Look up vendor when MAC address changes
  useEffect(() => {
    if (macAddress.length >= 8) {
      const localVendor = lookupVendorLocal(macAddress);
      setCurrentVendor(localVendor);
    } else {
      setCurrentVendor(null);
    }
  }, [macAddress]);

  const saveRecentMac = useCallback(
    (mac: string) => {
      const updated = [mac, ...recentMacs.filter((m) => m !== mac)].slice(0, 10);
      setRecentMacs(updated);
      localStorage.setItem('wol-recent-macs', JSON.stringify(updated));
    },
    [recentMacs],
  );

  const formatMac = useCallback((value: string): string => {
    const clean = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const pairs = clean.match(/.{1,2}/g) || [];
    return pairs.slice(0, 6).join(':');
  }, []);

  const handleMacChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setMacAddress(formatMac(e.target.value));
    },
    [formatMac],
  );

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    setStatus({ type: null, message: '' });
    try {
      const result = await invoke<WolDevice[]>('discover_wol_devices');

      const devicesWithLocalVendor: WolDevice[] = result.map((device) => ({
        ...device,
        vendor: lookupVendorLocal(device.mac),
        vendorSource: lookupVendorLocal(device.mac) ? ('local' as const) : null,
      }));
      setDevices(devicesWithLocalVendor);

      if (result.length === 0) {
        setStatus({ type: 'error', message: 'No devices found in ARP table' });
      } else {
        setIsLookingUp(true);
        const updatedDevices = [...devicesWithLocalVendor];

        for (let i = 0; i < updatedDevices.length; i++) {
          if (!updatedDevices[i].vendor) {
            try {
              const { vendor, source } = await lookupVendor(updatedDevices[i].mac);
              if (vendor) {
                updatedDevices[i] = { ...updatedDevices[i], vendor, vendorSource: source };
                setDevices([...updatedDevices]);
              }
            } catch {
              // Continue with next device
            }
          }
        }
        setIsLookingUp(false);
      }
    } catch (error) {
      setStatus({ type: 'error', message: `Scan failed: ${error}` });
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleWake = useCallback(
    async (targetMac?: string) => {
      const mac = targetMac || macAddress;
      if (!mac) {
        setStatus({ type: 'error', message: 'Please enter a MAC address' });
        return;
      }

      const cleanMac = mac.replace(/[:-]/g, '');
      if (!/^[0-9a-fA-F]{12}$/.test(cleanMac)) {
        setStatus({ type: 'error', message: 'Invalid MAC address format' });
        return;
      }

      setStatus({ type: null, message: '' });
      try {
        await invoke('wake_on_lan', {
          macAddress: mac,
          broadcastAddress: broadcastAddress || undefined,
          port: port || undefined,
          password: useSecureOn && password ? password : undefined,
        });
        setStatus({ type: 'success', message: `Wake packet sent to ${mac}` });
        saveRecentMac(mac);
      } catch (error) {
        setStatus({ type: 'error', message: `Failed to send wake packet: ${error}` });
      }
    },
    [macAddress, broadcastAddress, port, useSecureOn, password, saveRecentMac],
  );

  const toggleDeviceSelection = useCallback((mac: string) => {
    setSelectedDevices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(mac)) {
        newSet.delete(mac);
      } else {
        newSet.add(mac);
      }
      return newSet;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedDevices.size === devices.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(devices.map((d) => d.mac)));
    }
  }, [selectedDevices.size, devices]);

  const handleBulkWake = useCallback(async () => {
    if (selectedDevices.size === 0) {
      setStatus({ type: 'error', message: 'No devices selected' });
      return;
    }

    setIsBulkWaking(true);
    setStatus({ type: null, message: '' });

    let successCount = 0;
    let failCount = 0;

    for (const mac of selectedDevices) {
      try {
        await invoke('wake_on_lan', {
          macAddress: mac,
          broadcastAddress: broadcastAddress || undefined,
          port: port || undefined,
          password: useSecureOn && password ? password : undefined,
        });
        successCount++;
        saveRecentMac(mac);
      } catch {
        failCount++;
      }
    }

    setIsBulkWaking(false);

    if (failCount === 0) {
      setStatus({
        type: 'success',
        message: `Successfully sent wake packets to ${successCount} device${successCount !== 1 ? 's' : ''}`,
      });
    } else if (successCount === 0) {
      setStatus({ type: 'error', message: `Failed to wake all ${failCount} devices` });
    } else {
      setStatus({
        type: 'success',
        message: `Sent ${successCount} wake packet${successCount !== 1 ? 's' : ''}, ${failCount} failed`,
      });
    }

    setSelectedDevices(new Set());
  }, [selectedDevices, broadcastAddress, port, useSecureOn, password, saveRecentMac]);

  const handleWakeAll = useCallback(async () => {
    if (devices.length === 0) {
      setStatus({ type: 'error', message: 'No devices to wake' });
      return;
    }

    setIsBulkWaking(true);
    setStatus({ type: null, message: '' });

    let successCount = 0;
    let failCount = 0;

    for (const device of devices) {
      try {
        await invoke('wake_on_lan', {
          macAddress: device.mac,
          broadcastAddress: broadcastAddress || undefined,
          port: port || undefined,
          password: useSecureOn && password ? password : undefined,
        });
        successCount++;
        saveRecentMac(device.mac);
      } catch {
        failCount++;
      }
    }

    setIsBulkWaking(false);

    if (failCount === 0) {
      setStatus({
        type: 'success',
        message: `Successfully sent wake packets to all ${successCount} devices`,
      });
    } else {
      setStatus({
        type: 'success',
        message: `Sent ${successCount} wake packet${successCount !== 1 ? 's' : ''}, ${failCount} failed`,
      });
    }
  }, [devices, broadcastAddress, port, useSecureOn, password, saveRecentMac]);

  const handleSelectDevice = useCallback((device: WolDevice) => {
    setMacAddress(device.mac);
    setCurrentVendor(device.vendor || null);
    setStatus({ type: null, message: '' });
  }, []);

  const handlePasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPassword(formatMac(e.target.value));
    },
    [formatMac],
  );

  return {
    // State
    macAddress,
    broadcastAddress,
    port,
    password,
    useSecureOn,
    devices,
    selectedDevices,
    isScanning,
    isBulkWaking,
    isLookingUp,
    status,
    recentMacs,
    currentVendor,
    showScheduleManager,
    // Setters
    setMacAddress,
    setBroadcastAddress,
    setPort,
    setUseSecureOn,
    setShowScheduleManager,
    // Handlers
    handleMacChange,
    handleScan,
    handleWake,
    toggleDeviceSelection,
    toggleSelectAll,
    handleBulkWake,
    handleWakeAll,
    handleSelectDevice,
    handlePasswordChange,
    formatMac,
    // Pass-through
    onClose,
  };
}

export type WOLQuickToolMgr = ReturnType<typeof useWOLQuickTool>;
