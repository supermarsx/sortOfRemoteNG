import React, { useState, useEffect, useCallback } from 'react';
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
  Palette,
  LayoutGrid,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, ProxyConfig } from '../../types/settings';
import GeneralSettings from './sections/GeneralSettings';
import ThemeSettings from './sections/ThemeSettings';
import LayoutSettings from './sections/LayoutSettings';
import SecuritySettings from './sections/SecuritySettings';
import PerformanceSettings from './sections/PerformanceSettings';
import ProxySettings from './sections/ProxySettings';
import AdvancedSettings from './sections/AdvancedSettings';
import { SettingsManager } from '../../utils/settingsManager';
import { ThemeManager } from '../../utils/themeManager';
import { loadLanguage } from '../../i18n';

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

  const loadSettings = useCallback(async () => {
    const currentSettings = await settingsManager.loadSettings();
    setSettings(currentSettings);
  }, [settingsManager]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, loadSettings]);

  // Keyboard handling for ESC
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      await settingsManager.saveSettings(settings);
      
      // Apply language change
      if (settings.language !== i18n.language) {
        if (settings.language !== "en") {
          await loadLanguage(settings.language);
        }
        await i18n.changeLanguage(settings.language);
      }
      
      // Apply theme changes
      themeManager.applyTheme(
        settings.theme,
        settings.colorScheme,
        settings.primaryAccentColor,
      );
      
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
        if (updates.language !== "en") {
          await loadLanguage(updates.language);
        }
        await i18n.changeLanguage(updates.language);
      }

      if (
        updates.theme ||
        updates.colorScheme ||
        typeof updates.primaryAccentColor !== "undefined"
      ) {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.primaryAccentColor,
        );
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
    { id: 'theme', label: t('settings.theme'), icon: Palette },
    { id: 'layout', label: 'Layout', icon: LayoutGrid },
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
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {autoSaveStatus && (
          <div className="fixed bottom-6 right-6 z-50">
            <div
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border shadow-lg bg-gray-800 ${
                autoSaveStatus === "success"
                  ? "border-green-500 text-green-400"
                  : "border-red-500 text-red-400"
              }`}
            >
              {autoSaveStatus === "success" ? (
                <CheckCircle size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span className="text-sm">
                {autoSaveStatus === "success"
                  ? t("settings.autoSaveSuccess")
                  : t("settings.autoSaveError")}
              </span>
            </div>
          </div>
        )}
        <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">
            {t("settings.title")}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              data-tooltip={t("settings.reset")}
              aria-label={t("settings.reset")}
              className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={handleSave}
              data-tooltip={t("settings.save")}
              aria-label={t("settings.save")}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              <Save size={16} />
            </button>
            <button
              onClick={onClose}
              data-tooltip={t("settings.cancel")}
              aria-label={t("settings.cancel")}
              className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
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
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {activeTab === 'general' && (
                <GeneralSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'theme' && (
                <ThemeSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'layout' && (
                <LayoutSettings settings={settings} updateSettings={updateSettings} />
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
      </div>
    </div>
  );
};
