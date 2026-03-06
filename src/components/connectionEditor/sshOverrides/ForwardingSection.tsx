import OverrideToggle from "./OverrideToggle";
import { Checkbox, NumberInput, TextInput, Select } from "../../ui/forms";
import { ProxyCommandTemplates } from "../../../types/ssh/sshSettings";

const proxyTemplateOptions = [
  { value: "", label: "None (custom command)" },
  ...ProxyCommandTemplates.map((t) => ({ value: t, label: t === "ssh_stdio" ? "ssh -W (stdio)" : t })),
];

const ForwardingSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Forwarding</h4>

      {/* ── TCP Forwarding ── */}
      <OverrideToggle
        label="TCP Forwarding"
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
        label="X11 Forwarding"
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
                  onChange={(val: string) => u("x11DisplayOverride", val || undefined)}
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
        label="Agent Forwarding"
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
      <h4 className="sor-form-section-heading mt-4">ProxyCommand</h4>

      <OverrideToggle
        label="ProxyCommand"
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
              onChange={(val: string) => u("proxyCommandTemplate", val || undefined)}
              options={proxyTemplateOptions}
              variant="form-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-textSecondary)] w-28">Custom command</span>
            <TextInput
              value={v("proxyCommand") ?? ""}
              onChange={(val: string) => u("proxyCommand", val || undefined)}
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
                  onChange={(val: string) => u("proxyCommandHost", val || undefined)}
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
                  onChange={(val: string) => u("proxyCommandUsername", val || undefined)}
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
