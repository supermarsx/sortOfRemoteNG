import type { SectionProps } from "./selectClass";
import React from "react";
import { Volume2, Mic, Music } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const AudioDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Volume2 className="w-4 h-4 text-primary" />}
      title="Audio Defaults"
    />

    <Card>
      <SettingsSelectRow
        settingKey="audioPlaybackMode"
        icon={<Volume2 size={16} />}
        label="Audio playback"
        value={rdp.audioPlaybackMode ?? "local"}
        options={[
          { value: "local", label: "Play on this computer" },
          { value: "remote", label: "Play on remote computer" },
          { value: "disabled", label: "Do not play" },
        ]}
        onChange={(v) =>
          update({
            audioPlaybackMode: v as "local" | "remote" | "disabled",
          })
        }
        infoTooltip="Controls where remote session audio is played back — locally, on the remote machine, or not at all."
      />

      <SettingsSelectRow
        settingKey="audioRecordingMode"
        icon={<Mic size={16} />}
        label="Audio recording"
        value={rdp.audioRecordingMode ?? "disabled"}
        options={[
          { value: "disabled", label: "Disabled" },
          { value: "enabled", label: "Record from this computer" },
        ]}
        onChange={(v) =>
          update({ audioRecordingMode: v as "enabled" | "disabled" })
        }
        infoTooltip="When enabled, audio input from your local microphone is redirected to the remote session."
      />

      <SettingsSelectRow
        settingKey="audioQuality"
        icon={<Music size={16} />}
        label="Audio quality"
        value={rdp.audioQuality ?? "dynamic"}
        options={[
          { value: "dynamic", label: "Dynamic (auto-adjust)" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ]}
        onChange={(v) =>
          update({ audioQuality: v as "dynamic" | "medium" | "high" })
        }
        infoTooltip="Sets the audio codec quality level. Dynamic mode auto-adjusts based on available bandwidth."
      />
    </Card>
  </div>
);

export default AudioDefaults;
