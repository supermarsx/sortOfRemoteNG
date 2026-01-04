import React, { useState, useEffect, useCallback } from 'react';
import { X, Power, Clock, Search, RefreshCw, Send, AlertCircle, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

interface WolDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  last_seen: string | null;
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
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [recentMacs, setRecentMacs] = useState<string[]>([]);

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
      setDevices(result);
      if (result.length === 0) {
        setStatus({ type: 'error', message: 'No devices found in ARP table' });
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

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center space-x-2">
            <Power size={18} className="text-green-400" />
            <h2 className="text-lg font-semibold text-white">{t('wake.quickTool', 'Wake-on-LAN')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {/* Quick Wake Section */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-300">
              {t('wake.macAddress', 'MAC Address')}
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
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
