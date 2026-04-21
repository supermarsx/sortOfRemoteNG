import type { SectionProps } from "./types";
import Toggle from "./Toggle";
import React from "react";
import { SSHVersions } from "../../../../types/settings/settings";
import { Shield } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { NumberInput, Select, FormField } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const SSHProtocolSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <SettingsCollapsibleSection
    title={t("settings.sshTerminal.sshProtocol", "SSH Protocol Settings")}
    icon={<Shield className="w-4 h-4 text-error" />}
    defaultOpen={false}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label={<span className="flex items-center gap-1">{t("settings.sshTerminal.sshVersion", "SSH Version")} <InfoTooltip text="SSH protocol version to use. Auto will negotiate the best version supported by the server." /></span>}>
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
        label={<span className="flex items-center gap-1">{t(
          "settings.sshTerminal.enableCompression",
          "Enable SSH compression",
        )} <InfoTooltip text="Compress data transmitted over the SSH connection. Reduces bandwidth usage but increases CPU load." /></span>}
        description={t(
          "settings.sshTerminal.enableCompressionDesc",
          "Compress data over the SSH connection (useful for slow links)",
        )}
      />
      {cfg.enableCompression && (
        <div className="mt-3 ml-10">
          <FormField label={<span className="flex items-center gap-1">{t(
              "settings.sshTerminal.compressionLevel",
              "Compression Level (1-9)",
            )} <InfoTooltip text="Compression strength from 1 (fastest, least compression) to 9 (slowest, best compression)." /></span>}>
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
