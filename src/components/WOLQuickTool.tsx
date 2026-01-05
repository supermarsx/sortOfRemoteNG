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
  Loader2
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
  const [isScanning, setIsScanning] = useState(false);
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
      const devicesWithLocalVendor = result.map(device => ({
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
        return <Database size={10} className="text-blue-400" title="Local database" />;
      case 'maclookup':
      case 'macvendors':
        return <Globe size={10} className="text-green-400" title="Online lookup" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-animate flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden modal-content-animate border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gradient-to-r from-gray-800 to-gray-750">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Power size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{t('wake.quickTool', 'Wake-on-LAN')}</h2>
              <p className="text-xs text-gray-400">Send magic packets to wake network devices</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white btn-animate"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(85vh-80px)]">
          {/* Quick Wake Section */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-300">
              {t('wake.macAddress', 'MAC Address')}
            </label>
            <div className="flex space-x-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={macAddress}
                  onChange={handleMacChange}
                  placeholder="00:11:22:33:44:55"
                  className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all font-mono text-lg"
                />
                {currentVendor && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 bg-gray-600/50 rounded text-xs text-gray-300">
                    <Building2 size={12} className="text-green-400" />
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
                value={macAddress}
                onChange={handleMacChange}
                placeholder="00:11:22:33:44:55"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={() => handleWake()}
                disabled={!macAddress}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center space-x-2"
              >
                <Send size={16} />
                <span>{t('wake.send', 'Wake')}</span>
              </button>
            </div>
          </div>

          {/* Advanced Options */}
          <details className="group">
            <summary className="text-sm text-gray-400 cursor-pointer hover:text-white">
              {t('wake.advancedOptions', 'Advanced Options')}
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-gray-700">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {t('wake.broadcastAddress', 'Broadcast Address')}
                </label>
                <input
                  type="text"
                  value={broadcastAddress}
                  onChange={(e) => setBroadcastAddress(e.target.value)}
                  placeholder="255.255.255.255"
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {t('wake.port', 'UDP Port')}
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 9)}
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div>
                <label className="flex items-center space-x-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={useSecureOn}
                    onChange={(e) => setUseSecureOn(e.target.checked)}
                    className="rounded"
                  />
                  <span>{t('wake.secureOn', 'SecureOn Password')}</span>
                </label>
                {useSecureOn && (
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(formatMac(e.target.value))}
                    placeholder="00:00:00:00:00:00"
                    className="mt-2 w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white"
                  />
                )}
              </div>
            </div>
          </details>

          {/* Status Message */}
          {status.type && (
            <div className={`flex items-center space-x-2 p-3 rounded-md ${
              status.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
            }`}>
              {status.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span className="text-sm">{status.message}</span>
            </div>
          )}

          {/* Recent MACs */}
          {recentMacs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-400">
                  <Clock size={14} className="inline mr-1" />
                  {t('wake.recent', 'Recent')}
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentMacs.map((mac, idx) => (
                  <button
                    key={idx}
                    onClick={() => setMacAddress(mac)}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                  >
                    {mac}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Network Scan */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-400">
                <Search size={14} className="inline mr-1" />
                {t('wake.networkDevices', 'Network Devices')}
              </label>
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center space-x-1"
              >
                <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
                <span>{isScanning ? t('wake.scanning', 'Scanning...') : t('wake.scan', 'Scan ARP')}</span>
              </button>
            </div>
            
            {devices.length > 0 && (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {devices.map((device, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectDevice(device)}
                    className="flex items-center justify-between p-2 bg-gray-700/50 hover:bg-gray-700 rounded cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-mono truncate">{device.mac}</div>
                      <div className="text-xs text-gray-400">
                        {device.ip} {device.hostname && `(${device.hostname})`}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWake(device.mac);
                      }}
                      className="ml-2 p-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                      title="Wake this device"
                    >
                      <Power size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
