import React from "react";
import { Zap } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";

const TEXTAREA_CLASS =
  "w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500";

const AdvancedSSHSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.advancedSSH", "Advanced SSH Options")}
    icon={<Zap className="w-4 h-4 text-amber-400" />}
    defaultOpen={false}
  >
    <p className="text-xs text-[var(--color-textSecondary)] mb-4">
      {t(
        "settings.sshTerminal.advancedSSHDesc",
        "Configure preferred encryption ciphers, MACs, key exchanges, and host key algorithms. Items are tried in order of preference.",
      )}
    </p>

    <div className="space-y-4">
      {(
        [
          [
            "preferredCiphers",
            "settings.sshTerminal.preferredCiphers",
            "Preferred Ciphers",
            "One cipher per line",
            4,
          ],
          [
            "preferredMACs",
            "settings.sshTerminal.preferredMACs",
            "Preferred MACs",
            "One MAC per line",
            3,
          ],
          [
            "preferredKeyExchanges",
            "settings.sshTerminal.preferredKEX",
            "Preferred Key Exchanges",
            "One key exchange per line",
            4,
          ],
          [
            "preferredHostKeyAlgorithms",
            "settings.sshTerminal.preferredHostKeys",
            "Preferred Host Key Algorithms",
            "One algorithm per line",
            4,
          ],
        ] as const
      ).map(([field, tKey, fallback, placeholder, rows]) => (
        <div key={field}>
          <label className="text-sm text-[var(--color-textSecondary)] block mb-2">
            {t(tKey, fallback)}
          </label>
          <textarea
            value={(cfg[field] as string[]).join("\n")}
            onChange={(e) =>
              up({
                [field]: e.target.value.split("\n").filter(Boolean),
              })
            }
            rows={rows}
            className={TEXTAREA_CLASS}
            placeholder={placeholder}
          />
        </div>
      ))}
    </div>
  </SettingsCollapsibleSection>
);

export default TEXTAREA_CLASS;
