import type { SectionProps } from "./types";
import OverrideToggle from "./OverrideToggle";
import { IPProtocol } from "../../../types/settings/settings";
import { Checkbox, Select } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const TcpIpSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">TCP/IP <InfoTooltip text="Override TCP/IP network-level settings for this SSH connection." /></h4>

      <OverrideToggle
        label={<>TCP No Delay <InfoTooltip text="Disable Nagle's algorithm to send data immediately without waiting to coalesce small packets. Reduces latency for interactive sessions." /></>}
        isOverridden={ov("tcpNoDelay")}
        globalValue={g.tcpNoDelay ? "Enabled" : "Disabled"}
        onToggle={(on) => u("tcpNoDelay", on ? !g.tcpNoDelay : undefined)}
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("tcpNoDelay")} onChange={(v: boolean) => u("tcpNoDelay", v)} variant="form" />
          Disable Nagle algorithm
        </label>
      </OverrideToggle>

      <OverrideToggle
        label={<>TCP Keep Alive <InfoTooltip text="Send TCP-level keep-alive probes to detect broken connections even when the SSH layer is idle." /></>}
        isOverridden={ov("tcpKeepAlive")}
        globalValue={g.tcpKeepAlive ? "Enabled" : "Disabled"}
        onToggle={(on) => u("tcpKeepAlive", on ? !g.tcpKeepAlive : undefined)}
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("tcpKeepAlive")} onChange={(v: boolean) => u("tcpKeepAlive", v)} variant="form" />
          Enable TCP keep-alive
        </label>
      </OverrideToggle>

      <OverrideToggle
        label={<>IP Protocol <InfoTooltip text="Force the connection to use IPv4, IPv6, or auto-detect based on DNS resolution." /></>}
        isOverridden={ov("ipProtocol")}
        globalValue={g.ipProtocol}
        onToggle={(on) => u("ipProtocol", on ? g.ipProtocol : undefined)}
      >
        <Select value={v("ipProtocol")} onChange={(v: string) => u("ipProtocol", v as IPProtocol)} options={[{ value: "auto", label: "Auto" }, { value: "ipv4", label: "IPv4 only" }, { value: "ipv6", label: "IPv6 only" }]} variant="form-sm" className="" />
      </OverrideToggle>
    </div>
  );
};

export default TcpIpSection;
