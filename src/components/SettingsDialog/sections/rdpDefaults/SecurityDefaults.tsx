import type { SectionProps } from "./selectClass";
import React from "react";
import { Shield, KeyRound, Lock, Network, LogIn } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const SecurityDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const credsspOn = rdp.useCredSsp ?? true;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title="Security Defaults"
      />

      <Card>
        <Toggle
          checked={credsspOn}
          onChange={(v) => update({ useCredSsp: v })}
          icon={<KeyRound size={16} />}
          label="Use CredSSP"
          description="Master switch — when off, CredSSP is skipped entirely for new connections"
          infoTooltip="Enables Credential Security Support Provider for secure credential delegation during authentication."
        />

        <Toggle
          checked={rdp.enableTls ?? true}
          onChange={(v) => update({ enableTls: v })}
          icon={<Lock size={16} />}
          label="Enable TLS"
          description="Encrypt the RDP transport with TLS to protect data in transit"
          infoTooltip="Encrypts the RDP connection using TLS to protect data in transit."
        />

        <div className={!credsspOn ? "opacity-50 pointer-events-none" : undefined}>
          <Toggle
            checked={rdp.enableNla ?? true}
            onChange={(v) => update({ enableNla: v })}
            disabled={!credsspOn}
            icon={<Network size={16} />}
            label="Enable NLA (Network Level Authentication)"
            description="Require authentication before opening the full RDP session"
            infoTooltip="Requires authentication before establishing a full RDP session, reducing exposure to denial-of-service attacks."
          />
        </div>

        <Toggle
          checked={rdp.autoLogon ?? false}
          onChange={(v) => update({ autoLogon: v })}
          icon={<LogIn size={16} />}
          label="Auto logon"
          description="Send stored credentials in the connection INFO packet to bypass the remote login screen"
          infoTooltip="Automatically sends stored credentials during connection to bypass the remote login screen."
        />
      </Card>
    </div>
  );
};

export default SecurityDefaults;
