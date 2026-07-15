import { useMemo } from "react";
import {
  DIRECT_RLOGIN_NETWORK_PATH,
  type RloginNetworkPathCapability,
  type RloginSettings,
  type RloginSettingsPatch,
} from "../../types/connection/rloginSettings";
import {
  patchRloginSettings,
  validateRloginSettings,
} from "../../utils/rlogin/rloginSettings";
import { RloginAdvancedSection } from "./rloginOptions/AdvancedSection";
import { RloginConnectionSection } from "./rloginOptions/ConnectionSection";
import { RloginNetworkPathSection } from "./rloginOptions/NetworkPathSection";
import { RloginSecuritySection } from "./rloginOptions/SecuritySection";
import { RloginTerminalSection } from "./rloginOptions/TerminalSection";
import type { RloginEditorSectionId } from "./rloginOptions/types";
import { useComposedControlledValue } from "./useComposedControlledValue";

export interface RloginOptionsProps {
  settings: RloginSettings;
  port: number;
  onSettingsChange: (settings: RloginSettings) => void;
  onPortChange: (port: number) => void;
  networkPath?: RloginNetworkPathCapability;
  section?: RloginEditorSectionId | "all";
  disabled?: boolean;
  now?: () => Date;
}

export function RloginOptions({
  settings,
  port,
  onSettingsChange,
  onPortChange,
  networkPath = DIRECT_RLOGIN_NETWORK_PATH,
  section = "all",
  disabled,
  now,
}: RloginOptionsProps) {
  const [liveSettings, emitSettings] = useComposedControlledValue(
    settings,
    onSettingsChange,
  );
  const validation = useMemo(
    () => validateRloginSettings(settings, { port, networkPath }),
    [networkPath, port, settings],
  );
  const onChange = (patch: RloginSettingsPatch) =>
    emitSettings(patchRloginSettings(liveSettings, patch));
  const shows = (candidate: RloginEditorSectionId) =>
    section === "all" || section === candidate;

  return (
    <div
      className="space-y-4"
      aria-label="RLogin protocol settings"
      data-testid="rlogin-options"
    >
      {shows("connection") ? (
        <RloginConnectionSection
          settings={settings}
          port={port}
          onPortChange={onPortChange}
          onChange={onChange}
          validation={validation}
          networkPath={networkPath}
          disabled={disabled}
        />
      ) : null}
      {shows("terminal") ? (
        <RloginTerminalSection
          settings={settings}
          onChange={onChange}
          validation={validation}
          disabled={disabled}
        />
      ) : null}
      {shows("network-path") ? (
        <RloginNetworkPathSection
          settings={settings}
          onChange={onChange}
          validation={validation}
          networkPath={networkPath}
          disabled={disabled}
        />
      ) : null}
      {shows("security") ? (
        <RloginSecuritySection
          settings={settings}
          onChange={onChange}
          validation={validation}
          disabled={disabled}
          now={now}
        />
      ) : null}
      {shows("advanced") ? (
        <RloginAdvancedSection
          settings={settings}
          onChange={onChange}
          validation={validation}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

export { RloginAdvancedSection } from "./rloginOptions/AdvancedSection";
export { RloginConnectionSection } from "./rloginOptions/ConnectionSection";
export { RloginNetworkPathSection } from "./rloginOptions/NetworkPathSection";
export { RloginSecuritySection } from "./rloginOptions/SecuritySection";
export { RloginTerminalSection } from "./rloginOptions/TerminalSection";
export { RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS } from "./rloginOptions/searchMetadata";
export type { RloginEditorSectionId } from "./rloginOptions/types";

export default RloginOptions;
