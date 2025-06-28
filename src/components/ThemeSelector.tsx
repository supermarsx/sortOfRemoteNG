import React from 'react';
import { Palette, Sun, Moon, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ThemeSelectorProps {
  theme: 'dark' | 'light' | 'auto';
  colorScheme: string;
  onThemeChange: (theme: 'dark' | 'light' | 'auto') => void;
  onColorSchemeChange: (scheme: string) => void;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  theme,
  colorScheme,
  onThemeChange,
  onColorSchemeChange,
}) => {
  const { t } = useTranslation();

  const colorSchemes = [
    { name: 'blue', colors: ['#3b82f6', '#1d4ed8', '#1e40af'] },
    { name: 'green', colors: ['#10b981', '#059669', '#047857'] },
    { name: 'purple', colors: ['#8b5cf6', '#7c3aed', '#6d28d9'] },
    { name: 'red', colors: ['#ef4444', '#dc2626', '#b91c1c'] },
    { name: 'orange', colors: ['#f97316', '#ea580c', '#c2410c'] },
    { name: 'teal', colors: ['#14b8a6', '#0d9488', '#0f766e'] },
  ];

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Theme Mode
        </label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'auto', label: 'Auto', icon: Monitor },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => onThemeChange(value as any)}
              className={`p-4 rounded-lg border-2 transition-colors flex flex-col items-center space-y-2 ${
                theme === value
                  ? 'border-blue-500 bg-blue-500/20'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <Icon size={24} className="text-gray-300" />
              <span className="text-white font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Color Scheme
        </label>
        <div className="grid grid-cols-3 gap-3">
          {colorSchemes.map(scheme => (
            <button
              key={scheme.name}
              onClick={() => onColorSchemeChange(scheme.name)}
              className={`p-4 rounded-lg border-2 transition-colors ${
                colorScheme === scheme.name
                  ? 'border-blue-500 bg-blue-500/20'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center space-x-2 mb-2">
                <Palette size={16} className="text-gray-300" />
                <span className="text-white font-medium capitalize">{scheme.name}</span>
              </div>
              <div className="flex space-x-1">
                {scheme.colors.map((color, index) => (
                  <div
                    key={index}
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="bg-gray-700 rounded-lg p-4">
        <h3 className="text-white font-medium mb-3">Preview</h3>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <div 
              className="w-4 h-4 rounded"
              style={{ backgroundColor: colorSchemes.find(s => s.name === colorScheme)?.colors[0] }}
            />
            <span className="text-gray-300">Primary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div 
              className="w-4 h-4 rounded"
              style={{ backgroundColor: colorSchemes.find(s => s.name === colorScheme)?.colors[1] }}
            />
            <span className="text-gray-300">Secondary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div 
              className="w-4 h-4 rounded"
              style={{ backgroundColor: colorSchemes.find(s => s.name === colorScheme)?.colors[2] }}
            />
            <span className="text-gray-300">Accent Color</span>
          </div>
        </div>
      </div>
    </div>
  );
};