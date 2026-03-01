import React, { useState } from "react";
import { ChevronDown, ChevronUp, Settings2, RotateCcw } from "lucide-react";
import { Connection } from "../../types/connection";
import {
  SSHTerminalConfig,
  defaultSSHTerminalConfig,
  BellStyle,
  TaskbarFlashMode,
  SSHVersion,
} from "../../types/settings";
import { useSettings } from "../../contexts/SettingsContext";
import { Checkbox, NumberInput, Select, Slider } from '../ui/forms';
import OverrideToggle from '../ui/OverrideToggle';

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
  setFormData,
}) => {
  const { settings } = useSettings();
  const globalConfig = settings.sshTerminal || defaultSSHTerminalConfig;
  const [isExpanded, setIsExpanded] = useState(false);
  const overrides = formData.sshTerminalConfigOverride || {};

  // Check if any overrides exist
  const hasOverrides = Object.keys(overrides).length > 0;

  const updateOverride = <K extends OverrideKey>(
    key: K,
    value: SSHTerminalConfig[K] | undefined,
  ) => {
    setFormData((prev) => {
      const currentOverrides = prev.sshTerminalConfigOverride || {};
      if (value === undefined) {
        // Remove the override (revert to global)
        const { [key]: _, ...rest } = currentOverrides;
        return {
          ...prev,
          sshTerminalConfigOverride:
            Object.keys(rest).length > 0 ? rest : undefined,
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
    setFormData((prev) => ({
      ...prev,
      sshTerminalConfigOverride: undefined,
    }));
  };

  const isOverridden = (key: OverrideKey) => key in overrides;
  const getValue = <K extends OverrideKey>(key: K): SSHTerminalConfig[K] =>
    (overrides[key] as SSHTerminalConfig[K]) ?? globalConfig[key];

  // Only show for SSH protocol
  if (formData.protocol !== "ssh" || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-[var(--color-border)]/50 hover:bg-[var(--color-border)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
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
            Override global SSH terminal settings for this connection. Unchecked
            settings inherit from global defaults.
          </p>

          {hasOverrides && (
            <button
              type="button"
              onClick={clearAllOverrides}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All to Global
            </button>
          )}

          {/* Font Settings */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">Font</h4>

            <OverrideToggle
              label="Use Custom Font"
              isOverridden={isOverridden("useCustomFont")}
              globalValue={globalConfig.useCustomFont ? "Yes" : "No"}
              onToggle={(enabled) =>
                updateOverride(
                  "useCustomFont",
                  enabled ? !globalConfig.useCustomFont : undefined,
                )
              }
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("useCustomFont")} onChange={(v: boolean) => updateOverride("useCustomFont", v)} variant="form" />
                Enable custom font
              </label>
            </OverrideToggle>

            {getValue("useCustomFont") && (
              <>
                <OverrideToggle
                  label="Font Family"
                  isOverridden={
                    isOverridden("font") && "family" in (overrides.font || {})
                  }
                  globalValue={globalConfig.font.family}
                  onToggle={(enabled) => {
                    if (enabled) {
                      updateOverride("font", {
                        ...getValue("font"),
                        family: globalConfig.font.family,
                      });
                    } else {
                      const { family: _, ...rest } = overrides.font || {};
                      updateOverride(
                        "font",
                        Object.keys(rest).length > 0
                          ? (rest as any)
                          : undefined,
                      );
                    }
                  }}
                >
                  <input
                    type="text"
                    value={getValue("font").family}
                    onChange={(e) =>
                      updateOverride("font", {
                        ...getValue("font"),
                        family: e.target.value,
                      })
                    }
                    className="sor-form-input-sm w-full"
                  />
                </OverrideToggle>

                <OverrideToggle
                  label="Font Size"
                  isOverridden={
                    isOverridden("font") && "size" in (overrides.font || {})
                  }
                  globalValue={`${globalConfig.font.size}px`}
                  onToggle={(enabled) => {
                    if (enabled) {
                      updateOverride("font", {
                        ...getValue("font"),
                        size: globalConfig.font.size,
                      });
                    } else {
                      const { size: _, ...rest } = overrides.font || {};
                      updateOverride(
                        "font",
                        Object.keys(rest).length > 0
                          ? (rest as any)
                          : undefined,
                      );
                    }
                  }}
                >
                  <NumberInput value={getValue("font").size} onChange={(v: number) => updateOverride("font", {
                        ...getValue("font"),
                        size: v,
                      })} className="w-24 px-3 py-1.5  bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]" min={8} max={32} />
                </OverrideToggle>
              </>
            )}
          </div>

          {/* Terminal Dimensions */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">Dimensions</h4>

            <OverrideToggle
              label="Custom Dimensions"
              isOverridden={isOverridden("useCustomDimensions")}
              globalValue={
                globalConfig.useCustomDimensions
                  ? `${globalConfig.columns}x${globalConfig.rows}`
                  : "Auto"
              }
              onToggle={(enabled) =>
                updateOverride(
                  "useCustomDimensions",
                  enabled ? !globalConfig.useCustomDimensions : undefined,
                )
              }
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("useCustomDimensions")} onChange={(v: boolean) => updateOverride("useCustomDimensions", v)} variant="form" />
                Use custom dimensions
              </label>
            </OverrideToggle>

            {getValue("useCustomDimensions") && (
              <div className="flex gap-3">
                <OverrideToggle
                  label="Columns"
                  isOverridden={isOverridden("columns")}
                  globalValue={`${globalConfig.columns}`}
                  onToggle={(enabled) =>
                    updateOverride(
                      "columns",
                      enabled ? globalConfig.columns : undefined,
                    )
                  }
                >
                  <NumberInput value={getValue("columns")} onChange={(v: number) => updateOverride("columns", v)} variant="form-sm" className="" min={40} max={500} />
                </OverrideToggle>
                <OverrideToggle
                  label="Rows"
                  isOverridden={isOverridden("rows")}
                  globalValue={`${globalConfig.rows}`}
                  onToggle={(enabled) =>
                    updateOverride(
                      "rows",
                      enabled ? globalConfig.rows : undefined,
                    )
                  }
                >
                  <NumberInput value={getValue("rows")} onChange={(v: number) => updateOverride("rows", v)} variant="form-sm" className="" min={10} max={200} />
                </OverrideToggle>
              </div>
            )}

            <OverrideToggle
              label="Scrollback Lines"
              isOverridden={isOverridden("scrollbackLines")}
              globalValue={`${globalConfig.scrollbackLines.toLocaleString()}`}
              onToggle={(enabled) =>
                updateOverride(
                  "scrollbackLines",
                  enabled ? globalConfig.scrollbackLines : undefined,
                )
              }
            >
              <NumberInput value={getValue("scrollbackLines")} onChange={(v: number) => updateOverride("scrollbackLines", v)} className="w-28 px-3 py-1.5  bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)]" min={100} max={100000} step={1000} />
            </OverrideToggle>
          </div>

          {/* Bell Settings */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">Bell & Alerts</h4>

            <OverrideToggle
              label="Bell Style"
              isOverridden={isOverridden("bellStyle")}
              globalValue={globalConfig.bellStyle}
              onToggle={(enabled) =>
                updateOverride(
                  "bellStyle",
                  enabled ? globalConfig.bellStyle : undefined,
                )
              }
            >
              <Select value={getValue("bellStyle")} onChange={(v: string) => updateOverride("bellStyle", v as BellStyle)} options={[{ value: "none", label: "None" }, { value: "system", label: "System" }, { value: "visual", label: "Visual" }, { value: "flash-window", label: "Flash Window" }, { value: "pc-speaker", label: "PC Speaker" }]} variant="form-sm" className="" />
            </OverrideToggle>

            <OverrideToggle
              label="Taskbar Flash"
              isOverridden={isOverridden("taskbarFlash")}
              globalValue={globalConfig.taskbarFlash}
              onToggle={(enabled) =>
                updateOverride(
                  "taskbarFlash",
                  enabled ? globalConfig.taskbarFlash : undefined,
                )
              }
            >
              <Select value={getValue("taskbarFlash")} onChange={(v: string) => updateOverride(
                    "taskbarFlash",
                    v as TaskbarFlashMode,
                  )} options={[{ value: "disabled", label: "Disabled" }, { value: "on-bell", label: "On Bell" }, { value: "on-output", label: "On Output" }, { value: "always", label: "Always" }]} variant="form-sm" className="" />
            </OverrideToggle>
          </div>

          {/* SSH Protocol Settings */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">SSH Protocol</h4>

            <OverrideToggle
              label="Compression"
              isOverridden={isOverridden("enableCompression")}
              globalValue={
                globalConfig.enableCompression
                  ? `Level ${globalConfig.compressionLevel}`
                  : "Disabled"
              }
              onToggle={(enabled) =>
                updateOverride(
                  "enableCompression",
                  enabled ? !globalConfig.enableCompression : undefined,
                )
              }
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("enableCompression")} onChange={(v: boolean) => updateOverride("enableCompression", v)} variant="form" />
                Enable compression
              </label>
            </OverrideToggle>

            {getValue("enableCompression") && (
              <OverrideToggle
                label="Compression Level"
                isOverridden={isOverridden("compressionLevel")}
                globalValue={`${globalConfig.compressionLevel}`}
                onToggle={(enabled) =>
                  updateOverride(
                    "compressionLevel",
                    enabled ? globalConfig.compressionLevel : undefined,
                  )
                }
              >
                <Slider value={getValue("compressionLevel")} onChange={(v: number) => updateOverride("compressionLevel", v)} min={1} max={9} className="w-32" />
                <span className="text-sm text-[var(--color-textSecondary)] ml-2">
                  {getValue("compressionLevel")}
                </span>
              </OverrideToggle>
            )}

            <OverrideToggle
              label="SSH Version"
              isOverridden={isOverridden("sshVersion")}
              globalValue={globalConfig.sshVersion}
              onToggle={(enabled) =>
                updateOverride(
                  "sshVersion",
                  enabled ? globalConfig.sshVersion : undefined,
                )
              }
            >
              <Select value={getValue("sshVersion")} onChange={(v: string) => updateOverride("sshVersion", v as SSHVersion)} options={[{ value: "auto", label: "Auto" }, { value: "1", label: "SSH-1 Only" }, { value: "2", label: "SSH-2 Only" }, { value: "3", label: "SSH-3 Only" }]} variant="form-sm" className="" />
            </OverrideToggle>
          </div>

          {/* TCP Options */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">TCP Options</h4>

            <OverrideToggle
              label="TCP No Delay"
              isOverridden={
                isOverridden("tcpOptions") &&
                "tcpNoDelay" in (overrides.tcpOptions || {})
              }
              globalValue={
                globalConfig.tcpOptions.tcpNoDelay ? "Enabled" : "Disabled"
              }
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride("tcpOptions", {
                    ...getValue("tcpOptions"),
                    tcpNoDelay: globalConfig.tcpOptions.tcpNoDelay,
                  });
                } else {
                  const { tcpNoDelay: _, ...rest } = overrides.tcpOptions || {};
                  updateOverride(
                    "tcpOptions",
                    Object.keys(rest).length > 0 ? (rest as any) : undefined,
                  );
                }
              }}
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("tcpOptions").tcpNoDelay} onChange={(v: boolean) => updateOverride("tcpOptions", {
                      ...getValue("tcpOptions"),
                      tcpNoDelay: v,
                    })} variant="form" />
                Disable Nagle's algorithm
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="TCP Keep Alive"
              isOverridden={
                isOverridden("tcpOptions") &&
                "tcpKeepAlive" in (overrides.tcpOptions || {})
              }
              globalValue={
                globalConfig.tcpOptions.tcpKeepAlive
                  ? `${globalConfig.tcpOptions.keepAliveInterval}s`
                  : "Disabled"
              }
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride("tcpOptions", {
                    ...getValue("tcpOptions"),
                    tcpKeepAlive: globalConfig.tcpOptions.tcpKeepAlive,
                  });
                } else {
                  const { tcpKeepAlive: _, ...rest } =
                    overrides.tcpOptions || {};
                  updateOverride(
                    "tcpOptions",
                    Object.keys(rest).length > 0 ? (rest as any) : undefined,
                  );
                }
              }}
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("tcpOptions").tcpKeepAlive} onChange={(v: boolean) => updateOverride("tcpOptions", {
                      ...getValue("tcpOptions"),
                      tcpKeepAlive: v,
                    })} variant="form" />
                Enable TCP keep alive
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Connection Timeout"
              isOverridden={
                isOverridden("tcpOptions") &&
                "connectionTimeout" in (overrides.tcpOptions || {})
              }
              globalValue={`${globalConfig.tcpOptions.connectionTimeout}s`}
              onToggle={(enabled) => {
                if (enabled) {
                  updateOverride("tcpOptions", {
                    ...getValue("tcpOptions"),
                    connectionTimeout:
                      globalConfig.tcpOptions.connectionTimeout,
                  });
                } else {
                  const { connectionTimeout: _, ...rest } =
                    overrides.tcpOptions || {};
                  updateOverride(
                    "tcpOptions",
                    Object.keys(rest).length > 0 ? (rest as any) : undefined,
                  );
                }
              }}
            >
              <div className="flex items-center gap-2">
                <NumberInput value={getValue("tcpOptions").connectionTimeout} onChange={(v: number) => updateOverride("tcpOptions", {
                      ...getValue("tcpOptions"),
                      connectionTimeout: v,
                    })} variant="form-sm" className="" min={5} max={300} />
                <span className="text-sm text-[var(--color-textSecondary)]">
                  seconds
                </span>
              </div>
            </OverrideToggle>
          </div>

          {/* Line Handling */}
          <div className="space-y-3">
            <h4 className="sor-form-section-heading">Line Handling</h4>

            <OverrideToggle
              label="Implicit CR in LF"
              isOverridden={isOverridden("implicitCrInLf")}
              globalValue={globalConfig.implicitCrInLf ? "Yes" : "No"}
              onToggle={(enabled) =>
                updateOverride(
                  "implicitCrInLf",
                  enabled ? !globalConfig.implicitCrInLf : undefined,
                )
              }
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("implicitCrInLf")} onChange={(v: boolean) => updateOverride("implicitCrInLf", v)} variant="form" />
                Add CR to every LF
              </label>
            </OverrideToggle>

            <OverrideToggle
              label="Auto Wrap"
              isOverridden={isOverridden("autoWrap")}
              globalValue={globalConfig.autoWrap ? "Yes" : "No"}
              onToggle={(enabled) =>
                updateOverride(
                  "autoWrap",
                  enabled ? !globalConfig.autoWrap : undefined,
                )
              }
            >
              <label className="sor-form-inline-check">
                <Checkbox checked={getValue("autoWrap")} onChange={(v: boolean) => updateOverride("autoWrap", v)} variant="form" />
                Auto-wrap long lines
              </label>
            </OverrideToggle>
          </div>
        </div>
      )}
    </div>
  );
};

export default SSHTerminalOverrides;
