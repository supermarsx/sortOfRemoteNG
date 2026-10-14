import { describe, expect, it } from "vitest";
import { parseNativeLoginActivity } from "../../src/hooks/protocol/useNativeLoginActivity";
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
});
