import React from 'react';
import { Checkbox, Select } from '../../../../ui/forms';
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
