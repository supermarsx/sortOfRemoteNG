import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GlobalSettings,
  SSHTerminalConfig,
  BellStyles,
  TaskbarFlashModes,
  LocalEchoModes,
  LineEditingModes,
  IPProtocols,
  SSHVersions,
  CharacterSets,
  defaultSSHTerminalConfig,
} from '../../../types/settings';
import {
  Terminal,
  Bell,
  Type,
  Palette,
  Network,
  Shield,
  Keyboard,
  LayoutGrid,
  Volume2,
  VolumeX,
  Monitor,
  Settings2,
  Zap,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';

interface SSHTerminalSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

// Collapsible Section Component
const CollapsibleSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] transition-colors"
      >
        <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
          {icon}
          <span>{title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 space-y-4 bg-[var(--color-surface)]">
          {children}
        </div>
      )}
    </div>
  );
};

// Toggle Switch Component
const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex items-start gap-3 cursor-pointer group">
    <div className="relative flex-shrink-0 mt-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-10 h-5 bg-[var(--color-border)] rounded-full peer-checked:bg-blue-600 transition-colors" />
      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
    </div>
    <div className="flex-1">
      <span className="text-sm text-[var(--color-text)] group-hover:text-blue-400 transition-colors">
        {label}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">{description}</p>
      )}
    </div>
  </label>
);

// Select Dropdown Component
const Select: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}> = ({ value, onChange, options, label }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

// Number Input Component
const NumberInput: React.FC<{
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}> = ({ value, onChange, label, min, max, step = 1, disabled }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    />
  </div>
);

// Text Input Component
const TextInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}> = ({ value, onChange, label, placeholder }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--color-textSecondary)]">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

