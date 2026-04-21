// Fail2ban — minimal TypeScript wire-format types for the sorng-fail2ban backend.

export interface Fail2banHost {
  id: string;
  name: string;
  host: string;
  port?: number;
  username?: string;
  ssh_key_path?: string;
  password?: string;
  use_sudo?: boolean;
}

// Open aliases for the wider record surface.
export type Fail2banJail = Record<string, unknown>;
export type Fail2banJailStatus = Record<string, unknown>;
export type Fail2banBannedIp = Record<string, unknown>;
export type Fail2banFilter = Record<string, unknown>;
export type Fail2banAction = Record<string, unknown>;
export type Fail2banLogEntry = Record<string, unknown>;
export type Fail2banLogStats = Record<string, unknown>;
export type Fail2banStats = Record<string, unknown>;
export type Fail2banFilterTestResult = Record<string, unknown>;
export type Fail2banHourlyBanCount = Record<string, unknown>;
export type Fail2banLogFileInfo = Record<string, unknown>;
