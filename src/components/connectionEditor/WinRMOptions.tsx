import { useCallback } from "react";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { Monitor } from "lucide-react";
import { InfoTooltip } from "../ui/InfoTooltip";
import { useSettings } from "../../contexts/SettingsContext";
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

  const { settings } = useSettings();
  const ws: WinrmConnectionSettings = formData.winrmSettings ?? DEFAULT_WINRM;
  const enableWinrm = formData.enableWinrmTools ?? settings.enableWinrmTools ?? true;

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
        {/* Enable/disable WinRM tools for this connection */}
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
            Enable WinRM Tools{" "}
            <InfoTooltip text="Show Windows management tools (Services, Processes, Event Viewer, etc.) in the context menu and RDP toolbar for this connection. When disabled, the WinRM configuration below still applies to any programmatic WinRM usage." />
          </label>
          <div className="flex items-center gap-2">
            {formData.enableWinrmTools === undefined && (
              <span className="text-xs text-[var(--color-textMuted)]">
                (global: {settings.enableWinrmTools ? "on" : "off"})
              </span>
            )}
            <select
              value={formData.enableWinrmTools === undefined ? "inherit" : formData.enableWinrmTools ? "on" : "off"}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => ({
                  ...prev,
                  enableWinrmTools: v === "inherit" ? undefined : v === "on",
                }));
              }}
              className="sor-form-input text-sm w-32"
            >
              <option value="inherit">Use global</option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </div>
        </div>

        {!enableWinrm && (
          <p className="text-xs text-warning">
            WinRM tools are disabled for this connection. The toolbar buttons and context menu entries will be hidden.
          </p>
        )}

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
