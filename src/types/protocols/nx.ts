// Types mirroring sorng_nx::nx::types (subset exposed to the UI).

export type NxSessionType =
  | 'unix-gnome'
  | 'unix-kde'
  | 'unix-xfce'
  | 'unix-custom';

export interface NxConfig {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  privateKey?: string | null;
  label?: string | null;
  sessionType?: NxSessionType;
  resolutionWidth?: number | null;
  resolutionHeight?: number | null;
  fullscreen?: boolean;
  clipboard?: boolean;
  audioEnabled?: boolean;
  resumeSessionId?: string | null;
}

export interface NxSessionInfo {
  id: string;
  host: string;
  connected: boolean;
  label?: string | null;
}

export interface NxSessionStats {
  id: string;
  bytesIn: number;
  bytesOut: number;
}
