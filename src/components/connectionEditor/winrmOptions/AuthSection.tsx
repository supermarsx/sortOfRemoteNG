import type { WinrmSectionProps } from "./types";
import { CollapsibleSection } from "../../ui/CollapsibleSection";
import { KeyRound } from "lucide-react";
import { Select } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const CSS = {
  select: "sor-form-select text-sm",
} as const;

const AUTH_OPTIONS = [
  { value: "negotiate", label: "Negotiate (auto NTLM / Kerberos)" },
  { value: "basic", label: "Basic (username:password)" },
  { value: "ntlm", label: "NTLM" },
  { value: "kerberos", label: "Kerberos" },
  { value: "credssp", label: "CredSSP" },
] as const;

const AuthSection: React.FC<WinrmSectionProps> = ({ ws, update }) => (
  <CollapsibleSection
    title="Authentication"
    icon={<KeyRound size={14} className="text-warning" />}
    defaultOpen
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Authentication Method <InfoTooltip text="The authentication protocol used for WinRM connections. Negotiate is recommended as it auto-selects the best available method." />
      </label>
      <Select
        value={ws.authMethod ?? "negotiate"}
        onChange={(v: string) =>
          update({ authMethod: v as WinrmSectionProps["ws"]["authMethod"] })
        }
        options={[...AUTH_OPTIONS]}
        className={CSS.select}
      />
      <p className="text-xs text-[var(--color-textMuted)] mt-1.5">
        {ws.authMethod === "basic"
          ? "Sends credentials Base64-encoded. Requires Basic auth enabled on the target. Use HTTPS for security."
          : ws.authMethod === "ntlm"
            ? "Challenge-response authentication. Works in workgroup and domain environments."
            : ws.authMethod === "kerberos"
              ? "Requires domain-joined machines with a KDC. Most secure for domain environments."
              : ws.authMethod === "credssp"
                ? "Credential delegation via TLS + NTLM/Kerberos. Required for double-hop scenarios."
                : "Automatically negotiates NTLM or Kerberos based on the environment. Recommended default."}
      </p>
    </div>
  </CollapsibleSection>
);

export default AuthSection;
