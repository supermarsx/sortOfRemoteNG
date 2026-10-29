import { describe, expect, it } from "vitest";
import {
  nativeLoginAdapterStopReasonCodes,
  nativeLoginReasonCodes,
  parseNativeLoginActivity,
} from "../../src/hooks/protocol/useNativeLoginActivity";
import enUS from "../../src/i18n/locales/en-US.json";
describe("native login activity projection", () => {
  const event = {
    connectionId: "connection-1",
    sessionId: "session-1",
    attemptId: "attempt-1",
    stage: "filling-password",
    timestampMs: 123,
    elapsedMs: 20,
  };
  it("retains fixed stages and drops private or page-supplied text", () => {
    expect(
      parseNativeLoginActivity({
        ...event,
        password: "secret",
        url: "https://example.test/?token=secret",
        reason: "page text",
      }),
    ).toEqual(event);
  });
  it("rejects unknown stages and invalid identities and times", () => {
    for (const patch of [
      { stage: "secret" },
      { sessionId: "https://page.test" },
      { elapsedMs: -1 },
      { timestampMs: NaN },
    ])
      expect(parseNativeLoginActivity({ ...event, ...patch })).toBeNull();
  });
  it("accepts only fixed cancellation codes and never arbitrary cancellation details", () => {
    for (const reasonCode of ["user-cancelled", "attempt-timeout"]) {
      expect(
        parseNativeLoginActivity({
          ...event,
          stage: "cancelled",
          reasonCode,
          reason: "PRIVATE_REASON",
        }),
      ).toEqual({ ...event, stage: "cancelled", reasonCode });
    }
    expect(
      parseNativeLoginActivity({
        ...event,
        stage: "cancelled",
        reasonCode: "navigation-scope-rejected",
        reason: "private account text",
      }),
    ).toEqual({
      ...event,
      stage: "cancelled",
      reasonCode: "navigation-scope-rejected",
    });
    for (const reasonCode of [
      "https://provider.test/?token=private",
      "private account text",
      {},
      123,
    ]) {
      expect(
        parseNativeLoginActivity({
          ...event,
          stage: "cancelled",
          reasonCode,
          lastActiveStage: "filling-password",
        }),
      ).toEqual({ ...event, stage: "cancelled" });
    }
  });
  it("accepts every page adapter stop cause as its own fixed code", () => {
    // NativeLoginRejection::ALL in native_features.rs, in its order.
    expect([...nativeLoginAdapterStopReasonCodes]).toEqual([
      "verification-required",
      "credentials-rejected",
      "focus-unavailable",
      "user-input",
      "page-changed",
      "field-not-empty",
      "submit-unavailable",
      "step-not-found",
      "expired",
    ]);
    expect(new Set(nativeLoginReasonCodes).size).toBe(
      nativeLoginReasonCodes.length,
    );
    for (const reasonCode of nativeLoginAdapterStopReasonCodes)
      for (const stage of ["held", "stopped", "cancelled"])
        expect(
          parseNativeLoginActivity({ ...event, stage, reasonCode }),
        ).toEqual({ ...event, stage, reasonCode });
    // A cause with page text appended is not a cause.
    expect(
      parseNativeLoginActivity({
        ...event,
        stage: "stopped",
        reasonCode: "credentials-rejected|Wrong password for alice",
      }),
    ).toEqual({ ...event, stage: "stopped" });
  });
  it("has a distinct, translated en-US message for every page adapter stop cause", () => {
    const reasons = (
      enUS as { statusBar: { loginReasons: Record<string, string> } }
    ).statusBar.loginReasons;
    const messages = nativeLoginAdapterStopReasonCodes.map(
      (code) => reasons[code],
    );
    expect(
      messages.every((text) => typeof text === "string" && text.length > 40),
    ).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
