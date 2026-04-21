import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { IPProtocols } from "../../../../types/settings/settings";
import { Network } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select, FormField } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const TcpOptionsSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.tcpOptions", "Low-level TCP Options")}
    icon={<Network className="w-4 h-4 text-teal-400" />}
    defaultOpen={false}
  >
    <Toggle
      checked={cfg.tcpOptions.tcpNoDelay}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, tcpNoDelay: v } })
      }
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.tcpNoDelay",
        "Disable Nagle algorithm (TCP_NODELAY)",
      )} <InfoTooltip text="Send data immediately without waiting to batch small packets. Reduces latency at the cost of slightly more network overhead." /></span>}
      description={t(
        "settings.sshTerminal.tcpNoDelayDesc",
        "Send data immediately without buffering small packets",
      )}
    />
    <Toggle
      checked={cfg.tcpOptions.tcpKeepAlive}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, tcpKeepAlive: v } })
      }
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.tcpKeepAlive",
        "Enable TCP keepalive",
      )} <InfoTooltip text="Send periodic TCP keepalive probes to detect and clean up dead connections before they time out." /></span>}
      description={t(
        "settings.sshTerminal.tcpKeepAliveDesc",
        "Send TCP keepalive probes to detect dead connections",
      )}
    />
    <Toggle
      checked={cfg.tcpOptions.soKeepAlive}
      onChange={(v) =>
        up({ tcpOptions: { ...cfg.tcpOptions, soKeepAlive: v } })
      }
      label={<span className="flex items-center gap-1">{t(
        "settings.sshTerminal.soKeepAlive",
        "Enable SO_KEEPALIVE option",
      )} <InfoTooltip text="Enable the socket-level keepalive mechanism provided by the operating system." /></span>}
      description={t(
        "settings.sshTerminal.soKeepAliveDesc",
        "Enable socket-level keepalive mechanism",
      )}
    />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
      <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.ipProtocol", "IP Protocol")} <InfoTooltip text="Preferred IP protocol version. Auto will try IPv4 first, then fall back to IPv6." /></span>}>
        <Select
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
        />
      </FormField>
      <FormField label={<span className="flex items-center gap-1">{t(
          "settings.sshTerminal.connectionTimeout",
          "Connection Timeout (sec)",
        )} <InfoTooltip text="Maximum time in seconds to wait for a TCP connection to be established before giving up." /></span>}>
        <NumberInput
          value={cfg.tcpOptions.connectionTimeout}
          onChange={(v) =>
            up({
              tcpOptions: { ...cfg.tcpOptions, connectionTimeout: v },
            })
          }
          min={5}
          max={300}
        />
      </FormField>
    </div>

    {cfg.tcpOptions.tcpKeepAlive && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
        <FormField label={<span className="flex items-center gap-1">{t(
            "settings.sshTerminal.keepAliveInterval",
            "Keepalive Interval (sec)",
          )} <InfoTooltip text="Time in seconds between TCP keepalive probes sent to the remote server." /></span>}>
          <NumberInput
            value={cfg.tcpOptions.keepAliveInterval}
            onChange={(v) =>
              up({
                tcpOptions: { ...cfg.tcpOptions, keepAliveInterval: v },
              })
            }
            min={1}
            max={3600}
          />
        </FormField>
        <FormField label={<span className="flex items-center gap-1">{t(
            "settings.sshTerminal.keepAliveProbes",
            "Keepalive Probes",
          )} <InfoTooltip text="Number of unacknowledged keepalive probes before the connection is considered dead." /></span>}>
          <NumberInput
            value={cfg.tcpOptions.keepAliveProbes}
            onChange={(v) =>
              up({
                tcpOptions: { ...cfg.tcpOptions, keepAliveProbes: v },
              })
            }
            min={1}
            max={30}
          />
        </FormField>
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default TcpOptionsSection;
