import { GlobalSettings } from "../../../../types/settings";
import { Key, Timer, Gauge, Loader2 } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";
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
      <h4 className="sor-section-heading">
        <Key className="w-4 h-4 text-purple-400" />
        Key Derivation (PBKDF2)
      </h4>

      <div className="sor-settings-card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Gauge className="w-4 h-4" />
              {t("security.iterations")}
            </label>
            <div className="flex space-x-2">
              <NumberInput value={settings.keyDerivationIterations} onChange={(v: number) => updateSettings({
                    keyDerivationIterations: v,
                  })} className="flex-1" min={10000} max={1000000} />
              <button
                onClick={handleBenchmark}
                disabled={isBenchmarking}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
              >
                {isBenchmarking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Gauge className="w-4 h-4" />
                    <span>Benchmark</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-[var(--color-textMuted)]">
              Higher values = more secure but slower. Benchmark to find optimal
              value.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              {t("security.benchmarkTime")}
            </label>
            <NumberInput value={settings.benchmarkTimeSeconds} onChange={(v: number) => updateSettings({
                  benchmarkTimeSeconds: v,
                })} className="w-full" min={0.5} max={10} step={0.5} />
            <p className="text-xs text-[var(--color-textMuted)]">
              Target time for key derivation during benchmark
            </p>
          </div>
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group pt-2">
          <Checkbox checked={settings.autoBenchmarkIterations} onChange={(v: boolean) => updateSettings({ autoBenchmarkIterations: v })} />
          <Gauge className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-purple-400" />
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
            {t("security.autoBenchmark")}
          </span>
        </label>
      </div>
    </div>
  );
}

export default KeyDerivationSection;
