import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import {
  loadSafeModeStatus,
  simulateUncleanExits,
  updateSafeModeConfig,
  type SafeModeStatus,
} from "../../../../utils/safeMode/safeModeState";

/** Backend-owned safe mode options (threshold, one-shot next start, test aid). */
const SafeModeSection: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SafeModeStatus | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    void loadSafeModeStatus().then(setStatus);
  }, []);

  if (!isTauri() || !status) return null;

  const apply = async (config: Parameters<typeof updateSafeModeConfig>[0]) => {
    try {
      setStatus(await updateSafeModeConfig(config));
    } catch {
      // The backend keeps the previous value.
    }
  };

  return (
    <div className="space-y-3" data-testid="safe-mode-settings">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert className="w-4 h-4 text-primary" />
        {t("safeMode.settingsTitle")}
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          {t("safeMode.thresholdLabel")}
          <span className="block text-[10px] text-[var(--color-textMuted)]">
            {t("safeMode.thresholdHelp")}
          </span>
        </span>
        <input
          type="number"
          min={0}
          max={1000}
          className="w-20 rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
          value={status.threshold}
          onChange={(e) => {
            const value = Math.max(0, Math.floor(Number(e.target.value) || 0));
            void apply({ threshold: value });
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          {t("safeMode.startNextTime")}
          <span className="block text-[10px] text-[var(--color-textMuted)]">
            {t("safeMode.startNextTimeHelp")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={status.startNextTime}
          onChange={(e) => void apply({ startNextTime: e.target.checked })}
        />
      </label>
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surfaceHover)]"
          onClick={async () => {
            try {
              setStatus(await simulateUncleanExits());
              setNote(t("safeMode.simulateDone"));
            } catch {
              // Nothing to simulate without tracking.
            }
          }}
        >
          {t("safeMode.simulate")}
        </button>
        {note && (
          <span className="text-[10px] text-[var(--color-textMuted)]">
            {note}
          </span>
        )}
      </div>
    </div>
  );
};

export default SafeModeSection;
