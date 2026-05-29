import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Activity,
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Hash,
  Key,
  Network,
  Plug,
  RefreshCw,
  Shuffle,
  Timer,
} from "lucide-react";
import {
  SettingsNumberRow,
  SettingsSliderRow,
  SettingsTextRow,
  SettingsToggleRow as Toggle,
} from "./SettingsPrimitives";
import { InfoTooltip } from "../InfoTooltip";
import { cx } from "../lib/cx";

/**
 * Network-config primitives.
 *
 * These are composition shims on top of the rows in `SettingsPrimitives.tsx`.
 * They exist because the same five-or-six network concepts (Port, Host,
 * "Allow remote", Connect timeout, TCP keep-alive, API key) were duplicated
 * across the REST API, MCP server, SSH terminal, RDP defaults, and Proxy
 * settings with subtly different markup. Each primitive here bakes in the
 * sensible defaults (icon, range, unit, placeholder) and the harder-to-get-
 * right interactions (banner-when-toggled-on, dim-when-parent-off, mask +
 * copy-flash + regenerate).
 *
 * Migrate call sites to these. Don't grow new variants of the same row.
 */

/* ── Sub-group header ─────────────────────────────────────────────
 * Promoted from the local `const SubGroupHeader` redefined inline in
 * Proxy / RDP Performance / Backup Selection / SSH Bell + Scrollback /
 * Cloud Sync Recording / MemoryWatchdog / CredSSP. Same 10px-uppercase,
 * thin top-border, muted-text styling — just stop redefining it.
 */
export const SettingsSubGroupHeader: React.FC<{
  icon: React.ReactNode;
  label: React.ReactNode;
  /** Pull the divider closer to the previous row. Defaults to `pt-3 mt-1`. */
  tight?: boolean;
}> = ({ icon, label, tight }) => (
  <div
    className={cx(
      "flex items-center gap-1.5 border-t border-[var(--color-border)]/40 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] font-medium",
      tight ? "pt-2 mt-0.5" : "pt-3 mt-1",
    )}
  >
    {icon}
    {label}
  </div>
);

/* ── Host / bind address ──────────────────────────────────────────
 * Used by: REST API (planned), MCP server, RDP Gateway, Proxy.
 *
 * Same shape as SettingsTextRow but with the `Network` icon and a
 * `127.0.0.1` placeholder pre-applied. When `warnOnPublicBind` is set,
 * a small AlertTriangle banner appears below the row whenever the
 * value resolves to `0.0.0.0` or `::` — the "I'm binding on all
 * interfaces" footgun.
 */
export interface SettingsHostRowProps {
  settingKey?: string;
  label?: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  infoTooltip?: string;
  /** Show a warning banner when the value is a wildcard bind address. */
  warnOnPublicBind?: boolean;
}

const PUBLIC_BIND_ADDRESSES = new Set(["0.0.0.0", "::", "[::]", "*"]);

export const SettingsHostRow: React.FC<SettingsHostRowProps> = ({
  settingKey,
  label = "Host",
  description,
  value,
  onChange,
  placeholder = "127.0.0.1",
  icon = <Network size={16} />,
  infoTooltip,
  warnOnPublicBind = false,
}) => {
  const isPublic =
    warnOnPublicBind && PUBLIC_BIND_ADDRESSES.has(value.trim());
  return (
    <>
      <SettingsTextRow
        settingKey={settingKey}
        icon={icon}
        label={label}
        description={description}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        infoTooltip={infoTooltip}
      />
      {isPublic && (
        <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Binding on a wildcard address exposes the service to your
            entire network. Make sure authentication is enabled.
          </span>
        </div>
      )}
    </>
  );
};

/* ── Port ─────────────────────────────────────────────────────────
 * Used by: REST API (randomize), MCP server, RDP Gateway, Proxy.
 *
 * Bakes in the Hash icon and the 1–65535 default range. Optional
 * `onRandomize` adds a Shuffle button trailing the input (REST API
 * uses this). Optional `locked` greys the input + button (REST API
 * uses this when "use random port on each start" is on).
 */
