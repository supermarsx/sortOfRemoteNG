import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../../types/settings';
import { SecureStorage } from '../../../utils/storage';

interface SecuritySettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
}

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
}) => {
  const { t } = useTranslation();
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    let isMounted = true;
    SecureStorage.isStorageEncrypted()
      .then((encrypted) => {
        if (isMounted) {
          setHasPassword(encrypted);
        }
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">{t('security.title')}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('security.algorithm')}
          </label>
          <select
            value={settings.encryptionAlgorithm}
            onChange={(e) => updateSettings({ encryptionAlgorithm: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="AES-256-GCM">AES-256-GCM</option>
            <option value="AES-256-CBC">AES-256-CBC</option>
            <option value="ChaCha20-Poly1305">ChaCha20-Poly1305</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('security.blockCipher')}
          </label>
          <select
            value={settings.blockCipherMode}
            onChange={(e) => updateSettings({ blockCipherMode: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="GCM">GCM</option>
            <option value="CBC">CBC</option>
            <option value="CTR">CTR</option>
            <option value="OFB">OFB</option>
            <option value="CFB">CFB</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('security.iterations')}
          </label>
          <div className="flex space-x-2">
            <input
              type="number"
              value={settings.keyDerivationIterations}
              onChange={(e) => updateSettings({ keyDerivationIterations: parseInt(e.target.value) })}
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              min="10000"
              max="1000000"
            />
            <button
              onClick={handleBenchmark}
              disabled={isBenchmarking}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
            >
              {isBenchmarking ? '...' : 'Benchmark'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('security.benchmarkTime')}
          </label>
          <input
            type="number"
            value={settings.benchmarkTimeSeconds}
            onChange={(e) => updateSettings({ benchmarkTimeSeconds: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="0.5"
            max="10"
            step="0.5"
          />
        </div>
      </div>

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={settings.autoBenchmarkIterations}
          onChange={(e) => updateSettings({ autoBenchmarkIterations: e.target.checked })}
          className="rounded border-gray-600 bg-gray-700 text-blue-600"
        />
        <span className="text-gray-300">{t('security.autoBenchmark')}</span>
      </label>

      <div className="border-t border-gray-700 pt-5 space-y-4">
        <h4 className="text-md font-medium text-white">Auto Lock</h4>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.autoLock.enabled && hasPassword}
            onChange={(e) =>
              updateSettings({
                autoLock: { ...settings.autoLock, enabled: e.target.checked },
              })
            }
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
            disabled={!hasPassword}
          />
          <span className="text-gray-300">
            Enable auto lock after inactivity
          </span>
        </label>
        {!hasPassword && (
          <p className="text-xs text-gray-400">
            Set a storage password to enable auto lock.
          </p>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Auto lock timeout (minutes)
          </label>
          <input
            type="number"
            value={settings.autoLock.timeoutMinutes}
            onChange={(e) =>
              updateSettings({
                autoLock: {
                  ...settings.autoLock,
                  timeoutMinutes: parseInt(e.target.value),
                },
              })
            }
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="1"
            max="240"
            disabled={!hasPassword}
          />
        </div>
      </div>
    </div>
  );
};

export default SecuritySettings;
