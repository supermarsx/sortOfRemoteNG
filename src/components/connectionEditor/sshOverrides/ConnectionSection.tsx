import type { SectionProps } from "./types";
import OverrideToggle from "./OverrideToggle";
import { Connection } from "../../../types/connection/connection";
import { Checkbox, NumberInput } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const ConnectionSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Connection <InfoTooltip text="Override the global SSH connection settings for this specific connection." /></h4>

      <OverrideToggle
        label={<>Connect Timeout <InfoTooltip text="Maximum time in seconds to wait for the SSH connection handshake to complete." /></>}
        isOverridden={ov("connectTimeout")}
        globalValue={`${g.connectTimeout}s`}
        onToggle={(on) => u("connectTimeout", on ? g.connectTimeout : undefined)}
      >
        <div className="flex items-center gap-2">
          <NumberInput value={v("connectTimeout")} onChange={(v: number) => u("connectTimeout", v)} variant="form-sm" className="" min={5} max={300} />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
        </div>
      </OverrideToggle>

      <OverrideToggle
        label={<>Keep Alive Interval <InfoTooltip text="How often (in seconds) to send keep-alive packets. Set to 0 to disable." /></>}
        isOverridden={ov("keepAliveInterval")}
        globalValue={g.keepAliveInterval === 0 ? "Disabled" : `${g.keepAliveInterval}s`}
        onToggle={(on) => u("keepAliveInterval", on ? g.keepAliveInterval : undefined)}
      >
        <div className="flex items-center gap-2">
          <NumberInput value={v("keepAliveInterval")} onChange={(v: number) => u("keepAliveInterval", v)} variant="form-sm" className="" min={0} max={600} />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds (0 = disabled)</span>
        </div>
      </OverrideToggle>

      <OverrideToggle
        label={<>Host Key Checking <InfoTooltip text="When strict, connections are rejected if the remote host key is unknown or has changed." /></>}
        isOverridden={ov("strictHostKeyChecking")}
        globalValue={g.strictHostKeyChecking ? "Strict" : "Disabled"}
        onToggle={(on) =>
          u("strictHostKeyChecking", on ? !g.strictHostKeyChecking : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("strictHostKeyChecking")} onChange={(v: boolean) => u("strictHostKeyChecking", v)} variant="form" />
          Strict host key verification
        </label>
      </OverrideToggle>
    </div>
  );
};

export default ConnectionSection;
