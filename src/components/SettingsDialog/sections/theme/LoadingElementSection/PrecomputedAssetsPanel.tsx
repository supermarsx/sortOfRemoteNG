import React from 'react';
import {
  Trash2,
  RotateCw,
  Sparkles,
  Maximize2,
  Gauge,
  Timer,
  Layers,
} from 'lucide-react';
import {
  Card,
  SettingsSelectRow,
  SettingsNumberRow,
} from '../../../../ui/settings/SettingsPrimitives';
import {
  ALL_LOADING_ELEMENT_TYPES,
  type FallbackMode,
} from '../../../../ui/display/loadingElement/types';
import { REGISTRY } from '../../../../ui/display/loadingElement/registry';
import { hashConfig } from '../../../../ui/display/loadingElement/runtime/configHash';
import type { UseLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';
import { useLoadingElementAssets } from '../../../../../hooks/settings/useLoadingElementAssets';

interface Props {
  mgr: UseLoadingElementSettings;
}

const SIZE_OPTIONS = [
  { value: '48', label: '48 px' },
  { value: '64', label: '64 px' },
  { value: '96', label: '96 px' },
  { value: '128', label: '128 px' },
  { value: '192', label: '192 px' },
];

const FRAME_RATE_OPTIONS = [
  { value: '24', label: '24 fps' },
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps' },
];

const MODE_OPTIONS: { value: FallbackMode; label: string; help: string }[] = [
  {
    value: 'never',
    label: 'Never',
    help: 'Always render the live loader.',
  },
  {
    value: 'whenUnavailable',
    label: 'When unavailable',
    help: 'Use precomputed assets only when the live loader cannot render.',
  },
  {
    value: 'always',
    label: 'Always',
    help: 'Always serve the precomputed asset (no live animation).',
  },
];

function formatKB(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const PrecomputedAssetsPanel: React.FC<Props> = ({ mgr }) => {
  const { le, setPrecomputed } = mgr;
  const assets = useLoadingElementAssets();

  const currentModeHelp =
    MODE_OPTIONS.find((m) => m.value === le.precomputed.mode)?.help ?? '';

  return (
    <Card>
      <div>
        <h5 className="text-sm font-medium text-[var(--color-text)]">
          Fallback assets (animated WebP)
        </h5>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Pre-render loaders to animated WebP for low-power scenarios or static
          fallback.
        </p>
      </div>

      <SettingsSelectRow
        icon={<Maximize2 size={16} />}
        label="Output size"
        value={String(le.precomputed.outputSizePx)}
        options={SIZE_OPTIONS}
        onChange={(v) =>
          setPrecomputed({
            outputSizePx: Number(v) as 48 | 64 | 96 | 128 | 192,
          })
        }
        infoTooltip="Pixel dimensions of the generated assets. Larger sizes look sharper but the files grow accordingly."
      />

      <SettingsSelectRow
        icon={<Gauge size={16} />}
        label="Frame rate"
        value={String(le.precomputed.frameRate)}
        options={FRAME_RATE_OPTIONS}
        onChange={(v) =>
          setPrecomputed({ frameRate: Number(v) as 24 | 30 | 60 })
        }
        infoTooltip="Frames per second baked into each asset. Higher rates animate more smoothly at the cost of file size."
      />

      <SettingsNumberRow
        icon={<Timer size={16} />}
        label="Duration"
        value={le.precomputed.durationSeconds}
        min={0.5}
        max={6}
        step={0.5}
        unit="s"
        onChange={(v) => setPrecomputed({ durationSeconds: v })}
        infoTooltip="Loop length, in seconds. Longer loops capture more animation but increase the asset size."
      />

      <SettingsSelectRow
        icon={<Layers size={16} />}
        label="Fallback mode"
        description={currentModeHelp}
        value={le.precomputed.mode}
        options={MODE_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
        onChange={(v) => setPrecomputed({ mode: v as FallbackMode })}
        infoTooltip="When precomputed assets should be used instead of the live loader."
      />

      <div className="flex flex-wrap gap-2 pt-3 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => assets?.generateAll()}
          disabled={!assets}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)] disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" /> Generate all
        </button>
        <button
          type="button"
          onClick={() => assets?.generateMissing()}
          disabled={!assets}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)] disabled:opacity-50"
        >
          <RotateCw className="w-3.5 h-3.5" /> Generate missing
        </button>
        <button
          type="button"
          onClick={() => assets?.clearAll()}
          disabled={!assets}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)] disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear all
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-surface)]/60 text-[var(--color-textSecondary)]">
            <tr>
              <th className="text-left px-2 py-1.5">Variant</th>
              <th className="text-left px-2 py-1.5">Status</th>
              <th className="text-left px-2 py-1.5">Size</th>
              <th className="text-right px-2 py-1.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {ALL_LOADING_ELEMENT_TYPES.map((type) => {
              const entry = le.precomputed.assets[type];
              const currentHash = hashConfig(le.perType[type]);
              const supported = REGISTRY[type].supportsCanvas;
              let status: '✓ ready' | '⚠ stale' | '— none' | 'unsupported' =
                '— none';
              if (!supported) status = 'unsupported';
              else if (entry)
                status = entry.configHash === currentHash ? '✓ ready' : '⚠ stale';
              const inFlight = assets?.inFlight?.has?.(type) ?? false;
              return (
                <tr key={type} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1.5 text-[var(--color-text)]">
                    {REGISTRY[type].label}
                  </td>
                  <td className="px-2 py-1.5">
                    {inFlight ? (
                      <span className="text-[var(--color-textMuted)]">
                        …generating
                      </span>
                    ) : status === 'unsupported' ? (
                      <span
                        className="text-[var(--color-textMuted)] italic"
                        title="Pure CSS variants can't currently be precomputed."
                      >
                        not supported
                      </span>
                    ) : (
                      <span
                        className={
                          status === '✓ ready'
                            ? 'text-emerald-400'
                            : status === '⚠ stale'
                              ? 'text-amber-400'
                              : 'text-[var(--color-textMuted)]'
                        }
                      >
                        {status}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--color-textSecondary)]">
                    {formatKB(entry?.bytes)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        title={
                          supported
                            ? 'Regenerate'
                            : 'This variant is pure CSS — precompute is not currently supported.'
                        }
                        onClick={() => assets?.generate(type)}
                        disabled={!assets || inFlight || !supported}
                        className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)] disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => assets?.clear(type)}
                        disabled={!assets || !entry || inFlight}
                        className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)] disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default PrecomputedAssetsPanel;

// `LoadingElementType` re-exported for parent panels that referenced this
// file's type imports (none currently — kept implicit via direct imports).
export type { LoadingElementType } from '../../../../ui/display/loadingElement/types';
