import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Settings2 } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Slider } from "../../ui/forms";
const AdvancedSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Advanced"
    icon={
      <Settings2 size={14} className="text-[var(--color-textSecondary)]" />
    }
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Client Name
      </label>
      <input
        type="text"
        value={rdp.advanced?.clientName ?? "SortOfRemoteNG"}
        onChange={(e) =>
          updateRdp("advanced", { clientName: e.target.value.slice(0, 15) })
        }
        className={CSS.input}
        maxLength={15}
        placeholder="SortOfRemoteNG"
      />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Read Timeout: {rdp.advanced?.readTimeoutMs ?? 16}ms
      </label>
      <Slider value={rdp.advanced?.readTimeoutMs ?? 16} onChange={(v: number) => updateRdp("advanced", { readTimeoutMs: v })} min={1} max={100} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1ms (fast)</span>
        <span>100ms (low CPU)</span>
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Full-frame Sync Interval: every{" "}
        {rdp.advanced?.fullFrameSyncInterval ?? 300} frames
      </label>
      <Slider value={rdp.advanced?.fullFrameSyncInterval ?? 300} onChange={(v: number) => updateRdp("advanced", {
            fullFrameSyncInterval: v,
          })} min={60} max={600} variant="full" step={30} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Max Consecutive Errors: {rdp.advanced?.maxConsecutiveErrors ?? 50}
      </label>
      <Slider value={rdp.advanced?.maxConsecutiveErrors ?? 50} onChange={(v: number) => updateRdp("advanced", {
            maxConsecutiveErrors: v,
          })} min={10} max={200} variant="full" step={10} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Stats Interval: {rdp.advanced?.statsIntervalSecs ?? 1}s
      </label>
      <Slider value={rdp.advanced?.statsIntervalSecs ?? 1} onChange={(v: number) => updateRdp("advanced", {
            statsIntervalSecs: v,
          })} min={1} max={10} variant="full" />
    </div>
  </Section>
);

export default AdvancedSection;
