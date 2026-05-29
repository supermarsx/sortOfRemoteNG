import type { Mgr } from "./types";
import React from "react";
import { Lock, Key, Shield, ShieldCheck } from "lucide-react";
import {
  BackupEncryptionAlgorithms,
  BackupEncryptionAlgorithm,
} from "../../../../types/settings/settings";
import {
  encryptionAlgorithmLabels,
  encryptionAlgorithmDescriptions,
} from "../../../../hooks/settings/useBackupSettings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
  SettingsPasswordRow,
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
          className={`flex flex-col gap-2.5 ${
            enabled ? "" : "opacity-50 pointer-events-none"
          }`}
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

          <SettingsPasswordRow
            icon={<Key size={16} />}
            label="Encryption password"
            value={mgr.backup.encryptionPassword || ""}
            onChange={(v) => mgr.updateBackup({ encryptionPassword: v })}
            placeholder="Enter encryption password…"
            disabled={!enabled}
            infoTooltip="The password used to derive the encryption key. Keep this safe — backups cannot be restored without it."
          />
        </div>
      </Card>
    </div>
  );
};

export default EncryptionSection;
