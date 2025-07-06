import React from 'react';
import { Connection } from '../../types/connection';
import { SSHLibraryType } from '../../utils/sshLibraries';

interface HTTPOptionsProps {
  formData: Partial<Connection & { sshLibrary?: SSHLibraryType }>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection & { sshLibrary?: SSHLibraryType }>>>;
}

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({ formData, setFormData }) => {
  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');
  if (formData.isGroup || !isHttpProtocol) return null;

  const addHttpHeader = () => {
    const key = prompt('Header name:');
    if (key) {
      const value = prompt('Header value:');
      if (value !== null) {
        setFormData(prev => ({
          ...prev,
          httpHeaders: {
            ...(prev.httpHeaders || {}),
            [key]: value,
          },
        }));
      }
    }
  };

  const removeHttpHeader = (key: string) => {
    const headers = { ...(formData.httpHeaders || {}) } as Record<string, string>;
    delete headers[key];
    setFormData({ ...formData, httpHeaders: headers });
  };

  return (
    <>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-300 mb-2">Authentication Type</label>
        <select
          value={formData.authType}
          onChange={(e) => setFormData({ ...formData, authType: e.target.value as any })}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="basic">Basic Authentication</option>
          <option value="header">Custom Headers</option>
        </select>
      </div>

      {formData.authType === 'basic' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Basic Auth Username</label>
            <input
              type="text"
              value={formData.basicAuthUsername || ''}
              onChange={(e) => setFormData({ ...formData, basicAuthUsername: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Basic Auth Password</label>
            <input
              type="password"
              value={formData.basicAuthPassword || ''}
              onChange={(e) => setFormData({ ...formData, basicAuthPassword: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Password"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">Realm (Optional)</label>
            <input
              type="text"
              value={formData.basicAuthRealm || ''}
              onChange={(e) => setFormData({ ...formData, basicAuthRealm: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Authentication realm"
            />
          </div>
        </>
      )}

      {formData.authType === 'header' && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Custom HTTP Headers</label>
          <div className="space-y-2">
            {Object.entries(formData.httpHeaders || {}).map(([key, value]) => (
              <div key={key} className="flex items-center space-x-2">
                <input
                  type="text"
                  value={key}
                  readOnly
                  className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setFormData({ ...formData, httpHeaders: { ...(formData.httpHeaders || {}), [key]: e.target.value } })}
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                />
                <button
                  type="button"
                  onClick={() => removeHttpHeader(key)}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addHttpHeader}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              Add Header
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default HTTPOptions;
