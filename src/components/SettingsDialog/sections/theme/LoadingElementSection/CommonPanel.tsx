import React from 'react';
import {
  Palette,
  Droplets,
  Maximize2,
  Sparkles,
  Layers,
  Accessibility,
  EyeOff,
  Minimize2,
} from 'lucide-react';
import {
  Card,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
  SettingsColorRow,
} from '../../../../ui/settings/SettingsPrimitives';
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
    <Card>
      <Toggle
        icon={<Palette size={16} />}
        label="Follow accent color"
        description="Use the active theme accent color for this loader"
        checked={le.followsAccentColor}
        onChange={(v) => setCommon({ followsAccentColor: v })}
        infoTooltip="When on, the loader inherits the active theme accent color and ignores the custom color below."
      />

      <div
        className={
          le.followsAccentColor ? 'opacity-50 pointer-events-none' : undefined
        }
      >
        <SettingsColorRow
          icon={<Droplets size={16} />}
          label="Custom color"
          value={le.customColor || '#00f0ff'}
          fallbackValue="#00f0ff"
          onChange={(v) => setCommon({ customColor: v })}
          infoTooltip="Color used when 'Follow accent color' is off."
        />
      </div>

      <SettingsSliderRow
        icon={<Maximize2 size={16} />}
        label="Size scale"
        value={le.sizeScale ?? 1}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => setCommon({ sizeScale: v })}
        infoTooltip="Global multiplier applied on top of the size each call site requests. 1 = no change, 0.5 = half, 2 = double."
      />

      <SettingsSliderRow
        icon={<Sparkles size={16} />}
        label="Glow intensity"
        value={le.glowIntensity ?? 1}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => setCommon({ glowIntensity: v })}
        infoTooltip="Global drop-shadow halo applied on top of the variant's own glow. 0 disables the extra glow entirely; 3 is heavy bloom."
      />

      <SettingsColorRow
        icon={<Droplets size={16} />}
        label="Glow color"
        value={le.glowColor || ''}
        fallbackValue={le.customColor || '#00f0ff'}
        chipLabel={le.glowColor || '(loader)'}
        onChange={(v) => setCommon({ glowColor: v })}
        infoTooltip="Color of the drop-shadow halo. Use 'Match loader' to follow the loader color instead."
        trailing={
          <button
            type="button"
            onClick={() => setCommon({ glowColor: '' })}
            className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-[var(--color-textSecondary)]"
            title="Clear — let glow follow the loader color"
          >
            Match loader
          </button>
        }
      />

      <SettingsSelectRow
        icon={<Layers size={16} />}
        label="Render mode"
        value={le.renderMode}
        options={RENDER_MODE_OPTIONS}
        onChange={(v) => setCommon({ renderMode: v as RenderMode })}
        infoTooltip="Force DOM or canvas rendering, or let the loader pick automatically based on size and complexity."
      />

      <SettingsSelectRow
        icon={<Accessibility size={16} />}
        label="Reduced motion"
        value={le.reducedMotionMode}
        options={REDUCED_MOTION_OPTIONS}
        onChange={(v) =>
          setCommon({ reducedMotionMode: v as ReducedMotionMode })
        }
        infoTooltip="How loaders behave when reduced motion is active — Auto follows the OS preference, Static freezes a single frame, Pause stops the animation entirely."
      />

      <Toggle
        icon={<EyeOff size={16} />}
        label="Pause when off-screen"
        description="Suspend animation when the loader is scrolled out of view"
        checked={le.pauseWhenOffScreen}
        onChange={(v) => setCommon({ pauseWhenOffScreen: v })}
        infoTooltip="Save CPU/GPU by suspending the loader animation while it isn't visible in the viewport."
      />

      <Toggle
        icon={<Minimize2 size={16} />}
        label="Pause when window is hidden"
        description="Suspend animation when the application window is minimized or hidden"
        checked={le.pauseWhenWindowHidden}
        onChange={(v) => setCommon({ pauseWhenWindowHidden: v })}
        infoTooltip="Save CPU/GPU by suspending the loader animation while the application window is minimized or otherwise hidden."
      />
    </Card>
  );
};

export default CommonPanel;
