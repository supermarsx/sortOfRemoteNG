import { Shield, Lock, Info, ShieldCheck } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsPasswordRow,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function EncryptionSection({ mgr }: { mgr: Mgr }) {
  const enabled = Boolean(mgr.cloudSync.encryptBeforeSync);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title="Encryption"
      />

      <Card>
        <Toggle
          icon={<ShieldCheck size={16} />}
          label="Encrypt Before Sync"
          description="End-to-end encrypt data before uploading to cloud"
          checked={enabled}
          onChange={(v) => mgr.updateCloudSync({ encryptBeforeSync: v })}
          infoTooltip="When enabled, payloads are encrypted locally before being sent to the provider. The provider never sees plaintext."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            enabled ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsPasswordRow
            icon={<Lock size={16} />}
            label="Encryption password"
            value={mgr.cloudSync.syncEncryptionPassword || ""}
            onChange={(v) =>
              mgr.updateCloudSync({ syncEncryptionPassword: v })
            }
            placeholder="Enter a strong password"
            disabled={!enabled}
            infoTooltip="The password used to derive the encryption key. The same password is required on every device that participates in the sync."
          />
          <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1 mt-1">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>
              This password is required on all devices to decrypt synced data.
            </span>
          </p>
        </div>
      </Card>
    </div>
  );
}

export default EncryptionSection;
