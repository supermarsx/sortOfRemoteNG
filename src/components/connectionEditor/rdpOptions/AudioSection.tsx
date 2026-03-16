import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Volume2, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Select } from "../../ui/forms";
const AudioSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Audio"
    icon={<Volume2 size={14} className="text-success" />}
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Audio Playback
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Where to play remote audio: locally, on the remote machine, or disabled entirely." />
      </label>
      <Select value={rdp.audio?.playbackMode ?? ""} onChange={(v: string) => updateRdp("audio", {
            playbackMode: v === "" ? undefined : (v as "local" | "remote" | "disabled"),
          })} options={[{ value: "", label: "Use global default" }, { value: "local", label: "Play on this computer" }, { value: "remote", label: "Play on remote computer" }, { value: "disabled", label: "Do not play" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Audio Recording
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Microphone redirection to the remote session. Enable to use your local mic in remote apps." />
      </label>
      <Select value={rdp.audio?.recordingMode ?? ""} onChange={(v: string) => updateRdp("audio", {
            recordingMode: v === "" ? undefined : (v as "enabled" | "disabled"),
          })} options={[{ value: "", label: "Use global default" }, { value: "disabled", label: "Disabled" }, { value: "enabled", label: "Record from this computer" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Audio Quality
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Codec quality hint sent to the server. Higher quality uses more bandwidth." />
      </label>
      <Select value={rdp.audio?.audioQuality ?? ""} onChange={(v: string) => updateRdp("audio", {
            audioQuality: v === "" ? undefined : (v as "dynamic" | "medium" | "high"),
          })} options={[{ value: "", label: "Use global default" }, { value: "dynamic", label: "Dynamic (auto-adjust)" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} className="CSS.select" />
    </div>
  </Section>
);

export default AudioSection;
