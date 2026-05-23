import { PasswordInput } from '../../../ui/forms';
import { Shield, Lock, Info } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function EncryptionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title="Encryption"
      />

      <div className="sor-settings-card">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-[var(--color-text)]">
              Encrypt Before Sync
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              End-to-end encrypt data before uploading to cloud
            </p>
          </div>
          <Checkbox checked={mgr.cloudSync.encryptBeforeSync} onChange={(v: boolean) => mgr.updateCloudSync({ encryptBeforeSync: v })} className="sor-checkbox-lg" />
        </label>

        {mgr.cloudSync.encryptBeforeSync && (
          <div className="space-y-2 pl-4 border-l-2 border-primary/30">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              <Lock className="w-4 h-4 inline mr-1" />
              Encryption Password
            </label>
            <PasswordInput
              value={mgr.cloudSync.syncEncryptionPassword || ""}
              onChange={(e) =>
                mgr.updateCloudSync({ syncEncryptionPassword: e.target.value })
              }
              placeholder="Enter a strong password"
              className="sor-settings-input"
            />
            <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1">
              <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                This password is required on all devices to decrypt synced data.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default EncryptionSection;
