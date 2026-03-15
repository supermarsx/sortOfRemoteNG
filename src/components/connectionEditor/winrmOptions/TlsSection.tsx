import type { WinrmSectionProps } from "./types";
import { CollapsibleSection } from "../../ui/CollapsibleSection";
import { Shield } from "lucide-react";
import { Checkbox } from "../../ui/forms";

const CSS = {
  label: "flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]",
} as const;

const TlsSection: React.FC<WinrmSectionProps> = ({ ws, update }) => (
  <CollapsibleSection
    title="TLS / Certificate Validation"
    icon={<Shield size={14} className="text-info" />}
    defaultOpen
  >
    <label className={CSS.label}>
      <Checkbox
        checked={ws.skipCaCheck ?? false}
        onChange={(v: boolean) => update({ skipCaCheck: v })}
      />
      <span>Skip CA certificate validation</span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 mt-0.5 mb-2">
      Accept self-signed or untrusted certificates. Useful for lab environments.
    </p>

    <label className={CSS.label}>
      <Checkbox
        checked={ws.skipCnCheck ?? false}
        onChange={(v: boolean) => update({ skipCnCheck: v })}
      />
      <span>Skip hostname (CN) verification</span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 mt-0.5">
      Accept certificates whose Common Name doesn't match the target hostname.
    </p>
  </CollapsibleSection>
);

export default TlsSection;
