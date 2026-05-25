import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Zap, Image, MoveHorizontal, Sparkles, Palette, MousePointer, Settings, Type, Layers, Database, Boxes } from "lucide-react";
import { Select, Slider } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

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

const PerformanceDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Zap className="w-4 h-4 text-primary" />}
      title="Performance / Frame Delivery Defaults"
    />

    <Card>
    {/* Connection Speed Preset */}
    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Connection Speed Preset <InfoTooltip text="Selects a predefined set of visual and frame delivery settings optimized for your network speed." />
      </label>
      <Select value={rdp.connectionSpeed ?? "broadband-high"} onChange={(v: string) => {
          const preset = SPEED_PRESETS[v];
          if (preset) {
            update({ connectionSpeed: v as typeof rdp.connectionSpeed, ...preset });
          } else {
            update({ connectionSpeed: v as typeof rdp.connectionSpeed });
          }
        }} options={[
          { value: "modem", label: "Modem (56 Kbps)" },
          { value: "broadband-low", label: "Broadband (Low)" },
          { value: "broadband-high", label: "Broadband (High)" },
          { value: "wan", label: "WAN" },
          { value: "lan", label: "LAN (10 Mbps+)" },
          { value: "auto-detect", label: "Auto-detect" },
        ]} className={selectClass} />
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Selecting a preset adjusts visual experience and frame delivery settings below.
      </p>
    </div>

    {/* Visual Experience */}
    <div className="text-sm text-[var(--color-textMuted)] font-medium pt-2">
      Visual Experience
    </div>

    {([
      ["disableWallpaper", true, "Disable wallpaper", "Prevents the desktop wallpaper from being rendered, reducing bandwidth usage.", <Image size={16} />],
      ["disableFullWindowDrag", true, "Disable full-window drag", "Shows only a window outline while dragging instead of rendering full window contents.", <MoveHorizontal size={16} />],
      ["disableMenuAnimations", true, "Disable menu animations", "Turns off menu fade and slide animations to improve responsiveness.", <Sparkles size={16} />],
      ["disableTheming", false, "Disable visual themes", "Disables Windows visual themes on the remote desktop to save bandwidth.", <Palette size={16} />],
      ["disableCursorShadow", true, "Disable cursor shadow", "Removes the shadow effect beneath the mouse cursor in the remote session.", <MousePointer size={16} />],
      ["disableCursorSettings", false, "Disable cursor settings", "Disables custom cursor rendering settings on the remote machine.", <Settings size={16} />],
      ["enableFontSmoothing", true, "Enable font smoothing (ClearType)", "Enables ClearType font smoothing for clearer text on the remote desktop.", <Type size={16} />],
      ["enableDesktopComposition", false, "Enable desktop composition (Aero)", "Enables Aero glass and transparency effects on the remote desktop. Uses more bandwidth.", <Layers size={16} />],
    ] as [string, boolean, string, string, React.ReactNode][]).map(([key, def, label, tooltip, icon]) => (
      <Toggle
        key={key}
        checked={(rdp[key as keyof typeof rdp] as boolean | undefined) ?? def}
        onChange={(v) => update({ [key]: v } as any)}
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
      description="Cache frequently used bitmaps to disk for faster reconnection"
      infoTooltip="Caches frequently used bitmaps to disk, reducing bandwidth on reconnection to the same server."
    />

    {/* Frame Delivery */}
    <div className="text-sm text-[var(--color-textMuted)] font-medium pt-2">
      Frame Delivery
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.targetFps ?? 30} <InfoTooltip text="Maximum frames per second the remote session will deliver. Set to 0 for unlimited." />
      </label>
      <Slider value={rdp.targetFps ?? 30} onChange={(v: number) => update({ targetFps: v })} min={0} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>0 (unlimited)</span>
        <span>60</span>
      </div>
    </div>

    <Toggle
      checked={rdp.frameBatching ?? true}
      onChange={(v) => update({ frameBatching: v })}
      icon={<Boxes size={16} />}
      label="Frame Batching"
      description="Accumulate dirty regions on the Rust side and emit them in batches (off = each region pushed immediately, lower latency with JS rAF pacing)"
      infoTooltip="Accumulates changed screen regions and sends them in batches to reduce IPC overhead."
    />

    {(rdp.frameBatching ?? true) && (
      <div className="pl-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Batch Interval: {rdp.frameBatchIntervalMs ?? 33}ms <InfoTooltip text="Time between batch flushes. Lower values mean smoother updates but higher CPU usage." /> (
          {Math.round(1000 / (rdp.frameBatchIntervalMs || 33))} fps max)
        </label>
        <Slider value={rdp.frameBatchIntervalMs ?? 33} onChange={(v: number) => update({ frameBatchIntervalMs: v })} min={8} max={100} variant="full" />
        <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
          <span>8ms (~120fps)</span>
          <span>100ms (~10fps)</span>
        </div>
      </div>
    )}

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Full-Frame Sync Interval: <InfoTooltip text="How often a complete framebuffer is resent to correct any accumulated rendering drift." /> every {rdp.fullFrameSyncInterval ?? 300}{" "}
        frames
      </label>
      <Slider value={rdp.fullFrameSyncInterval ?? 300} onChange={(v: number) => update({ fullFrameSyncInterval: v })} min={50} max={1000} variant="full" step={50} />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>50</span>
        <span>1000</span>
      </div>
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Periodically resends the entire framebuffer to fix any accumulated
        rendering errors.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        PDU Read Timeout: {rdp.readTimeoutMs ?? 16}ms <InfoTooltip text="How long to wait for incoming protocol data units before yielding. Lower values are more responsive but use more CPU." />
      </label>
      <Slider value={rdp.readTimeoutMs ?? 16} onChange={(v: number) => update({ readTimeoutMs: v })} min={1} max={50} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1ms</span>
        <span>50ms</span>
      </div>
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Lower = more responsive but higher CPU. 16ms ≈ 60hz poll rate.
      </p>
    </div>
    </Card>
  </div>
);

export default PerformanceDefaults;
