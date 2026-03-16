import { useCallback } from "react";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { Monitor } from "lucide-react";
import { InfoTooltip } from "../ui/InfoTooltip";
import type { Connection, WinrmConnectionSettings } from "../../types/connection/connection";
import TransportSection from "./winrmOptions/TransportSection";
import AuthSection from "./winrmOptions/AuthSection";
import TlsSection from "./winrmOptions/TlsSection";
import WmiSection from "./winrmOptions/WmiSection";

interface WinRMOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

const DEFAULT_WINRM: WinrmConnectionSettings = {
  httpPort: 5985,
  httpsPort: 5986,
  preferSsl: false,
  authMethod: "negotiate",
  skipCaCheck: false,
  skipCnCheck: false,
  autoFallback: true,
  namespace: "root\\cimv2",
  timeoutSec: 30,
};

/** Show WinRM settings for:
 *  - protocol === 'winrm' (dedicated WinRM connections)
 *  - osType === 'windows' (RDP/SSH/etc. connections to Windows machines)
 *  - protocol === 'rdp'  (always Windows)
 */
function shouldShow(formData: Partial<Connection>): boolean {
  if (formData.isGroup) return false;
  if (formData.protocol === "winrm") return true;
  if (formData.protocol === "rdp") return true;
  if (formData.osType === "windows") return true;
  return false;
}

export const WinRMOptions: React.FC<WinRMOptionsProps> = ({
  formData,
  setFormData,
}) => {
  if (!shouldShow(formData)) return null;

  const ws: WinrmConnectionSettings = formData.winrmSettings ?? DEFAULT_WINRM;

  const update = useCallback(
    (patch: Partial<WinrmConnectionSettings>) => {
      setFormData((prev) => ({
        ...prev,
        winrmSettings: {
          ...(prev.winrmSettings ?? DEFAULT_WINRM),
          ...patch,
        },
      }));
    },
    [setFormData],
  );

  return (
    <CollapsibleSection
      title="Windows Remote Management (WinRM)"
      icon={<Monitor size={14} className="text-info" />}
      defaultOpen
    >
      <div className="space-y-3">
        {/* Domain — only show here if the parent protocol doesn't already have one */}
        {formData.protocol !== "rdp" && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              Domain <InfoTooltip text="NetBIOS domain name for domain-joined accounts. Leave empty for local accounts." />
            </label>
            <input
              type="text"
              value={formData.domain || ""}
              onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
              className="sor-form-input text-sm"
              placeholder="CONTOSO (optional — for domain accounts)"
            />
            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              NetBIOS domain name. Leave empty for local accounts.
            </p>
          </div>
        )}

        <TransportSection ws={ws} update={update} />
        <AuthSection ws={ws} update={update} />
        <TlsSection ws={ws} update={update} />
        <WmiSection ws={ws} update={update} />
      </div>
    </CollapsibleSection>
  );
};

export default WinRMOptions;
