import React from "react";
import { useTranslation } from "react-i18next";
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
} from "../../../types/settings";
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
  RotateCcw,
} from "lucide-react";
import { SettingsCollapsibleSection } from "../../ui/SettingsPrimitives";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface SSHTerminalSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

interface SectionProps {
  cfg: SSHTerminalConfig;
  up: (updates: Partial<SSHTerminalConfig>) => void;
  t: (key: string, fallback: string) => string;
}

/* ═══════════════════════════════════════════════════════════════
   Reusable Primitives
   ═══════════════════════════════════════════════════════════════ */

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
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
  </label>
);

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

/* ═══════════════════════════════════════════════════════════════
   Line Handling
   ═══════════════════════════════════════════════════════════════ */

const LineHandlingSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineHandling", "Line Handling")}
    icon={<Type className="w-4 h-4 text-blue-400" />}
  >
    <Toggle
      checked={cfg.implicitCrInLf}
      onChange={(v) => up({ implicitCrInLf: v })}
      label={t(
        "settings.sshTerminal.implicitCrInLf",
        "Implicit CR in every LF",
      )}
      description={t(
        "settings.sshTerminal.implicitCrInLfDesc",
        "Automatically add carriage return when receiving line feed",
      )}
    />
    <Toggle
      checked={cfg.implicitLfInCr}
      onChange={(v) => up({ implicitLfInCr: v })}
      label={t(
        "settings.sshTerminal.implicitLfInCr",
        "Implicit LF in every CR",
      )}
      description={t(
        "settings.sshTerminal.implicitLfInCrDesc",
        "Automatically add line feed when receiving carriage return",
      )}
    />
    <Toggle
      checked={cfg.autoWrap}
      onChange={(v) => up({ autoWrap: v })}
      label={t("settings.sshTerminal.autoWrap", "Auto wrap mode")}
      description={t(
        "settings.sshTerminal.autoWrapDesc",
        "Automatically wrap text at terminal edge",
      )}
    />
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Line Discipline
   ═══════════════════════════════════════════════════════════════ */

const LineDisciplineSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.lineDiscipline", "Line Discipline")}
    icon={<Keyboard className="w-4 h-4 text-purple-400" />}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Select
        value={cfg.localEcho}
        onChange={(v) =>
          up({ localEcho: v as typeof cfg.localEcho })
        }
        label={t("settings.sshTerminal.localEcho", "Local Echo")}
        options={LocalEchoModes.map((m) => ({
          value: m,
          label:
            m === "auto"
              ? "Auto (let server decide)"
              : m === "on"
                ? "Force On"
                : "Force Off",
        }))}
      />
      <Select
        value={cfg.localLineEditing}
        onChange={(v) =>
          up({
            localLineEditing: v as typeof cfg.localLineEditing,
          })
        }
        label={t(
          "settings.sshTerminal.localLineEditing",
          "Local Line Editing",
        )}
        options={LineEditingModes.map((m) => ({
          value: m,
          label:
            m === "auto"
              ? "Auto (let server decide)"
              : m === "on"
                ? "Force On"
                : "Force Off",
        }))}
      />
    </div>
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Bell Settings
   ═══════════════════════════════════════════════════════════════ */

const BELL_STYLE_LABELS: Record<string, string> = {
  none: "None (disabled)",
  system: "System default",
  visual: "Visual bell (flash terminal)",
  "flash-window": "Flash window",
  "pc-speaker": "Beep using PC speaker",
};

const BellSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.bellSettings", "Bell Settings")}
    icon={<Bell className="w-4 h-4 text-yellow-400" />}
  >
    <Select
      value={cfg.bellStyle}
      onChange={(v) =>
        up({ bellStyle: v as typeof cfg.bellStyle })
      }
      label={t("settings.sshTerminal.bellStyle", "Bell Style")}
      options={BellStyles.map((s) => ({
        value: s,
        label: BELL_STYLE_LABELS[s] || s,
      }))}
    />

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <h5 className="text-sm font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
        {cfg.bellOveruseProtection.enabled ? (
          <VolumeX className="w-4 h-4 text-orange-400" />
        ) : (
          <Volume2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
        {t("settings.sshTerminal.bellOveruse", "Bell Overuse Protection")}
      </h5>
      <Toggle
        checked={cfg.bellOveruseProtection.enabled}
        onChange={(v) =>
          up({
            bellOveruseProtection: {
              ...cfg.bellOveruseProtection,
              enabled: v,
            },
          })
        }
        label={t(
          "settings.sshTerminal.enableBellOveruse",
          "Enable bell overuse protection",
        )}
        description={t(
          "settings.sshTerminal.bellOveruseDesc",
          "Silence the bell if it rings too frequently",
        )}
      />
      {cfg.bellOveruseProtection.enabled && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 ml-10">
          <NumberInput
            value={cfg.bellOveruseProtection.maxBells}
            onChange={(v) =>
              up({
                bellOveruseProtection: {
                  ...cfg.bellOveruseProtection,
                  maxBells: v,
                },
              })
            }
            label={t("settings.sshTerminal.maxBells", "Max bells")}
            min={1}
            max={100}
          />
          <NumberInput
            value={cfg.bellOveruseProtection.timeWindowSeconds}
            onChange={(v) =>
              up({
                bellOveruseProtection: {
                  ...cfg.bellOveruseProtection,
                  timeWindowSeconds: v,
                },
              })
            }
            label={t(
              "settings.sshTerminal.timeWindow",
              "Time window (sec)",
            )}
            min={1}
            max={60}
          />
          <NumberInput
            value={cfg.bellOveruseProtection.silenceDurationSeconds}
            onChange={(v) =>
              up({
                bellOveruseProtection: {
                  ...cfg.bellOveruseProtection,
                  silenceDurationSeconds: v,
                },
              })
            }
            label={t(
              "settings.sshTerminal.silenceDuration",
              "Silence duration (sec)",
            )}
            min={1}
            max={300}
          />
        </div>
      )}
    </div>

    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <Select
        value={cfg.taskbarFlash}
        onChange={(v) =>
          up({
            taskbarFlash: v as typeof cfg.taskbarFlash,
          })
        }
        label={t("settings.sshTerminal.taskbarFlash", "Taskbar Flashing")}
        options={TaskbarFlashModes.map((m) => ({
          value: m,
          label:
            m === "disabled"
              ? "Disabled"
              : m === "flashing"
                ? "Flash until focused"
                : "Steady highlight",
        }))}
      />
    </div>
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Keyboard
   ═══════════════════════════════════════════════════════════════ */

const KeyboardSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.keyboard", "Keyboard")}
    icon={<Keyboard className="w-4 h-4 text-cyan-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.disableKeypadMode}
      onChange={(v) => up({ disableKeypadMode: v })}
      label={t(
        "settings.sshTerminal.disableKeypadMode",
        "Disable keypad application mode",
      )}
      description={t(
        "settings.sshTerminal.disableKeypadModeDesc",
        "Force numeric keypad to always send numbers",
      )}
    />
    <Toggle
      checked={cfg.disableApplicationCursorKeys}
      onChange={(v) => up({ disableApplicationCursorKeys: v })}
      label={t(
        "settings.sshTerminal.disableAppCursorKeys",
        "Disable application cursor keys",
      )}
      description={t(
        "settings.sshTerminal.disableAppCursorKeysDesc",
        "Force cursor keys to always send ANSI sequences",
      )}
    />
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Terminal Dimensions
   ═══════════════════════════════════════════════════════════════ */

const DimensionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.dimensions", "Terminal Dimensions")}
    icon={<LayoutGrid className="w-4 h-4 text-green-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.useCustomDimensions}
      onChange={(v) => up({ useCustomDimensions: v })}
      label={t(
        "settings.sshTerminal.useCustomDimensions",
        "Use custom dimensions",
      )}
      description={t(
        "settings.sshTerminal.useCustomDimensionsDesc",
        "Override automatic terminal size detection",
      )}
    />
    {cfg.useCustomDimensions && (
      <div className="grid grid-cols-2 gap-4 mt-3 ml-10">
        <NumberInput
          value={cfg.columns}
          onChange={(v) => up({ columns: v })}
          label={t("settings.sshTerminal.columns", "Columns")}
          min={40}
          max={500}
        />
        <NumberInput
          value={cfg.rows}
          onChange={(v) => up({ rows: v })}
          label={t("settings.sshTerminal.rows", "Rows")}
          min={10}
          max={200}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Character Set
   ═══════════════════════════════════════════════════════════════ */

const CharacterSetSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.characterSet", "Character Set")}
    icon={<Type className="w-4 h-4 text-indigo-400" />}
    defaultOpen={false}
  >
    <Select
      value={cfg.characterSet}
      onChange={(v) => up({ characterSet: v })}
      label={t(
        "settings.sshTerminal.remoteCharset",
        "Remote Character Set",
      )}
      options={CharacterSets.map((cs) => ({ value: cs, label: cs }))}
    />
    <Select
      value={cfg.unicodeAmbiguousWidth}
      onChange={(v) =>
        up({ unicodeAmbiguousWidth: v as "narrow" | "wide" })
      }
      label={t(
        "settings.sshTerminal.unicodeWidth",
        "Unicode Ambiguous Width",
      )}
      options={[
        { value: "narrow", label: "Narrow (1 cell)" },
        { value: "wide", label: "Wide (2 cells)" },
      ]}
    />
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Font Configuration
   ═══════════════════════════════════════════════════════════════ */

const FontSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.font", "Font Configuration")}
    icon={<Type className="w-4 h-4 text-pink-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.useCustomFont}
      onChange={(v) => up({ useCustomFont: v })}
      label={t("settings.sshTerminal.useCustomFont", "Use custom font")}
      description={t(
        "settings.sshTerminal.useCustomFontDesc",
        "Override default terminal font settings",
      )}
    />
    {cfg.useCustomFont && (
      <div className="space-y-4 mt-3 ml-10">
        <TextInput
          value={cfg.font.family}
          onChange={(v) => up({ font: { ...cfg.font, family: v } })}
          label={t("settings.sshTerminal.fontFamily", "Font Family")}
          placeholder="Consolas, Monaco, monospace"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumberInput
            value={cfg.font.size}
            onChange={(v) => up({ font: { ...cfg.font, size: v } })}
            label={t("settings.sshTerminal.fontSize", "Size (px)")}
            min={8}
            max={48}
          />
          <Select
            value={String(cfg.font.weight)}
            onChange={(v) =>
              up({
                font: {
                  ...cfg.font,
                  weight:
                    v === "normal" ||
                    v === "bold" ||
                    v === "lighter" ||
                    v === "bolder"
                      ? v
                      : Number(v),
                },
              })
            }
            label={t("settings.sshTerminal.fontWeight", "Weight")}
            options={[
              { value: "lighter", label: "Lighter" },
              { value: "normal", label: "Normal" },
              { value: "bold", label: "Bold" },
              { value: "bolder", label: "Bolder" },
            ]}
          />
          <Select
            value={cfg.font.style}
            onChange={(v) =>
              up({
                font: {
                  ...cfg.font,
                  style: v as typeof cfg.font.style,
                },
              })
            }
            label={t("settings.sshTerminal.fontStyle", "Style")}
            options={[
              { value: "normal", label: "Normal" },
              { value: "italic", label: "Italic" },
              { value: "oblique", label: "Oblique" },
            ]}
          />
          <NumberInput
            value={cfg.font.lineHeight}
            onChange={(v) => up({ font: { ...cfg.font, lineHeight: v } })}
            label={t("settings.sshTerminal.lineHeight", "Line Height")}
            min={0.8}
            max={3}
            step={0.1}
          />
        </div>
        <NumberInput
          value={cfg.font.letterSpacing}
          onChange={(v) =>
            up({ font: { ...cfg.font, letterSpacing: v } })
          }
          label={t(
            "settings.sshTerminal.letterSpacing",
            "Letter Spacing (px)",
          )}
          min={-5}
          max={10}
          step={0.5}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Colors
   ═══════════════════════════════════════════════════════════════ */

const ColorsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.colors", "Color Settings")}
    icon={<Palette className="w-4 h-4 text-orange-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.allowTerminalAnsiColors}
      onChange={(v) => up({ allowTerminalAnsiColors: v })}
      label={t(
        "settings.sshTerminal.allowAnsi",
        "Allow terminal to specify ANSI colors",
      )}
      description={t(
        "settings.sshTerminal.allowAnsiDesc",
        "Let remote applications set the 16 standard colors",
      )}
    />
    <Toggle
      checked={cfg.allowXterm256Colors}
      onChange={(v) => up({ allowXterm256Colors: v })}
      label={t(
        "settings.sshTerminal.allowXterm256",
        "Allow xterm 256-color mode",
      )}
      description={t(
        "settings.sshTerminal.allowXterm256Desc",
        "Enable extended 256-color palette support",
      )}
    />
    <Toggle
      checked={cfg.allow24BitColors}
      onChange={(v) => up({ allow24BitColors: v })}
      label={t(
        "settings.sshTerminal.allow24Bit",
        "Allow 24-bit true colors",
      )}
      description={t(
        "settings.sshTerminal.allow24BitDesc",
        "Enable full RGB color support (16 million colors)",
      )}
    />
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   TCP Options
   ═══════════════════════════════════════════════════════════════ */

const TcpOptionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.tcpOptions", "Low-level TCP Options")}
    icon={<Network className="w-4 h-4 text-teal-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.tcpOptions.tcpNoDelay}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, tcpNoDelay: v } })
      }
      label={t(
        "settings.sshTerminal.tcpNoDelay",
        "Disable Nagle algorithm (TCP_NODELAY)",
      )}
      description={t(
        "settings.sshTerminal.tcpNoDelayDesc",
        "Send data immediately without buffering small packets",
      )}
    />
    <Toggle
      checked={cfg.tcpOptions.tcpKeepAlive}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, tcpKeepAlive: v } })
      }
      label={t(
        "settings.sshTerminal.tcpKeepAlive",
        "Enable TCP keepalive",
      )}
      description={t(
        "settings.sshTerminal.tcpKeepAliveDesc",
        "Send TCP keepalive probes to detect dead connections",
      )}
    />
    <Toggle
      checked={cfg.tcpOptions.soKeepAlive}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, soKeepAlive: v } })
      }
      label={t(
        "settings.sshTerminal.soKeepAlive",
        "Enable SO_KEEPALIVE option",
      )}
      description={t(
        "settings.sshTerminal.soKeepAliveDesc",
        "Enable socket-level keepalive mechanism",
      )}
    />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
      <Select
        value={cfg.tcpOptions.ipProtocol}
        onChange={(v) =>
          up({
            tcpOptions: {
              ...cfg.tcpOptions,
              ipProtocol: v as typeof cfg.tcpOptions.ipProtocol,
            },
          })
        }
        label={t("settings.sshTerminal.ipProtocol", "IP Protocol")}
        options={IPProtocols.map((p) => ({
          value: p,
          label: p === "auto" ? "Auto (IPv4/IPv6)" : p.toUpperCase(),
        }))}
      />
      <NumberInput
        value={cfg.tcpOptions.connectionTimeout}
        onChange={(v) =>
          up({
            tcpOptions: { ...cfg.tcpOptions, connectionTimeout: v },
          })
        }
        label={t(
          "settings.sshTerminal.connectionTimeout",
          "Connection Timeout (sec)",
        )}
        min={5}
        max={300}
      />
    </div>

    {cfg.tcpOptions.tcpKeepAlive && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
        <NumberInput
          value={cfg.tcpOptions.keepAliveInterval}
          onChange={(v) =>
            up({
              tcpOptions: { ...cfg.tcpOptions, keepAliveInterval: v },
            })
          }
          label={t(
            "settings.sshTerminal.keepAliveInterval",
            "Keepalive Interval (sec)",
          )}
          min={1}
          max={3600}
        />
        <NumberInput
          value={cfg.tcpOptions.keepAliveProbes}
          onChange={(v) =>
            up({
              tcpOptions: { ...cfg.tcpOptions, keepAliveProbes: v },
            })
          }
          label={t(
            "settings.sshTerminal.keepAliveProbes",
            "Keepalive Probes",
          )}
          min={1}
          max={30}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   SSH Protocol
   ═══════════════════════════════════════════════════════════════ */

const SSHProtocolSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.sshProtocol", "SSH Protocol Settings")}
    icon={<Shield className="w-4 h-4 text-red-400" />}
    defaultOpen={false}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Select
        value={cfg.sshVersion}
        onChange={(v) =>
          up({ sshVersion: v as typeof cfg.sshVersion })
        }
        label={t("settings.sshTerminal.sshVersion", "SSH Version")}
        options={SSHVersions.map((v) => ({
          value: v,
          label: v === "auto" ? "Auto (negotiate)" : `SSH-${v}`,
        }))}
      />
    </div>

    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <Toggle
        checked={cfg.enableCompression}
        onChange={(v) => up({ enableCompression: v })}
        label={t(
          "settings.sshTerminal.enableCompression",
          "Enable SSH compression",
        )}
        description={t(
          "settings.sshTerminal.enableCompressionDesc",
          "Compress data over the SSH connection (useful for slow links)",
        )}
      />
      {cfg.enableCompression && (
        <div className="mt-3 ml-10">
          <NumberInput
            value={cfg.compressionLevel}
            onChange={(v) => up({ compressionLevel: v })}
            label={t(
              "settings.sshTerminal.compressionLevel",
              "Compression Level (1-9)",
            )}
            min={1}
            max={9}
          />
        </div>
      )}
    </div>
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Scrollback & Selection
   ═══════════════════════════════════════════════════════════════ */

const ScrollbackSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.scrollback", "Scrollback & Selection")}
    icon={<Monitor className="w-4 h-4 text-slate-400" />}
    defaultOpen={false}
  >
    <NumberInput
      value={cfg.scrollbackLines}
      onChange={(v) => up({ scrollbackLines: v })}
      label={t("settings.sshTerminal.scrollbackLines", "Scrollback Lines")}
      min={100}
      max={100000}
      step={100}
    />
    <Toggle
      checked={cfg.scrollOnOutput}
      onChange={(v) => up({ scrollOnOutput: v })}
      label={t("settings.sshTerminal.scrollOnOutput", "Scroll on output")}
      description={t(
        "settings.sshTerminal.scrollOnOutputDesc",
        "Automatically scroll to bottom when new output appears",
      )}
    />
    <Toggle
      checked={cfg.scrollOnKeystroke}
      onChange={(v) => up({ scrollOnKeystroke: v })}
      label={t(
        "settings.sshTerminal.scrollOnKeystroke",
        "Scroll on keystroke",
      )}
      description={t(
        "settings.sshTerminal.scrollOnKeystrokeDesc",
        "Automatically scroll to bottom when typing",
      )}
    />
    <div className="border-t border-[var(--color-border)] pt-4 mt-4">
      <Toggle
        checked={cfg.copyOnSelect}
        onChange={(v) => up({ copyOnSelect: v })}
        label={t("settings.sshTerminal.copyOnSelect", "Copy on select")}
        description={t(
          "settings.sshTerminal.copyOnSelectDesc",
          "Automatically copy selected text to clipboard",
        )}
      />
      <Toggle
        checked={cfg.pasteOnRightClick}
        onChange={(v) => up({ pasteOnRightClick: v })}
        label={t(
          "settings.sshTerminal.pasteOnRightClick",
          "Paste on right-click",
        )}
        description={t(
          "settings.sshTerminal.pasteOnRightClickDesc",
          "Paste clipboard content when right-clicking",
        )}
      />
      <div className="mt-3">
        <TextInput
          value={cfg.wordSeparators}
          onChange={(v) => up({ wordSeparators: v })}
          label={t(
            "settings.sshTerminal.wordSeparators",
            "Word Separators (for double-click selection)",
          )}
          placeholder={' !"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~'}
        />
      </div>
    </div>
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Miscellaneous
   ═══════════════════════════════════════════════════════════════ */

const MiscSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.misc", "Miscellaneous")}
    icon={
      <Settings2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
    }
    defaultOpen={false}
  >
    <TextInput
      value={cfg.answerbackString}
      onChange={(v) => up({ answerbackString: v })}
      label={t("settings.sshTerminal.answerback", "Answerback String")}
      placeholder="Optional terminal identification string"
    />
    <Toggle
      checked={cfg.localPrinting}
      onChange={(v) => up({ localPrinting: v })}
      label={t(
        "settings.sshTerminal.localPrinting",
        "Enable local printing",
      )}
      description={t(
        "settings.sshTerminal.localPrintingDesc",
        "Allow print commands from terminal",
      )}
    />
    <Toggle
      checked={cfg.remoteControlledPrinting}
      onChange={(v) => up({ remoteControlledPrinting: v })}
      label={t(
        "settings.sshTerminal.remotePrinting",
        "Enable remote-controlled printing",
      )}
      description={t(
        "settings.sshTerminal.remotePrintingDesc",
        "Allow remote host to trigger printing",
      )}
    />
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Advanced SSH Options
   ═══════════════════════════════════════════════════════════════ */

const TEXTAREA_CLASS =
  "w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500";

const AdvancedSSHSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.advancedSSH", "Advanced SSH Options")}
    icon={<Zap className="w-4 h-4 text-amber-400" />}
    defaultOpen={false}
  >
    <p className="text-xs text-[var(--color-textSecondary)] mb-4">
      {t(
        "settings.sshTerminal.advancedSSHDesc",
        "Configure preferred encryption ciphers, MACs, key exchanges, and host key algorithms. Items are tried in order of preference.",
      )}
    </p>

    <div className="space-y-4">
      {(
        [
          [
            "preferredCiphers",
            "settings.sshTerminal.preferredCiphers",
            "Preferred Ciphers",
            "One cipher per line",
            4,
          ],
          [
            "preferredMACs",
            "settings.sshTerminal.preferredMACs",
            "Preferred MACs",
            "One MAC per line",
            3,
          ],
          [
            "preferredKeyExchanges",
            "settings.sshTerminal.preferredKEX",
            "Preferred Key Exchanges",
            "One key exchange per line",
            4,
          ],
          [
            "preferredHostKeyAlgorithms",
            "settings.sshTerminal.preferredHostKeys",
            "Preferred Host Key Algorithms",
            "One algorithm per line",
            4,
          ],
        ] as const
      ).map(([field, tKey, fallback, placeholder, rows]) => (
        <div key={field}>
          <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
            {t(tKey, fallback)}
          </label>
          <textarea
            value={(cfg[field] as string[]).join("\n")}
            onChange={(e) =>
              up({
                [field]: e.target.value.split("\n").filter(Boolean),
              })
            }
            rows={rows}
            className={TEXTAREA_CLASS}
            placeholder={placeholder}
          />
        </div>
      ))}
    </div>
  </SettingsCollapsibleSection>
);

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const SSHTerminalSettings: React.FC<SSHTerminalSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  const cfg = settings.sshTerminal || defaultSSHTerminalConfig;

  const up = (updates: Partial<SSHTerminalConfig>) => {
    updateSettings({ sshTerminal: { ...cfg, ...updates } });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Terminal className="w-5 h-5" />
        SSH Terminal
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Terminal line handling, bell, keyboard, font, colors, scrollback, and
        SSH protocol settings.
      </p>

      <LineHandlingSection cfg={cfg} up={up} t={t} />
      <LineDisciplineSection cfg={cfg} up={up} t={t} />
      <BellSection cfg={cfg} up={up} t={t} />
      <KeyboardSection cfg={cfg} up={up} t={t} />
      <DimensionsSection cfg={cfg} up={up} t={t} />
      <CharacterSetSection cfg={cfg} up={up} t={t} />
      <FontSection cfg={cfg} up={up} t={t} />
      <ColorsSection cfg={cfg} up={up} t={t} />
      <TcpOptionsSection cfg={cfg} up={up} t={t} />
      <SSHProtocolSection cfg={cfg} up={up} t={t} />
      <ScrollbackSection cfg={cfg} up={up} t={t} />
      <MiscSection cfg={cfg} up={up} t={t} />
      <AdvancedSSHSection cfg={cfg} up={up} t={t} />
    </div>
  );
};

export default SSHTerminalSettings;
