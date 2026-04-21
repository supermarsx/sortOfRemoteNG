// Types mirroring sorng_x2go::x2go::types (subset exposed to the UI).

export type X2goSessionType =
  | 'desktop-kde'
  | 'desktop-gnome'
  | 'desktop-xfce'
  | 'desktop-lxde'
  | 'desktop-custom'
  | 'single-app'
  | 'shadow';

export interface X2goConfig {
  host: string;
  port: number;
  username: string;
  password?: string | null;
  privateKey?: string | null;
  sessionType: X2goSessionType;
  resolutionWidth?: number | null;
  resolutionHeight?: number | null;
  resumeSessionId?: string | null;
  audioEnabled?: boolean;
  clipboardEnabled?: boolean;
}

export interface X2goSessionInfo {
  id: string;
  host: string;
  username: string;
  sessionType: X2goSessionType;
  connected: boolean;
}

export interface X2goSessionStats {
  id: string;
  bytesIn: number;
  bytesOut: number;
}
