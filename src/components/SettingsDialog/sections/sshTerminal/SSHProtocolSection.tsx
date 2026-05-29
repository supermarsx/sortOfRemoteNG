import type { SectionProps } from "./types";
import React from "react";
import { SSHVersions } from "../../../../types/settings/settings";
import { Shield, GitBranch, Archive, Gauge } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";

const SSHProtocolSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Shield className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.sshProtocol", "SSH Protocol Settings")}
    />
    <Card>
      <SettingsSelectRow
        settingKey="sshVersion"
        icon={<GitBranch size={16} />}
        label={t("settings.sshTerminal.sshVersion", "SSH version")}
        value={cfg.sshVersion}
        onChange={(v) => up({ sshVersion: v as typeof cfg.sshVersion })}
        options={SSHVersions.map((v) => ({
          value: v,
          label:
            v === "auto"
              ? "Auto (negotiate)"
              : v === "1"
                ? "SSH-1 (legacy, insecure)"
                : v === "2"
                  ? "SSH-2 (standard)"
                  : "SSH3 (HTTP/3 over QUIC, experimental)",
        }))}
        infoTooltip="SSH protocol version to use. SSH-2 is the standard. The 'SSH3' option is the experimental HTTP/3-over-QUIC transport (not a real SSH protocol version 3)."
      />

      <Toggle
        checked={cfg.enableCompression}
        onChange={(v) => up({ enableCompression: v })}
        icon={<Archive size={16} />}
        label={t(
          "settings.sshTerminal.enableCompression",
          "Enable SSH compression",
        )}
        description={t(
          "settings.sshTerminal.enableCompressionDesc",
          "Compress data over the SSH connection (useful for slow links)",
        )}
        infoTooltip="Compress data transmitted over the SSH connection. Reduces bandwidth usage but increases CPU load."
      />

      <div
        className={`flex flex-col gap-2.5 ${
          cfg.enableCompression ? "" : "opacity-50 pointer-events-none"
        }`}
      >
        <SettingsNumberRow
          settingKey="compressionLevel"
          icon={<Gauge size={16} />}
          label={t(
            "settings.sshTerminal.compressionLevel",
            "Compression level",
          )}
          value={cfg.compressionLevel}
          min={1}
          max={9}
          onChange={(v) => up({ compressionLevel: v })}
          infoTooltip="Compression strength from 1 (fastest, least compression) to 9 (slowest, best compression)."
        />
      </div>
    </Card>
  </div>
);

export default SSHProtocolSection;
