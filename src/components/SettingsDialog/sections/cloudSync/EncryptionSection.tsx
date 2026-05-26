import { PasswordInput } from "../../../ui/forms";
import { Shield, Lock, Info, ShieldCheck } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
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
          className={
            enabled ? undefined : "opacity-50 pointer-events-none"
          }
        >
          <div className="sor-settings-select-row">
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Lock size={16} />
              </span>
              Encryption Password
              <InfoTooltip text="The password used to derive the encryption key. The same password is required on every device that participates in the sync." />
            </span>
            <div style={{ width: "18rem" }}>
              <PasswordInput
                value={mgr.cloudSync.syncEncryptionPassword || ""}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    syncEncryptionPassword: e.target.value,
                  })
                }
                placeholder="Enter a strong password"
                className="sor-settings-input"
                disabled={!enabled}
              />
            </div>
          </div>
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
