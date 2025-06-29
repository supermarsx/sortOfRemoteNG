import React, { useState } from 'react';
import { Play, X } from 'lucide-react';

interface QuickConnectProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (hostname: string, protocol: string) => void;
}

export const QuickConnect: React.FC<QuickConnectProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [hostname, setHostname] = useState('');
  const [protocol, setProtocol] = useState('rdp');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hostname.trim()) {
      onConnect(hostname.trim(), protocol);
      setHostname('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Quick Connect</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Hostname or IP Address
            </label>
            <input
              type="text"
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="192.168.1.100 or server.example.com"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Protocol
            </label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="rdp">RDP (Remote Desktop)</option>
              <option value="ssh">SSH (Secure Shell)</option>
              <option value="vnc">VNC (Virtual Network Computing)</option>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="telnet">Telnet</option>
            </select>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Play size={16} />
              <span>Connect</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
