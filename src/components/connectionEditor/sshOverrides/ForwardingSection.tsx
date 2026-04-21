import type { SectionProps } from "./types";
import OverrideToggle from "./OverrideToggle";
import { Checkbox, NumberInput, TextInput, Select } from "../../ui/forms";
import { ProxyCommandTemplates, type ProxyCommandTemplate } from "../../../types/ssh/sshSettings";
import { InfoTooltip } from "../../ui/InfoTooltip";

const proxyTemplateOptions = [
  { value: "", label: "None (custom command)" },
  ...ProxyCommandTemplates.map((t) => ({ value: t, label: t === "ssh_stdio" ? "ssh -W (stdio)" : t })),
];

const ForwardingSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Forwarding <InfoTooltip text="Override port forwarding, X11 forwarding, and agent forwarding settings for this connection." /></h4>

      {/* ── TCP Forwarding ── */}
      <OverrideToggle
        label={<>TCP Forwarding <InfoTooltip text="Allow TCP port forwarding (local and remote tunnels) through this SSH connection." /></>}
        isOverridden={ov("enableTcpForwarding")}
        globalValue={g.enableTcpForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableTcpForwarding", on ? !g.enableTcpForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("enableTcpForwarding")} onChange={(val: boolean) => u("enableTcpForwarding", val)} variant="form" />
          Allow TCP port forwarding
        </label>
      </OverrideToggle>

      {/* ── X11 Forwarding ── */}
      <OverrideToggle
        label={<>X11 Forwarding <InfoTooltip text="Forward X11 graphical applications from the remote host to your local display." /></>}
        isOverridden={ov("enableX11Forwarding")}
        globalValue={g.enableX11Forwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableX11Forwarding", on ? !g.enableX11Forwarding : undefined)
        }
      >
        <div className="space-y-2">
          <label className="sor-form-inline-check">
            <Checkbox checked={v("enableX11Forwarding")} onChange={(val: boolean) => u("enableX11Forwarding", val)} variant="form" />
            Enable X11 forwarding
          </label>

          {v("enableX11Forwarding") && (
            <div className="ml-6 space-y-2">
              <label className="sor-form-inline-check">
                <Checkbox checked={v("x11Trusted")} onChange={(val: boolean) => u("x11Trusted", val)} variant="form" />
                Trusted mode (full access to local X server)
              </label>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">Display offset</span>
                <NumberInput value={v("x11DisplayOffset")} onChange={(val: number) => u("x11DisplayOffset", val)} variant="form-sm" min={0} max={99} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">DISPLAY override</span>
                <TextInput
                  value={v("x11DisplayOverride") ?? ""}
                  onChange={(v) => u("x11DisplayOverride", v || undefined)}
                  variant="form-sm"
                  placeholder="auto (e.g. :0 or localhost:10.0)"
                />
              </div>
            </div>
          )}
        </div>
      </OverrideToggle>

      {/* ── Agent Forwarding ── */}
      <OverrideToggle
        label={<>Agent Forwarding <InfoTooltip text="Forward your local SSH agent to the remote host for onward connections using your local keys." /></>}
        isOverridden={ov("agentForwarding")}
        globalValue={g.agentForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("agentForwarding", on ? !g.agentForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("agentForwarding")} onChange={(val: boolean) => u("agentForwarding", val)} variant="form" />
          Forward SSH agent to remote host
        </label>
      </OverrideToggle>

      {/* ── ProxyCommand ── */}
      <h4 className="sor-form-section-heading mt-4">ProxyCommand <InfoTooltip text="Route the SSH connection through a proxy or jump host using a custom command." /></h4>

      <OverrideToggle
        label={<>ProxyCommand <InfoTooltip text="Specify a command used to establish the connection, such as an SSH jump host or SOCKS proxy." /></>}
        isOverridden={ov("proxyCommand") || ov("proxyCommandTemplate")}
        globalValue={g.proxyCommand || g.proxyCommandTemplate || "None"}
        onToggle={(on) => {
          if (!on) {
            u("proxyCommand", undefined);
            u("proxyCommandTemplate", undefined);
            u("proxyCommandHost", undefined);
            u("proxyCommandPort", undefined);
            u("proxyCommandUsername", undefined);
            u("proxyCommandPassword", undefined);
            u("proxyCommandProxyType", undefined);
            u("proxyCommandTimeout", undefined);
          }
        }}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-textSecondary)] w-28">Template</span>
            <Select
              value={v("proxyCommandTemplate") ?? ""}
              onChange={(val: string) => u("proxyCommandTemplate", val ? val as ProxyCommandTemplate : undefined)}
              options={proxyTemplateOptions}
              variant="form-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-textSecondary)] w-28">Custom command</span>
            <TextInput
              value={v("proxyCommand") ?? ""}
              onChange={(v) => u("proxyCommand", v || undefined)}
              variant="form-sm"
              placeholder="e.g. ssh -W %h:%p jumpbox"
            />
          </div>

          {(v("proxyCommandTemplate") && v("proxyCommandTemplate") !== "nc") && (
            <div className="ml-6 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">Proxy host</span>
                <TextInput
                  value={v("proxyCommandHost") ?? ""}
                  onChange={(v) => u("proxyCommandHost", v || undefined)}
                  variant="form-sm"
                  placeholder="127.0.0.1"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">Proxy port</span>
                <NumberInput
                  value={v("proxyCommandPort") ?? 1080}
                  onChange={(val: number) => u("proxyCommandPort", val)}
                  variant="form-sm"
                  min={1}
                  max={65535}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">Proxy user</span>
                <TextInput
                  value={v("proxyCommandUsername") ?? ""}
                  onChange={(v) => u("proxyCommandUsername", v || undefined)}
                  variant="form-sm"
                  placeholder="optional"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] w-28">Timeout</span>
                <NumberInput
                  value={v("proxyCommandTimeout") ?? 15}
                  onChange={(val: number) => u("proxyCommandTimeout", val)}
                  variant="form-sm"
                  min={1}
                  max={300}
                />
                <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
              </div>
            </div>
          )}

          <p className="text-xs text-[var(--color-textTertiary)] ml-1">
            Use <code>%h</code> for host, <code>%p</code> for port, <code>%r</code> for username in custom commands.
          </p>
        </div>
      </OverrideToggle>
    </div>
  );
};

export default ForwardingSection;
