import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { SSHVersions } from "../../../../types/settings/settings";
import { Shield } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select, FormField } from "../../../ui/forms";

const SSHProtocolSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.sshProtocol", "SSH Protocol Settings")}
    icon={<Shield className="w-4 h-4 text-error" />}
    defaultOpen={false}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label={t("settings.sshTerminal.sshVersion", "SSH Version")}>
        <Select
          value={cfg.sshVersion}
          onChange={(v) =>
            up({ sshVersion: v as typeof cfg.sshVersion })
          }
          options={SSHVersions.map((v) => ({
            value: v,
            label: v === "auto" ? "Auto (negotiate)" : `SSH-${v}`,
          }))}
        />
      </FormField>
    </div>

    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <Toggle
        checked={cfg.enableCompression}
        onChange={(v) => up({ enableCompression: v })}
        label={t(
          "settings.sshTerminal.enableCompression",
          "Enable SSH compression",
        )}
        description={t(
          "settings.sshTerminal.enableCompressionDesc",
          "Compress data over the SSH connection (useful for slow links)",
        )}
      />
      {cfg.enableCompression && (
        <div className="mt-3 ml-10">
          <FormField label={t(
              "settings.sshTerminal.compressionLevel",
              "Compression Level (1-9)",
            )}>
            <NumberInput
              value={cfg.compressionLevel}
              onChange={(v) => up({ compressionLevel: v })}
              min={1}
              max={9}
            />
          </FormField>
        </div>
      )}
    </div>
  </SettingsCollapsibleSection>
);

export default SSHProtocolSection;
