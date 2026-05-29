import type { SectionProps } from "./types";
import React from "react";
import { IPProtocols } from "../../../../types/settings/settings";
import { Network, Zap, Globe } from "lucide-react";
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

const TcpOptionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Network className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.tcpOptions", "Low-level TCP Options")}
    />
    <Card>
      <Toggle
        checked={cfg.tcpOptions.tcpNoDelay}
        onChange={(v) =>
          up({ tcpOptions: { ...cfg.tcpOptions, tcpNoDelay: v } })
        }
        icon={<Zap size={16} />}
        label={t(
          "settings.sshTerminal.tcpNoDelay",
          "Disable Nagle algorithm (TCP_NODELAY)",
        )}
        description={t(
          "settings.sshTerminal.tcpNoDelayDesc",
          "Send data immediately without buffering small packets",
        )}
        infoTooltip="Send data immediately without waiting to batch small packets. Reduces latency at the cost of slightly more network overhead."
      />

      <SettingsTcpKeepAliveBlock
        enabled={cfg.tcpOptions.tcpKeepAlive}
        onEnabledChange={(v) =>
          up({ tcpOptions: { ...cfg.tcpOptions, tcpKeepAlive: v } })
        }
        label={t(
          "settings.sshTerminal.tcpKeepAlive",
          "Enable TCP keepalive",
        )}
        description={t(
          "settings.sshTerminal.tcpKeepAliveDesc",
          "Send TCP keepalive probes to detect dead connections",
        )}
        infoTooltip="Send periodic TCP keepalive probes to detect and clean up dead connections before they time out."
        soKeepAlive={{
          value: cfg.tcpOptions.soKeepAlive,
          onChange: (v) =>
            up({ tcpOptions: { ...cfg.tcpOptions, soKeepAlive: v } }),
          label: t(
            "settings.sshTerminal.soKeepAlive",
            "Enable SO_KEEPALIVE option",
          ),
          description: t(
            "settings.sshTerminal.soKeepAliveDesc",
            "Enable socket-level keepalive mechanism",
          ),
          infoTooltip:
            "Enable the socket-level keepalive mechanism provided by the operating system.",
        }}
        intervalSecs={{
          settingKey: "keepAliveInterval",
          value: cfg.tcpOptions.keepAliveInterval,
          onChange: (v) =>
            up({ tcpOptions: { ...cfg.tcpOptions, keepAliveInterval: v } }),
          min: 1,
          max: 3600,
          label: t(
            "settings.sshTerminal.keepAliveInterval",
            "Keepalive interval",
          ),
          infoTooltip:
            "Time in seconds between TCP keepalive probes sent to the remote server.",
        }}
        probes={{
          settingKey: "keepAliveProbes",
          value: cfg.tcpOptions.keepAliveProbes,
          onChange: (v) =>
            up({ tcpOptions: { ...cfg.tcpOptions, keepAliveProbes: v } }),
          min: 1,
          max: 30,
          label: t(
            "settings.sshTerminal.keepAliveProbes",
            "Keepalive probes",
          ),
          infoTooltip:
            "Number of unacknowledged keepalive probes before the connection is considered dead.",
        }}
      />

      <SettingsSelectRow
        settingKey="ipProtocol"
        icon={<Globe size={16} />}
        label={t("settings.sshTerminal.ipProtocol", "IP protocol")}
        value={cfg.tcpOptions.ipProtocol}
        onChange={(v) =>
          up({
            tcpOptions: {
              ...cfg.tcpOptions,
              ipProtocol: v as typeof cfg.tcpOptions.ipProtocol,
            },
          })
        }
        options={IPProtocols.map((p) => ({
          value: p,
          label: p === "auto" ? "Auto (IPv4/IPv6)" : p.toUpperCase(),
        }))}
        infoTooltip="Preferred IP protocol version. Auto will try IPv4 first, then fall back to IPv6."
      />
      <SettingsConnectionTimeoutRow
        settingKey="connectionTimeout"
        label={t(
          "settings.sshTerminal.connectionTimeout",
          "Connection timeout",
        )}
        value={cfg.tcpOptions.connectionTimeout}
        min={5}
        max={300}
        onChange={(v) =>
          up({ tcpOptions: { ...cfg.tcpOptions, connectionTimeout: v } })
        }
        infoTooltip="Maximum time in seconds to wait for a TCP connection to be established before giving up."
      />
    </Card>
  </div>
);

export default TcpOptionsSection;
