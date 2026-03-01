import Toggle from "./Toggle";
import React from "react";
import { IPProtocols } from "../../../../types/settings";
import { Network } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select } from "../../../ui/forms";

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
      label={t(
        "settings.sshTerminal.tcpNoDelay",
        "Disable Nagle algorithm (TCP_NODELAY)",
      )}
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
      label={t(
        "settings.sshTerminal.tcpKeepAlive",
        "Enable TCP keepalive",
      )}
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
      label={t(
        "settings.sshTerminal.soKeepAlive",
        "Enable SO_KEEPALIVE option",
      )}
      description={t(
        "settings.sshTerminal.soKeepAliveDesc",
        "Enable socket-level keepalive mechanism",
      )}
    />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
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
        label={t("settings.sshTerminal.ipProtocol", "IP Protocol")}
        options={IPProtocols.map((p) => ({
          value: p,
          label: p === "auto" ? "Auto (IPv4/IPv6)" : p.toUpperCase(),
        }))}
      />
      <NumberInput
        value={cfg.tcpOptions.connectionTimeout}
        onChange={(v) =>
          up({
            tcpOptions: { ...cfg.tcpOptions, connectionTimeout: v },
          })
        }
        label={t(
          "settings.sshTerminal.connectionTimeout",
          "Connection Timeout (sec)",
        )}
        min={5}
        max={300}
      />
    </div>

    {cfg.tcpOptions.tcpKeepAlive && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--color-border)]">
        <NumberInput
          value={cfg.tcpOptions.keepAliveInterval}
          onChange={(v) =>
            up({
              tcpOptions: { ...cfg.tcpOptions, keepAliveInterval: v },
            })
          }
          label={t(
            "settings.sshTerminal.keepAliveInterval",
            "Keepalive Interval (sec)",
          )}
          min={1}
          max={3600}
        />
        <NumberInput
          value={cfg.tcpOptions.keepAliveProbes}
          onChange={(v) =>
            up({
              tcpOptions: { ...cfg.tcpOptions, keepAliveProbes: v },
            })
          }
          label={t(
            "settings.sshTerminal.keepAliveProbes",
            "Keepalive Probes",
          )}
          min={1}
          max={30}
        />
      </div>
    )}
  </SettingsCollapsibleSection>
);

export default TcpOptionsSection;
