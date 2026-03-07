import type { SSHTerminalConfig } from "../../../../types/ssh/sshSettings";
import type { TFunction } from "i18next";

export interface SectionProps {
  cfg: SSHTerminalConfig;
  up: (updates: Partial<SSHTerminalConfig>) => void;
  t: TFunction;
}
