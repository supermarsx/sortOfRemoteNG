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
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import { SettingsSubGroupHeader as SubGroupHeader } from "../../../ui/settings/NetworkPrimitives";
import { normalizeRdpTargetFps } from "../../../../utils/rdp/rdpSettingsMerge";

import { RDP_VISUAL_PRESETS as SPEED_PRESETS } from "../../../../utils/rdp/rdpPerformancePresets";

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
          description="Selecting a preset adjusts the visual experience. Your frame rate limit is preserved."
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
          infoTooltip="Selects visual settings for your network speed. Frame rate limits are configured separately."
        />

        <SubGroupHeader icon={<Eye size={11} />} label="Visual experience" />

        {/* Written out one by one rather than mapped over a table: `settingKey`
            has to be a literal for `settingsSearchDrift` to join these controls
            to the search index. */}
        <Toggle
          settingKey="disableWallpaper"
          checked={rdp.disableWallpaper ?? true}
          onChange={(v) => update({ disableWallpaper: v })}
          icon={<Image size={16} />}
          label="Disable wallpaper"
          infoTooltip="Prevents the desktop wallpaper from being rendered, reducing bandwidth usage."
        />
        <Toggle
          settingKey="disableFullWindowDrag"
          checked={rdp.disableFullWindowDrag ?? true}
          onChange={(v) => update({ disableFullWindowDrag: v })}
          icon={<MoveHorizontal size={16} />}
          label="Disable full-window drag"
          infoTooltip="Shows only a window outline while dragging instead of rendering full window contents."
        />
        <Toggle
          settingKey="disableMenuAnimations"
          checked={rdp.disableMenuAnimations ?? true}
          onChange={(v) => update({ disableMenuAnimations: v })}
          icon={<Sparkles size={16} />}
          label="Disable menu animations"
          infoTooltip="Turns off menu fade and slide animations to improve responsiveness."
        />
        <Toggle
          settingKey="disableTheming"
          checked={rdp.disableTheming ?? false}
          onChange={(v) => update({ disableTheming: v })}
          icon={<Palette size={16} />}
          label="Disable visual themes"
          infoTooltip="Disables Windows visual themes on the remote desktop to save bandwidth."
        />
        <Toggle
          settingKey="disableCursorShadow"
          checked={rdp.disableCursorShadow ?? true}
          onChange={(v) => update({ disableCursorShadow: v })}
          icon={<MousePointer size={16} />}
          label="Disable cursor shadow"
          infoTooltip="Removes the shadow effect beneath the mouse cursor in the remote session."
        />
        <Toggle
          settingKey="disableCursorSettings"
          checked={rdp.disableCursorSettings ?? false}
          onChange={(v) => update({ disableCursorSettings: v })}
          icon={<Settings size={16} />}
          label="Disable cursor settings"
          infoTooltip="Disables custom cursor rendering settings on the remote machine."
        />
        <Toggle
          settingKey="enableFontSmoothing"
          checked={rdp.enableFontSmoothing ?? true}
          onChange={(v) => update({ enableFontSmoothing: v })}
          icon={<Type size={16} />}
          label="Enable font smoothing (ClearType)"
          infoTooltip="Enables ClearType font smoothing for clearer text on the remote desktop."
        />
        <Toggle
          settingKey="enableDesktopComposition"
          checked={rdp.enableDesktopComposition ?? false}
          onChange={(v) => update({ enableDesktopComposition: v })}
          icon={<Layers size={16} />}
          label="Enable desktop composition (Aero)"
          infoTooltip="Enables Aero glass and transparency effects on the remote desktop. Uses more bandwidth."
        />

        <Toggle
          settingKey="persistentBitmapCaching"
          checked={rdp.persistentBitmapCaching ?? false}
          onChange={(v) => update({ persistentBitmapCaching: v })}
          icon={<Database size={16} />}
          label="Persistent bitmap caching"
          description="Cache frequently used bitmaps to disk for faster reconnection."
          infoTooltip="Caches frequently used bitmaps to disk, reducing bandwidth on reconnection to the same server."
        />

        <SubGroupHeader icon={<Timer size={11} />} label="Frame delivery" />

        <Toggle
          settingKey="frameRateLimitEnabled"
          checked={rdp.frameRateLimitEnabled === true}
          onChange={(v) =>
            update({
              frameRateLimitEnabled: v,
              ...(v
                ? { targetFps: normalizeRdpTargetFps(rdp.targetFps) || 60 }
                : {}),
            })
          }
          icon={<Gauge size={16} />}
          label="Limit frame rate"
          description="Off: uncapped delivery adapts to activity and capacity. Idle sessions do not redraw."
          infoTooltip="Enable an optional maximum FPS. Existing saved FPS preferences only apply after enabling this limit."
        />

        <fieldset
          disabled={rdp.frameRateLimitEnabled !== true}
          className={
            rdp.frameRateLimitEnabled === true ? undefined : "opacity-50"
          }
        >
          <SettingsNumberRow
            settingKey="targetFps"
            icon={<Gauge size={16} />}
            label="Maximum FPS"
            description="Optional presentation limit, including high refresh rates such as 144 or 240 FPS. 0 leaves delivery uncapped."
            value={
              rdp.frameRateLimitEnabled === true
                ? normalizeRdpTargetFps(rdp.targetFps)
                : 0
            }
            min={0}
            max={4294967295}
            unit=" fps"
            onChange={(v) => update({ targetFps: normalizeRdpTargetFps(v) })}
            infoTooltip="Caps frame presentation. The default is uncapped; network presets do not change this limit."
          />
        </fieldset>

        <Toggle
          settingKey="frameBatching"
          checked={frameBatchOn}
          onChange={(v) => update({ frameBatching: v })}
          icon={<Boxes size={16} />}
          label="Frame batching"
          description="Combines pending changed regions without a timed wait. Legacy batch intervals are ignored."
          infoTooltip="Coalesces pending screen changes to reduce delivery overhead without setting a frame rate limit."
        />

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
