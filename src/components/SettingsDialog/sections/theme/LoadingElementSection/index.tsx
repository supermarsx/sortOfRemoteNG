import React from 'react';
import { CircleDotDashed } from 'lucide-react';
import type { GlobalSettings } from '../../../../../types/settings/settings';
import { useLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';
import {
  SettingsSectionHeader as SectionHeader,
} from '../../../../ui/settings/SettingsPrimitives';
import { TypeBrowserPanel } from './TypeBrowserPanel';
import { CommonPanel } from './CommonPanel';
import { VariantConfigPanel } from './VariantConfigPanel';
import { PrecomputedAssetsPanel } from './PrecomputedAssetsPanel';

export interface LoadingElementSectionProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const LoadingElementSection: React.FC<LoadingElementSectionProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useLoadingElementSettings(settings, updateSettings);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<CircleDotDashed className="w-4 h-4 text-primary" />}
        title="Loading Element"
      />
      <p className="text-xs text-[var(--color-textMuted)]">
        Pick the global loader, tune its parameters, and manage precomputed fallback assets.
      </p>
      <TypeBrowserPanel mgr={mgr} />
      <CommonPanel mgr={mgr} />
      <VariantConfigPanel mgr={mgr} />
      <PrecomputedAssetsPanel mgr={mgr} />
    </div>
  );
};

export default LoadingElementSection;
