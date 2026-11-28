import React from "react";
import { Settings2, RotateCcw } from "lucide-react";
import { Connection } from "../../types/connection/connection";
import {
  SSHTerminalConfig,
  defaultSSHTerminalConfig,
  BellStyle,
  TaskbarFlashMode,
} from "../../types/settings/settings";
import { useSettings } from "../../contexts/SettingsContext";
import { Checkbox, NumberInput, Select, Slider } from "../ui/forms";
import OverrideToggle from "../ui/OverrideToggle";
import { OverrideSummary } from "./OverrideSummary";

const TERMINAL_PANEL_KEYS = [
  "useCustomFont",
  "font",
  "useCustomDimensions",
  "columns",
  "rows",
  "scrollbackLines",
  "bellStyle",
  "taskbarFlash",
  "implicitCrInLf",
  "autoWrap",
] as const;

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
  const overrides = formData.sshTerminalConfigOverride || {};

  // Check if any overrides exist
  const overrideCount = TERMINAL_PANEL_KEYS.filter(
    (key) => overrides[key] !== undefined,
  ).length;
  const hasOverrides = overrideCount > 0;

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
    setFormData((prev) => {
      const remaining = { ...prev.sshTerminalConfigOverride };
      for (const key of TERMINAL_PANEL_KEYS) delete remaining[key];
      return {
        ...prev,
        sshTerminalConfigOverride: Object.keys(remaining).length
          ? remaining
          : undefined,
      };
    });
  };

  const isOverridden = (key: OverrideKey) => key in overrides;
  const getValue = <K extends OverrideKey>(key: K): SSHTerminalConfig[K] =>
    (overrides[key] as SSHTerminalConfig[K]) ?? globalConfig[key];

  // Only show for SSH protocol
  if (formData.protocol !== "ssh" || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            Terminal Settings Override
          </span>
          <OverrideSummary count={overrideCount} />
        </div>
      </div>

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
              <Checkbox
                checked={getValue("useCustomFont")}
                onChange={(v: boolean) => updateOverride("useCustomFont", v)}
                variant="form"
              />
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
                      Object.keys(rest).length > 0 ? (rest as any) : undefined,
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
                      Object.keys(rest).length > 0 ? (rest as any) : undefined,
                    );
                  }
                }}
              >
                <NumberInput
                  value={getValue("font").size}
                  onChange={(v: number) =>
                    updateOverride("font", {
                      ...getValue("font"),
                      size: v,
                    })
                  }
                  className="w-24 px-3 py-1.5  bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  min={8}
                  max={32}
                />
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
              <Checkbox
                checked={getValue("useCustomDimensions")}
                onChange={(v: boolean) =>
                  updateOverride("useCustomDimensions", v)
                }
                variant="form"
              />
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
                <NumberInput
                  value={getValue("columns")}
                  onChange={(v: number) => updateOverride("columns", v)}
                  variant="form-sm"
                  className=""
                  min={40}
                  max={500}
                />
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
                <NumberInput
                  value={getValue("rows")}
                  onChange={(v: number) => updateOverride("rows", v)}
                  variant="form-sm"
                  className=""
                  min={10}
                  max={200}
                />
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
            <NumberInput
              value={getValue("scrollbackLines")}
              onChange={(v: number) => updateOverride("scrollbackLines", v)}
              className="w-28 px-3 py-1.5  bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              min={100}
              max={100000}
              step={1000}
            />
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
            <Select
              value={getValue("bellStyle")}
              onChange={(v: string) =>
                updateOverride("bellStyle", v as BellStyle)
              }
              options={[
                { value: "none", label: "None" },
                { value: "system", label: "System" },
                { value: "visual", label: "Visual" },
                { value: "flash-window", label: "Flash Window" },
                { value: "pc-speaker", label: "PC Speaker" },
              ]}
              variant="form-sm"
              className=""
            />
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
            <Select
              value={getValue("taskbarFlash")}
              onChange={(v: string) =>
                updateOverride("taskbarFlash", v as TaskbarFlashMode)
              }
              options={[
                { value: "disabled", label: "Disabled" },
                { value: "on-bell", label: "On Bell" },
                { value: "on-output", label: "On Output" },
                { value: "always", label: "Always" },
              ]}
              variant="form-sm"
              className=""
            />
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
              <Checkbox
                checked={getValue("implicitCrInLf")}
                onChange={(v: boolean) => updateOverride("implicitCrInLf", v)}
                variant="form"
              />
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
              <Checkbox
                checked={getValue("autoWrap")}
                onChange={(v: boolean) => updateOverride("autoWrap", v)}
                variant="form"
              />
              Auto-wrap long lines
            </label>
          </OverrideToggle>
        </div>
      </div>
    </div>
  );
};

export default SSHTerminalOverrides;
