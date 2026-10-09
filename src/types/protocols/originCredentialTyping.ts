import type { OriginBrowserIdentity } from "./originBrowser";

/** Owner-window IPC. Never log these requests: type carries a transient secret. */
export interface OriginCredentialInputRequest {
  identity: OriginBrowserIdentity;
  viewId?: string;
  action:
    | { kind: "capture" }
    | { kind: "cancel"; captureId: string }
    | {
        kind: "type";
        captureId: string;
        text: string;
        credentialKind: "credential" | "totp";
        restoreFocus: true;
        typingMode: "simulated" | "instant";
        startsAtUnixMs?: number;
        expiresAtUnixMs?: number;
      };
}

export interface OriginCredentialInputReply {
  /** waiting is a secret-free capture miss, not an authorization failure. */
  status: "waiting" | "captured" | "complete" | "cancelled";
  /** Empty only for waiting; no target was captured. */
  captureId: string;
}

export type OriginCredentialInputTransport = (
  request: OriginCredentialInputRequest,
) => Promise<OriginCredentialInputReply>;
