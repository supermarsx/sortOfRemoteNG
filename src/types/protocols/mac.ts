// Types mirroring sorng_mac (Linux Mandatory Access Control) types
// — subset exposed to the UI.

export type MacSystem = 'selinux' | 'apparmor' | 'tomoyo' | 'smack' | 'none';

export interface MacConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string | null;
  privateKey?: string | null;
  usePty?: boolean;
}

export interface MacConnectionSummary {
  id: string;
  host: string;
  detectedSystems: MacSystem[];
  connectedAt: string;
}

export type SelinuxMode = 'enforcing' | 'permissive' | 'disabled';

export interface SelinuxBoolean {
  name: string;
  current: boolean;
  pending: boolean;
  description?: string | null;
}

export type ApparmorProfileMode = 'enforce' | 'complain' | 'disabled' | 'unconfined';

export interface ApparmorProfile {
  name: string;
  mode: ApparmorProfileMode;
}

export interface MacDashboard {
  system: MacSystem;
  status: string;
  alerts: number;
}
