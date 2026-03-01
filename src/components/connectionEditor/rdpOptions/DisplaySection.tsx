import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Monitor } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, NumberInput, Select, Slider } from "../../ui/forms";
const DisplaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Display"
    icon={<Monitor size={14} className="text-blue-400" />}
    defaultOpen
  >
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Width
        </label>
        <NumberInput value={rdp.display?.width ?? 1920} onChange={(v: number) => updateRdp("display", { width: v })} className="CSS.input" min={640} max={7680} />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Height
        </label>
        <NumberInput value={rdp.display?.height ?? 1080} onChange={(v: number) => updateRdp("display", { height: v })} className="CSS.input" min={480} max={4320} />
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Color Depth
      </label>
      <Select value={rdp.display?.colorDepth ?? 32} onChange={(v: string) => updateRdp("display", {
            colorDepth: parseInt(v) as 16 | 24 | 32,
          })} options={[{ value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Desktop Scale Factor: {rdp.display?.desktopScaleFactor ?? 100}%
      </label>
      <Slider value={rdp.display?.desktopScaleFactor ?? 100} onChange={(v: number) => updateRdp("display", { desktopScaleFactor: v })} min={100} max={500} variant="full" step={25} />
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.resizeToWindow ?? false} onChange={(v: boolean) => updateRdp("display", { resizeToWindow: v })} className="CSS.checkbox" />
      <span>Resize to window (dynamic resolution)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.smartSizing ?? true} onChange={(v: boolean) => updateRdp("display", { smartSizing: v })} className="CSS.checkbox" />
      <span>Smart sizing (scale to fit)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.lossyCompression ?? true} onChange={(v: boolean) => updateRdp("display", { lossyCompression: v })} className="CSS.checkbox" />
      <span>Lossy bitmap compression</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.magnifierEnabled ?? false} onChange={(v: boolean) => updateRdp("display", { magnifierEnabled: v })} className="CSS.checkbox" />
      <span>Enable magnifier glass</span>
    </label>

    {rdp.display?.magnifierEnabled && (
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Magnifier Zoom: {rdp.display?.magnifierZoom ?? 3}x
        </label>
        <Slider value={rdp.display?.magnifierZoom ?? 3} onChange={(v: number) => updateRdp("display", { magnifierZoom: v })} min={2} max={8} variant="full" />
      </div>
    )}
  </Section>
);

export default DisplaySection;
