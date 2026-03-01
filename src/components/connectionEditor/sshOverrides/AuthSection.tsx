import AuthMethodSelector from "./AuthMethodSelector";
import OverrideToggle from "./OverrideToggle";
import { Checkbox } from "../../ui/forms";

const AuthSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Authentication</h4>

      <OverrideToggle
        label="Auth Methods"
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
        label="Try Public Key First"
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
        label="Agent Forwarding"
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
