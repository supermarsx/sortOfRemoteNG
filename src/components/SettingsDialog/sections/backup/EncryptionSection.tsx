import type { Mgr } from './types';
import React from "react";
import { PasswordInput } from '../../../ui/forms';
import { Lock, Key, Shield } from "lucide-react";
import { BackupEncryptionAlgorithms, BackupEncryptionAlgorithm } from "../../../../types/settings/settings";
import { encryptionAlgorithmLabels, encryptionAlgorithmDescriptions } from "../../../../hooks/settings/useBackupSettings";
import { Checkbox, Select } from "../../../ui/forms";

const EncryptionSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Lock className="w-4 h-4 text-warning" />
      Encryption
    </h4>

    <div className="sor-settings-sub-card">
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <span className="text-[var(--color-text)]">Encrypt Backups</span>
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            Password-protect backup files
          </p>
        </div>
        <Checkbox checked={mgr.backup.encryptBackups} onChange={(v: boolean) => mgr.updateBackup({ encryptBackups: v })} className="sor-checkbox-lg" />
      </label>

      {mgr.backup.encryptBackups && (
        <div className="space-y-4 pl-4 border-l-2 border-warning/30">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              <Shield className="w-4 h-4 inline mr-2" />
              Encryption Algorithm
            </label>
            <Select value={mgr.backup.encryptionAlgorithm} onChange={(v: string) =>
                mgr.updateBackup({
                  encryptionAlgorithm:
                    v as BackupEncryptionAlgorithm,
                })} options={[...BackupEncryptionAlgorithms.map((alg) => ({ value: alg, label: encryptionAlgorithmLabels[alg] }))]} className="sor-settings-input" />
            <p className="text-xs text-[var(--color-textMuted)]">
              {
                encryptionAlgorithmDescriptions[
                  mgr.backup.encryptionAlgorithm
                ]
              }
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              <Key className="w-4 h-4 inline mr-2" />
              Encryption Password
            </label>
            <PasswordInput
              value={mgr.backup.encryptionPassword || ""}
              onChange={(e) =>
                mgr.updateBackup({ encryptionPassword: e.target.value })
              }
              placeholder="Enter encryption password..."
              className="sor-settings-input"
            />
          </div>
        </div>
      )}
    </div>
  </div>
);

export default EncryptionSection;
