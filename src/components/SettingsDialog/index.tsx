import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  RotateCcw,
  Shield,
  Zap,
  Monitor,
  Code,
  Wifi,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, ProxyConfig } from '../../types/settings';
import GeneralSettings from './sections/GeneralSettings';
import SecuritySettings from './sections/SecuritySettings';
import PerformanceSettings from './sections/PerformanceSettings';
import ProxySettings from './sections/ProxySettings';
import AdvancedSettings from './sections/AdvancedSettings';
import { SettingsManager } from '../../utils/settings';
import { ThemeManager } from '../../utils/themeManager';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'success' | 'error' | null>(null);
  const settingsManager = SettingsManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    const currentSettings = await settingsManager.loadSettings();
    setSettings(currentSettings);
  };

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      await settingsManager.saveSettings(settings);
      
      // Apply language change
      if (settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }
      
      // Apply theme changes
      themeManager.applyTheme(settings.theme, settings.colorScheme);
      
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const handleReset = async () => {
    if (confirm(t('settings.reset'))) {
      const defaultSettings = await settingsManager.loadSettings();
      setSettings(defaultSettings);
    }
  };

  const handleBenchmark = async () => {
    if (!settings) return;
    
    setIsBenchmarking(true);
    try {
      const optimalIterations = await settingsManager.benchmarkKeyDerivation(settings.benchmarkTimeSeconds);
      setSettings({
        ...settings,
        keyDerivationIterations: optimalIterations,
      });
    } catch (error) {
      console.error('Benchmark failed:', error);
    } finally {
      setIsBenchmarking(false);
    }
  };

  const showAutoSave = (status: 'success' | 'error') => {
    setAutoSaveStatus(status);
    setTimeout(() => setAutoSaveStatus(null), 2000);
  };

  const updateSettings = async (updates: Partial<GlobalSettings>) => {
    if (!settings) return;

    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    try {
      await settingsManager.saveSettings(newSettings);

      if (updates.language && updates.language !== i18n.language) {
        i18n.changeLanguage(updates.language);
      }

      if (updates.theme || updates.colorScheme) {
        themeManager.applyTheme(newSettings.theme, newSettings.colorScheme);
      }

      showAutoSave('success');
    } catch (error) {
      console.error('Failed to auto save settings:', error);
      showAutoSave('error');
    }
  };

  const updateProxy = async (updates: Partial<ProxyConfig>) => {
    if (!settings) return;

    const newSettings = {
      ...settings,
      globalProxy: { ...settings.globalProxy, ...updates } as ProxyConfig,
    };
    setSettings(newSettings);

    try {
      await settingsManager.saveSettings(newSettings);
      showAutoSave('success');
    } catch (error) {
      console.error('Failed to auto save settings:', error);
      showAutoSave('error');
    }
  };

  if (!isOpen || !settings) return null;

  const tabs = [
    { id: 'general', label: t('settings.general'), icon: Monitor },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'performance', label: t('settings.performance'), icon: Zap },
    { id: 'proxy', label: 'Proxy', icon: Wifi },
    { id: 'advanced', label: t('settings.advanced'), icon: Code },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden relative">
        {autoSaveStatus && (
          <div className={`absolute top-2 right-2 flex items-center space-x-1 text-sm ${
            autoSaveStatus === 'success' ? 'text-green-400' : 'text-red-400'
          }`}>
            {autoSaveStatus === 'success' ? (
              <CheckCircle size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>
              {autoSaveStatus === 'success'
                ? t('settings.autoSaveSuccess')
                : t('settings.autoSaveError')}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex h-[600px]">
          {/* Sidebar */}
          <div className="w-64 bg-gray-900 border-r border-gray-700">
            <div className="p-4">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-left transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {activeTab === 'general' && (
                <GeneralSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'security' && (
                <SecuritySettings
                  settings={settings}
                  updateSettings={updateSettings}
                  handleBenchmark={handleBenchmark}
                  isBenchmarking={isBenchmarking}
                />
              )}

              {activeTab === 'performance' && (
                <PerformanceSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'proxy' && (
                <ProxySettings settings={settings} updateProxy={updateProxy} />
              )}

              {activeTab === 'advanced' && (
                <AdvancedSettings settings={settings} updateSettings={updateSettings} />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-700">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors flex items-center space-x-2"
          >
            <RotateCcw size={16} />
            <span>{t('settings.reset')}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            {t('settings.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
          >
            <Save size={16} />
            <span>{t('settings.save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
