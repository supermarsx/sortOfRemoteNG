import type { SessionSectionProps } from "./selectClass";
import React from "react";
import { Layers, Image, PanelRight, XSquare, Camera, Timer } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
} from "../../../ui/settings/SettingsPrimitives";

const SessionManagement: React.FC<SessionSectionProps> = ({
  settings,
  updateSettings,
}) => {
  const thumbnailsOn = settings.rdpSessionThumbnailsEnabled ?? true;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Layers className="w-4 h-4 text-primary" />}
        title="Session Management"
      />

      <Card>
        <SettingsSelectRow
          settingKey="rdpSessionDisplayMode"
          icon={<PanelRight size={16} />}
          label="Session panel display mode"
          description="Floating popup or docked side panel."
          value={settings.rdpSessionDisplayMode ?? "popup"}
          options={[
            { value: "popup", label: "Popup (modal overlay)" },
            { value: "panel", label: "Panel (right sidebar)" },
          ]}
          onChange={(v) =>
            updateSettings({
              rdpSessionDisplayMode: v as "panel" | "popup",
            })
          }
          infoTooltip="Controls how the RDP Sessions manager is presented — as a floating modal overlay or a docked sidebar panel."
        />

        <SettingsSelectRow
          settingKey="rdpSessionClosePolicy"
          icon={<XSquare size={16} />}
          label="Tab close policy"
          description="Detach keeps the session alive for reattachment; Disconnect ends it immediately."
          value={settings.rdpSessionClosePolicy ?? "ask"}
          options={[
            { value: "ask", label: "Ask every time" },
            {
              value: "detach",
              label: "Keep session running (detach)",
            },
            { value: "disconnect", label: "Fully disconnect" },
          ]}
          onChange={(v) =>
            updateSettings({
              rdpSessionClosePolicy: v as "disconnect" | "detach" | "ask",
            })
          }
          infoTooltip="Determines what happens when you close an RDP tab — ask, keep running in background, or fully disconnect."
        />

        <Toggle
          checked={thumbnailsOn}
          onChange={(v) => updateSettings({ rdpSessionThumbnailsEnabled: v })}
          icon={<Image size={16} />}
          label="Show session thumbnails"
          description="Display live previews of active RDP sessions in the session manager."
          infoTooltip="Displays live preview thumbnails of active RDP sessions in the session manager."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            thumbnailsOn ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsSelectRow
            settingKey="rdpSessionThumbnailPolicy"
            icon={<Camera size={16} />}
            label="Thumbnail capture policy"
            value={settings.rdpSessionThumbnailPolicy ?? "realtime"}
            options={[
              { value: "realtime", label: "Realtime (periodic refresh)" },
              { value: "on-blur", label: "On blur (when tab loses focus)" },
              {
                value: "on-detach",
                label: "On detach (when viewer is detached)",
              },
              { value: "manual", label: "Manual only" },
            ]}
            onChange={(v) =>
              updateSettings({
                rdpSessionThumbnailPolicy: v as
                  | "realtime"
                  | "on-blur"
                  | "on-detach"
                  | "manual",
              })
            }
            infoTooltip="Controls when session thumbnails are captured — continuously, on tab blur, on detach, or manually."
          />

          <SettingsSliderRow
            settingKey="rdpSessionThumbnailInterval"
            icon={<Timer size={16} />}
            label="Thumbnail refresh interval"
            value={settings.rdpSessionThumbnailInterval ?? 5}
            min={1}
            max={30}
            unit="s"
            onChange={(v) =>
              updateSettings({ rdpSessionThumbnailInterval: v })
            }
            infoTooltip="How often session thumbnails are refreshed when using the realtime capture policy."
          />
        </div>
      </Card>
    </div>
  );
};

export default SessionManagement;
