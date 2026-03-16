import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Monitor, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, NumberInput, Select, Slider } from "../../ui/forms";
const DisplaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Display"
    icon={<Monitor size={14} className="text-primary" />}
    defaultOpen
  >
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Width
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Remote desktop horizontal resolution in pixels. Standard values: 1920, 2560, 3840." />
        </label>
        <NumberInput value={rdp.display?.width ?? 1920} onChange={(v: number) => updateRdp("display", { width: v })} className="CSS.input" min={640} max={7680} />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Height
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Remote desktop vertical resolution in pixels. Standard values: 1080, 1440, 2160." />
        </label>
        <NumberInput value={rdp.display?.height ?? 1080} onChange={(v: number) => updateRdp("display", { height: v })} className="CSS.input" min={480} max={4320} />
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Color Depth
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Bits per pixel for the remote session. Higher values show more colors but use more bandwidth." />
      </label>
      <Select value={rdp.display?.colorDepth?.toString() ?? ""} onChange={(v: string) => updateRdp("display", {
            colorDepth: v === "" ? undefined : (parseInt(v) as 16 | 24 | 32),
          })} options={[{ value: "", label: "Use global default" }, { value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Desktop Scale Factor: {rdp.display?.desktopScaleFactor ?? 100}%
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Desktop DPI scaling percentage. Increase on HiDPI displays to prevent tiny text on the remote desktop." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.display?.desktopScaleFactor != null} onChange={(v: boolean) => updateRdp("display", { desktopScaleFactor: v ? 100 : undefined })} className="CSS.checkbox" />
        <span className="text-xs text-[var(--color-textMuted)]">Override</span>
      </label>
      {rdp.display?.desktopScaleFactor != null && (
      <Slider value={rdp.display?.desktopScaleFactor ?? 100} onChange={(v: number) => updateRdp("display", { desktopScaleFactor: v })} min={100} max={500} variant="full" step={25} />
      )}
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">Resize to window (dynamic resolution) <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Dynamically adjust the remote resolution when the local window is resized. Requires server support." /></label>
      <Select value={rdp.display?.resizeToWindow === undefined ? "" : rdp.display.resizeToWindow ? "true" : "false"} onChange={(v: string) => updateRdp("display", { resizeToWindow: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">Smart sizing (scale to fit) <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Scale the remote desktop image to fit the local canvas. Useful when the remote resolution differs from the window size." /></label>
      <Select value={rdp.display?.smartSizing === undefined ? "" : rdp.display.smartSizing ? "true" : "false"} onChange={(v: string) => updateRdp("display", { smartSizing: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">Lossy bitmap compression <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Allow lossy bitmap compression to reduce bandwidth. May introduce minor visual artifacts on slow connections." /></label>
      <Select value={rdp.display?.lossyCompression === undefined ? "" : rdp.display.lossyCompression ? "true" : "false"} onChange={(v: string) => updateRdp("display", { lossyCompression: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
    </div>

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
