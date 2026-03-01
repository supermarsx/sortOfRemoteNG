import OverrideToggle from "./OverrideToggle";
import { Checkbox } from "../../ui/forms";

const ForwardingSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Forwarding</h4>

      <OverrideToggle
        label="TCP Forwarding"
        isOverridden={ov("enableTcpForwarding")}
        globalValue={g.enableTcpForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableTcpForwarding", on ? !g.enableTcpForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("enableTcpForwarding")} onChange={(v: boolean) => u("enableTcpForwarding", v)} variant="form" />
          Allow TCP port forwarding
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="X11 Forwarding"
        isOverridden={ov("enableX11Forwarding")}
        globalValue={g.enableX11Forwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableX11Forwarding", on ? !g.enableX11Forwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("enableX11Forwarding")} onChange={(v: boolean) => u("enableX11Forwarding", v)} variant="form" />
          Enable X11 forwarding
        </label>
      </OverrideToggle>
    </div>
  );
};

export default ForwardingSection;
