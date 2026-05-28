import React from "react";
import {
  FileKey,
  Gauge,
  ShieldCheck,
  Network,
  Lock,
  KeyRound,
  Settings,
  FolderTree,
  FolderOpen,
  Layers,
  Palette,
  Shield,
  GitFork,
  Tag,
  Database,
  Activity,
  Hash,
  Repeat,
  TrendingUp,
  Sparkles,
  FileBox,
  ListChecks,
} from "lucide-react";
import {
  defaultExportSecuritySettings,
  type GlobalSettings,
  type ExportPasswordScore,
  type ExportSecuritySettings,
  type ExportFormat,
} from "../../../../types/settings/settings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

/**
 * Small in-card sub-group header (matches Memory Watchdog / CredSSP).
 */
const SubGroupHeader: React.FC<{ icon: React.ReactNode; label: string }> = ({
  icon,
  label,
}) => (
  <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-[var(--color-border)]/40 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] font-medium">
    {icon}
    {label}
  </div>
);

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
    <div className="space-y-4">
      <SectionHeader
        icon={<FileKey className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Export Security
            <InfoTooltip text="Controls default export format, sidecar inclusion, password-encrypted export key derivation, and password strength checks." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          These defaults apply to the Import / Export tool. Export passwords
          are never saved here.
        </p>

        <SettingsSelectRow
          icon={<FileBox size={16} />}
          label="Default export format"
          value={exportSecurity.defaultFormat}
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
          onChange={(v) =>
            updateExportSecurity({ defaultFormat: v as ExportFormat })
          }
          infoTooltip="Format pre-selected in the Import / Export tool. Individual exports can still override this."
        />

        <SettingsNumberRow
          icon={<Gauge size={16} />}
          label="Export PBKDF2 iterations"
          value={exportSecurity.keyDerivationIterations}
          min={10000}
          max={5000000}
          step={10000}
          onChange={(v) =>
            updateExportSecurity({ keyDerivationIterations: v })
          }
          infoTooltip="Higher iteration counts slow down brute-force attacks against password-encrypted export files, but also slow export/import."
        />

        <SubGroupHeader
          icon={<ListChecks size={11} />}
          label="Include in exports by default"
        />

        <Toggle
          checked={exportSecurity.includeConnectionsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeConnectionsByDefault: v })
          }
          icon={<Network size={16} />}
          label="Connections"
          description="Include saved connections by default"
        />
        <Toggle
          checked={exportSecurity.encryptByDefault}
          onChange={(v) => updateExportSecurity({ encryptByDefault: v })}
          icon={<Lock size={16} />}
          label="Encrypt exports"
          description="Password-encrypt the exported file by default"
        />
        <Toggle
          checked={exportSecurity.includePasswordsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includePasswordsByDefault: v })
          }
          icon={<KeyRound size={16} />}
          label="Passwords"
          description="Include saved passwords in the export by default"
        />
        <Toggle
          checked={exportSecurity.includeSettingsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeSettingsByDefault: v })
          }
          icon={<Settings size={16} />}
          label="Application settings"
          description="Include global application preferences"
        />
        <Toggle
          checked={exportSecurity.includeFolderItemsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeFolderItemsByDefault: v })
          }
          icon={<FolderTree size={16} />}
          label="Folders / groups"
          description="Include the folder tree structure"
        />
        <Toggle
          checked={exportSecurity.includeEmptyFoldersByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeEmptyFoldersByDefault: v })
          }
          icon={<FolderOpen size={16} />}
          label="Empty folders"
          description="Include folders that contain no connections"
        />
        <Toggle
          checked={exportSecurity.includeTabGroupsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeTabGroupsByDefault: v })
          }
          icon={<Layers size={16} />}
          label="Tab groups"
          description="Include user-defined tab groups"
        />
        <Toggle
          checked={exportSecurity.includeColorTagsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeColorTagsByDefault: v })
          }
          icon={<Palette size={16} />}
          label="Color tags"
          description="Include color tag definitions"
        />
        <Toggle
          checked={exportSecurity.includeVpnDataByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeVpnDataByDefault: v })
          }
          icon={<Shield size={16} />}
          label="VPN definitions"
          description="Include configured VPN profiles"
        />
        <Toggle
          checked={exportSecurity.includeTunnelChainsByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeTunnelChainsByDefault: v })
          }
          icon={<GitFork size={16} />}
          label="Tunnel chains"
          description="Include SSH tunnel chains"
        />
        <Toggle
          checked={exportSecurity.includeExportMetadataByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeExportMetadataByDefault: v })
          }
          icon={<Tag size={16} />}
          label="Export metadata"
          description="Embed metadata describing how the export was produced"
        />
        <Toggle
          checked={exportSecurity.includeDatabaseMetadataByDefault}
          onChange={(v) =>
            updateExportSecurity({ includeDatabaseMetadataByDefault: v })
          }
          icon={<Database size={16} />}
          label="Database metadata"
          description="Include the source collection's metadata"
        />

        <SubGroupHeader
          icon={<ShieldCheck size={11} />}
          label="Password strength feedback"
        />

        <Toggle
          checked={exportSecurity.showPasswordStrength}
          onChange={(v) =>
            updateExportSecurity({ showPasswordStrength: v })
          }
          icon={<Activity size={16} />}
          label="Show strength meter in export tab"
          description="Render a visual strength meter as the export password is typed"
        />
        <Toggle
          checked={exportSecurity.showEntropyBits}
          onChange={(v) => updateExportSecurity({ showEntropyBits: v })}
          icon={<Hash size={16} />}
          label="Show estimated entropy bits"
          description="Display the rough entropy of the typed password alongside the meter"
        />
        <Toggle
          checked={exportSecurity.enforceMinimumPasswordScore}
          onChange={(v) =>
            updateExportSecurity({ enforceMinimumPasswordScore: v })
          }
          icon={<ShieldCheck size={16} />}
          label="Block export below minimum score"
          description="Refuse to export when the password is below the configured score"
        />
        <SettingsSelectRow
          icon={<Gauge size={16} />}
          label="Minimum password score"
          value={String(exportSecurity.minimumPasswordScore)}
          options={[
            { value: "0", label: "Very weak" },
            { value: "1", label: "Weak" },
            { value: "2", label: "Fair" },
            { value: "3", label: "Strong" },
            { value: "4", label: "Very strong" },
          ]}
          onChange={(v) =>
            updateExportSecurity({
              minimumPasswordScore: Number(v) as ExportPasswordScore,
            })
          }
          infoTooltip="The minimum strength score the export password must reach. Higher values make encrypted exports harder to brute-force."
        />

        <SubGroupHeader
          icon={<Sparkles size={11} />}
          label="Strength detection heuristics"
        />

        <Toggle
          checked={exportSecurity.detectCommonPasswords}
          onChange={(v) =>
            updateExportSecurity({ detectCommonPasswords: v })
          }
          icon={<KeyRound size={16} />}
          label="Detect common passwords"
          description="Penalize passwords matching well-known dictionaries"
        />
        <Toggle
          checked={exportSecurity.detectRepeatedCharacters}
          onChange={(v) =>
            updateExportSecurity({ detectRepeatedCharacters: v })
          }
          icon={<Repeat size={16} />}
          label="Detect repeated characters"
          description="Penalize runs like aaaa or 1111"
        />
        <Toggle
          checked={exportSecurity.detectSequentialPatterns}
          onChange={(v) =>
            updateExportSecurity({ detectSequentialPatterns: v })
          }
          icon={<TrendingUp size={16} />}
          label="Detect keyboard / numeric sequences"
          description="Penalize qwerty, 12345, abcdef, …"
        />
        <Toggle
          checked={exportSecurity.rewardUncommonSymbols}
          onChange={(v) =>
            updateExportSecurity({ rewardUncommonSymbols: v })
          }
          icon={<Sparkles size={16} />}
          label="Reward uncommon symbols"
          description="Give a small score bump for less-common punctuation"
        />

        <div className="sor-settings-select-row !items-start">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <ListChecks size={16} />
            </span>
            Additional common passwords
            <InfoTooltip text="Extra entries added to the common-password denylist. One per line or comma-separated." />
          </span>
          <textarea
            value={exportSecurity.customCommonPasswords}
            onChange={(event) =>
              updateExportSecurity({
                customCommonPasswords: event.target.value,
              })
            }
            className="sor-settings-input min-h-20 resize-y font-mono text-sm"
            style={{ width: "20rem" }}
            placeholder="One password per line, or comma-separated"
          />
        </div>
      </Card>
    </div>
  );
}

export default ExportSecuritySection;
