// Fail2ban wire-format types for the sorng-fail2ban backend.

export interface Fail2banSshConfig {
  host: string;
  port: number;
  username: string;
  private_key_path?: string | null;
  ssh_options?: Record<string, string>;
  connect_timeout?: number | null;
}

export interface Fail2banHost {
  id: string;
  name: string;
  description?: string | null;
  ssh?: Fail2banSshConfig | null;
  use_sudo?: boolean;
  client_binary?: string | null;
  tags?: string[];
}

export type Fail2banJail = Record<string, unknown>;
export type Fail2banJailStatus = Record<string, unknown>;
export type Fail2banBannedIp = Record<string, unknown>;
export interface Fail2banBannedIpSummary {
  ip: string;
  total_bans: number;
  jails: string[];
  country: string | null;
  last_banned: string | null;
}
export type Fail2banFilter = Record<string, unknown>;
export type Fail2banAction = Record<string, unknown>;
export type Fail2banLogEntry = Record<string, unknown>;
export type Fail2banLogStats = Record<string, unknown>;
export type Fail2banStats = Record<string, unknown>;
export type Fail2banFilterTestResult = Record<string, unknown>;
export type Fail2banHourlyBanCount = Record<string, unknown>;
export type Fail2banLogFileInfo = Record<string, unknown>;
