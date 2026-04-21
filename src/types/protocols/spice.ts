// Types mirroring sorng_spice::spice::types (subset exposed to the UI).

export interface SpiceConfig {
  host: string;
  port: number;
  tlsPort?: number | null;
  password?: string | null;
  label?: string | null;
  viewOnly: boolean;
  shareClipboard: boolean;
  usbRedirection: boolean;
  audioPlayback: boolean;
  preferredWidth?: number | null;
  preferredHeight?: number | null;
}

export interface SpiceSessionInfo {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  label?: string | null;
}

export interface SpiceSessionStats {
  id: string;
  bytesIn: number;
  bytesOut: number;
  latencyMs?: number | null;
}
