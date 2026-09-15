import type { FileListResult } from "./synology";

/** Runtime-only route. Never add this or its proxy credentials to saved login/session data. */
export type SynologyApiRoute =
  | { kind: "direct" }
  | { kind: "http_proxy"; url: string; username?: string; password?: string };

export interface SynologyFileLogin {
  host: string;
  port: number;
  username: string;
  password: string;
  useHttps: boolean;
}
/** `syn_fs_connect` `sessionProfile`: DSM session name `FileStation` (default) or `webui`. */
export type SynologySessionProfile = "file_station" | "dsm_desktop";
/** Closed sign-in methods reported by `SYNO.API.Auth.Type` after a 403/449. */
export type SynologyAuthMethod =
  "otp" | "secure_signin_approval" | "security_key";
/** Device token issued by DSM after an opted-in trusted-device sign-in. Never render `deviceId`. */
export interface SynologyTrustedDevice {
  deviceName: string;
  deviceId: string;
}
/** A trusted-device vault write. `not-saved` never blocks sign-in; show its message. */
export type SynologyDeviceTrustWrite =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "not-saved"; message: string };
/**
 * Vault storage for this saved connection's trusted device, keyed by NAS address
 * and DSM account. Each call opens the vault afresh; results are attempt-local.
 */
export interface SynologyDeviceTrustAdapter {
  resolve(
    assertAttempt: () => void,
    account: string,
  ): Promise<SynologyTrustedDevice | null>;
  store(
    assertAttempt: () => void,
    account: string,
    device: SynologyTrustedDevice,
  ): Promise<SynologyDeviceTrustWrite>;
  forget(
    assertAttempt: () => void,
    account: string,
  ): Promise<SynologyDeviceTrustWrite>;
}
export type SynologyFileAuthResult =
  | {
      status: "connected";
      sessionId: string;
      message: string;
      trustedDevice?: SynologyTrustedDevice;
    }
  | {
      status: "otp_required";
      message: string;
      methods?: SynologyAuthMethod[];
      /** A saved `deviceId` was sent and DSM still asked for a code. */
      trustedDeviceRejected?: true;
      /** The saved device name does not match this computer, so no token was sent. */
      trustedDeviceMismatch?: true;
    }
  | { status: "otp_invalid"; message: string }
  /** DSM code 406: the account must set up 2FA in DSM before any API sign-in. */
  | { status: "otp_enrollment_required"; message: string }
  | {
      status: "unsupported_mfa";
      message: string;
      methods?: SynologyAuthMethod[];
    };
export type SynologyFileAuthChallenge = Exclude<
  SynologyFileAuthResult,
  { status: "connected" }
>;
export type SynologyFileOperation = "delete" | "copy" | "move" | "search";
export interface SynologyFileTaskStatus {
  taskId: string;
  operation: SynologyFileOperation;
  finished: boolean;
  progress: number | null;
  files?: FileListResult;
}
export interface SynologyFileTransferResult {
  cancelled: boolean;
  name?: string;
  bytes?: number;
}
