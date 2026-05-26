import type { Mgr } from "./types";
import React from "react";
import { PasswordInput } from "../../../ui/forms";
import { Lock, Key, Shield, ShieldCheck } from "lucide-react";
import {
  BackupEncryptionAlgorithms,
  BackupEncryptionAlgorithm,
} from "../../../../types/settings/settings";
import {
  encryptionAlgorithmLabels,
  encryptionAlgorithmDescriptions,
} from "../../../../hooks/settings/useBackupSettings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const algorithmOptions = BackupEncryptionAlgorithms.map((alg) => ({
  value: alg,
  label: encryptionAlgorithmLabels[alg],
}));

const EncryptionSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const enabled = Boolean(mgr.backup.encryptBackups);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Lock className="w-4 h-4 text-primary" />}
        title="Encryption"
      />

      <Card>
        <Toggle
          icon={<ShieldCheck size={16} />}
          label="Encrypt Backups"
          description="Password-protect backup files"
          checked={enabled}
          onChange={(v) => mgr.updateBackup({ encryptBackups: v })}
          infoTooltip="Encrypts backup files with a password so they cannot be read without the correct credentials."
        />

        <div
          className={
            enabled ? undefined : "opacity-50 pointer-events-none"
          }
        >
          <SettingsSelectRow
            icon={<Shield size={16} />}
            label="Encryption Algorithm"
            value={mgr.backup.encryptionAlgorithm}
            options={algorithmOptions}
            onChange={(v) =>
              mgr.updateBackup({
                encryptionAlgorithm: v as BackupEncryptionAlgorithm,
              })
            }
            infoTooltip="The cipher used to encrypt backup files. AES-256-GCM is recommended for strong authenticated encryption."
          />
          <p className="text-xs text-[var(--color-textMuted)] mt-1 mb-2 ml-7">
            {encryptionAlgorithmDescriptions[mgr.backup.encryptionAlgorithm]}
          </p>

          <div className="sor-settings-select-row">
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Key size={16} />
              </span>
              Encryption Password
              <InfoTooltip text="The password used to derive the encryption key. Keep this safe — backups cannot be restored without it." />
            </span>
            <div style={{ width: "18rem" }}>
              <PasswordInput
                value={mgr.backup.encryptionPassword || ""}
                onChange={(e) =>
                  mgr.updateBackup({ encryptionPassword: e.target.value })
                }
                placeholder="Enter encryption password..."
                className="sor-settings-input"
                disabled={!enabled}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default EncryptionSection;
