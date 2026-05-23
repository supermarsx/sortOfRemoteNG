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
} from "lucide-react";
import {
  defaultExportSecuritySettings,
  type GlobalSettings,
  type ExportPasswordScore,
  type ExportSecuritySettings,
  type ExportFormat,
} from "../../../../types/settings/settings";
import { NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Default export format
            </label>
            <Select
              value={exportSecurity.defaultFormat}
              onChange={(value: string) =>
                updateExportSecurity({ defaultFormat: value as ExportFormat })
              }
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
              onChange={(value: number) =>
                updateExportSecurity({ keyDerivationIterations: value })
              }
              min={10000}
              max={5000000}
              step={10000}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-[var(--color-border)]">
          <Toggle
            checked={exportSecurity.includeConnectionsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeConnectionsByDefault: v })
            }
            icon={<Network size={16} />}
            label="Include connections by default"
          />
          <Toggle
            checked={exportSecurity.encryptByDefault}
            onChange={(v) => updateExportSecurity({ encryptByDefault: v })}
            icon={<Lock size={16} />}
            label="Encrypt exports by default"
          />
          <Toggle
            checked={exportSecurity.includePasswordsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includePasswordsByDefault: v })
            }
            icon={<KeyRound size={16} />}
            label="Include passwords by default"
          />
          <Toggle
            checked={exportSecurity.includeSettingsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeSettingsByDefault: v })
            }
            icon={<Settings size={16} />}
            label="Include settings by default"
          />
          <Toggle
            checked={exportSecurity.includeFolderItemsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeFolderItemsByDefault: v })
            }
            icon={<FolderTree size={16} />}
            label="Include folders/groups by default"
          />
          <Toggle
            checked={exportSecurity.includeEmptyFoldersByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeEmptyFoldersByDefault: v })
            }
            icon={<FolderOpen size={16} />}
            label="Include empty folders by default"
          />
          <Toggle
            checked={exportSecurity.includeTabGroupsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeTabGroupsByDefault: v })
            }
            icon={<Layers size={16} />}
            label="Include tab groups by default"
          />
          <Toggle
            checked={exportSecurity.includeColorTagsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeColorTagsByDefault: v })
            }
            icon={<Palette size={16} />}
            label="Include color tags by default"
          />
          <Toggle
            checked={exportSecurity.includeVpnDataByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeVpnDataByDefault: v })
            }
            icon={<Shield size={16} />}
            label="Include VPN definitions by default"
          />
          <Toggle
            checked={exportSecurity.includeTunnelChainsByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeTunnelChainsByDefault: v })
            }
            icon={<GitFork size={16} />}
            label="Include tunnel chains by default"
          />
          <Toggle
            checked={exportSecurity.includeExportMetadataByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeExportMetadataByDefault: v })
            }
            icon={<Tag size={16} />}
            label="Include export metadata by default"
          />
          <Toggle
            checked={exportSecurity.includeDatabaseMetadataByDefault}
            onChange={(v) =>
              updateExportSecurity({ includeDatabaseMetadataByDefault: v })
            }
            icon={<Database size={16} />}
            label="Include database metadata by default"
          />
        </div>

        <div className="pt-3 border-t border-[var(--color-border)] space-y-4">
          <h5 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Password strength feedback
          </h5>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
            <Toggle
              checked={exportSecurity.showPasswordStrength}
              onChange={(v) =>
                updateExportSecurity({ showPasswordStrength: v })
              }
              icon={<Activity size={16} />}
              label="Show strength meter in export tab"
            />
            <Toggle
              checked={exportSecurity.showEntropyBits}
              onChange={(v) => updateExportSecurity({ showEntropyBits: v })}
              icon={<Hash size={16} />}
              label="Show estimated entropy bits"
            />
            <Toggle
              checked={exportSecurity.enforceMinimumPasswordScore}
              onChange={(v) =>
                updateExportSecurity({ enforceMinimumPasswordScore: v })
              }
              icon={<ShieldCheck size={16} />}
              label="Block export below minimum score"
            />
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Minimum password score
              </label>
              <Select
                value={exportSecurity.minimumPasswordScore}
                onChange={(value: string) =>
                  updateExportSecurity({
                    minimumPasswordScore: Number(value) as ExportPasswordScore,
                  })
                }
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
            <Toggle
              checked={exportSecurity.detectCommonPasswords}
              onChange={(v) =>
                updateExportSecurity({ detectCommonPasswords: v })
              }
              icon={<KeyRound size={16} />}
              label="Detect common passwords"
            />
            <Toggle
              checked={exportSecurity.detectRepeatedCharacters}
              onChange={(v) =>
                updateExportSecurity({ detectRepeatedCharacters: v })
              }
              icon={<Repeat size={16} />}
              label="Detect repeated characters"
            />
            <Toggle
              checked={exportSecurity.detectSequentialPatterns}
              onChange={(v) =>
                updateExportSecurity({ detectSequentialPatterns: v })
              }
              icon={<TrendingUp size={16} />}
              label="Detect keyboard and numeric sequences"
            />
            <Toggle
              checked={exportSecurity.rewardUncommonSymbols}
              onChange={(v) =>
                updateExportSecurity({ rewardUncommonSymbols: v })
              }
              icon={<Sparkles size={16} />}
              label="Reward uncommon symbols"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Additional common passwords
            </label>
            <textarea
              value={exportSecurity.customCommonPasswords}
              onChange={(event) =>
                updateExportSecurity({
                  customCommonPasswords: event.target.value,
                })
              }
              className="sor-settings-input min-h-20 w-full resize-y"
              placeholder="One password per line, or comma-separated"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ExportSecuritySection;
