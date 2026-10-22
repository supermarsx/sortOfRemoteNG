import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { RDPConnectionSettings } from "../../types/connection/connection";

interface RDPSettingsPanelProps {
  rdpSettings: RDPConnectionSettings;
  desktopSize: { width: number; height: number };
  colorDepth: number;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  perfLabel: string;
  certFingerprint: string | null;
}

export function RDPSettingsPanel({
  rdpSettings,
  desktopSize,
  colorDepth,
  audioEnabled,
  clipboardEnabled,
  perfLabel,
  certFingerprint,
}: RDPSettingsPanelProps) {
  return (
    <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Current resolution
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            {desktopSize.width}x{desktopSize.height}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Configured resolution
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            {rdpSettings.display?.width ?? "Auto"}x
            {rdpSettings.display?.height ?? "Auto"}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Color Depth
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            {colorDepth}-bit
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Audio
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono flex items-center gap-1">
            {audioEnabled ? (
              <Volume2 size={12} className="text-success" />
            ) : (
              <VolumeX size={12} className="text-[var(--color-textMuted)]" />
            )}
            {rdpSettings.audio?.playbackMode ?? "local"}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Clipboard
          </div>
          <div
            className={`text-xs font-mono ${clipboardEnabled ? "text-success" : "text-[var(--color-textMuted)]"}`}
          >
            {clipboardEnabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Speed Preset
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono capitalize">
            {perfLabel}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Frame Batching
          </div>
          <div
            className={`text-xs font-mono ${rdpSettings.performance?.frameBatching ? "text-success" : "text-warning"}`}
          >
            {rdpSettings.performance?.frameBatching ? "On (coalescing)" : "Off"}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Security
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            {rdpSettings.security?.enableNla ? "NLA" : ""}
            {rdpSettings.security?.enableTls ? "+TLS" : ""}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Keyboard
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            0x
            {(rdpSettings.input?.keyboardLayout ?? 0x0409)
              .toString(16)
              .padStart(4, "0")}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Mouse Mode
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono capitalize">
            {rdpSettings.input?.mouseMode ?? "absolute"}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] text-xs mb-1">
            Perf Flags
          </div>
          <div className="text-[var(--color-text)] text-xs font-mono">
            {[
              rdpSettings.performance?.disableWallpaper && "noWP",
              rdpSettings.performance?.disableFullWindowDrag && "noDrag",
              rdpSettings.performance?.disableMenuAnimations && "noAnim",
              rdpSettings.performance?.disableTheming && "noTheme",
              rdpSettings.performance?.enableFontSmoothing && "CT",
              rdpSettings.performance?.enableDesktopComposition && "Aero",
            ]
              .filter(Boolean)
              .join(" ")}
          </div>
        </div>
        {certFingerprint && (
          <div className="col-span-full min-w-0 rounded bg-[var(--color-background)] p-2">
            <div className="text-[var(--color-textMuted)] text-xs mb-1">
              Server Certificate
            </div>
            <div
              className="break-all text-info text-xs font-mono select-text"
              title={certFingerprint}
            >
              SHA256:{certFingerprint}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
