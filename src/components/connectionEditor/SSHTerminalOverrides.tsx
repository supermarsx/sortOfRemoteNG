import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Settings2, RotateCcw } from 'lucide-react';
import { Connection } from '../../types/connection';
import { 
  SSHTerminalConfig, 
  defaultSSHTerminalConfig,
  BellStyle,
  TaskbarFlashMode,
  SSHVersion,
} from '../../types/settings';
import { useSettings } from '../../contexts/SettingsContext';

interface SSHTerminalOverridesProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

type OverrideKey = keyof SSHTerminalConfig;

/**
 * Component for overriding global SSH terminal settings per-connection.
 * Only shows fields that differ from global settings, with option to customize.
 */
export const SSHTerminalOverrides: React.FC<SSHTerminalOverridesProps> = ({ 
  formData, 
  setFormData 
}) => {
  const { settings } = useSettings();
  const globalConfig = settings.sshTerminal || defaultSSHTerminalConfig;
  const [isExpanded, setIsExpanded] = useState(false);
  const overrides = formData.sshTerminalConfigOverride || {};

  // Check if any overrides exist
  const hasOverrides = Object.keys(overrides).length > 0;

  const updateOverride = <K extends OverrideKey>(key: K, value: SSHTerminalConfig[K] | undefined) => {
    setFormData(prev => {
      const currentOverrides = prev.sshTerminalConfigOverride || {};
      if (value === undefined) {
        // Remove the override (revert to global)
        const { [key]: _, ...rest } = currentOverrides;
        return {
          ...prev,
          sshTerminalConfigOverride: Object.keys(rest).length > 0 ? rest : undefined,
        };
      }
      return {
        ...prev,
        sshTerminalConfigOverride: {
          ...currentOverrides,
          [key]: value,
        },
      };
    });
  };

  const clearAllOverrides = () => {
    setFormData(prev => ({
      ...prev,
      sshTerminalConfigOverride: undefined,
    }));
  };

  const isOverridden = (key: OverrideKey) => key in overrides;
  const getValue = <K extends OverrideKey>(key: K): SSHTerminalConfig[K] => 
    (overrides[key] as SSHTerminalConfig[K]) ?? globalConfig[key];

  // Only show for SSH protocol
  if (formData.protocol !== 'ssh' || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-[var(--color-border)]/50 hover:bg-[var(--color-border)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-200">
            Terminal Settings Override
          </span>
          {hasOverrides && (
            <span className="px-2 py-0.5 text-xs bg-blue-600 text-[var(--color-text)] rounded-full">
              {Object.keys(overrides).length} custom
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4 bg-[var(--color-surface)]/50">
          <p className="text-xs text-[var(--color-textSecondary)]">
            Override global SSH terminal settings for this connection. 
            Unchecked settings inherit from global defaults.
          </p>

          {hasOverrides && (
            <button
              type="button"
              onClick={clearAllOverrides}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All to Global
            </button>
          )}

          {/* Font Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Font</h4>
            
            <OverrideToggle
              label="Use Custom Font"
              isOverridden={isOverridden('useCustomFont')}
              globalValue={globalConfig.useCustomFont ? 'Yes' : 'No'}
              onToggle={(enabled) => updateOverride('useCustomFont', enabled ? !globalConfig.useCustomFont : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('useCustomFont')}
                  onChange={(e) => updateOverride('useCustomFont', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable custom font
              </label>
            </OverrideToggle>

            {getValue('useCustomFont') && (
              <>
                <OverrideToggle
                  label="Font Family"
                  isOverridden={isOverridden('font') && 'family' in (overrides.font || {})}
                  globalValue={globalConfig.font.family}
                  onToggle={(enabled) => {
                    if (enabled) {
                      updateOverride('font', { ...getValue('font'), family: globalConfig.font.family });
                    } else {
                      const { family: _, ...rest } = overrides.font || {};
                      updateOverride('font', Object.keys(rest).length > 0 ? rest as any : undefined);
                    }
                  }}
                >
                  <input
                    type="text"
                    value={getValue('font').family}
                    onChange={(e) => updateOverride('font', { ...getValue('font'), family: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  />
                </OverrideToggle>

                <OverrideToggle
                  label="Font Size"
                  isOverridden={isOverridden('font') && 'size' in (overrides.font || {})}
                  globalValue={`${globalConfig.font.size}px`}
                  onToggle={(enabled) => {
                    if (enabled) {
                      updateOverride('font', { ...getValue('font'), size: globalConfig.font.size });
                    } else {
                      const { size: _, ...rest } = overrides.font || {};
                      updateOverride('font', Object.keys(rest).length > 0 ? rest as any : undefined);
                    }
                  }}
                >
                  <input
                    type="number"
                    min={8}
                    max={32}
                    value={getValue('font').size}
                    onChange={(e) => updateOverride('font', { ...getValue('font'), size: Number(e.target.value) })}
                    className="w-24 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  />
                </OverrideToggle>
              </>
            )}
          </div>

          {/* Terminal Dimensions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Dimensions</h4>
            
            <OverrideToggle
              label="Custom Dimensions"
              isOverridden={isOverridden('useCustomDimensions')}
              globalValue={globalConfig.useCustomDimensions ? `${globalConfig.columns}x${globalConfig.rows}` : 'Auto'}
              onToggle={(enabled) => updateOverride('useCustomDimensions', enabled ? !globalConfig.useCustomDimensions : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('useCustomDimensions')}
                  onChange={(e) => updateOverride('useCustomDimensions', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Use custom dimensions
              </label>
            </OverrideToggle>

            {getValue('useCustomDimensions') && (
              <div className="flex gap-3">
                <OverrideToggle
                  label="Columns"
                  isOverridden={isOverridden('columns')}
                  globalValue={`${globalConfig.columns}`}
                  onToggle={(enabled) => updateOverride('columns', enabled ? globalConfig.columns : undefined)}
                >
                  <input
                    type="number"
                    min={40}
                    max={500}
                    value={getValue('columns')}
                    onChange={(e) => updateOverride('columns', Number(e.target.value))}
                    className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  />
                </OverrideToggle>
                <OverrideToggle
                  label="Rows"
                  isOverridden={isOverridden('rows')}
                  globalValue={`${globalConfig.rows}`}
                  onToggle={(enabled) => updateOverride('rows', enabled ? globalConfig.rows : undefined)}
                >
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={getValue('rows')}
                    onChange={(e) => updateOverride('rows', Number(e.target.value))}
                    className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  />
                </OverrideToggle>
              </div>
            )}

            <OverrideToggle
              label="Scrollback Lines"
              isOverridden={isOverridden('scrollbackLines')}
              globalValue={`${globalConfig.scrollbackLines.toLocaleString()}`}
              onToggle={(enabled) => updateOverride('scrollbackLines', enabled ? globalConfig.scrollbackLines : undefined)}
            >
              <input
                type="number"
                min={100}
                max={100000}
                step={1000}
                value={getValue('scrollbackLines')}
                onChange={(e) => updateOverride('scrollbackLines', Number(e.target.value))}
                className="w-28 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              />
            </OverrideToggle>
          </div>

          {/* Bell Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Bell & Alerts</h4>
            
            <OverrideToggle
              label="Bell Style"
              isOverridden={isOverridden('bellStyle')}
              globalValue={globalConfig.bellStyle}
              onToggle={(enabled) => updateOverride('bellStyle', enabled ? globalConfig.bellStyle : undefined)}
            >
              <select
                value={getValue('bellStyle')}
                onChange={(e) => updateOverride('bellStyle', e.target.value as BellStyle)}
                className="w-40 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="none">None</option>
                <option value="system">System</option>
                <option value="visual">Visual</option>
                <option value="flash-window">Flash Window</option>
                <option value="pc-speaker">PC Speaker</option>
              </select>
            </OverrideToggle>

            <OverrideToggle
              label="Taskbar Flash"
              isOverridden={isOverridden('taskbarFlash')}
              globalValue={globalConfig.taskbarFlash}
              onToggle={(enabled) => updateOverride('taskbarFlash', enabled ? globalConfig.taskbarFlash : undefined)}
            >
              <select
                value={getValue('taskbarFlash')}
                onChange={(e) => updateOverride('taskbarFlash', e.target.value as TaskbarFlashMode)}
                className="w-40 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="disabled">Disabled</option>
                <option value="on-bell">On Bell</option>
                <option value="on-output">On Output</option>
                <option value="always">Always</option>
              </select>
            </OverrideToggle>
          </div>

          {/* SSH Protocol Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">SSH Protocol</h4>
            
            <OverrideToggle
              label="Compression"
              isOverridden={isOverridden('enableCompression')}
              globalValue={globalConfig.enableCompression ? `Level ${globalConfig.compressionLevel}` : 'Disabled'}
              onToggle={(enabled) => updateOverride('enableCompression', enabled ? !globalConfig.enableCompression : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('enableCompression')}
                  onChange={(e) => updateOverride('enableCompression', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable compression
              </label>
            </OverrideToggle>

            {getValue('enableCompression') && (
              <OverrideToggle
                label="Compression Level"
                isOverridden={isOverridden('compressionLevel')}
                globalValue={`${globalConfig.compressionLevel}`}
                onToggle={(enabled) => updateOverride('compressionLevel', enabled ? globalConfig.compressionLevel : undefined)}
              >
                <input
                  type="range"
                  min={1}
                  max={9}
                  value={getValue('compressionLevel')}
                  onChange={(e) => updateOverride('compressionLevel', Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-[var(--color-textSecondary)] ml-2">{getValue('compressionLevel')}</span>
              </OverrideToggle>
            )}

            <OverrideToggle
              label="SSH Version"
              isOverridden={isOverridden('sshVersion')}
              globalValue={globalConfig.sshVersion}
              onToggle={(enabled) => updateOverride('sshVersion', enabled ? globalConfig.sshVersion : undefined)}
            >
              <select
                value={getValue('sshVersion')}
                onChange={(e) => updateOverride('sshVersion', e.target.value as SSHVersion)}
                className="w-32 px-3 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value="auto">Auto</option>
                <option value="1">SSH-1 Only</option>
                <option value="2">SSH-2 Only</option>
                <option value="3">SSH-3 Only</option>
              </select>
            </OverrideToggle>
          </div>

          {/* TCP Options */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">TCP Options</h4>
            
            <OverrideToggle
              label="TCP No Delay"
              isOverridden={isOverridden('tcpOptions') && 'tcpNoDelay' in (overrides.tcpOptions || {})}
              globalValue={globalConfig.tcpOptions.tcpNoDelay ? 'Enabled' : 'Disabled'}
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride('tcpOptions', { ...getValue('tcpOptions'), tcpNoDelay: globalConfig.tcpOptions.tcpNoDelay });
                } else {
                  const { tcpNoDelay: _, ...rest } = overrides.tcpOptions || {};
                  updateOverride('tcpOptions', Object.keys(rest).length > 0 ? rest as any : undefined);
                }
              }}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('tcpOptions').tcpNoDelay}
                  onChange={(e) => updateOverride('tcpOptions', { ...getValue('tcpOptions'), tcpNoDelay: e.target.checked })}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Disable Nagle's algorithm
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="TCP Keep Alive"
              isOverridden={isOverridden('tcpOptions') && 'tcpKeepAlive' in (overrides.tcpOptions || {})}
              globalValue={globalConfig.tcpOptions.tcpKeepAlive ? `${globalConfig.tcpOptions.keepAliveInterval}s` : 'Disabled'}
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride('tcpOptions', { ...getValue('tcpOptions'), tcpKeepAlive: globalConfig.tcpOptions.tcpKeepAlive });
                } else {
                  const { tcpKeepAlive: _, ...rest } = overrides.tcpOptions || {};
                  updateOverride('tcpOptions', Object.keys(rest).length > 0 ? rest as any : undefined);
                }
              }}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('tcpOptions').tcpKeepAlive}
                  onChange={(e) => updateOverride('tcpOptions', { ...getValue('tcpOptions'), tcpKeepAlive: e.target.checked })}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Enable TCP keep alive
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Connection Timeout"
              isOverridden={isOverridden('tcpOptions') && 'connectionTimeout' in (overrides.tcpOptions || {})}
              globalValue={`${globalConfig.tcpOptions.connectionTimeout}s`}
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride('tcpOptions', { ...getValue('tcpOptions'), connectionTimeout: globalConfig.tcpOptions.connectionTimeout });
                } else {
                  const { connectionTimeout: _, ...rest } = overrides.tcpOptions || {};
                  updateOverride('tcpOptions', Object.keys(rest).length > 0 ? rest as any : undefined);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={getValue('tcpOptions').connectionTimeout}
                  onChange={(e) => updateOverride('tcpOptions', { ...getValue('tcpOptions'), connectionTimeout: Number(e.target.value) })}
                  className="w-20 px-2 py-1.5 text-sm bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
              </div>
            </OverrideToggle>
          </div>

          {/* Line Handling */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-1">Line Handling</h4>
            
            <OverrideToggle
              label="Implicit CR in LF"
              isOverridden={isOverridden('implicitCrInLf')}
              globalValue={globalConfig.implicitCrInLf ? 'Yes' : 'No'}
              onToggle={(enabled) => updateOverride('implicitCrInLf', enabled ? !globalConfig.implicitCrInLf : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('implicitCrInLf')}
                  onChange={(e) => updateOverride('implicitCrInLf', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Add CR to every LF
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Auto Wrap"
              isOverridden={isOverridden('autoWrap')}
              globalValue={globalConfig.autoWrap ? 'Yes' : 'No'}
              onToggle={(enabled) => updateOverride('autoWrap', enabled ? !globalConfig.autoWrap : undefined)}
            >
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={getValue('autoWrap')}
                  onChange={(e) => updateOverride('autoWrap', e.target.checked)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                Auto-wrap long lines
              </label>
            </OverrideToggle>
          </div>
        </div>
      )}
    </div>
  );
};

interface OverrideToggleProps {
  label: string;
  isOverridden: boolean;
  globalValue: string;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

/**
 * A toggle row that shows whether a setting is overridden from global.
 */
const OverrideToggle: React.FC<OverrideToggleProps> = ({
  label,
  isOverridden,
  globalValue,
  onToggle,
  children,
}) => {
  return (
    <div className="flex items-start gap-3">
      <label className="flex items-center gap-2 min-w-[140px]">
        <input
          type="checkbox"
          checked={isOverridden}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
        />
        <span className="text-sm text-[var(--color-textSecondary)]">{label}</span>
      </label>
      <div className="flex-1">
        {isOverridden ? (
          children
        ) : (
          <span className="text-sm text-gray-500 italic">
            Global: {globalValue}
          </span>
        )}
      </div>
    </div>
  );
};

export default SSHTerminalOverrides;
