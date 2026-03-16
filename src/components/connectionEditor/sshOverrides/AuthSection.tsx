import type { SectionProps } from "./types";
import AuthMethodSelector from "./AuthMethodSelector";
import OverrideToggle from "./OverrideToggle";
import { Checkbox } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const AuthSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Authentication <InfoTooltip text="Override the global SSH authentication settings for this specific connection." /></h4>

      <OverrideToggle
        label={<>Auth Methods <InfoTooltip text="The ordered list of SSH authentication methods to attempt (e.g. publickey, password, keyboard-interactive)." /></>}
        isOverridden={ov("preferredAuthMethods")}
        globalValue={g.preferredAuthMethods.join(", ")}
        onToggle={(on) =>
          u("preferredAuthMethods", on ? [...g.preferredAuthMethods] : undefined)
        }
      >
        <AuthMethodSelector
          value={v("preferredAuthMethods")}
          onChange={(methods) => u("preferredAuthMethods", methods)}
        />
      </OverrideToggle>

      <OverrideToggle
        label={<>Try Public Key First <InfoTooltip text="When enabled, public key authentication is attempted before password authentication." /></>}
        isOverridden={ov("tryPublicKeyFirst")}
        globalValue={g.tryPublicKeyFirst ? "Yes" : "No"}
        onToggle={(on) =>
          u("tryPublicKeyFirst", on ? !g.tryPublicKeyFirst : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("tryPublicKeyFirst")} onChange={(v: boolean) => u("tryPublicKeyFirst", v)} variant="form" />
          Attempt public key auth first
        </label>
      </OverrideToggle>

      <OverrideToggle
        label={<>Agent Forwarding <InfoTooltip text="Forward your local SSH agent to the remote host, allowing it to use your local keys for onward connections." /></>}
        isOverridden={ov("agentForwarding")}
        globalValue={g.agentForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("agentForwarding", on ? !g.agentForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("agentForwarding")} onChange={(v: boolean) => u("agentForwarding", v)} variant="form" />
          Enable SSH agent forwarding
        </label>
      </OverrideToggle>
    </div>
  );
};

export default AuthSection;
