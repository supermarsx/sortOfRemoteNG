import { GlobalSettings } from "../../../../types/settings/settings";
import { Key, Timer, Gauge, Loader2 } from "lucide-react";
import { NumberInput } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { TFunc } from "./types";

function KeyDerivationSection({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
  t,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Key className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Key Derivation (PBKDF2){" "}
            <InfoTooltip text="PBKDF2 derives encryption keys from your master password — more iterations make brute-force attacks harder but slow down unlock" />
          </span>
        }
      />

      <Card>
        {/* Iterations + Benchmark button — custom row so the Benchmark
            action sits next to the input without breaking the standard
            label/icon layout. */}
        <div
          data-setting-key="keyDerivationIterations"
          className="sor-settings-select-row"
        >
          <div className="min-w-0">
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Gauge size={16} />
              </span>
              {t("security.iterations")}
              <InfoTooltip text="Number of PBKDF2 hashing rounds — higher values increase security but require more time to derive the key." />
            </span>
            <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
              Higher values = more secure but slower. Benchmark to find the
              optimal value for this machine.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NumberInput
              value={settings.keyDerivationIterations}
              onChange={(v: number) =>
                updateSettings({ keyDerivationIterations: v })
              }
              variant="settings-compact"
              className="text-right"
              style={{ width: "7rem" }}
              min={10000}
              max={1000000}
            />
            <button
              onClick={handleBenchmark}
              disabled={isBenchmarking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
            >
              {isBenchmarking ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Testing…</span>
                </>
              ) : (
                <>
                  <Gauge className="w-3.5 h-3.5" />
                  <span>Benchmark</span>
                </>
              )}
            </button>
          </div>
        </div>

        <SettingsNumberRow
          settingKey="benchmarkTimeSeconds"
          icon={<Timer size={16} />}
          label={t("security.benchmarkTime")}
          description="Target duration the benchmark should run when probing this machine."
          value={settings.benchmarkTimeSeconds}
          min={0.5}
          max={10}
          step={0.5}
          unit="s"
          onChange={(v) => updateSettings({ benchmarkTimeSeconds: v })}
          infoTooltip="Target duration in seconds the benchmark should run to determine the optimal iteration count for your hardware."
        />

        <Toggle
          checked={settings.autoBenchmarkIterations}
          onChange={(v) => updateSettings({ autoBenchmarkIterations: v })}
          icon={<Gauge size={16} />}
          label={t("security.autoBenchmark")}
          description="Re-run the iteration benchmark on each launch to keep the count optimal."
          infoTooltip="Automatically re-run the iteration benchmark on startup to keep the count optimal for the current machine."
        />
      </Card>
    </div>
  );
}

export default KeyDerivationSection;
