import type { NxSessionType } from "../nx";

/** Persisted editor options consumed by the native NoMachine handoff. */
export interface NxNativeSavedOptions {
  nxConnectionService?: "nx" | "ssh";
  nxSessionType?: NxSessionType;
  nxCustomCommand?: string;
  nxNativeClientPath?: string;
  nxWidth?: number;
  nxHeight?: number;
  nxFullscreen?: boolean;
  nxAudioEnabled?: boolean;
  nxClipboardEnabled?: boolean;
}

export interface NxNativeSessionInfo {
  id: string;
  host: string;
  port: number;
  username?: string | null;
  label?: string | null;
  state: "Running" | "Terminated" | "Failed" | string;
  native_client_pid?: number | null;
  server_session_id?: null;
}
