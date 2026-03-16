import type { SessionSectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { Layers } from "lucide-react";
import { Checkbox, Select, Slider } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const SessionManagement: React.FC<SessionSectionProps> = ({
  settings,
  updateSettings,
}) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Layers className="w-4 h-4 text-primary" />
      Session Management
    </h4>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Session Panel Display Mode <InfoTooltip text="Controls how the RDP Sessions manager is presented -- as a floating modal overlay or a docked sidebar panel." />
      </label>
      <Select value={settings.rdpSessionDisplayMode ?? "popup"} onChange={(v: string) => updateSettings({
            rdpSessionDisplayMode: v as "panel" | "popup",
          })} options={[{ value: "popup", label: "Popup (modal overlay)" }, { value: "panel", label: "Panel (right sidebar)" }]} className="selectClass" />
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        How the RDP Sessions manager appears — as a floating popup or a docked
        side panel.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Tab Close Policy <InfoTooltip text="Determines what happens when you close an RDP tab -- ask, keep running in background, or fully disconnect." />
      </label>
      <Select value={settings.rdpSessionClosePolicy ?? "ask"} onChange={(v: string) => updateSettings({
            rdpSessionClosePolicy: v as
              | "disconnect"
              | "detach"
              | "ask",
          })} options={[{ value: "ask", label: "Ask every time" }, { value: "detach", label: "Keep session running in background (detach)" }, { value: "disconnect", label: "Fully disconnect the session" }]} className="selectClass" />
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        What happens when you close an RDP tab. &ldquo;Detach&rdquo; keeps the
        remote session alive so you can reattach later.
        &ldquo;Disconnect&rdquo; ends the session immediately.
      </p>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={settings.rdpSessionThumbnailsEnabled ?? true} onChange={(v: boolean) => updateSettings({ rdpSessionThumbnailsEnabled: v })} />
      <span className="sor-toggle-label">
        Show session thumbnails <InfoTooltip text="Displays live preview thumbnails of active RDP sessions in the session manager." />
      </span>
    </label>

    {(settings.rdpSessionThumbnailsEnabled ?? true) && (
      <div className="ml-7 space-y-3">
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Thumbnail Capture Policy <InfoTooltip text="Controls when session thumbnails are captured -- continuously, on tab blur, on detach, or manually." />
          </label>
          <Select value={settings.rdpSessionThumbnailPolicy ?? "realtime"} onChange={(v: string) => updateSettings({
                rdpSessionThumbnailPolicy: v as
                  | "realtime"
                  | "on-blur"
                  | "on-detach"
                  | "manual",
              })} options={[{ value: "realtime", label: "Realtime (periodic refresh)" }, { value: "on-blur", label: "On blur (when tab loses focus)" }, { value: "on-detach", label: "On detach (when viewer is detached)" }, { value: "manual", label: "Manual only" }]} className="selectClass" />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Thumbnail Refresh Interval: <InfoTooltip text="How often session thumbnails are refreshed when using the realtime capture policy." />{" "}
            {settings.rdpSessionThumbnailInterval ?? 5}s
          </label>
          <Slider value={settings.rdpSessionThumbnailInterval ?? 5} onChange={(v: number) => updateSettings({
                rdpSessionThumbnailInterval: v,
              })} min={1} max={30} variant="full" />
          <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
            <span>1s</span>
            <span>30s</span>
          </div>
        </div>
      </div>
    )}
  </div>
);

export default SessionManagement;
