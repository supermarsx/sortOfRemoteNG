import React from 'react';
import { Checkbox, NumberInput, Select, Slider } from '../../../../ui/forms';
import { InfoTooltip } from '../../../../ui/InfoTooltip';
import type {
  ReducedMotionMode,
  RenderMode,
} from '../../../../ui/display/loadingElement/types';
import type { UseLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';

interface Props {
  mgr: UseLoadingElementSettings;
}

const RENDER_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'dom', label: 'DOM' },
  { value: 'canvas', label: 'Canvas' },
];

const REDUCED_MOTION_OPTIONS = [
  { value: 'auto', label: 'Auto (follow OS)' },
  { value: 'static', label: 'Static frame' },
  { value: 'pause', label: 'Pause animation' },
];

export const CommonPanel: React.FC<Props> = ({ mgr }) => {
  const { le, setCommon } = mgr;

  return (
    <div className="sor-settings-card">
      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox
          checked={le.followsAccentColor}
          onChange={(v: boolean) => setCommon({ followsAccentColor: v })}
        />
        <span className="text-sm text-[var(--color-textSecondary)]">
          Follow accent color{' '}
          <InfoTooltip text="Use the active theme accent color for this loader" />
        </span>
      </label>

      <div
        className={`flex items-center gap-3 ${le.followsAccentColor ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <label className="text-xs text-[var(--color-textSecondary)] w-32">
          Custom color <InfoTooltip text="Color used when not following the accent" />
        </label>
        <input
          type="color"
          value={le.customColor || '#00f0ff'}
          onChange={(e) => setCommon({ customColor: e.target.value })}
          className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
        />
        <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded">
          {le.customColor}
        </span>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--color-textSecondary)]">
          Size scale{' '}
          <InfoTooltip text="Global multiplier applied on top of the size each call site requests. 1 = no change, 0.5 = half, 2 = double." />
        </label>
        <div className="flex items-center gap-3">
          <Slider
            value={le.sizeScale ?? 1}
            onChange={(v: number) => setCommon({ sizeScale: v })}
            min={0.5}
            max={2}
            step={0.05}
            variant="full"
            className="flex-1"
          />
          <NumberInput
            value={Number((le.sizeScale ?? 1).toFixed(2))}
            onChange={(v: number) => setCommon({ sizeScale: v })}
            min={0.25}
            max={3}
            step={0.05}
            className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-xs"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--color-textSecondary)]">
          Glow intensity{' '}
          <InfoTooltip text="Global drop-shadow halo applied on top of the variant's own glow. 0 disables the extra glow entirely; 3 is heavy bloom." />
        </label>
        <div className="flex items-center gap-3">
          <Slider
            value={le.glowIntensity ?? 1}
            onChange={(v: number) => setCommon({ glowIntensity: v })}
            min={0}
            max={3}
            step={0.05}
            variant="full"
            className="flex-1"
          />
          <NumberInput
            value={Number((le.glowIntensity ?? 1).toFixed(2))}
            onChange={(v: number) => setCommon({ glowIntensity: v })}
            min={0}
            max={3}
            step={0.05}
            className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-xs"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--color-textSecondary)] w-32">
          Glow color{' '}
          <InfoTooltip text="Color of the drop-shadow halo. Empty = follow the loader color." />
        </label>
        <input
          type="color"
          value={le.glowColor && le.glowColor.startsWith('#') ? le.glowColor : (le.customColor || '#00f0ff')}
          onChange={(e) => setCommon({ glowColor: e.target.value })}
          className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
        />
        <button
          type="button"
          onClick={() => setCommon({ glowColor: '' })}
          className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
          title="Clear — let glow follow the loader color"
        >
          Match loader
        </button>
        <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded">
          {le.glowColor || '(loader)'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)]">
            Render mode <InfoTooltip text="Force DOM/canvas rendering, or let the loader pick automatically" />
          </label>
          <Select
            value={le.renderMode}
            onChange={(v: string) => setCommon({ renderMode: v as RenderMode })}
            options={RENDER_MODE_OPTIONS}
            className="sor-settings-select w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)]">
            Reduced motion <InfoTooltip text="How loaders behave when reduced motion is active" />
          </label>
          <Select
            value={le.reducedMotionMode}
            onChange={(v: string) => setCommon({ reducedMotionMode: v as ReducedMotionMode })}
            options={REDUCED_MOTION_OPTIONS}
            className="sor-settings-select w-full"
          />
        </div>
      </div>

      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox
          checked={le.pauseWhenOffScreen}
          onChange={(v: boolean) => setCommon({ pauseWhenOffScreen: v })}
        />
        <span className="text-sm text-[var(--color-textSecondary)]">
          Pause when off-screen{' '}
          <InfoTooltip text="Suspend animation when the loader is scrolled out of view" />
        </span>
      </label>

      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox
          checked={le.pauseWhenWindowHidden}
          onChange={(v: boolean) => setCommon({ pauseWhenWindowHidden: v })}
        />
        <span className="text-sm text-[var(--color-textSecondary)]">
          Pause when window is hidden{' '}
          <InfoTooltip text="Suspend animation when the application window is minimized or hidden" />
        </span>
      </label>
    </div>
  );
};

export default CommonPanel;
