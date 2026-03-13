import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Zap } from "lucide-react";
import { Checkbox, Select, Slider } from "../../../ui/forms";

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
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Zap className="w-4 h-4 text-warning" />
      Performance / Frame Delivery Defaults
    </h4>

    {/* Connection Speed Preset */}
    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Connection Speed Preset
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
      ["disableWallpaper", true, "Disable wallpaper"],
      ["disableFullWindowDrag", true, "Disable full-window drag"],
      ["disableMenuAnimations", true, "Disable menu animations"],
      ["disableTheming", false, "Disable visual themes"],
      ["disableCursorShadow", true, "Disable cursor shadow"],
      ["disableCursorSettings", false, "Disable cursor settings"],
      ["enableFontSmoothing", true, "Enable font smoothing (ClearType)"],
      ["enableDesktopComposition", false, "Enable desktop composition (Aero)"],
    ] as [string, boolean, string][]).map(([key, def, label]) => (
      <label key={key} className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={(rdp[key as keyof typeof rdp] as boolean | undefined) ?? def} onChange={(v: boolean) => update({ [key]: v } as any)} />
        <span className="sor-toggle-label">{label}</span>
      </label>
    ))}

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.persistentBitmapCaching ?? false} onChange={(v: boolean) => update({ persistentBitmapCaching: v })} />
      <span className="sor-toggle-label">Persistent bitmap caching</span>
    </label>

    {/* Frame Delivery */}
    <div className="text-sm text-[var(--color-textMuted)] font-medium pt-2">
      Frame Delivery
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.targetFps ?? 30}
      </label>
      <Slider value={rdp.targetFps ?? 30} onChange={(v: number) => update({ targetFps: v })} min={0} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>0 (unlimited)</span>
        <span>60</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.frameBatching ?? true} onChange={(v: boolean) => update({ frameBatching: v })} />
      <span className="sor-toggle-label">
        Frame Batching (accumulate dirty regions)
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
      When enabled, dirty regions are accumulated on the Rust side and emitted
      in batches. When disabled, each region is pushed immediately (lower
      latency, JS rAF handles pacing).
    </p>

    {(rdp.frameBatching ?? true) && (
      <div className="ml-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Batch Interval: {rdp.frameBatchIntervalMs ?? 33}ms (
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
        Full-Frame Sync Interval: every {rdp.fullFrameSyncInterval ?? 300}{" "}
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
        PDU Read Timeout: {rdp.readTimeoutMs ?? 16}ms
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
  </div>
);

export default PerformanceDefaults;
