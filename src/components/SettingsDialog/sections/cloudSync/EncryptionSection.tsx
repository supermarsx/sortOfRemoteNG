import { PasswordInput } from "../../../ui/forms/PasswordInput";
import { Shield, Lock, Info } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import type { Mgr } from "./types";
function EncryptionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
      <label className="flex items-center justify-between cursor-pointer">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <span className="text-[var(--color-text)] font-medium">
              Encrypt Before Sync
            </span>
            <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
              End-to-end encrypt data before uploading to cloud
            </p>
          </div>
        </div>
        <Checkbox checked={mgr.cloudSync.encryptBeforeSync} onChange={(v: boolean) => mgr.updateCloudSync({ encryptBeforeSync: v })} className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
      </label>

      {mgr.cloudSync.encryptBeforeSync && (
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
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
          <p className="text-xs text-[var(--color-textSecondary)] mt-1">
            <Info className="w-3 h-3 inline mr-1" />
            This password is required on all devices to decrypt synced data
          </p>
        </div>
      )}
    </div>
  );
}

export default EncryptionSection;
