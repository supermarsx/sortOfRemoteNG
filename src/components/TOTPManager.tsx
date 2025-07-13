import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Copy, RefreshCw, Shield, QrCode, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TOTPConfig } from '../types/settings';
import { TOTPService } from '../utils/totpService';
import QRCode from 'qrcode';

interface TOTPManagerProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
}

export const TOTPManager: React.FC<TOTPManagerProps> = ({ isOpen, onClose, connectionId }) => {
  const { t } = useTranslation();
  const [totpConfigs, setTotpConfigs] = useState<TOTPConfig[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<TOTPConfig>>({
    issuer: 'sortOfRemoteNG',
    account: '',
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  });
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});

  const totpService = new TOTPService();

  useEffect(() => {
    if (isOpen) {
      loadTOTPConfigs();
      const interval = setInterval(updateCurrentCodes, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const loadTOTPConfigs = async () => {
    const configs = await totpService.getAllConfigs();
    setTotpConfigs(configs);
    updateCurrentCodes();
  };

  const updateCurrentCodes = () => {
    const codes: Record<string, string> = {};
    totpConfigs.forEach(config => {
      if (config.secret) {
        codes[config.secret] = totpService.generateToken(config.secret, config);
      }
    });
    setCurrentCodes(codes);
  };

  const handleAddConfig = async () => {
    if (!newConfig.account) return;

    const secret = totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: newConfig.issuer || 'sortOfRemoteNG',
      account: newConfig.account,
      digits: newConfig.digits || 6,
      period: newConfig.period || 30,
      algorithm: newConfig.algorithm || 'SHA1',
    };

    // Generate QR code
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
      algorithm: 'SHA1',
    });
    setShowAddForm(false);
  };

  const handleDeleteConfig = async (secret: string) => {
    if (confirm('Are you sure you want to delete this TOTP configuration?')) {
      await totpService.deleteConfig(secret);
      setTotpConfigs(totpConfigs.filter(config => config.secret !== secret));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getTimeRemaining = () => {
    const now = Math.floor(Date.now() / 1000);
    const period = 30; // Most common TOTP period
    return period - (now % period);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
            <Shield size={20} className="text-blue-400" />
            <span>TOTP Authenticator</span>
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Plus size={14} />
              <span>Add TOTP</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Add TOTP Form */}
          {showAddForm && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-medium text-white mb-4">Add New TOTP Configuration</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Account Name *
                  </label>
                  <input
                    type="text"
                    value={newConfig.account || ''}
                    onChange={(e) => setNewConfig({ ...newConfig, account: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="user@example.com"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Issuer
                  </label>
                  <input
                    type="text"
                    value={newConfig.issuer || ''}
                    onChange={(e) => setNewConfig({ ...newConfig, issuer: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="sortOfRemoteNG"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Digits
                  </label>
                  <select
                    value={newConfig.digits || 6}
                    onChange={(e) => setNewConfig({ ...newConfig, digits: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                  >
                    <option value={6}>6 digits</option>
                    <option value={8}>8 digits</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Period (seconds)
                  </label>
                  <select
                    value={newConfig.period || 30}
                    onChange={(e) => setNewConfig({ ...newConfig, period: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                  >
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddConfig}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Add TOTP
                </button>
              </div>
            </div>
          )}

          {/* QR Code Display */}
          {qrCodeUrl && (
            <div className="bg-gray-700 rounded-lg p-6 mb-6 text-center">
              <h3 className="text-lg font-medium text-white mb-4">Scan QR Code</h3>
              <img src={qrCodeUrl} alt="TOTP QR Code" className="mx-auto mb-4" />
              <p className="text-gray-300 text-sm">
                Scan this QR code with your authenticator app (Google Authenticator, Aegis, etc.)
              </p>
              <button
                onClick={() => setQrCodeUrl('')}
                className="mt-4 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* TOTP Configurations */}
          <div className="space-y-4">
            {totpConfigs.length === 0 ? (
              <div className="text-center py-12">
                <Key size={48} className="mx-auto text-gray-500 mb-4" />
                <p className="text-gray-400">No TOTP configurations found</p>
                <p className="text-gray-500 text-sm">Add a new TOTP configuration to get started</p>
              </div>
            ) : (
              totpConfigs.map(config => (
                <div key={config.secret} className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <Shield size={16} className="text-blue-400" />
                        <span className="text-white font-medium">{config.account}</span>
                        <span className="text-gray-400 text-sm">({config.issuer})</span>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        <div className="bg-gray-800 rounded-lg px-4 py-2 font-mono text-2xl text-green-400">
                          {currentCodes[config.secret] || '------'}
                        </div>
                        
                        <div className="text-sm text-gray-400">
                          <div>Expires in: {getTimeRemaining()}s</div>
                          <div>{config.digits} digits • {config.period}s period</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => copyToClipboard(currentCodes[config.secret] || '')}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                        title="Copy code"
                      >
                        <Copy size={16} />
                      </button>
                      
                      <button
                        onClick={() => copyToClipboard(config.secret)}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                        title="Copy secret"
                      >
                        <Key size={16} />
                      </button>
                      
                      <button
                        onClick={() => handleDeleteConfig(config.secret)}
                        className="p-2 hover:bg-gray-600 rounded transition-colors text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Instructions */}
          <div className="mt-8 bg-blue-900/20 border border-blue-700 rounded-lg p-4">
            <h3 className="text-blue-300 font-medium mb-2">How to use TOTP</h3>
            <ul className="text-blue-200 text-sm space-y-1">
              <li>• Install an authenticator app like Google Authenticator or Aegis</li>
              <li>• Scan the QR code or manually enter the secret key</li>
              <li>• Use the generated codes for two-factor authentication</li>
              <li>• Codes refresh every 30 seconds (or configured period)</li>
              <li>• Keep your secret keys secure and backed up</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
