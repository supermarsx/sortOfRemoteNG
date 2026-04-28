import React from 'react';
import { CircleDotDashed } from 'lucide-react';
import SectionHeading from '../../../../ui/SectionHeading';
import type { GlobalSettings } from '../../../../../types/settings/settings';
import { useLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';
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
    <div className="space-y-6">
      <SectionHeading
        icon={<CircleDotDashed className="w-5 h-5" />}
        title="Loading Element"
        description="Pick the global loader, tune its parameters, and manage precomputed fallback assets."
      />
      <TypeBrowserPanel mgr={mgr} />
      <CommonPanel mgr={mgr} />
      <VariantConfigPanel mgr={mgr} />
      <PrecomputedAssetsPanel mgr={mgr} />
    </div>
  );
};

export default LoadingElementSection;
