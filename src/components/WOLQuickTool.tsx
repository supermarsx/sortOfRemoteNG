import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Power, 
  Clock, 
  Search, 
  RefreshCw, 
  Send, 
  AlertCircle, 
  CheckCircle,
  Cpu,
  Globe,
  Building2,
  Database,
  Loader2,
  CheckSquare,
  Square,
  Zap
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { lookupVendor, lookupVendorLocal } from '../utils/macVendorLookup';

interface WolDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  last_seen: string | null;
  vendor?: string | null;
  vendorSource?: 'local' | 'maclookup' | 'macvendors' | null;
}

interface WOLQuickToolProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WOLQuickTool: React.FC<WOLQuickToolProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
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
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [recentMacs, setRecentMacs] = useState<string[]>([]);
  const [currentVendor, setCurrentVendor] = useState<string | null>(null);

  useEffect(() => {
    // Load recent MACs from localStorage
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

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const saveRecentMac = useCallback((mac: string) => {
    const updated = [mac, ...recentMacs.filter(m => m !== mac)].slice(0, 10);
    setRecentMacs(updated);
    localStorage.setItem('wol-recent-macs', JSON.stringify(updated));
  }, [recentMacs]);

  const handleScan = async () => {
    setIsScanning(true);
    setStatus({ type: null, message: '' });
    try {
      const result = await invoke<WolDevice[]>('discover_wol_devices');
      
      // Add local vendor lookup first (fast)
      const devicesWithLocalVendor: WolDevice[] = result.map(device => ({
        ...device,
        vendor: lookupVendorLocal(device.mac),
        vendorSource: lookupVendorLocal(device.mac) ? 'local' as const : null,
      }));
      setDevices(devicesWithLocalVendor);
      
      if (result.length === 0) {
        setStatus({ type: 'error', message: 'No devices found in ARP table' });
      } else {
        // Then do online lookups for devices without local vendor
        setIsLookingUp(true);
        const updatedDevices = [...devicesWithLocalVendor];
        
        for (let i = 0; i < updatedDevices.length; i++) {
          if (!updatedDevices[i].vendor) {
            try {
              const { vendor, source } = await lookupVendor(updatedDevices[i].mac);
              if (vendor) {
                updatedDevices[i] = {
                  ...updatedDevices[i],
                  vendor,
                  vendorSource: source,
                };
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
  };

  const handleWake = async (targetMac?: string) => {
    const mac = targetMac || macAddress;
    if (!mac) {
      setStatus({ type: 'error', message: 'Please enter a MAC address' });
      return;
    }

    // Validate MAC format
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
  };

  const toggleDeviceSelection = (mac: string) => {
    setSelectedDevices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mac)) {
        newSet.delete(mac);
      } else {
        newSet.add(mac);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDevices.size === devices.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(devices.map(d => d.mac)));
    }
  };

  const handleBulkWake = async () => {
    if (selectedDevices.size === 0) {
      setStatus({ type: 'error', message: 'No devices selected' });
      return;
    }

    setIsBulkWaking(true);
    setStatus({ type: null, message: '' });
    
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

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
      } catch (error) {
        failCount++;
        errors.push(`${mac}: ${error}`);
      }
    }

    setIsBulkWaking(false);
    
    if (failCount === 0) {
      setStatus({ 
        type: 'success', 
        message: `Successfully sent wake packets to ${successCount} device${successCount !== 1 ? 's' : ''}` 
      });
    } else if (successCount === 0) {
      setStatus({ 
        type: 'error', 
        message: `Failed to wake all ${failCount} devices` 
      });
    } else {
      setStatus({ 
        type: 'success', 
        message: `Sent ${successCount} wake packet${successCount !== 1 ? 's' : ''}, ${failCount} failed` 
      });
    }
    
    setSelectedDevices(new Set());
  };

  const handleWakeAll = async () => {
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
        message: `Successfully sent wake packets to all ${successCount} devices` 
      });
    } else {
      setStatus({ 
        type: 'success', 
        message: `Sent ${successCount} wake packet${successCount !== 1 ? 's' : ''}, ${failCount} failed` 
      });
    }
  };

  const handleSelectDevice = (device: WolDevice) => {
    setMacAddress(device.mac);
    setCurrentVendor(device.vendor || null);
    setStatus({ type: null, message: '' });
  };

  const formatMac = (value: string): string => {
    const clean = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const pairs = clean.match(/.{1,2}/g) || [];
    return pairs.slice(0, 6).join(':');
  };

  const handleMacChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMacAddress(formatMac(e.target.value));
  };

  const getVendorSourceIcon = (source: string | null | undefined) => {
    switch (source) {
      case 'local':
        return <span title="Local database"><Database size={10} className="text-blue-400" /></span>;
      case 'maclookup':
      case 'macvendors':
        return <span title="Online lookup"><Globe size={10} className="text-green-400" /></span>;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div 
        className="relative bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden modal-content-animate border border-[var(--color-border)] resize-y"
        style={{ minHeight: '400px', maxHeight: '90vh', height: '85vh' }}
      >
        {/* Scattered glow effect across the background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[250px] h-[180px] bg-green-500/8 rounded-full blur-[100px] top-[20%] left-[15%]" />
          <div className="absolute w-[200px] h-[200px] bg-emerald-500/6 rounded-full blur-[120px] top-[45%] left-[40%]" />
          <div className="absolute w-[220px] h-[150px] bg-teal-500/6 rounded-full blur-[90px] top-[65%] right-[20%]" />
        </div>
        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Power size={20} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">{t('wake.quickTool', 'Wake-on-LAN')}</h2>
              <p className="text-xs text-[var(--color-textSecondary)]">Send magic packets to wake network devices</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] btn-animate"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 space-y-5 overflow-y-auto flex flex-col bg-[var(--color-surface)]" style={{ height: 'calc(100% - 80px)' }}>
          {/* Quick Wake Section */}
          <div className="space-y-3 flex-shrink-0">
            <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
              {t('wake.macAddress', 'MAC Address')}
            </label>
            <div className="flex space-x-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={macAddress}
                  onChange={handleMacChange}
                  placeholder="00:11:22:33:44:55"
                  className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all font-mono text-lg"
                />
                {currentVendor && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 bg-[var(--color-surfaceHover)] rounded text-xs text-[var(--color-textSecondary)]">
                    <Building2 size={12} className="text-green-500" />
                    <span>{currentVendor}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => handleWake()}
                disabled={!macAddress}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center space-x-2 font-medium btn-animate shadow-lg shadow-green-500/20 disabled:shadow-none"
              >
                <Send size={18} />
                <span>{t('wake.send', 'Wake')}</span>
              </button>
            </div>
          </div>

          {/* Advanced Options */}
          <details className="group flex-shrink-0">
            <summary className="text-sm text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] flex items-center gap-2 transition-colors">
              <Cpu size={14} />
              {t('wake.advancedOptions', 'Advanced Options')}
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-4 p-4 bg-[var(--color-surfaceHover)]/30 rounded-lg border border-[var(--color-border)] animate-fade-in">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-2">
                  {t('wake.broadcastAddress', 'Broadcast Address')}
                </label>
                <input
                  type="text"
                  value={broadcastAddress}
                  onChange={(e) => setBroadcastAddress(e.target.value)}
                  placeholder="255.255.255.255"
                  className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-2">
                  {t('wake.port', 'UDP Port')}
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 9)}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
                />
              </div>
              <div className="col-span-2">
                <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSecureOn}
                    onChange={(e) => setUseSecureOn(e.target.checked)}
                    className="rounded bg-[var(--color-input)] border-[var(--color-border)] text-green-500 focus:ring-green-500"
                  />
                  <span>{t('wake.secureOn', 'SecureOn Password')}</span>
                </label>
                {useSecureOn && (
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(formatMac(e.target.value))}
                    placeholder="00:00:00:00:00:00"
                    className="mt-2 w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-green-500 transition-all animate-fade-in"
                  />
                )}
              </div>
            </div>
          </details>

          {/* Status Message */}
          {status.type && (
            <div className={`flex items-center space-x-3 p-4 rounded-lg animate-fade-in-up ${
              status.type === 'success' 
                ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30' 
                : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
            }`}>
              {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
              <span className="text-sm font-medium">{status.message}</span>
            </div>
          )}

          {/* Recent MACs */}
          {recentMacs.length > 0 && (
            <div className="animate-fade-in flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
                  <Clock size={14} className="text-[var(--color-textMuted)]" />
                  {t('wake.recent', 'Recent')}
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentMacs.map((mac, idx) => (
                  <button
                    key={idx}
                    onClick={() => setMacAddress(mac)}
                    className="px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-lg transition-all font-mono border border-[var(--color-border)] btn-animate"
                  >
                    {mac}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Network Scan */}
          <div className="animate-fade-in flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
                <Search size={14} className="text-[var(--color-textMuted)]" />
                {t('wake.networkDevices', 'Network Devices')}
                {devices.length > 0 && (
                  <span className="text-xs text-[var(--color-textMuted)]">({devices.length})</span>
                )}
                {isLookingUp && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
                    <Loader2 size={10} className="animate-spin" />
                    Looking up vendors...
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                {devices.length > 0 && (
                  <>
                    <button
                      onClick={toggleSelectAll}
                      className="px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-lg transition-all flex items-center space-x-2 border border-[var(--color-border)] btn-animate"
                      title={selectedDevices.size === devices.length ? 'Deselect all' : 'Select all'}
                    >
                      {selectedDevices.size === devices.length ? <CheckSquare size={12} /> : <Square size={12} />}
                      <span>{selectedDevices.size === devices.length ? t('wake.deselectAll', 'Deselect All') : t('wake.selectAll', 'Select All')}</span>
                    </button>
                    {selectedDevices.size > 0 && (
                      <button
                        onClick={handleBulkWake}
                        disabled={isBulkWaking}
                        className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-all flex items-center space-x-2 btn-animate shadow-md shadow-green-500/20 disabled:shadow-none"
                      >
                        {isBulkWaking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        <span>{t('wake.wakeSelected', 'Wake Selected')} ({selectedDevices.size})</span>
                      </button>
                    )}
                    <button
                      onClick={handleWakeAll}
                      disabled={isBulkWaking}
                      className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 text-white rounded-lg transition-all flex items-center space-x-2 btn-animate shadow-md shadow-amber-500/20 disabled:shadow-none"
                      title="Wake all discovered devices"
                    >
                      {isBulkWaking ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      <span>{t('wake.wakeAll', 'Wake All')}</span>
                    </button>
                  </>
                )}
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className="px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-lg transition-all flex items-center space-x-2 border border-[var(--color-border)] btn-animate"
                >
                  <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
                  <span>{isScanning ? t('wake.scanning', 'Scanning...') : t('wake.scan', 'Scan ARP')}</span>
                </button>
              </div>
            </div>
            
            {devices.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 stagger-animate">
                {devices.map((device, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectDevice(device)}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border group animate-fade-in-up card-hover-effect ${
                      selectedDevices.has(device.mac)
                        ? 'bg-green-500/10 border-green-500/40 hover:bg-green-500/15'
                        : 'bg-[var(--color-surfaceHover)]/30 border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]/50 hover:border-[var(--color-textMuted)]'
                    }`}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDeviceSelection(device.mac);
                        }}
                        className={`p-1 rounded transition-colors ${
                          selectedDevices.has(device.mac)
                            ? 'text-green-500 hover:text-green-400'
                            : 'text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]'
                        }`}
                      >
                        {selectedDevices.has(device.mac) ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--color-text)] font-mono">{device.mac}</span>
                          {device.vendor && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-[var(--color-surfaceHover)] rounded text-xs text-[var(--color-textSecondary)]">
                              {getVendorSourceIcon(device.vendorSource)}
                              <Building2 size={10} />
                              {device.vendor}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--color-textMuted)] mt-1 flex items-center gap-2">
                          <span>{device.ip}</span>
                          {device.hostname && (
                            <>
                              <span className="text-[var(--color-border)]">•</span>
                              <span className="text-[var(--color-textMuted)]">{device.hostname}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWake(device.mac);
                      }}
                      className="ml-3 p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all opacity-0 group-hover:opacity-100 btn-animate shadow-lg shadow-green-500/20"
                      title="Wake this device"
                    >
                      <Power size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {devices.length === 0 && !isScanning && (
              <div className="text-center py-8 text-[var(--color-textMuted)]">
                <Search size={32} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">Click "Scan ARP" to discover devices on your network</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