export const SSHTerminalSettings: React.FC<SSHTerminalSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  
  const sshTerminal = settings.sshTerminal || defaultSSHTerminalConfig;

  const updateTerminalSettings = (updates: Partial<SSHTerminalConfig>) => {
    updateSettings({
      sshTerminal: { ...sshTerminal, ...updates },
    });
  };

  const resetToDefaults = () => {
    updateSettings({ sshTerminal: { ...defaultSSHTerminalConfig } });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Terminal className="w-5 h-5" />
        SSH Terminal
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Terminal line handling, bell, keyboard, font, colors, scrollback, and SSH protocol settings.
      </p>

      {/* Line Handling */}
      <CollapsibleSection
        title={t('settings.sshTerminal.lineHandling', 'Line Handling')}
        icon={<Type className="w-4 h-4 text-blue-400" />}
      >
        <Toggle
          checked={sshTerminal.implicitCrInLf}
          onChange={(v) => updateTerminalSettings({ implicitCrInLf: v })}
          label={t('settings.sshTerminal.implicitCrInLf', 'Implicit CR in every LF')}
          description={t('settings.sshTerminal.implicitCrInLfDesc', 'Automatically add carriage return when receiving line feed')}
        />
        <Toggle
          checked={sshTerminal.implicitLfInCr}
          onChange={(v) => updateTerminalSettings({ implicitLfInCr: v })}
          label={t('settings.sshTerminal.implicitLfInCr', 'Implicit LF in every CR')}
          description={t('settings.sshTerminal.implicitLfInCrDesc', 'Automatically add line feed when receiving carriage return')}
        />
        <Toggle
          checked={sshTerminal.autoWrap}
          onChange={(v) => updateTerminalSettings({ autoWrap: v })}
          label={t('settings.sshTerminal.autoWrap', 'Auto wrap mode')}
          description={t('settings.sshTerminal.autoWrapDesc', 'Automatically wrap text at terminal edge')}
        />
      </CollapsibleSection>

      {/* Line Discipline */}
      <CollapsibleSection
        title={t('settings.sshTerminal.lineDiscipline', 'Line Discipline')}
        icon={<Keyboard className="w-4 h-4 text-purple-400" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            value={sshTerminal.localEcho}
            onChange={(v) => updateTerminalSettings({ localEcho: v as typeof sshTerminal.localEcho })}
            label={t('settings.sshTerminal.localEcho', 'Local Echo')}
            options={LocalEchoModes.map((m) => ({
              value: m,
              label: m === 'auto' ? 'Auto (let server decide)' : m === 'on' ? 'Force On' : 'Force Off',
            }))}
          />
          <Select
            value={sshTerminal.localLineEditing}
            onChange={(v) => updateTerminalSettings({ localLineEditing: v as typeof sshTerminal.localLineEditing })}
            label={t('settings.sshTerminal.localLineEditing', 'Local Line Editing')}
            options={LineEditingModes.map((m) => ({
              value: m,
              label: m === 'auto' ? 'Auto (let server decide)' : m === 'on' ? 'Force On' : 'Force Off',
            }))}
          />
        </div>
      </CollapsibleSection>

      {/* Bell Settings */}
      <CollapsibleSection
        title={t('settings.sshTerminal.bellSettings', 'Bell Settings')}
        icon={<Bell className="w-4 h-4 text-yellow-400" />}
      >
        <Select
          value={sshTerminal.bellStyle}
          onChange={(v) => updateTerminalSettings({ bellStyle: v as typeof sshTerminal.bellStyle })}
          label={t('settings.sshTerminal.bellStyle', 'Bell Style')}
          options={BellStyles.map((s) => ({
            value: s,
            label: {
              'none': 'None (disabled)',
              'system': 'System default',
              'visual': 'Visual bell (flash terminal)',
              'flash-window': 'Flash window',
              'pc-speaker': 'Beep using PC speaker',
            }[s] || s,
          }))}
        />
        
        <div className="border-t border-[var(--color-border)] pt-4 mt-4">
          <h5 className="text-sm font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
            {sshTerminal.bellOveruseProtection.enabled ? (
              <VolumeX className="w-4 h-4 text-orange-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-gray-400" />
            )}
            {t('settings.sshTerminal.bellOveruse', 'Bell Overuse Protection')}
          </h5>
          <Toggle
            checked={sshTerminal.bellOveruseProtection.enabled}
            onChange={(v) => updateTerminalSettings({
              bellOveruseProtection: { ...sshTerminal.bellOveruseProtection, enabled: v },
            })}
            label={t('settings.sshTerminal.enableBellOveruse', 'Enable bell overuse protection')}
            description={t('settings.sshTerminal.bellOveruseDesc', 'Silence the bell if it rings too frequently')}
          />
          {sshTerminal.bellOveruseProtection.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 ml-10">
              <NumberInput
                value={sshTerminal.bellOveruseProtection.maxBells}
                onChange={(v) => updateTerminalSettings({
                  bellOveruseProtection: { ...sshTerminal.bellOveruseProtection, maxBells: v },
                })}
                label={t('settings.sshTerminal.maxBells', 'Max bells')}
                min={1}
                max={100}
              />
              <NumberInput
                value={sshTerminal.bellOveruseProtection.timeWindowSeconds}
                onChange={(v) => updateTerminalSettings({
                  bellOveruseProtection: { ...sshTerminal.bellOveruseProtection, timeWindowSeconds: v },
                })}
                label={t('settings.sshTerminal.timeWindow', 'Time window (sec)')}
                min={1}
                max={60}
              />
              <NumberInput
                value={sshTerminal.bellOveruseProtection.silenceDurationSeconds}
                onChange={(v) => updateTerminalSettings({
                  bellOveruseProtection: { ...sshTerminal.bellOveruseProtection, silenceDurationSeconds: v },
                })}
                label={t('settings.sshTerminal.silenceDuration', 'Silence duration (sec)')}
                min={1}
                max={300}
              />
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-border)] pt-4 mt-4">
          <Select
            value={sshTerminal.taskbarFlash}
            onChange={(v) => updateTerminalSettings({ taskbarFlash: v as typeof sshTerminal.taskbarFlash })}
            label={t('settings.sshTerminal.taskbarFlash', 'Taskbar Flashing')}
            options={TaskbarFlashModes.map((m) => ({
              value: m,
              label: m === 'disabled' ? 'Disabled' : m === 'flashing' ? 'Flash until focused' : 'Steady highlight',
            }))}
          />
        </div>
      </CollapsibleSection>

      {/* Keyboard */}
      <CollapsibleSection
        title={t('settings.sshTerminal.keyboard', 'Keyboard')}
        icon={<Keyboard className="w-4 h-4 text-cyan-400" />}
        defaultOpen={false}
      >
        <Toggle
          checked={sshTerminal.disableKeypadMode}
          onChange={(v) => updateTerminalSettings({ disableKeypadMode: v })}
          label={t('settings.sshTerminal.disableKeypadMode', 'Disable keypad application mode')}
          description={t('settings.sshTerminal.disableKeypadModeDesc', 'Force numeric keypad to always send numbers')}
        />
        <Toggle
          checked={sshTerminal.disableApplicationCursorKeys}
          onChange={(v) => updateTerminalSettings({ disableApplicationCursorKeys: v })}
          label={t('settings.sshTerminal.disableAppCursorKeys', 'Disable application cursor keys')}
          description={t('settings.sshTerminal.disableAppCursorKeysDesc', 'Force cursor keys to always send ANSI sequences')}
        />
      </CollapsibleSection>

      {/* Terminal Dimensions */}
      <CollapsibleSection
        title={t('settings.sshTerminal.dimensions', 'Terminal Dimensions')}
        icon={<LayoutGrid className="w-4 h-4 text-green-400" />}
        defaultOpen={false}
      >
        <Toggle
          checked={sshTerminal.useCustomDimensions}
          onChange={(v) => updateTerminalSettings({ useCustomDimensions: v })}
          label={t('settings.sshTerminal.useCustomDimensions', 'Use custom dimensions')}
          description={t('settings.sshTerminal.useCustomDimensionsDesc', 'Override automatic terminal size detection')}
        />
        {sshTerminal.useCustomDimensions && (
          <div className="grid grid-cols-2 gap-4 mt-3 ml-10">
            <NumberInput
              value={sshTerminal.columns}
              onChange={(v) => updateTerminalSettings({ columns: v })}
              label={t('settings.sshTerminal.columns', 'Columns')}
              min={40}
              max={500}
            />
            <NumberInput
              value={sshTerminal.rows}
              onChange={(v) => updateTerminalSettings({ rows: v })}
              label={t('settings.sshTerminal.rows', 'Rows')}
              min={10}
              max={200}
            />
          </div>
        )}
      </CollapsibleSection>

      {/* Character Set */}
      <CollapsibleSection
        title={t('settings.sshTerminal.characterSet', 'Character Set')}
        icon={<Type className="w-4 h-4 text-indigo-400" />}
        defaultOpen={false}
      >
        <Select
          value={sshTerminal.characterSet}
          onChange={(v) => updateTerminalSettings({ characterSet: v })}
          label={t('settings.sshTerminal.remoteCharset', 'Remote Character Set')}
          options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
        />
        <Select
          value={sshTerminal.unicodeAmbiguousWidth}
          onChange={(v) => updateTerminalSettings({ unicodeAmbiguousWidth: v as 'narrow' | 'wide' })}
          label={t('settings.sshTerminal.unicodeWidth', 'Unicode Ambiguous Width')}
          options={[
            { value: 'narrow', label: 'Narrow (1 cell)' },
            { value: 'wide', label: 'Wide (2 cells)' },
          ]}
        />
      </CollapsibleSection>

      {/* Font Configuration */}
      <CollapsibleSection
        title={t('settings.sshTerminal.font', 'Font Configuration')}
        icon={<Type className="w-4 h-4 text-pink-400" />}
        defaultOpen={false}
      >
        <Toggle
          checked={sshTerminal.useCustomFont}
          onChange={(v) => updateTerminalSettings({ useCustomFont: v })}
          label={t('settings.sshTerminal.useCustomFont', 'Use custom font')}
          description={t('settings.sshTerminal.useCustomFontDesc', 'Override default terminal font settings')}
        />
        {sshTerminal.useCustomFont && (
          <div className="space-y-4 mt-3 ml-10">
            <TextInput
              value={sshTerminal.font.family}
              onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, family: v } })}
              label={t('settings.sshTerminal.fontFamily', 'Font Family')}
              placeholder="Consolas, Monaco, monospace"
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <NumberInput
                value={sshTerminal.font.size}
                onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, size: v } })}
                label={t('settings.sshTerminal.fontSize', 'Size (px)')}
                min={8}
                max={48}
              />
              <Select
                value={String(sshTerminal.font.weight)}
                onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, weight: v === 'normal' || v === 'bold' || v === 'lighter' || v === 'bolder' ? v : Number(v) } })}
                label={t('settings.sshTerminal.fontWeight', 'Weight')}
                options={[
                  { value: 'lighter', label: 'Lighter' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'bold', label: 'Bold' },
                  { value: 'bolder', label: 'Bolder' },
                ]}
              />
              <Select
                value={sshTerminal.font.style}
                onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, style: v as typeof sshTerminal.font.style } })}
                label={t('settings.sshTerminal.fontStyle', 'Style')}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'italic', label: 'Italic' },
                  { value: 'oblique', label: 'Oblique' },
                ]}
              />
              <NumberInput
                value={sshTerminal.font.lineHeight}
                onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, lineHeight: v } })}
                label={t('settings.sshTerminal.lineHeight', 'Line Height')}
                min={0.8}
                max={3}
                step={0.1}
              />
            </div>
            <NumberInput
              value={sshTerminal.font.letterSpacing}
              onChange={(v) => updateTerminalSettings({ font: { ...sshTerminal.font, letterSpacing: v } })}
              label={t('settings.sshTerminal.letterSpacing', 'Letter Spacing (px)')}
              min={-5}
              max={10}
              step={0.5}
            />
          </div>
        )}
      </CollapsibleSection>

      {/* Colors */}
      <CollapsibleSection
        title={t('settings.sshTerminal.colors', 'Color Settings')}
        icon={<Palette className="w-4 h-4 text-orange-400" />}
        defaultOpen={false}
      >
        <Toggle
          checked={sshTerminal.allowTerminalAnsiColors}
          onChange={(v) => updateTerminalSettings({ allowTerminalAnsiColors: v })}
          label={t('settings.sshTerminal.allowAnsi', 'Allow terminal to specify ANSI colors')}
          description={t('settings.sshTerminal.allowAnsiDesc', 'Let remote applications set the 16 standard colors')}
        />
        <Toggle
          checked={sshTerminal.allowXterm256Colors}
          onChange={(v) => updateTerminalSettings({ allowXterm256Colors: v })}
          label={t('settings.sshTerminal.allowXterm256', 'Allow xterm 256-color mode')}
          description={t('settings.sshTerminal.allowXterm256Desc', 'Enable extended 256-color palette support')}
        />
        <Toggle
          checked={sshTerminal.allow24BitColors}
          onChange={(v) => updateTerminalSettings({ allow24BitColors: v })}
          label={t('settings.sshTerminal.allow24Bit', 'Allow 24-bit true colors')}
          description={t('settings.sshTerminal.allow24BitDesc', 'Enable full RGB color support (16 million colors)')}
        />
      </CollapsibleSection>

      {/* TCP Options */}
      <CollapsibleSection
        title={t('settings.sshTerminal.tcpOptions', 'Low-level TCP Options')}
        icon={<Network className="w-4 h-4 text-teal-400" />}
        defaultOpen={false}
      >
        <Toggle
          checked={sshTerminal.tcpOptions.tcpNoDelay}
          onChange={(v) => updateTerminalSettings({
            tcpOptions: { ...sshTerminal.tcpOptions, tcpNoDelay: v },
          })}
          label={t('settings.sshTerminal.tcpNoDelay', 'Disable Nagle algorithm (TCP_NODELAY)')}
          description={t('settings.sshTerminal.tcpNoDelayDesc', 'Send data immediately without buffering small packets')}
        />
        <Toggle
          checked={sshTerminal.tcpOptions.tcpKeepAlive}
          onChange={(v) => updateTerminalSettings({
            tcpOptions: { ...sshTerminal.tcpOptions, tcpKeepAlive: v },
          })}
          label={t('settings.sshTerminal.tcpKeepAlive', 'Enable TCP keepalive')}
          description={t('settings.sshTerminal.tcpKeepAliveDesc', 'Send TCP keepalive probes to detect dead connections')}
        />
        <Toggle
          checked={sshTerminal.tcpOptions.soKeepAlive}
          onChange={(v) => updateTerminalSettings({
            tcpOptions: { ...sshTerminal.tcpOptions, soKeepAlive: v },
          })}
          label={t('settings.sshTerminal.soKeepAlive', 'Enable SO_KEEPALIVE option')}
          description={t('settings.sshTerminal.soKeepAliveDesc', 'Enable socket-level keepalive mechanism')}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
          <Select
            value={sshTerminal.tcpOptions.ipProtocol}
            onChange={(v) => updateTerminalSettings({
              tcpOptions: { ...sshTerminal.tcpOptions, ipProtocol: v as typeof sshTerminal.tcpOptions.ipProtocol },
            })}
            label={t('settings.sshTerminal.ipProtocol', 'IP Protocol')}
            options={IPProtocols.map((p) => ({
              value: p,
              label: p === 'auto' ? 'Auto (IPv4/IPv6)' : p.toUpperCase(),
            }))}
          />
          <NumberInput
            value={sshTerminal.tcpOptions.connectionTimeout}
            onChange={(v) => updateTerminalSettings({
              tcpOptions: { ...sshTerminal.tcpOptions, connectionTimeout: v },
            })}
            label={t('settings.sshTerminal.connectionTimeout', 'Connection Timeout (sec)')}
            min={5}
            max={300}
          />
        </div>
        
        {sshTerminal.tcpOptions.tcpKeepAlive && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
            <NumberInput
              value={sshTerminal.tcpOptions.keepAliveInterval}
              onChange={(v) => updateTerminalSettings({
                tcpOptions: { ...sshTerminal.tcpOptions, keepAliveInterval: v },
              })}
              label={t('settings.sshTerminal.keepAliveInterval', 'Keepalive Interval (sec)')}
              min={1}
              max={3600}
            />
            <NumberInput
              value={sshTerminal.tcpOptions.keepAliveProbes}
              onChange={(v) => updateTerminalSettings({
                tcpOptions: { ...sshTerminal.tcpOptions, keepAliveProbes: v },
              })}
              label={t('settings.sshTerminal.keepAliveProbes', 'Keepalive Probes')}
              min={1}
              max={30}
            />
          </div>
        )}
      </CollapsibleSection>

      {/* SSH Protocol */}
      <CollapsibleSection
        title={t('settings.sshTerminal.sshProtocol', 'SSH Protocol Settings')}
        icon={<Shield className="w-4 h-4 text-red-400" />}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            value={sshTerminal.sshVersion}
            onChange={(v) => updateTerminalSettings({ sshVersion: v as typeof sshTerminal.sshVersion })}
            label={t('settings.sshTerminal.sshVersion', 'SSH Version')}
            options={SSHVersions.map((v) => ({
              value: v,
              label: v === 'auto' ? 'Auto (negotiate)' : `SSH-${v}`,
            }))}
          />
        </div>
        
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <Toggle
            checked={sshTerminal.enableCompression}
            onChange={(v) => updateTerminalSettings({ enableCompression: v })}
            label={t('settings.sshTerminal.enableCompression', 'Enable SSH compression')}
            description={t('settings.sshTerminal.enableCompressionDesc', 'Compress data over the SSH connection (useful for slow links)')}
          />
          {sshTerminal.enableCompression && (
            <div className="mt-3 ml-10">
              <NumberInput
                value={sshTerminal.compressionLevel}
                onChange={(v) => updateTerminalSettings({ compressionLevel: v })}
                label={t('settings.sshTerminal.compressionLevel', 'Compression Level (1-9)')}
                min={1}
                max={9}
              />
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Scrollback & Selection */}
      <CollapsibleSection
        title={t('settings.sshTerminal.scrollback', 'Scrollback & Selection')}
        icon={<Monitor className="w-4 h-4 text-slate-400" />}
        defaultOpen={false}
      >
        <NumberInput
          value={sshTerminal.scrollbackLines}
          onChange={(v) => updateTerminalSettings({ scrollbackLines: v })}
          label={t('settings.sshTerminal.scrollbackLines', 'Scrollback Lines')}
          min={100}
          max={100000}
          step={100}
        />
        <Toggle
          checked={sshTerminal.scrollOnOutput}
          onChange={(v) => updateTerminalSettings({ scrollOnOutput: v })}
          label={t('settings.sshTerminal.scrollOnOutput', 'Scroll on output')}
          description={t('settings.sshTerminal.scrollOnOutputDesc', 'Automatically scroll to bottom when new output appears')}
        />
        <Toggle
          checked={sshTerminal.scrollOnKeystroke}
          onChange={(v) => updateTerminalSettings({ scrollOnKeystroke: v })}
          label={t('settings.sshTerminal.scrollOnKeystroke', 'Scroll on keystroke')}
          description={t('settings.sshTerminal.scrollOnKeystrokeDesc', 'Automatically scroll to bottom when typing')}
        />
        <div className="border-t border-[var(--color-border)] pt-4 mt-4">
          <Toggle
            checked={sshTerminal.copyOnSelect}
            onChange={(v) => updateTerminalSettings({ copyOnSelect: v })}
            label={t('settings.sshTerminal.copyOnSelect', 'Copy on select')}
            description={t('settings.sshTerminal.copyOnSelectDesc', 'Automatically copy selected text to clipboard')}
          />
          <Toggle
            checked={sshTerminal.pasteOnRightClick}
            onChange={(v) => updateTerminalSettings({ pasteOnRightClick: v })}
            label={t('settings.sshTerminal.pasteOnRightClick', 'Paste on right-click')}
            description={t('settings.sshTerminal.pasteOnRightClickDesc', 'Paste clipboard content when right-clicking')}
          />
          <div className="mt-3">
            <TextInput
              value={sshTerminal.wordSeparators}
              onChange={(v) => updateTerminalSettings({ wordSeparators: v })}
              label={t('settings.sshTerminal.wordSeparators', 'Word Separators (for double-click selection)')}
              placeholder={' !"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~'}
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* Misc Behavior */}
      <CollapsibleSection
        title={t('settings.sshTerminal.misc', 'Miscellaneous')}
        icon={<Settings2 className="w-4 h-4 text-gray-400" />}
        defaultOpen={false}
      >
        <TextInput
          value={sshTerminal.answerbackString}
          onChange={(v) => updateTerminalSettings({ answerbackString: v })}
          label={t('settings.sshTerminal.answerback', 'Answerback String')}
          placeholder="Optional terminal identification string"
        />
        <Toggle
          checked={sshTerminal.localPrinting}
          onChange={(v) => updateTerminalSettings({ localPrinting: v })}
          label={t('settings.sshTerminal.localPrinting', 'Enable local printing')}
          description={t('settings.sshTerminal.localPrintingDesc', 'Allow print commands from terminal')}
        />
        <Toggle
          checked={sshTerminal.remoteControlledPrinting}
          onChange={(v) => updateTerminalSettings({ remoteControlledPrinting: v })}
          label={t('settings.sshTerminal.remotePrinting', 'Enable remote-controlled printing')}
          description={t('settings.sshTerminal.remotePrintingDesc', 'Allow remote host to trigger printing')}
        />
      </CollapsibleSection>

      {/* Advanced SSH Options (Ciphers, MACs, etc.) */}
      <CollapsibleSection
        title={t('settings.sshTerminal.advancedSSH', 'Advanced SSH Options')}
        icon={<Zap className="w-4 h-4 text-amber-400" />}
        defaultOpen={false}
      >
        <p className="text-xs text-[var(--color-textSecondary)] mb-4">
          {t('settings.sshTerminal.advancedSSHDesc', 'Configure preferred encryption ciphers, MACs, key exchanges, and host key algorithms. Items are tried in order of preference.')}
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
              {t('settings.sshTerminal.preferredCiphers', 'Preferred Ciphers')}
            </label>
            <textarea
              value={sshTerminal.preferredCiphers.join('\n')}
              onChange={(e) => updateTerminalSettings({ preferredCiphers: e.target.value.split('\n').filter(Boolean) })}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="One cipher per line"
            />
          </div>
          
          <div>
            <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
              {t('settings.sshTerminal.preferredMACs', 'Preferred MACs')}
            </label>
            <textarea
              value={sshTerminal.preferredMACs.join('\n')}
              onChange={(e) => updateTerminalSettings({ preferredMACs: e.target.value.split('\n').filter(Boolean) })}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="One MAC per line"
            />
          </div>
          
          <div>
            <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
              {t('settings.sshTerminal.preferredKEX', 'Preferred Key Exchanges')}
            </label>
            <textarea
              value={sshTerminal.preferredKeyExchanges.join('\n')}
              onChange={(e) => updateTerminalSettings({ preferredKeyExchanges: e.target.value.split('\n').filter(Boolean) })}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="One key exchange per line"
            />
          </div>
          
          <div>
            <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
              {t('settings.sshTerminal.preferredHostKeys', 'Preferred Host Key Algorithms')}
            </label>
            <textarea
              value={sshTerminal.preferredHostKeyAlgorithms.join('\n')}
              onChange={(e) => updateTerminalSettings({ preferredHostKeyAlgorithms: e.target.value.split('\n').filter(Boolean) })}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="One algorithm per line"
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default SSHTerminalSettings;
