import { useCallback } from "react";
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

export const WinRMOptions: React.FC<WinRMOptionsProps> = ({
  formData,
  setFormData,
}) => {
  // Only show for winrm protocol connections (not groups)
  if (formData.isGroup || formData.protocol !== "winrm") return null;

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
    <div className="space-y-3">
      {/* Domain field */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Domain
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

      <TransportSection ws={ws} update={update} />
      <AuthSection ws={ws} update={update} />
      <TlsSection ws={ws} update={update} />
      <WmiSection ws={ws} update={update} />
    </div>
  );
};

export default WinRMOptions;
