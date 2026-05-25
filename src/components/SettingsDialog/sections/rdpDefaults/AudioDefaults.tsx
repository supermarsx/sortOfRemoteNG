import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Volume2 } from "lucide-react";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

const AudioDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Volume2 className="w-4 h-4 text-primary" />}
      title="Audio Defaults"
    />

    <Card>
    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Audio Playback <InfoTooltip text="Controls where remote session audio is played back -- locally, on the remote machine, or not at all." />
      </label>
      <Select value={rdp.audioPlaybackMode ?? "local"} onChange={(v: string) => update({
            audioPlaybackMode: v as "local" | "remote" | "disabled",
          })} options={[
            { value: "local", label: "Play on this computer" },
            { value: "remote", label: "Play on remote computer" },
            { value: "disabled", label: "Do not play" },
          ]} className={selectClass} />
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Audio Recording <InfoTooltip text="When enabled, audio input from your local microphone is redirected to the remote session." />
      </label>
      <Select value={rdp.audioRecordingMode ?? "disabled"} onChange={(v: string) => update({
            audioRecordingMode: v as "enabled" | "disabled",
          })} options={[
            { value: "disabled", label: "Disabled" },
            { value: "enabled", label: "Record from this computer" },
          ]} className={selectClass} />
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Audio Quality <InfoTooltip text="Sets the audio codec quality level. Dynamic mode auto-adjusts based on available bandwidth." />
      </label>
      <Select value={rdp.audioQuality ?? "dynamic"} onChange={(v: string) => update({
            audioQuality: v as "dynamic" | "medium" | "high",
          })} options={[
            { value: "dynamic", label: "Dynamic (auto-adjust)" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]} className={selectClass} />
    </div>
    </Card>
  </div>
);

export default AudioDefaults;
