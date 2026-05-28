import type { SectionProps } from "./selectClass";
import React from "react";
import {
  Zap,
  Image,
  MoveHorizontal,
  Sparkles,
  Palette,
  MousePointer,
  Settings,
  Type,
  Layers,
  Database,
  Boxes,
  Gauge,
  Timer,
  Eye,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
} from "../../../ui/settings/SettingsPrimitives";

/* Small in-card sub-group header (matches Memory Watchdog / CredSSP). */
const SubGroupHeader: React.FC<{ icon: React.ReactNode; label: string }> = ({
  icon,
  label,
}) => (
  <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-[var(--color-border)]/40 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] font-medium">
    {icon}
    {label}
  </div>
);

const SPEED_PRESETS: Record<
  string,
  {
    disableWallpaper: boolean;
    disableFullWindowDrag: boolean;
    disableMenuAnimations: boolean;
    disableTheming: boolean;
    disableCursorShadow: boolean;
    enableFontSmoothing: boolean;
    enableDesktopComposition: boolean;
    targetFps: number;
    frameBatchIntervalMs: number;
  }
> = {
  modem: {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: true,
    disableCursorShadow: true,
    enableFontSmoothing: false,
    enableDesktopComposition: false,
    targetFps: 15,
    frameBatchIntervalMs: 66,
  },
  "broadband-low": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    targetFps: 24,
    frameBatchIntervalMs: 42,
  },
  "broadband-high": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    targetFps: 30,
    frameBatchIntervalMs: 33,
  },
  wan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
    targetFps: 60,
    frameBatchIntervalMs: 16,
  },
  lan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
    targetFps: 60,
    frameBatchIntervalMs: 16,
  },
};

const VISUAL_TOGGLES: [
  string,
  boolean,
  string,
  string,
  React.ReactNode,
][] = [
  [
    "disableWallpaper",
    true,
    "Disable wallpaper",
    "Prevents the desktop wallpaper from being rendered, reducing bandwidth usage.",
    <Image key="i1" size={16} />,
  ],
  [
    "disableFullWindowDrag",
    true,
    "Disable full-window drag",
    "Shows only a window outline while dragging instead of rendering full window contents.",
    <MoveHorizontal key="i2" size={16} />,
  ],
  [
    "disableMenuAnimations",
    true,
    "Disable menu animations",
    "Turns off menu fade and slide animations to improve responsiveness.",
    <Sparkles key="i3" size={16} />,
  ],
  [
    "disableTheming",
    false,
    "Disable visual themes",
    "Disables Windows visual themes on the remote desktop to save bandwidth.",
    <Palette key="i4" size={16} />,
  ],
  [
    "disableCursorShadow",
    true,
    "Disable cursor shadow",
    "Removes the shadow effect beneath the mouse cursor in the remote session.",
    <MousePointer key="i5" size={16} />,
  ],
  [
    "disableCursorSettings",
    false,
    "Disable cursor settings",
    "Disables custom cursor rendering settings on the remote machine.",
    <Settings key="i6" size={16} />,
  ],
  [
    "enableFontSmoothing",
    true,
    "Enable font smoothing (ClearType)",
    "Enables ClearType font smoothing for clearer text on the remote desktop.",
    <Type key="i7" size={16} />,
  ],
  [
    "enableDesktopComposition",
    false,
    "Enable desktop composition (Aero)",
    "Enables Aero glass and transparency effects on the remote desktop. Uses more bandwidth.",
    <Layers key="i8" size={16} />,
  ],
];

const PerformanceDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const frameBatchOn = rdp.frameBatching ?? true;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Zap className="w-4 h-4 text-primary" />}
        title="Performance / Frame Delivery Defaults"
      />

      <Card>
        <SettingsSelectRow
          settingKey="connectionSpeed"
          icon={<Gauge size={16} />}
          label="Connection speed preset"
          description="Selecting a preset adjusts the visual experience and frame delivery options below."
          value={rdp.connectionSpeed ?? "broadband-high"}
          options={[
            { value: "modem", label: "Modem (56 Kbps)" },
            { value: "broadband-low", label: "Broadband (Low)" },
            { value: "broadband-high", label: "Broadband (High)" },
            { value: "wan", label: "WAN" },
            { value: "lan", label: "LAN (10 Mbps+)" },
            { value: "auto-detect", label: "Auto-detect" },
          ]}
          onChange={(v) => {
            const preset = SPEED_PRESETS[v];
            if (preset) {
              update({
                connectionSpeed: v as typeof rdp.connectionSpeed,
                ...preset,
              });
            } else {
              update({ connectionSpeed: v as typeof rdp.connectionSpeed });
            }
          }}
          infoTooltip="Selects a predefined set of visual and frame delivery settings optimized for your network speed."
        />

        <SubGroupHeader icon={<Eye size={11} />} label="Visual experience" />

        {VISUAL_TOGGLES.map(([key, def, label, tooltip, icon]) => (
          <Toggle
            key={key}
            checked={
              (rdp[key as keyof typeof rdp] as boolean | undefined) ?? def
            }
            onChange={(v) =>
              update({ [key]: v } as Record<string, unknown>)
            }
            icon={icon}
            label={label}
            infoTooltip={tooltip}
          />
        ))}

        <Toggle
          checked={rdp.persistentBitmapCaching ?? false}
          onChange={(v) => update({ persistentBitmapCaching: v })}
          icon={<Database size={16} />}
          label="Persistent bitmap caching"
          description="Cache frequently used bitmaps to disk for faster reconnection."
          infoTooltip="Caches frequently used bitmaps to disk, reducing bandwidth on reconnection to the same server."
        />

        <SubGroupHeader icon={<Timer size={11} />} label="Frame delivery" />

        <SettingsSliderRow
          settingKey="targetFps"
          icon={<Gauge size={16} />}
          label="Target FPS"
          description="0 = unlimited."
          value={rdp.targetFps ?? 30}
          min={0}
          max={60}
          unit=" fps"
          onChange={(v) => update({ targetFps: v })}
          infoTooltip="Maximum frames per second the remote session will deliver. Set to 0 for unlimited."
        />

        <Toggle
          checked={frameBatchOn}
          onChange={(v) => update({ frameBatching: v })}
          icon={<Boxes size={16} />}
          label="Frame batching"
          description="Accumulate dirty regions on the Rust side and emit them in batches (off = each region pushed immediately, lower latency with JS rAF pacing)."
          infoTooltip="Accumulates changed screen regions and sends them in batches to reduce IPC overhead."
        />

        <div
          className={
            frameBatchOn ? undefined : "opacity-50 pointer-events-none"
          }
        >
          <SettingsSliderRow
            settingKey="frameBatchIntervalMs"
            icon={<Timer size={16} />}
            label="Batch interval"
            description={`Approximately ${Math.round(1000 / (rdp.frameBatchIntervalMs || 33))} fps max. Lower values give smoother updates at the cost of CPU.`}
            value={rdp.frameBatchIntervalMs ?? 33}
            min={8}
            max={100}
            unit="ms"
            onChange={(v) => update({ frameBatchIntervalMs: v })}
            infoTooltip="Time between batch flushes. Lower values mean smoother updates but higher CPU usage."
          />
        </div>

        <SettingsSliderRow
          settingKey="fullFrameSyncInterval"
          icon={<Sparkles size={16} />}
          label="Full-frame sync interval"
          description="Periodically resends the entire framebuffer to correct accumulated rendering drift."
          value={rdp.fullFrameSyncInterval ?? 300}
          min={50}
          max={1000}
          step={50}
          unit=" frames"
          onChange={(v) => update({ fullFrameSyncInterval: v })}
          infoTooltip="How often a complete framebuffer is resent to correct any accumulated rendering drift."
        />

        <SettingsSliderRow
          settingKey="readTimeoutMs"
          icon={<Timer size={16} />}
          label="PDU read timeout"
          description="Lower = more responsive but higher CPU. 16 ms ≈ 60 Hz poll rate."
          value={rdp.readTimeoutMs ?? 16}
          min={1}
          max={50}
          unit="ms"
          onChange={(v) => update({ readTimeoutMs: v })}
          infoTooltip="How long to wait for incoming protocol data units before yielding. Lower values are more responsive but use more CPU."
        />
      </Card>
    </div>
  );
};

export default PerformanceDefaults;
