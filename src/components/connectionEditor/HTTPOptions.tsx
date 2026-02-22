import React, { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Connection } from '../../types/connection';

interface HTTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({ formData, setFormData }) => {
  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');
  const isHttps = formData.protocol === 'https';

  const [showAddHeader, setShowAddHeader] = useState(false);
  const [headerName, setHeaderName] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const headerNameRef = useRef<HTMLInputElement>(null);

  // Focus the header name input when the dialog opens
  useEffect(() => {
    if (showAddHeader) {
      setTimeout(() => headerNameRef.current?.focus(), 50);
    }
  }, [showAddHeader]);

  if (formData.isGroup || !isHttpProtocol) return null;

  const handleAddHeader = () => {
    const name = headerName.trim();
    if (!name) return;
    setFormData(prev => ({
      ...prev,
      httpHeaders: {
        ...(prev.httpHeaders || {}),
        [name]: headerValue,
      },
    }));
    setHeaderName('');
    setHeaderValue('');
    setShowAddHeader(false);
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

      {isHttps && (
        <div className="md:col-span-2">
          <label className="flex items-center space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={formData.httpVerifySsl ?? true}
              onChange={(e) =>
                setFormData({ ...formData, httpVerifySsl: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            <span>Verify TLS certificates</span>
          </label>
          {(formData.httpVerifySsl ?? true) ? (
            <p className="text-xs text-gray-500 mt-1">
              Disable only for self-signed or untrusted certificates.
            </p>
          ) : (
            <div className="flex items-start gap-2 mt-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">SSL verification disabled</p>
                <p className="text-xs text-red-300/70 mt-0.5">
                  This connection will accept any certificate, including potentially malicious ones.
                  Only use this for trusted internal servers with self-signed certificates.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {isHttps && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Certificate Trust Policy
          </label>
          <select
            value={formData.tlsTrustPolicy ?? ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                tlsTrustPolicy: e.target.value === '' ? undefined : (e.target.value as 'tofu' | 'always-ask' | 'always-trust' | 'strict'),
              })
            }
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">Use global default</option>
            <option value="tofu">Trust On First Use (TOFU)</option>
            <option value="always-ask">Always Ask</option>
            <option value="always-trust">Always Trust (skip verification)</option>
            <option value="strict">Strict (reject unless pre-approved)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Controls whether certificate fingerprints are memorized and verified across connections.
          </p>
        </div>
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
              onClick={() => setShowAddHeader(true)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              Add Header
            </button>
          </div>
        </div>
      )}

      {/* Add Header overlay dialog */}
      {showAddHeader && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddHeader(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowAddHeader(false);
          }}
        >
          <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 relative">
            <div className="relative h-12 border-b border-gray-700">
              <h2 className="absolute left-5 top-3 text-sm font-semibold text-white">
                Add HTTP Header
              </h2>
              <button
                type="button"
                onClick={() => setShowAddHeader(false)}
                className="absolute right-3 top-2 text-gray-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Header Name</label>
                <input
                  ref={headerNameRef}
                  type="text"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddHeader();
                    }
                  }}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g. Authorization"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Header Value</label>
                <input
                  type="text"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddHeader();
                    }
                  }}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g. Bearer token123"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddHeader(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddHeader}
                  className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HTTPOptions;
