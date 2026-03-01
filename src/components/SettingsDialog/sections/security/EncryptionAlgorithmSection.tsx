import { GlobalSettings } from "../../../../types/settings";
import { Lock, ShieldCheck } from "lucide-react";
import { ENCRYPTION_ALGORITHMS } from "../../../../hooks/settings/useSecuritySettings";
import { Select } from "../../../ui/forms";
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

  return (
    <div className="space-y-4">
      <h4 className="sor-section-heading">
        <Lock className="w-4 h-4 text-blue-400" />
        {t("security.algorithm")}
      </h4>

      <div className="sor-settings-card space-y-4">
        <div data-setting-key="encryptionAlgorithm" className="flex items-center gap-3">
          <Lock className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <Select value={settings.encryptionAlgorithm} onChange={(v: string) =>
                updateSettings({ encryptionAlgorithm: v as any })} options={[...ENCRYPTION_ALGORITHMS.map((algo) => ({ value: algo.value, label: `${algo.label}
                  ${algo.recommended ? " ★" : ""}` }))]} className="sor-settings-select w-full text-sm" />
          </div>
        </div>

        {selectedAlgo && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]/60 rounded-md text-sm">
            {selectedAlgo.recommended && (
              <span className="px-1.5 py-0.5 text-[10px] bg-green-600/30 text-green-400 rounded">
                Recommended
              </span>
            )}
            <span className="text-[var(--color-textSecondary)]">
              {selectedAlgo.description}
            </span>
          </div>
        )}

        {mgr.validModes.length > 0 && (
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-[var(--color-textSecondary)] whitespace-nowrap">
                Mode:
              </span>
              <Select value={settings.blockCipherMode} onChange={(v: string) =>
                  updateSettings({ blockCipherMode: v as any })} options={[...mgr.validModes.map((mode) => ({ value: mode.value, label: mode.label }))]} className="sor-settings-select flex-1 text-sm" disabled={mgr.validModes.length === 1} />
            </div>
          </div>
        )}

        {settings.encryptionAlgorithm === "ChaCha20-Poly1305" && (
          <div className="sor-diag-card text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            Stream cipher with built-in AEAD (no block mode needed)
          </div>
        )}
      </div>
    </div>
  );
}

export default EncryptionAlgorithmSection;
