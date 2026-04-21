// Types mirroring sorng_ard::ard::types (subset exposed to the UI).

export interface ArdSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  curtainMode: boolean;
  connectedAt: string;
}

export interface ArdSessionStats {
  id: string;
  framesReceived: number;
  bytesIn: number;
  bytesOut: number;
}

export type ArdInputAction =
  | { kind: 'KeyDown'; keysym: number }
  | { kind: 'KeyUp'; keysym: number }
  | { kind: 'PointerMove'; x: number; y: number }
  | { kind: 'PointerButton'; buttonMask: number; x: number; y: number };

export interface ArdLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
