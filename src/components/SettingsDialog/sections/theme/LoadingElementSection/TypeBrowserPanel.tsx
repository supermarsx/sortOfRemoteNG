import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import { Select } from '../../../../ui/forms';
import { LoadingElement } from '../../../../ui/display/loadingElement/LoadingElement';
import { REGISTRY } from '../../../../ui/display/loadingElement/registry';
import {
  ALL_LOADING_ELEMENT_TYPES,
  type LoadingElementType,
} from '../../../../ui/display/loadingElement/types';
import type { UseLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';

interface Props {
  mgr: UseLoadingElementSettings;
}

export const TypeBrowserPanel: React.FC<Props> = ({ mgr }) => {
  const { le, currentDescriptor, setDefaultType, applyPreset, resetCurrentToDefault } = mgr;
  // Preview animation toggle. Defaults to playing — the whole point of a
  // live preview is to show motion. The button lets the user freeze a frame
  // for inspection, then resume.
  const [previewPaused, setPreviewPaused] = useState(false);

  const typeOptions = useMemo(
    () =>
      ALL_LOADING_ELEMENT_TYPES.map((t) => ({
        value: t,
        label: REGISTRY[t].label,
      })),
    [],
  );

  const presetOptions = useMemo(
    () => [
      { value: '__custom__', label: 'Custom (current)' },
      ...currentDescriptor.presets.map((p) => ({ value: p.id, label: p.label })),
    ],
    [currentDescriptor],
  );

  // Detect which preset, if any, the active config currently matches.
  // Drives the Select's displayed value so the dropdown actually reflects
  // the user's choice instead of always snapping back to the placeholder.
  const activePresetId = useMemo(() => {
    const cfg = le.perType[le.defaultType] as unknown as Record<string, unknown>;
    for (const p of currentDescriptor.presets) {
      const seed = currentDescriptor.defaultConfig as unknown as Record<string, unknown>;
      const merged = { ...seed, ...(p.config as Record<string, unknown>) };
      let match = true;
      for (const k of Object.keys(merged)) {
        if (cfg[k] !== merged[k]) { match = false; break; }
      }
      if (match) return p.id;
    }
    return '__custom__';
  }, [le.perType, le.defaultType, currentDescriptor]);

  const goPrev = () => {
    const i = ALL_LOADING_ELEMENT_TYPES.indexOf(le.defaultType);
    const next = ALL_LOADING_ELEMENT_TYPES[(i - 1 + ALL_LOADING_ELEMENT_TYPES.length) % ALL_LOADING_ELEMENT_TYPES.length];
    setDefaultType(next);
  };
  const goNext = () => {
    const i = ALL_LOADING_ELEMENT_TYPES.indexOf(le.defaultType);
    const next = ALL_LOADING_ELEMENT_TYPES[(i + 1) % ALL_LOADING_ELEMENT_TYPES.length];
    setDefaultType(next);
  };

  return (
    <div className="sor-settings-card">
      <div className="space-y-2">
        <label className="text-sm text-[var(--color-textSecondary)]">Loader type</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
            aria-label="Previous loader"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <Select
            value={le.defaultType}
            onChange={(v: string) => setDefaultType(v as LoadingElementType)}
            options={typeOptions}
            className="sor-settings-select flex-1"
          />
          <button
            type="button"
            onClick={goNext}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
            aria-label="Next loader"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-[var(--color-textMuted)]">{currentDescriptor.description}</p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div
          className="flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40"
          style={{ width: 160, height: 160 }}
        >
          <LoadingElement
            type={le.defaultType}
            config={le.perType[le.defaultType]}
            color={le.followsAccentColor ? undefined : le.customColor}
            size={140}
            paused={previewPaused}
          />
        </div>
        <button
          type="button"
          onClick={() => setPreviewPaused((p) => !p)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
          aria-label={previewPaused ? 'Play preview' : 'Pause preview'}
        >
          {previewPaused ? (
            <>
              <Play className="w-3 h-3" />
              Play
            </>
          ) : (
            <>
              <Pause className="w-3 h-3" />
              Pause
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Preset
          </label>
          <Select
            value={activePresetId}
            onChange={(v: string) => {
              if (v && v !== '__custom__') applyPreset(v);
            }}
            options={presetOptions}
            className="sor-settings-select w-full"
          />
        </div>
        <button
          type="button"
          onClick={resetCurrentToDefault}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to default
        </button>
      </div>
    </div>
  );
};

export default TypeBrowserPanel;
