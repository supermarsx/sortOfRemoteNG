import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { Cable } from "lucide-react";
import { Checkbox, Select, Slider } from "../../../ui/forms";

const TcpSocketDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Cable className="w-4 h-4 text-emerald-400" />
      TCP / Socket Defaults
    </h4>
    <p className="text-xs text-[var(--color-textMuted)]">
      Low-level socket settings applied during the TCP connection phase.
      Incorrect values may cause connectivity issues.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Connect Timeout: {rdp.tcpConnectTimeoutSecs ?? 10}s
      </label>
      <Slider value={rdp.tcpConnectTimeoutSecs ?? 10} onChange={(v: number) => update({ tcpConnectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1s</span>
        <span>60s</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcpNodelay ?? true} onChange={(v: boolean) => update({ tcpNodelay: v })} />
      <span className="sor-toggle-label">
        TCP_NODELAY (disable Nagle&apos;s algorithm)
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
      Reduces latency for interactive sessions. Recommended ON.
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcpKeepAlive ?? true} onChange={(v: boolean) => update({ tcpKeepAlive: v })} />
      <span className="sor-toggle-label">
        TCP Keep-Alive
      </span>
    </label>

    {(rdp.tcpKeepAlive ?? true) && (
      <div className="ml-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Keep-Alive Interval: {rdp.tcpKeepAliveIntervalSecs ?? 60}s
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
          Receive Buffer (bytes)
        </label>
        <Select value={rdp.tcpRecvBufferSize ?? 262144} onChange={(v: string) => update({ tcpRecvBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Send Buffer (bytes)
        </label>
        <Select value={rdp.tcpSendBufferSize ?? 262144} onChange={(v: string) => update({ tcpSendBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
    </div>
  </div>
);

export default TcpSocketDefaults;
