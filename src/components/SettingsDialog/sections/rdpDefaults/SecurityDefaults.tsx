import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Shield, Network } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const SecurityDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Shield className="w-4 h-4 text-error" />
      Security Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.useCredSsp ?? true} onChange={(v: boolean) => update({ useCredSsp: v })} />
      <span className="sor-toggle-label font-medium">
        Use CredSSP <InfoTooltip text="Enables Credential Security Support Provider for secure credential delegation during authentication." />
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
      Master toggle – when disabled, CredSSP is entirely skipped for new
      connections.
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enableTls ?? true} onChange={(v: boolean) => update({ enableTls: v })} />
      <span className="sor-toggle-label">
        Enable TLS <InfoTooltip text="Encrypts the RDP connection using TLS to protect data in transit." />
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enableNla ?? true} onChange={(v: boolean) => update({ enableNla: v })} disabled={!(rdp.useCredSsp ?? true)} />
      <span
        className={`text-sm transition-colors ${
          !(rdp.useCredSsp ?? true)
            ? "text-[var(--color-textMuted)]"
            : "text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]"
        }`}
      >
        Enable NLA (Network Level Authentication) <InfoTooltip text="Requires authentication before establishing a full RDP session, reducing exposure to denial-of-service attacks." />
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.autoLogon ?? false} onChange={(v: boolean) => update({ autoLogon: v })} />
      <span className="sor-toggle-label">
        Auto logon (send credentials in INFO packet) <InfoTooltip text="Automatically sends stored credentials during connection to bypass the remote login screen." />
      </span>
    </label>
  </div>
);

export default SecurityDefaults;