export interface SettingsPortRowProps {
  settingKey?: string;
  label?: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** When set, renders a Shuffle button after the input. */
  onRandomize?: () => void;
  /** When `true`, the input + randomize button are disabled and muted. */
  locked?: boolean;
  infoTooltip?: string;
  icon?: React.ReactNode;
}

export const SettingsPortRow: React.FC<SettingsPortRowProps> = ({
  settingKey,
  label = "Port",
  description,
  value,
  onChange,
  min = 1,
  max = 65535,
  onRandomize,
  locked = false,
  infoTooltip,
  icon = <Hash size={16} />,
}) => {
  if (!onRandomize) {
    // No randomize button — straight delegation to SettingsNumberRow.
    return (
      <div
        className={locked ? "opacity-50 pointer-events-none" : undefined}
      >
        <SettingsNumberRow
          settingKey={settingKey}
          icon={icon}
          label={label}
          description={description}
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          infoTooltip={infoTooltip}
        />
      </div>
    );
  }
  // Custom row with a trailing Shuffle button. Matches the same
  // sor-settings-select-row shell SettingsNumberRow uses so spacing
  // and label styling stay consistent.
  return (
    <div
      className={cx(
        "sor-settings-select-row",
        locked && "opacity-50 pointer-events-none",
      )}
      {...(settingKey ? { "data-setting-key": settingKey } : {})}
    >
      <div className="min-w-0">
        <span className="sor-settings-row-label flex items-center gap-1">
          <span className="text-[var(--color-textSecondary)] mr-1">
            {icon}
          </span>
          {label}
          {infoTooltip && <InfoTooltip text={infoTooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="sor-settings-input text-right"
          style={{ width: "6rem" }}
          disabled={locked}
        />
        <button
          type="button"
          onClick={onRandomize}
          disabled={locked}
          className="inline-flex items-center justify-center p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          aria-label="Randomize port"
          title="Randomize port"
        >
          <Shuffle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/* ── Remote-access toggle + warning banner ────────────────────────
 * Used by: REST API, MCP server.
 *
 * Toggle on its own line, followed by the standard "you just opened
 * the firewall" AlertTriangle banner when checked. Both call sites
 * had this exact pattern copy-pasted; centralizing it kills 15 lines
 * at each site.
 */
export interface SettingsRemoteAccessRowProps {
  settingKey?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  infoTooltip?: string;
  /** Banner shown below the toggle when `checked` is true. */
  warningText?: string;
  icon?: React.ReactNode;
}

export const SettingsRemoteAccessRow: React.FC<
  SettingsRemoteAccessRowProps
> = ({
  settingKey,
  checked,
  onChange,
  label = "Allow remote connections",
  description = "Listen on all interfaces instead of localhost only",
  infoTooltip = "Listen on all network interfaces instead of localhost only. This exposes the service to other machines on your network.",
  warningText = "Warning: This exposes the service to your network. Ensure authentication is enabled.",
  icon = <Network size={16} />,
}) => (
  <>
    <Toggle
      settingKey={settingKey}
      icon={icon}
      label={label}
      description={description}
      checked={checked}
      onChange={onChange}
      infoTooltip={infoTooltip}
    />
    {checked && (
      <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{warningText}</span>
      </div>
    )}
  </>
);

/* ── Connect timeout ──────────────────────────────────────────────
 * Used by: SSH TCP options (number), RDP TCP defaults (slider),
 * REST API request-timeout (number).
 *
 * Bakes in the Timer icon, the `s` unit, and the "5–60" default
 * range. `variant: "slider"` switches to SettingsSliderRow so the
 * RDP TCP card keeps its slider feel; the SSH card stays on the
 * compact numeric input.
 */
export interface SettingsConnectionTimeoutRowProps {
  settingKey?: string;
  label?: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  variant?: "number" | "slider";
  infoTooltip?: string;
  icon?: React.ReactNode;
}

export const SettingsConnectionTimeoutRow: React.FC<
  SettingsConnectionTimeoutRowProps
> = ({
  settingKey,
  label = "Connect timeout",
  description,
  value,
  onChange,
  min = 1,
  max = 60,
  step = 1,
  variant = "number",
  infoTooltip = "Maximum time in seconds to wait for the connection to be established before timing out.",
  icon = <Timer size={16} />,
}) => {
  if (variant === "slider") {
    return (
      <SettingsSliderRow
        settingKey={settingKey}
        icon={icon}
        label={label}
        description={description}
        value={value}
        min={min}
        max={max}
        step={step}
        unit="s"
        onChange={onChange}
        infoTooltip={infoTooltip}
      />
    );
  }
  return (
    <SettingsNumberRow
      settingKey={settingKey}
      icon={icon}
      label={label}
      description={description}
      value={value}
      min={min}
      max={max}
      step={step}
      unit="s"
      onChange={onChange}
      infoTooltip={infoTooltip}
    />
  );
};

/* ── TCP keep-alive composite ─────────────────────────────────────
 * Used by: SSH TCP options (toggle + interval + probes + SO_KEEPALIVE),
 * RDP TCP defaults (toggle + interval only).
 *
 * Renders the parent toggle and a dim-wrapped sub-block containing
 * only the sub-rows that were configured. Each sub-row prop is
 * optional — pass it iff you want it rendered. The SSH form gets all
 * four; the RDP form gets toggle + interval.
 */
export interface SettingsTcpKeepAliveBlockProps {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  /** Label for the parent toggle. */
  label?: string;
  /** Description for the parent toggle. */
  description?: string;
  infoTooltip?: string;
  /** Optional secondary toggle (SO_KEEPALIVE in SSH). Sits next to the parent. */
  soKeepAlive?: {
    value: boolean;
    onChange: (v: boolean) => void;
    label?: string;
    description?: string;
    infoTooltip?: string;
  };
  /** Keepalive interval row. Rendered iff provided. */
  intervalSecs?: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    settingKey?: string;
    label?: string;
    infoTooltip?: string;
    /** "number" (default) renders a compact NumberRow, "slider" uses
     *  SettingsSliderRow to match the RDP TCP defaults UX. */
    variant?: "number" | "slider";
  };
  /** Keepalive probes row. Rendered iff provided. */
  probes?: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    settingKey?: string;
    label?: string;
    infoTooltip?: string;
  };
}

export const SettingsTcpKeepAliveBlock: React.FC<
  SettingsTcpKeepAliveBlockProps
> = ({
  enabled,
  onEnabledChange,
  label = "Enable TCP keep-alive",
  description = "Send periodic probes to detect stale connections before they're dropped.",
  infoTooltip = "Sends periodic TCP keep-alive probes to detect and prevent stale connections from being dropped.",
  soKeepAlive,
  intervalSecs,
  probes,
}) => (
  <>
    <Toggle
      icon={<Activity size={16} />}
      label={label}
      description={description}
      checked={enabled}
      onChange={onEnabledChange}
      infoTooltip={infoTooltip}
    />
    {soKeepAlive && (
      <Toggle
        icon={<Plug size={16} />}
        label={soKeepAlive.label ?? "Enable SO_KEEPALIVE option"}
        description={
          soKeepAlive.description ??
          "Enable socket-level keepalive mechanism"
        }
        checked={soKeepAlive.value}
        onChange={soKeepAlive.onChange}
        infoTooltip={
          soKeepAlive.infoTooltip ??
          "Enable the socket-level keepalive mechanism provided by the operating system."
        }
      />
    )}
    {(intervalSecs || probes) && (
      <div
        className={`flex flex-col gap-2.5 ${
          enabled ? "" : "opacity-50 pointer-events-none"
        }`}
      >
        {intervalSecs && (
          intervalSecs.variant === "slider" ? (
            <SettingsSliderRow
              settingKey={intervalSecs.settingKey ?? "keepAliveInterval"}
              icon={<RefreshCw size={16} />}
              label={intervalSecs.label ?? "Keep-alive interval"}
              value={intervalSecs.value}
              min={intervalSecs.min ?? 1}
              max={intervalSecs.max ?? 3600}
              step={intervalSecs.step ?? 1}
              unit="s"
              onChange={intervalSecs.onChange}
              infoTooltip={
                intervalSecs.infoTooltip ??
                "Time in seconds between TCP keep-alive probes."
              }
            />
          ) : (
            <SettingsNumberRow
              settingKey={intervalSecs.settingKey ?? "keepAliveInterval"}
              icon={<RefreshCw size={16} />}
              label={intervalSecs.label ?? "Keep-alive interval"}
              value={intervalSecs.value}
              min={intervalSecs.min ?? 1}
              max={intervalSecs.max ?? 3600}
              step={intervalSecs.step ?? 1}
              unit="s"
              onChange={intervalSecs.onChange}
              infoTooltip={
                intervalSecs.infoTooltip ??
                "Time in seconds between TCP keep-alive probes."
              }
            />
          )
        )}
        {probes && (
          <SettingsNumberRow
            settingKey={probes.settingKey ?? "keepAliveProbes"}
            icon={<AlertCircle size={16} />}
            label={probes.label ?? "Keep-alive probes"}
            value={probes.value}
            min={probes.min ?? 1}
            max={probes.max ?? 30}
            onChange={probes.onChange}
            infoTooltip={
              probes.infoTooltip ??
              "Number of unacknowledged keep-alive probes before the connection is considered dead."
            }
          />
        )}
      </div>
    )}
  </>
);

/* ── API key field ────────────────────────────────────────────────
 * Used by: REST API, MCP server.
 *
 * Read-only masked input + show/hide + copy-with-flash + regenerate
 * trailing buttons. Both REST and MCP previously rolled this inline
 * with ~30 lines of markup each; this primitive replaces both.
 */
export interface SettingsApiKeyFieldProps {
  settingKey?: string;
  label?: string;
  value: string;
  /** Called when the user clicks the Copy button. The primitive
   *  handles the 2-second "copied" feedback flash internally — your
   *  handler just needs to put the value on the clipboard. */
  onCopy: () => void | Promise<void>;
  /** Called when the user clicks the Regenerate button. */
  onRegenerate: () => void | Promise<void>;
  /** When `true`, the Regenerate button shows a spinner instead. */
  isRegenerating?: boolean;
  placeholder?: string;
  infoTooltip?: string;
  /** Optional description shown under the label. */
  description?: string;
  /** Width of the input. Defaults to 16rem to match REST/MCP. */
  inputWidth?: string;
  /** Disable the entire row (e.g. when the parent "Require auth"
   *  toggle is off). */
  disabled?: boolean;
}

export const SettingsApiKeyField: React.FC<SettingsApiKeyFieldProps> = ({
  settingKey,
  label = "API key",
  value,
  onCopy,
  onRegenerate,
  isRegenerating = false,
  placeholder = "No API key generated",
  infoTooltip,
  description,
  inputWidth = "16rem",
  disabled = false,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    await onCopy();
    setCopiedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setCopiedFlash(false), 2000);
  };

  return (
    <>
      <div
        className={cx(
          "sor-settings-select-row",
          disabled && "opacity-50 pointer-events-none",
        )}
        {...(settingKey ? { "data-setting-key": settingKey } : {})}
      >
        <div className="min-w-0">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Key size={16} />
            </span>
            {label}
            {infoTooltip && <InfoTooltip text={infoTooltip} />}
          </span>
          {description && (
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 sor-settings-input px-2 min-w-0"
            style={{ width: inputWidth }}
          >
            <input
              type={showKey ? "text" : "password"}
              value={value}
              readOnly
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent border-0 p-0 text-sm font-mono text-[var(--color-text)] outline-none"
              aria-label={label}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              aria-label={showKey ? "Hide key" : "Show key"}
              title={showKey ? "Hide key" : "Show key"}
              disabled={!value}
            >
              {showKey ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
            {value && (
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                aria-label="Copy key"
                title="Copy key"
              >
                {copiedFlash ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="shrink-0 inline-flex items-center justify-center p-2 bg-primary border border-primary rounded-md text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
            aria-label="Generate new key"
            title="Generate new key"
          >
            <RefreshCw
              className={cx(
                "w-4 h-4",
                isRegenerating && "animate-spin",
              )}
            />
          </button>
        </div>
      </div>
    </>
  );
};
