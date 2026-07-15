import { describe, expect, it } from "vitest";
import { normalizeConnectionBehavior } from "../../../src/utils/behavior/normalizeBehavior";

describe("normalizeConnectionBehavior", () => {
  it("treats a missing configuration as an intentional no-op", () => {
    expect(normalizeConnectionBehavior(undefined)).toMatchObject({
      status: "absent",
      executable: false,
      issues: [],
    });
  });

  it("normalizes a valid v1 rule and preserves explicit zero values", () => {
    const result = normalizeConnectionBehavior({
      version: 1,
      rules: [
        {
          id: " reconnect ",
          name: " Reconnect once ",
          event: "session.disconnected",
          actions: [
            {
              type: "reconnect",
              delayMs: 0,
              maxAttempts: 0,
              backoff: "exponential",
            },
          ],
          options: {
            delayMs: 0,
            cooldownMs: 0,
            oncePerSession: true,
            stopOnActionError: true,
          },
        },
      ],
    });

    expect(result.status).toBe("valid");
    expect(result.executable).toBe(true);
    expect(result.config?.rules[0]).toEqual({
      id: "reconnect",
      name: "Reconnect once",
      enabled: true,
      event: "session.disconnected",
      when: undefined,
      actions: [
        {
          type: "reconnect",
          delayMs: 0,
          maxAttempts: 0,
          backoff: "exponential",
        },
      ],
      options: {
        delayMs: 0,
        cooldownMs: 0,
        oncePerSession: true,
        stopOnActionError: true,
      },
    });
  });

  it("filters unsupported actions and filter values without mutating the input", () => {
    const input = {
      version: 1,
      rules: [
        {
          id: "notify",
          name: "Notify",
          enabled: false,
          event: "window.blurred",
          when: {
            reasons: ["user", "user", "not-real"],
            windowKinds: ["detached", "space-station"],
          },
          actions: [
            { type: "notify", title: 42, message: "Lost focus" },
            { type: "launchMissiles" },
          ],
        },
      ],
    };
    const before = structuredClone(input);

    const result = normalizeConnectionBehavior(input);

    expect(input).toEqual(before);
    expect(result.config?.rules[0]).toMatchObject({
      enabled: false,
      when: { reasons: ["user"], windowKinds: ["detached"] },
      actions: [
        {
          type: "notify",
          title: undefined,
          message: "Lost focus",
          level: "info",
          sound: "inherit",
        },
      ],
    });
    expect(result.issues.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "rules[0].when.reasons[2]",
        "rules[0].when.windowKinds[1]",
        "rules[0].actions[0].title",
        "rules[0].actions[1].type",
      ]),
    );
  });

  it("drops invalid rules while retaining valid rules in their original order", () => {
    const result = normalizeConnectionBehavior({
      version: 1,
      rules: [
        { id: "bad", event: "session.magic", actions: [] },
        {
          id: "good",
          name: "Good",
          event: "session.started",
          actions: [{ type: "writeLog" }],
        },
        { id: "also-bad", event: "session.ended", actions: "nope" },
      ],
    });

    expect(result.config?.rules.map((rule) => rule.id)).toEqual(["good"]);
    expect(result.issues).toHaveLength(2);
  });

  it("clamps bounded timing and retry values", () => {
    const result = normalizeConnectionBehavior({
      version: 1,
      rules: [
        {
          id: "bounded",
          name: "Bounded",
          event: "session.reconnectFailed",
          options: { delayMs: Number.MAX_SAFE_INTEGER, cooldownMs: -1 },
          actions: [
            {
              type: "reconnect",
              delayMs: Number.MAX_SAFE_INTEGER,
              maxAttempts: 1000,
            },
            {
              type: "runCustomScript",
              scriptId: "script-1",
              timeoutMs: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
      ],
    });

    expect(result.config?.rules[0].options).toMatchObject({
      delayMs: 86_400_000,
      cooldownMs: 0,
    });
    expect(result.config?.rules[0].actions).toEqual([
      {
        type: "reconnect",
        delayMs: 86_400_000,
        maxAttempts: 100,
        backoff: "fixed",
      },
      {
        type: "runCustomScript",
        scriptId: "script-1",
        timeoutMs: 3_600_000,
      },
    ]);
  });

  it("rejects malformed roots and preserves unsupported future versions verbatim", () => {
    expect(
      normalizeConnectionBehavior({ version: 1, rules: {} }),
    ).toMatchObject({
      status: "invalid",
      executable: false,
    });

    const future = { version: 2, rules: [{ event: "future.event" }] };
    const result = normalizeConnectionBehavior(future);
    expect(result).toMatchObject({
      status: "unsupported-version",
      executable: false,
      raw: future,
    });
    expect(result.raw).toBe(future);
  });

  it("requires a non-empty saved script id", () => {
    const result = normalizeConnectionBehavior({
      version: 1,
      rules: [
        {
          id: "script",
          name: "Script",
          event: "session.started",
          actions: [{ type: "runCustomScript", scriptId: "  " }],
        },
      ],
    });

    expect(result.config?.rules[0].actions).toEqual([]);
    expect(result.issues[0]).toMatchObject({
      path: "rules[0].actions[0].scriptId",
      code: "missing-value",
    });
  });
});
