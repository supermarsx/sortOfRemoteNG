import type { WinrmSectionProps } from "./types";
import { CollapsibleSection } from "../../ui/CollapsibleSection";
import { Shield } from "lucide-react";
import { Checkbox } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const CSS = {
  label: "flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]",
} as const;

const TlsSection: React.FC<WinrmSectionProps> = ({ ws, update }) => (
  <CollapsibleSection
    title="TLS / Certificate Validation"
    icon={<Shield size={14} className="text-info" />}
    defaultOpen
  >
    <p className="text-xs text-[var(--color-textMuted)] mb-2 leading-relaxed">
      By default this connection&apos;s certificate is trust-on-first-use:
      pinned on first connect, rejected if it changes, and reviewable in the
      Trust Center under Legacy TLS. The options below relax that to accept any
      certificate (Always Trust) — useful for lab appliances, but it disables
      change detection.
    </p>

    <label className={CSS.label}>
      <Checkbox
        checked={ws.skipCaCheck ?? false}
        onChange={(v: boolean) => update({ skipCaCheck: v })}
      />
      <span>Trust certificate without verification (Always Trust) <InfoTooltip text="Accept the server certificate without trust-on-first-use pinning or CA validation — equivalent to an Always Trust override in the Trust Center. Useful for self-signed certificates in lab environments, but no change detection." /></span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 mt-0.5 mb-2">
      Accept self-signed or untrusted certificates without pinning. Useful for
      lab environments.
    </p>

    <label className={CSS.label}>
      <Checkbox
        checked={ws.skipCnCheck ?? false}
        onChange={(v: boolean) => update({ skipCnCheck: v })}
      />
      <span>Skip hostname (CN) verification <InfoTooltip text="Accept certificates whose Common Name does not match the target hostname. Enable when the certificate was issued for a different name." /></span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 mt-0.5">
      Accept certificates whose Common Name doesn't match the target hostname.
    </p>
  </CollapsibleSection>
);

export default TlsSection;
