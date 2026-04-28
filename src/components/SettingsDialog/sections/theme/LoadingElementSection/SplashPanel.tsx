import React, { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Checkbox, Select } from '../../../../ui/forms';
import { InfoTooltip } from '../../../../ui/InfoTooltip';
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

export const SplashPanel: React.FC<Props> = ({ mgr }) => {
  const { le, setSplashType, setSplashUseGlobalDefault } = mgr;
  const [previewPaused, setPreviewPaused] = useState(false);

  const typeOptions = useMemo(
    () =>
      ALL_LOADING_ELEMENT_TYPES.map((t) => ({
        value: t,
        label: REGISTRY[t].label,
      })),
    [],
  );

  const effectiveSplashType: LoadingElementType = le.splash.useGlobalDefault
    ? le.defaultType
    : le.splash.type;

  return (
    <div className="sor-settings-card">
      <h5 className="text-sm font-medium text-[var(--color-text)]">Splash screen</h5>
      <p className="text-xs text-[var(--color-textMuted)]">
        The progress bar is preserved.
      </p>

      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox
          checked={le.splash.useGlobalDefault}
          onChange={(v: boolean) => setSplashUseGlobalDefault(v)}
        />
        <span className="text-sm text-[var(--color-textSecondary)]">
          Use the global loader default{' '}
          <InfoTooltip text="When enabled, the splash uses your default loader. Otherwise, pick a dedicated splash variant." />
        </span>
      </label>

      <div className={`space-y-2 ${le.splash.useGlobalDefault ? 'opacity-50 pointer-events-none' : ''}`}>
        <label className="text-xs text-[var(--color-textSecondary)]">Splash type</label>
        <Select
          value={le.splash.type}
          onChange={(v: string) => setSplashType(v as LoadingElementType)}
          options={typeOptions}
          className="sor-settings-select w-full"
          disabled={le.splash.useGlobalDefault}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <div
          className="flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40"
          style={{ width: 100, height: 100 }}
        >
          <LoadingElement
            type={effectiveSplashType}
            config={le.perType[effectiveSplashType]}
            color={le.followsAccentColor ? undefined : le.customColor}
            size={80}
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
    </div>
  );
};

export default SplashPanel;
