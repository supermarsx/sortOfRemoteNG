import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Cable } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
const TcpSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="TCP / Socket"
    icon={<Cable size={14} className="text-emerald-400" />}
  >
    <p className="text-xs text-[var(--color-textMuted)] mb-3">
      Low-level socket options for the underlying TCP connection.
    </p>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Connect Timeout: {rdp.tcp?.connectTimeoutSecs ?? 10}s
      </label>
      <Slider value={rdp.tcp?.connectTimeoutSecs ?? 10} onChange={(v: number) => updateRdp("tcp", { connectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1s</span>
        <span>60s</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcp?.nodelay ?? true} onChange={(v: boolean) => updateRdp("tcp", { nodelay: v })} className="CSS.checkbox" />
      <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP_NODELAY (disable Nagle&apos;s algorithm)
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcp?.keepAlive ?? true} onChange={(v: boolean) => updateRdp("tcp", { keepAlive: v })} className="CSS.checkbox" />
      <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP Keep-Alive
      </span>
    </label>

    {(rdp.tcp?.keepAlive ?? true) && (
      <div className="ml-6">
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Keep-Alive Interval: {rdp.tcp?.keepAliveIntervalSecs ?? 60}s
        </label>
        <Slider value={rdp.tcp?.keepAliveIntervalSecs ?? 60} onChange={(v: number) => updateRdp("tcp", {
              keepAliveIntervalSecs: v,
            })} min={5} max={300} variant="full" step={5} />
      </div>
    )}

    <div className="grid grid-cols-2 gap-3 mt-2">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Recv Buffer
        </label>
        <Select value={rdp.tcp?.recvBufferSize ?? 262144} onChange={(v: string) => updateRdp("tcp", { recvBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="sor-form-input-xs" />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Send Buffer
        </label>
        <Select value={rdp.tcp?.sendBufferSize ?? 262144} onChange={(v: string) => updateRdp("tcp", { sendBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="sor-form-input-xs" />
      </div>
    </div>
  </Section>
);

export default TcpSection;
