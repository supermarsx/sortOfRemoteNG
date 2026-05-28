import { GlobalSettings } from "../../../../types/settings/settings";
import { Lock, ShieldCheck } from "lucide-react";
import { ENCRYPTION_ALGORITHMS } from "../../../../hooks/settings/useSecuritySettings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr, TFunc } from "./types";

function EncryptionAlgorithmSection({
  settings,
  updateSettings,
  mgr,
  t,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  mgr: Mgr;
  t: TFunc;
}) {
  const selectedAlgo = ENCRYPTION_ALGORITHMS.find(
    (a) => a.value === settings.encryptionAlgorithm,
  );

  // Build the algorithm description with the recommended ★ + algorithm
  // notes so it lives inline as the row's description (one-per-line style).
  const algoDescription = selectedAlgo
    ? `${selectedAlgo.recommended ? "★ Recommended — " : ""}${selectedAlgo.description}`
    : undefined;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Lock className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            {t("security.algorithm")}{" "}
            <InfoTooltip text="Choose the symmetric encryption algorithm used to protect stored credentials and connection files." />
          </span>
        }
      />

      <Card>
        <SettingsSelectRow
          settingKey="encryptionAlgorithm"
          icon={<Lock size={16} />}
          label="Algorithm"
          description={algoDescription}
          value={settings.encryptionAlgorithm}
          options={ENCRYPTION_ALGORITHMS.map((algo) => ({
            value: algo.value,
            label: `${algo.label}${algo.recommended ? " ★" : ""}`,
          }))}
          onChange={(v) =>
            updateSettings({
              encryptionAlgorithm:
                v as GlobalSettings["encryptionAlgorithm"],
            })
          }
          infoTooltip="The symmetric cipher used to encrypt your stored credentials and connection files. AES-256-GCM is widely supported; ChaCha20-Poly1305 is the modern alternative."
        />

        {mgr.validModes.length > 0 && (
          <SettingsSelectRow
            settingKey="blockCipherMode"
            icon={<ShieldCheck size={16} />}
            label="Cipher mode"
            value={settings.blockCipherMode}
            options={mgr.validModes.map((mode) => ({
              value: mode.value,
              label: mode.label,
            }))}
            onChange={(v) =>
              updateSettings({
                blockCipherMode:
                  v as GlobalSettings["blockCipherMode"],
              })
            }
            infoTooltip="Block cipher mode of operation — determines how plaintext blocks are chained together during encryption."
          />
        )}

        {settings.encryptionAlgorithm === "ChaCha20-Poly1305" && (
          <p className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
            <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0" />
            Stream cipher with built-in AEAD — no block mode required.
          </p>
        )}
      </Card>
    </div>
  );
}

export default EncryptionAlgorithmSection;
