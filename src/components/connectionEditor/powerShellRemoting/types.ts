import type { PsRemotingCapabilities } from "../../../types/powershell";
import type { PowerShellRemotingSettings } from "../../../types/powershellRemoting";

export interface PowerShellRemotingSectionProps {
  value: PowerShellRemotingSettings;
  onChange: (value: PowerShellRemotingSettings) => void;
  capabilities: PsRemotingCapabilities;
  targetHost: string;
}

export interface PowerShellRemotingEditorProps {
  targetHost: string;
  value: PowerShellRemotingSettings;
  onChange: (value: PowerShellRemotingSettings) => void;
  capabilities?: PsRemotingCapabilities;
  /** Canonical resolver output supplied by the shared connection editor. */
  networkPathSummary?: string | null;
}
