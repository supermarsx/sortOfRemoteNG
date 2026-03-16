import type { WinrmSectionProps } from "./types";
import { CollapsibleSection } from "../../ui/CollapsibleSection";
import { Network } from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const CSS = {
  input: "sor-form-input text-sm",
  select: "sor-form-select text-sm",
  label: "flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]",
} as const;

const TransportSection: React.FC<WinrmSectionProps> = ({ ws, update }) => (
  <CollapsibleSection
    title="Transport"
    icon={<Network size={14} className="text-primary" />}
    defaultOpen
  >
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          HTTP Port <InfoTooltip text="The port used for unencrypted WinRM HTTP connections. Default is 5985." />
        </label>
        <NumberInput
          value={ws.httpPort ?? 5985}
          onChange={(v: number) => update({ httpPort: v })}
          className={CSS.input}
          min={1}
          max={65535}
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          HTTPS Port <InfoTooltip text="The port used for TLS-encrypted WinRM HTTPS connections. Default is 5986." />
        </label>
        <NumberInput
          value={ws.httpsPort ?? 5986}
          onChange={(v: number) => update({ httpsPort: v })}
          className={CSS.input}
          min={1}
          max={65535}
        />
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Preferred Protocol <InfoTooltip text="Choose whether WinRM connects over HTTP or HTTPS first. HTTPS is recommended for security." />
      </label>
      <Select
        value={ws.preferSsl ? "https" : "http"}
        onChange={(v: string) => update({ preferSsl: v === "https" })}
        options={[
          { value: "http", label: "HTTP (port " + (ws.httpPort ?? 5985) + ")" },
          { value: "https", label: "HTTPS (port " + (ws.httpsPort ?? 5986) + ")" },
        ]}
        className={CSS.select}
      />
    </div>

    <label className={CSS.label}>
      <Checkbox
        checked={ws.autoFallback ?? true}
        onChange={(v: boolean) => update({ autoFallback: v })}
      />
      <span>Auto-fallback to other protocol if preferred fails <InfoTooltip text="When enabled, automatically tries the alternate protocol (HTTP/HTTPS) if the preferred one fails to connect." /></span>
    </label>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Operation Timeout (seconds) <InfoTooltip text="Maximum time in seconds to wait for a WinRM operation to complete before timing out." />
      </label>
      <NumberInput
        value={ws.timeoutSec ?? 30}
        onChange={(v: number) => update({ timeoutSec: v })}
        className={CSS.input}
        min={5}
        max={300}
      />
    </div>
  </CollapsibleSection>
);

export default TransportSection;
