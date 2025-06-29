import React, { useState, useEffect } from 'react';
import { X, Search, Wifi, Monitor, Database, HardDrive, Globe, Play, Plus, Settings, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NetworkDiscoveryConfig, DiscoveredHost, DiscoveredService } from '../types/connection';
import { NetworkScanner } from '../utils/networkScanner';
import { useConnections } from '../contexts/ConnectionContext';

interface NetworkDiscoveryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NetworkDiscovery: React.FC<NetworkDiscoveryProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { dispatch } = useConnections();
  const [config, setConfig] = useState<NetworkDiscoveryConfig>({
    enabled: true,
    ipRange: '192.168.1.0/24',
    portRanges: ['22', '80', '443', '3389', '5900'],
    protocols: ['ssh', 'http', 'https', 'rdp', 'vnc'],
    timeout: 5000,
    maxConcurrent: 50,
    customPorts: {
      ssh: [22],
      http: [80, 8080, 8000],
      https: [443, 8443],
      rdp: [3389],
      vnc: [5900, 5901, 5902],
      mysql: [3306],
      ftp: [21],
      telnet: [23],
    },
  });
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const scanner = new NetworkScanner();

  const handleScan = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setDiscoveredHosts([]);

    try {
      const hosts = await scanner.scanNetwork(config, (progress) => {
        setScanProgress(progress);
      });
      setDiscoveredHosts(hosts);
    } catch (error) {
      console.error('Network scan failed:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCreateConnections = () => {
    selectedHosts.forEach(hostIp => {
      const host = discoveredHosts.find(h => h.ip === hostIp);
      if (!host) return;

      host.services.forEach(service => {
        const connection = {
          id: crypto.randomUUID(),
          name: `${host.hostname || host.ip} (${service.service})`,
          protocol: service.protocol as any,
          hostname: host.ip,
          port: service.port,
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          description: `Auto-discovered ${service.service} service${service.version ? ` (${service.version})` : ''}`,
          tags: ['auto-discovered'],
        };

        dispatch({ type: 'ADD_CONNECTION', payload: connection });
      });
    });

    setSelectedHosts(new Set());
    onClose();
  };

  const getServiceIcon = (service: string) => {
    switch (service.toLowerCase()) {
      case 'ssh': return Monitor;
      case 'http':
      case 'https': return Globe;
      case 'rdp': return Monitor;
      case 'vnc': return Monitor;
      case 'mysql': return Database;
      case 'ftp':
      case 'sftp': return HardDrive;
      default: return Wifi;
    }
  };

  const toggleHostSelection = (hostIp: string) => {
    const newSelection = new Set(selectedHosts);
    if (newSelection.has(hostIp)) {
      newSelection.delete(hostIp);
    } else {
      newSelection.add(hostIp);
    }
    setSelectedHosts(newSelection);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Network Discovery</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Settings size={14} />
              <span>Advanced</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Scan Configuration */}
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  IP Range (CIDR)
                </label>
                <input
                  type="text"
                  value={config.ipRange}
                  onChange={(e) => setConfig({ ...config, ipRange: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                  placeholder="192.168.1.0/24"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Timeout (ms)
                </label>
                <input
                  type="number"
                  value={config.timeout}
                  onChange={(e) => setConfig({ ...config, timeout: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                  min="1000"
                  max="30000"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Concurrent
                </label>
                <input
                  type="number"
                  value={config.maxConcurrent}
                  onChange={(e) => setConfig({ ...config, maxConcurrent: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                  min="1"
                  max="100"
                />
              </div>
            </div>

            {showAdvanced && (
              <div className="bg-gray-700 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-medium text-white mb-4">Advanced Configuration</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Port Ranges (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={config.portRanges.join(', ')}
                      onChange={(e) => setConfig({ 
                        ...config, 
                        portRanges: e.target.value.split(',').map(p => p.trim()) 
                      })}
                      className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                      placeholder="22, 80, 443, 3389, 5900"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Protocols to Detect
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {['ssh', 'http', 'https', 'rdp', 'vnc', 'mysql', 'ftp', 'telnet'].map(protocol => (
                        <label key={protocol} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={config.protocols.includes(protocol)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({ ...config, protocols: [...config.protocols, protocol] });
                              } else {
                                setConfig({ 
                                  ...config, 
                                  protocols: config.protocols.filter(p => p !== protocol) 
                                });
                              }
                            }}
                            className="rounded border-gray-600 bg-gray-700 text-blue-600"
                          />
                          <span className="text-gray-300 text-sm">{protocol.toUpperCase()}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center space-x-4">
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors flex items-center space-x-2"
              >
                {isScanning ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Scanning... {scanProgress.toFixed(0)}%</span>
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    <span>Start Scan</span>
                  </>
                )}
              </button>

              {selectedHosts.size > 0 && (
                <button
                  onClick={handleCreateConnections}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors flex items-center space-x-2"
                >
                  <Plus size={16} />
                  <span>Create {selectedHosts.size} Connection(s)</span>
                </button>
              )}
            </div>

            {isScanning && (
              <div className="mt-4">
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Discovered Hosts */}
          {discoveredHosts.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-white mb-4">
                Discovered Hosts ({discoveredHosts.length})
              </h3>
              
              <div className="space-y-4">
                {discoveredHosts.map(host => (
                  <div
                    key={host.ip}
                    className={`bg-gray-700 rounded-lg p-4 border-2 transition-colors cursor-pointer ${
                      selectedHosts.has(host.ip) 
                        ? 'border-blue-500 bg-blue-900/20' 
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                    onClick={() => toggleHostSelection(host.ip)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedHosts.has(host.ip)}
                          onChange={() => toggleHostSelection(host.ip)}
                          className="rounded border-gray-600 bg-gray-700 text-blue-600"
                        />
                        <div>
                          <h4 className="text-white font-medium">
                            {host.hostname || host.ip}
                          </h4>
                          {host.hostname && (
                            <p className="text-gray-400 text-sm">{host.ip}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <p className="text-gray-400 text-sm">
                          Response: {host.responseTime}ms
                        </p>
                        {host.macAddress && (
                          <p className="text-gray-500 text-xs">
                            MAC: {host.macAddress}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {host.services.map((service, index) => {
                        const ServiceIcon = getServiceIcon(service.service);
                        return (
                          <div
                            key={index}
                            className="bg-gray-600 rounded-lg p-3 flex items-center space-x-3"
                          >
                            <ServiceIcon size={20} className="text-blue-400" />
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-medium">
                                {service.service.toUpperCase()}
                              </p>
                              <p className="text-gray-400 text-sm">
                                Port {service.port}
                              </p>
                              {service.version && (
                                <p className="text-gray-500 text-xs truncate">
                                  {service.version}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isScanning && discoveredHosts.length === 0 && (
            <div className="text-center py-12">
              <Search size={48} className="mx-auto text-gray-500 mb-4" />
              <p className="text-gray-400">No hosts discovered yet. Start a scan to find devices on your network.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};