import type { SectionProps } from "./selectClass";
import React from "react";
import { Cable, Zap, Download, Upload } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import {
  SettingsConnectionTimeoutRow,
  SettingsTcpKeepAliveBlock,
} from "../../../ui/settings/NetworkPrimitives";

const BUFFER_OPTIONS = [
  { value: "65536", label: "64 KB" },
  { value: "131072", label: "128 KB" },
  { value: "262144", label: "256 KB (default)" },
  { value: "524288", label: "512 KB" },
  { value: "1048576", label: "1 MB" },
  { value: "2097152", label: "2 MB" },
];

const TcpSocketDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const keepAliveOn = rdp.tcpKeepAlive ?? true;
  return (
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

        <SettingsConnectionTimeoutRow
          settingKey="tcpConnectTimeoutSecs"
          label="Connect timeout"
          value={rdp.tcpConnectTimeoutSecs ?? 10}
          min={1}
          max={60}
          variant="slider"
          onChange={(v) => update({ tcpConnectTimeoutSecs: v })}
          infoTooltip="Maximum time in seconds to wait for a TCP connection to be established before timing out."
        />

        <Toggle
          checked={rdp.tcpNodelay ?? true}
          onChange={(v) => update({ tcpNodelay: v })}
          icon={<Zap size={16} />}
          label="TCP_NODELAY (disable Nagle's algorithm)"
          description="Send packets immediately to reduce latency for interactive sessions (recommended ON)."
          infoTooltip="Disables Nagle's algorithm to send packets immediately, reducing latency for interactive sessions."
        />

        <SettingsTcpKeepAliveBlock
          enabled={keepAliveOn}
          onEnabledChange={(v) => update({ tcpKeepAlive: v })}
          label="TCP keep-alive"
          description="Send periodic probes to detect stale connections before they're dropped."
          infoTooltip="Sends periodic keep-alive probes to detect and prevent stale connections from being dropped."
          intervalSecs={{
            settingKey: "tcpKeepAliveIntervalSecs",
            value: rdp.tcpKeepAliveIntervalSecs ?? 60,
            onChange: (v) => update({ tcpKeepAliveIntervalSecs: v }),
            min: 5,
            max: 300,
            step: 5,
            variant: "slider",
            label: "Keep-alive interval",
            infoTooltip:
              "Time in seconds between TCP keep-alive probes sent to maintain the connection.",
          }}
        />

        <SettingsSelectRow
          settingKey="tcpRecvBufferSize"
          icon={<Download size={16} />}
          label="Receive buffer"
          value={String(rdp.tcpRecvBufferSize ?? 262144)}
          options={BUFFER_OPTIONS}
          onChange={(v) => update({ tcpRecvBufferSize: parseInt(v, 10) })}
          infoTooltip="Size of the TCP receive buffer. Larger buffers improve throughput on high-latency networks."
        />

        <SettingsSelectRow
          settingKey="tcpSendBufferSize"
          icon={<Upload size={16} />}
          label="Send buffer"
          value={String(rdp.tcpSendBufferSize ?? 262144)}
          options={BUFFER_OPTIONS}
          onChange={(v) => update({ tcpSendBufferSize: parseInt(v, 10) })}
          infoTooltip="Size of the TCP send buffer. Larger buffers can improve throughput for outbound data."
        />
      </Card>
    </div>
  );
};

export default TcpSocketDefaults;
