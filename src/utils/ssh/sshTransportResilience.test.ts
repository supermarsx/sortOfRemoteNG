import { afterEach, describe, expect, it } from "vitest";
import { classifySshFailure, describeSshTransportNotice } from "./sshFailure";
import {
  SSH_SESSION_RECONNECT_EVENT,
  requestInPlaceSshReconnect,
  type SshSessionReconnectDetail,
} from "./sshReconnectEvent";

describe("libssh2 -43 classification", () => {
  it("treats the backend-rendered SOCKET_RECV message as a recoverable transport failure", () => {
    const result = classifySshFailure(
      "transport read (libssh2 code -43 LIBSSH2_ERROR_SOCKET_RECV)",
    );
    expect(result.kind).toBe("transport");
    expect(result.recoverable).toBe(true);
  });

  it("matches the code form even without the word transport", () => {
    expect(
      classifySshFailure("read failed (libssh2 code -43 LIBSSH2_ERROR_X)")
        .recoverable,
    ).toBe(true);
  });

  it("keeps authentication failures non-recoverable", () => {
    expect(classifySshFailure("Authentication failed").recoverable).toBe(false);
  });
});

describe("transport notices", () => {
  it("renders the reconnecting marker with attempt counts", () => {
    const notice = describeSshTransportNotice({
      kind: "transport_retrying",
      attempt: 2,
      max_attempts: 4,
    });
    expect(notice?.state).toBe("retrying");
    expect(notice?.line).toContain("attempt 2/4");
  });

  it("renders the recovered marker so the stuck state clears", () => {
    const notice = describeSshTransportNotice({ kind: "transport_recovered" });
    expect(notice?.state).toBe("recovered");
    expect(notice?.line).toContain("connection recovered");
  });

  it("ignores ordinary fatal ssh-error payloads", () => {
    expect(describeSshTransportNotice({ message: "boom" })).toBeNull();
  });
});

describe("in-place reconnect request", () => {
  const listeners: EventListener[] = [];
  afterEach(() => {
    for (const l of listeners.splice(0))
      window.removeEventListener(SSH_SESSION_RECONNECT_EVENT, l);
  });

  it("is unhandled when no terminal is mounted (caller falls back)", () => {
    expect(requestInPlaceSshReconnect("s1")).toBe(false);
  });

  it("is handled only by the terminal that owns the session", () => {
    const seen: string[] = [];
    const listener: EventListener = (event) => {
      const detail = (event as CustomEvent<SshSessionReconnectDetail>).detail;
      if (detail.sessionId !== "s1") return;
      seen.push(detail.sessionId);
      detail.handled = true;
    };
    listeners.push(listener);
    window.addEventListener(SSH_SESSION_RECONNECT_EVENT, listener);
    expect(requestInPlaceSshReconnect("s2")).toBe(false);
    expect(requestInPlaceSshReconnect("s1")).toBe(true);
    expect(seen).toEqual(["s1"]);
  });
});
