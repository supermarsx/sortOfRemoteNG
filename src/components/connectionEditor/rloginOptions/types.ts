import type {
  RloginNetworkPathCapability,
  RloginSettings,
  RloginSettingsPatch,
} from "../../../types/connection/rloginSettings";
import type { RloginValidationResult } from "../../../utils/rlogin/rloginSettings";

export type RloginEditorSectionId =
  | "connection"
  | "terminal"
  | "network-path"
  | "security"
  | "advanced";

export interface RloginSettingsSectionProps {
  settings: RloginSettings;
  onChange: (patch: RloginSettingsPatch) => void;
  validation?: RloginValidationResult;
  disabled?: boolean;
}

export interface RloginConnectionSectionProps extends RloginSettingsSectionProps {
  port: number;
  onPortChange: (port: number) => void;
  networkPath?: RloginNetworkPathCapability;
}

export interface RloginNetworkPathSectionProps extends RloginSettingsSectionProps {
  networkPath: RloginNetworkPathCapability;
}

export const fieldError = (
  validation: RloginValidationResult | undefined,
  field: string,
): string | undefined => validation?.errorsByField[field];
