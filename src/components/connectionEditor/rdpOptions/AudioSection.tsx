import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Volume2 } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Select } from "../../ui/forms";
const AudioSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Audio"
    icon={<Volume2 size={14} className="text-green-400" />}
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Playback
      </label>
      <Select value={rdp.audio?.playbackMode ?? "local"} onChange={(v: string) => updateRdp("audio", {
            playbackMode: v as "local" | "remote" | "disabled",
          })} options={[{ value: "local", label: "Play on this computer" }, { value: "remote", label: "Play on remote computer" }, { value: "disabled", label: "Do not play" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Recording
      </label>
      <Select value={rdp.audio?.recordingMode ?? "disabled"} onChange={(v: string) => updateRdp("audio", {
            recordingMode: v as "enabled" | "disabled",
          })} options={[{ value: "disabled", label: "Disabled" }, { value: "enabled", label: "Record from this computer" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Quality
      </label>
      <Select value={rdp.audio?.audioQuality ?? "dynamic"} onChange={(v: string) => updateRdp("audio", {
            audioQuality: v as "dynamic" | "medium" | "high",
          })} options={[{ value: "dynamic", label: "Dynamic (auto-adjust)" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} className="CSS.select" />
    </div>
  </Section>
);

export default AudioSection;
