import { FileKey, Gauge, ShieldCheck } from "lucide-react";
import {
  defaultExportSecuritySettings,
  type GlobalSettings,
  type ExportPasswordScore,
  type ExportSecuritySettings,
  type ExportFormat,
} from "../../../../types/settings/settings";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

function ExportSecuritySection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  const exportSecurity: ExportSecuritySettings = {
    ...defaultExportSecuritySettings,
    ...(settings.exportSecurity ?? {}),
  };

  const updateExportSecurity = (updates: Partial<ExportSecuritySettings>) => {
    updateSettings({
      exportSecurity: {
        ...exportSecurity,
        ...updates,
      },
    });
  };

  return (
    <div className="sor-settings-card space-y-4">
      <div>
        <h4 className="sor-section-heading">
          <FileKey className="w-4 h-4 text-primary" />
          <span className="flex items-center gap-1">
            Export Security
            <InfoTooltip text="Controls default export format, sidecar inclusion, password-encrypted export key derivation, and password strength checks." />
          </span>
        </h4>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          These defaults apply to the Import / Export tool. Export passwords are never saved here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Default export format
          </label>
          <Select
            value={exportSecurity.defaultFormat}
            onChange={(value: string) => updateExportSecurity({ defaultFormat: value as ExportFormat })}
            options={[
              { value: "json", label: "JSON package" },
              { value: "xml", label: "sortOfRemoteNG XML" },
              { value: "csv", label: "CSV inventory" },
              { value: "txt", label: "Plain text outline" },
              { value: "markdown", label: "Markdown table" },
              { value: "html", label: "HTML report" },
              { value: "excel", label: "Excel table (.xls)" },
              { value: "mremoteng", label: "mRemoteNG XML" },
            ]}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Gauge className="w-4 h-4" />
            <span className="flex items-center gap-1">
              Export PBKDF2 iterations
              <InfoTooltip text="Higher iteration counts slow down brute-force attacks against password-encrypted export files, but also slow export/import." />
            </span>
          </label>
          <NumberInput
            value={exportSecurity.keyDerivationIterations}
            onChange={(value: number) => updateExportSecurity({ keyDerivationIterations: value })}
            min={10000}
            max={5000000}
            step={10000}
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeConnectionsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeConnectionsByDefault: value })} />
          <span className="sor-toggle-label">Include connections by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.encryptByDefault} onChange={(value: boolean) => updateExportSecurity({ encryptByDefault: value })} />
          <span className="sor-toggle-label">Encrypt exports by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includePasswordsByDefault} onChange={(value: boolean) => updateExportSecurity({ includePasswordsByDefault: value })} />
          <span className="sor-toggle-label">Include passwords by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeSettingsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeSettingsByDefault: value })} />
          <span className="sor-toggle-label">Include settings by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeFolderItemsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeFolderItemsByDefault: value })} />
          <span className="sor-toggle-label">Include folders/groups by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeEmptyFoldersByDefault} onChange={(value: boolean) => updateExportSecurity({ includeEmptyFoldersByDefault: value })} />
          <span className="sor-toggle-label">Include empty folders by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeTabGroupsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeTabGroupsByDefault: value })} />
          <span className="sor-toggle-label">Include tab groups by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeColorTagsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeColorTagsByDefault: value })} />
          <span className="sor-toggle-label">Include color tags by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeVpnDataByDefault} onChange={(value: boolean) => updateExportSecurity({ includeVpnDataByDefault: value })} />
          <span className="sor-toggle-label">Include VPN definitions by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeTunnelChainsByDefault} onChange={(value: boolean) => updateExportSecurity({ includeTunnelChainsByDefault: value })} />
          <span className="sor-toggle-label">Include tunnel chains by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeExportMetadataByDefault} onChange={(value: boolean) => updateExportSecurity({ includeExportMetadataByDefault: value })} />
          <span className="sor-toggle-label">Include export metadata by default</span>
        </label>
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={exportSecurity.includeDatabaseMetadataByDefault} onChange={(value: boolean) => updateExportSecurity({ includeDatabaseMetadataByDefault: value })} />
          <span className="sor-toggle-label">Include database metadata by default</span>
        </label>
      </div>

      <div className="border-t border-[var(--color-border)] pt-4 space-y-4">
        <h5 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Password strength feedback
        </h5>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.showPasswordStrength} onChange={(value: boolean) => updateExportSecurity({ showPasswordStrength: value })} />
            <span className="sor-toggle-label">Show strength meter in export tab</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.showEntropyBits} onChange={(value: boolean) => updateExportSecurity({ showEntropyBits: value })} />
            <span className="sor-toggle-label">Show estimated entropy bits</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.enforceMinimumPasswordScore} onChange={(value: boolean) => updateExportSecurity({ enforceMinimumPasswordScore: value })} />
            <span className="sor-toggle-label">Block export below minimum score</span>
          </label>
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Minimum password score
            </label>
            <Select
              value={exportSecurity.minimumPasswordScore}
              onChange={(value: string) => updateExportSecurity({ minimumPasswordScore: Number(value) as ExportPasswordScore })}
              options={[
                { value: 0, label: "Very weak" },
                { value: 1, label: "Weak" },
                { value: 2, label: "Fair" },
                { value: 3, label: "Strong" },
                { value: 4, label: "Very strong" },
              ]}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.detectCommonPasswords} onChange={(value: boolean) => updateExportSecurity({ detectCommonPasswords: value })} />
            <span className="sor-toggle-label">Detect common passwords</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.detectRepeatedCharacters} onChange={(value: boolean) => updateExportSecurity({ detectRepeatedCharacters: value })} />
            <span className="sor-toggle-label">Detect repeated characters</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.detectSequentialPatterns} onChange={(value: boolean) => updateExportSecurity({ detectSequentialPatterns: value })} />
            <span className="sor-toggle-label">Detect keyboard and numeric sequences</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={exportSecurity.rewardUncommonSymbols} onChange={(value: boolean) => updateExportSecurity({ rewardUncommonSymbols: value })} />
            <span className="sor-toggle-label">Reward uncommon symbols</span>
          </label>
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Additional common passwords
          </label>
          <textarea
            value={exportSecurity.customCommonPasswords}
            onChange={(event) => updateExportSecurity({ customCommonPasswords: event.target.value })}
            className="sor-settings-input min-h-20 w-full resize-y"
            placeholder="One password per line, or comma-separated"
          />
        </div>
      </div>
    </div>
  );
}

export default ExportSecuritySection;