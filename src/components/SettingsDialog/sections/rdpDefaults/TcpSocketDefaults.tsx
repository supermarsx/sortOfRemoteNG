import type { SectionProps } from "./selectClass";
import React from "react";
import { Cable, Zap, Activity } from "lucide-react";
import { Select, Slider } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const TcpSocketDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Cable className="w-4 h-4 text-primary" />}
      title="TCP / Socket Defaults"
    />

    <Card>
    <p className="text-xs text-[var(--color-textMuted)]">
      Low-level socket settings applied during the TCP connection phase.
      Incorrect values may cause connectivity issues.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Connect Timeout: {rdp.tcpConnectTimeoutSecs ?? 10}s <InfoTooltip text="Maximum time in seconds to wait for a TCP connection to be established before timing out." />
      </label>
      <Slider value={rdp.tcpConnectTimeoutSecs ?? 10} onChange={(v: number) => update({ tcpConnectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1s</span>
        <span>60s</span>
      </div>
    </div>

    <Toggle
      checked={rdp.tcpNodelay ?? true}
      onChange={(v) => update({ tcpNodelay: v })}
      icon={<Zap size={16} />}
      label="TCP_NODELAY (disable Nagle's algorithm)"
      description="Send packets immediately to reduce latency for interactive sessions (recommended ON)"
      infoTooltip="Disables Nagle's algorithm to send packets immediately, reducing latency for interactive sessions."
    />

    <Toggle
      checked={rdp.tcpKeepAlive ?? true}
      onChange={(v) => update({ tcpKeepAlive: v })}
      icon={<Activity size={16} />}
      label="TCP Keep-Alive"
      description="Send periodic probes to detect stale connections before they're dropped"
      infoTooltip="Sends periodic keep-alive probes to detect and prevent stale connections from being dropped."
    />

    {(rdp.tcpKeepAlive ?? true) && (
      <div className="pl-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Keep-Alive Interval: {rdp.tcpKeepAliveIntervalSecs ?? 60}s <InfoTooltip text="Time in seconds between TCP keep-alive probes sent to maintain the connection." />
        </label>
        <Slider value={rdp.tcpKeepAliveIntervalSecs ?? 60} onChange={(v: number) => update({ tcpKeepAliveIntervalSecs: v })} min={5} max={300} variant="full" step={5} />
        <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
          <span>5s</span>
          <span>300s</span>
        </div>
      </div>
    )}

    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Receive Buffer (bytes) <InfoTooltip text="Size of the TCP receive buffer. Larger buffers improve throughput on high-latency networks." />
        </label>
        <Select value={rdp.tcpRecvBufferSize ?? 262144} onChange={(v: string) => update({ tcpRecvBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Send Buffer (bytes) <InfoTooltip text="Size of the TCP send buffer. Larger buffers can improve throughput for outbound data." />
        </label>
        <Select value={rdp.tcpSendBufferSize ?? 262144} onChange={(v: string) => update({ tcpSendBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
    </div>
    </Card>
  </div>
);

export default TcpSocketDefaults;
