import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Cable, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
const TcpSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="TCP / Socket"
    icon={<Cable size={14} className="text-success" />}
  >
    <p className="text-xs text-[var(--color-textMuted)] mb-3">
      Low-level socket options for the underlying TCP connection.
    </p>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Connect Timeout{rdp.tcp?.connectTimeoutSecs != null ? `: ${rdp.tcp.connectTimeoutSecs}s` : ""}
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Maximum seconds to wait for the initial TCP connection. Increase for high-latency or unreliable networks." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.tcp?.connectTimeoutSecs != null} onChange={(v: boolean) => updateRdp("tcp", { connectTimeoutSecs: v ? 10 : undefined })} className={CSS.checkbox} />
        <span className="text-xs text-[var(--color-textMuted)]">Override (uncheck to use global default)</span>
      </label>
      {rdp.tcp?.connectTimeoutSecs != null && (
      <>
      <Slider value={rdp.tcp?.connectTimeoutSecs ?? 10} onChange={(v: number) => updateRdp("tcp", { connectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1s</span>
        <span>60s</span>
      </div>
      </>
      )}
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">TCP_NODELAY (disable Nagle's algorithm) <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Disable Nagle's algorithm to send packets immediately without buffering. Reduces input latency at the cost of more small packets." /></label>
      <Select value={rdp.tcp?.nodelay === undefined ? "" : rdp.tcp.nodelay ? "true" : "false"} onChange={(v: string) => updateRdp("tcp", { nodelay: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">TCP Keep-Alive <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Send periodic keep-alive probes to detect dead connections and prevent firewalls from closing idle sessions." /></label>
      <Select value={rdp.tcp?.keepAlive === undefined ? "" : rdp.tcp.keepAlive ? "true" : "false"} onChange={(v: string) => updateRdp("tcp", { keepAlive: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
    </div>

    {rdp.tcp?.keepAlive === true && (
      <div className="ml-6">
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Keep-Alive Interval{rdp.tcp?.keepAliveIntervalSecs != null ? `: ${rdp.tcp.keepAliveIntervalSecs}s` : ""}
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Seconds between keep-alive probes. Lower values detect dead connections faster but add network overhead." />
        </label>
        <label className="flex items-center gap-2 mb-1">
          <Checkbox checked={rdp.tcp?.keepAliveIntervalSecs != null} onChange={(v: boolean) => updateRdp("tcp", { keepAliveIntervalSecs: v ? 60 : undefined })} className={CSS.checkbox} />
          <span className="text-xs text-[var(--color-textMuted)]">Override (uncheck to use global default)</span>
        </label>
        {rdp.tcp?.keepAliveIntervalSecs != null && (
        <Slider value={rdp.tcp?.keepAliveIntervalSecs ?? 60} onChange={(v: number) => updateRdp("tcp", {
              keepAliveIntervalSecs: v,
            })} min={5} max={300} variant="full" step={5} />
        )}
      </div>
    )}

    <div className="grid grid-cols-2 gap-3 mt-2">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Recv Buffer
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="TCP receive buffer size. Larger buffers improve throughput on high-latency links but use more memory." />
        </label>
        <Select value={rdp.tcp?.recvBufferSize?.toString() ?? ""} onChange={(v: string) => updateRdp("tcp", { recvBufferSize: v === "" ? undefined : parseInt(v) })} options={[{ value: "", label: "Use global default" }, { value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="sor-form-input-xs" />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Send Buffer
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="TCP send buffer size. Larger buffers help with bursty output but increase memory usage per connection." />
        </label>
        <Select value={rdp.tcp?.sendBufferSize?.toString() ?? ""} onChange={(v: string) => updateRdp("tcp", { sendBufferSize: v === "" ? undefined : parseInt(v) })} options={[{ value: "", label: "Use global default" }, { value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="sor-form-input-xs" />
      </div>
    </div>
  </Section>
);

export default TcpSection;
