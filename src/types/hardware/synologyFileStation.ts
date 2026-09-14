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
export type SynologyFileAuthResult =
  | { status: "connected"; sessionId: string; message: string }
  | {
      status: "otp_required" | "otp_invalid" | "unsupported_mfa";
      message: string;
    };
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
