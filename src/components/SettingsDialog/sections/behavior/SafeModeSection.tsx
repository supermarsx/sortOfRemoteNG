import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import {
  Card,
  NumberRow,
  SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
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
    <div className="space-y-4" data-testid="safe-mode-settings">
      <SectionHeader
        icon={<ShieldAlert className="w-4 h-4 text-primary" />}
        title={t("safeMode.settingsTitle")}
      />
      <Card>
        <NumberRow
          label={t("safeMode.thresholdLabel")}
          description={t("safeMode.thresholdHelp")}
          value={status.threshold}
          min={0}
          max={1000}
          onChange={(v) =>
            void apply({ threshold: Math.max(0, Math.floor(v || 0)) })
          }
        />
        <Toggle
          checked={status.startNextTime}
          onChange={(v) => void apply({ startNextTime: v })}
          icon={<RotateCcw size={16} />}
          label={t("safeMode.startNextTime")}
          description={t("safeMode.startNextTimeHelp")}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="sor-btn sor-btn-secondary sor-btn-sm"
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
            <span className="text-xs text-[var(--color-textSecondary)]">
              {note}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
};

export default SafeModeSection;
