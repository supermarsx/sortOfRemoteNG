import OverrideToggle from "./OverrideToggle";
import { Checkbox, NumberInput } from "../../ui/forms";

const BannerSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Banner & Misc</h4>

      <OverrideToggle
        label="Show Banner"
        isOverridden={ov("showBanner")}
        globalValue={g.showBanner ? "Yes" : "No"}
        onToggle={(on) => u("showBanner", on ? !g.showBanner : undefined)}
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("showBanner")} onChange={(v: boolean) => u("showBanner", v)} variant="form" />
          Display server banner
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="Banner Timeout"
        isOverridden={ov("bannerTimeout")}
        globalValue={`${g.bannerTimeout}s`}
        onToggle={(on) => u("bannerTimeout", on ? g.bannerTimeout : undefined)}
      >
        <div className="flex items-center gap-2">
          <NumberInput value={v("bannerTimeout")} onChange={(v: number) => u("bannerTimeout", v)} variant="form-sm" className="" min={1} max={60} />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
        </div>
      </OverrideToggle>
    </div>
  );
};

export default BannerSection;
