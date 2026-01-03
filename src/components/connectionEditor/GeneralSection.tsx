import React from 'react';
import { Connection } from '../../types/connection';
import { SSHLibraryType } from '../../utils/sshLibraries';
import { getDefaultPort } from '../../utils/defaultPorts';

interface GeneralSectionProps {
  formData: Partial<Connection & { sshLibrary?: SSHLibraryType }>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection & { sshLibrary?: SSHLibraryType }>>>;
  availableGroups: Connection[];
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({ formData, setFormData, availableGroups }) => {
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
      <div className="flex items-center space-x-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={!!formData.isGroup}
            onChange={(e) => setFormData({ ...formData, isGroup: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-gray-300">Create as folder/group</span>
        </label>
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
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="telnet">Telnet</option>
                <option value="rlogin">RLogin</option>
                <option value="gcp">Google Cloud Platform (GCP)</option>
                <option value="azure">Microsoft Azure</option>
                <option value="ibm-csp">IBM Cloud</option>
                <option value="digital-ocean">Digital Ocean</option>
              </select>
            </div>

            {formData.protocol === 'ssh' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">SSH Library</label>
                <select
                  value={formData.sshLibrary}
                  onChange={(e) => setFormData({ ...formData, sshLibrary: e.target.value as SSHLibraryType })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="webssh">WebSSH Library (Default)</option>
                  <option value="ssh2">SSH2 Library</option>
                  <option value="node-ssh">Node-SSH Library</option>
                  <option value="simple-ssh">Simple-SSH Library</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Choose the SSH library implementation for this connection</p>
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
