import React from 'react';
import { Cloud, Database, Folder, Globe, HardDrive, Monitor, Server, Shield, Star, Terminal } from 'lucide-react';
import { Connection } from '../../types/connection';
import { getDefaultPort } from '../../utils/defaultPorts';

interface GeneralSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  availableGroups: Connection[];
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({ formData, setFormData, availableGroups }) => {
  const iconOptions = [
    { value: '', label: 'Default', icon: Monitor },
    { value: 'terminal', label: 'Terminal', icon: Terminal },
    { value: 'globe', label: 'Web', icon: Globe },
    { value: 'database', label: 'Database', icon: Database },
    { value: 'server', label: 'Server', icon: Server },
    { value: 'shield', label: 'Shield', icon: Shield },
    { value: 'cloud', label: 'Cloud', icon: Cloud },
    { value: 'folder', label: 'Folder', icon: Folder },
    { value: 'star', label: 'Star', icon: Star },
    { value: 'drive', label: 'Drive', icon: HardDrive },
  ];

  const handleProtocolChange = (protocol: string) => {
    setFormData(prev => ({
      ...prev,
      protocol: protocol as Connection['protocol'],
      port: getDefaultPort(protocol),
      authType: ['http', 'https'].includes(protocol) ? 'basic' : 'password',
    }));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={!!formData.isGroup}
            onChange={(e) => setFormData({ ...formData, isGroup: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-gray-300">Create as folder/group</span>
        </label>
        {!formData.isGroup && (
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={!!formData.favorite}
              onChange={(e) => setFormData({ ...formData, favorite: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-300">Mark as favorite</span>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Name *</label>
          <input
            type="text"
            required
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={formData.isGroup ? 'Folder name' : 'Connection name'}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Icon</label>
          <div className="grid grid-cols-5 gap-2">
            {iconOptions.map(({ value, label, icon: Icon }) => {
              const isActive = (formData.icon || '') === value;
              return (
                <button
                  key={value || 'default'}
                  type="button"
                  onClick={() => setFormData({ ...formData, icon: value || undefined })}
                  className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-500/10 text-blue-200'
                      : 'border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title={label}
                >
                  <Icon size={16} />
                  <span className="text-[10px] uppercase tracking-wide">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Parent Folder</label>
          <select
            value={formData.parentId || ''}
            onChange={(e) => setFormData({ ...formData, parentId: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Root (No parent)</option>
            {availableGroups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>

        {!formData.isGroup && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Protocol</label>
              <select
                value={formData.protocol}
                onChange={(e) => handleProtocolChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="rdp">RDP (Remote Desktop)</option>
                <option value="ssh">SSH (Secure Shell)</option>
                <option value="vnc">VNC (Virtual Network Computing)</option>
                <option value="anydesk">AnyDesk</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="telnet">Telnet</option>
                <option value="rlogin">RLogin</option>
                <option value="gcp">Google Cloud Platform (GCP)</option>
                <option value="azure">Microsoft Azure</option>
                <option value="ibm-csp">IBM Cloud</option>
                <option value="digital-ocean">Digital Ocean</option>
                <option value="heroku">Heroku</option>
                <option value="scaleway">Scaleway</option>
                <option value="linode">Linode</option>
                <option value="ovhcloud">OVH Cloud</option>
              </select>
            </div>

            {formData.protocol === 'ssh' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">SSH Implementation</label>
                <div className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-400">
                  Rust SSH Library
                </div>
                <p className="text-xs text-gray-500 mt-1">Using secure Rust-based SSH implementation</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Hostname/IP *</label>
              <input
                type="text"
                required
                value={formData.hostname || ''}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="192.168.1.100 or server.example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Port</label>
              <input
                type="number"
                value={formData.port || 0}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min={1}
                max={65535}
              />
            </div>

            {formData.protocol === 'rdp' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Domain</label>
                <input
                  type="text"
                  value={formData.domain || ''}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Domain (optional)"
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default GeneralSection;
