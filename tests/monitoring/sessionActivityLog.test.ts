import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
  recordSessionActivity,
  subscribeSessionActivityLog,
  type SessionActivityCode,
  type SessionActivitySource,
} from "../../src/utils/monitoring/sessionActivityLog";
const h = vi.hoisted(() => ({ enabled: true, limit: 1000 }));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () => ({
        enableActionLog: h.enabled,
        maxLogEntries: h.limit,
      }),
    }),
  },
}));
const context = {
  sessionId: "session-a",
  connectionId: "connection-a",
  databaseId: "db-a",
};
beforeEach(() => {
  clearSessionActivityLog();
  h.enabled = true;
  h.limit = 1000;
});
describe("volatile session activity feed", () => {
  it("keeps immutable newest-first snapshots and notifies only subscribed observers", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeSessionActivityLog(changed);
    const original = getSessionActivityLog();
    recordSessionActivity(context, "website_script", "started");
    const first = getSessionActivityLog();
    recordSessionActivity(context, "website_script", "completed", {
      durationMs: 12.6,
    });
    expect(original).toHaveLength(0);
    expect(first).toHaveLength(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
      "completed",
      "started",
    ]);
    expect(getSessionActivityLog()[0].duration).toBe(13);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    clearSessionActivityLog();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("honors the logging switch and lower configured retention with a hard1000 cap", () => {
    h.enabled = false;
    recordSessionActivity(context, "ssh_macro", "started");
    expect(getSessionActivityLog()).toHaveLength(0);
    h.enabled = true;
    h.limit = 2;
    for (let index = 0; index < 3; index++)
      recordSessionActivity(context, "ssh_macro", "started");
    expect(getSessionActivityLog()).toHaveLength(2);
    h.limit = 100_000;
    for (let index = 0; index < 1001; index++)
      recordSessionActivity(context, "ssh_macro", "completed");
    expect(getSessionActivityLog()).toHaveLength(1000);
  });
  it("copies only affiliation IDs and fixed text, never arbitrary payload or reasons", () => {
    const extra = {
      ...context,
      password: "PRIVATE_PASSWORD",
      url: "https://private.test/?token=PRIVATE_TOKEN",
      output: "PRIVATE_OUTPUT",
    };
    recordSessionActivity(extra, "autofill", "stopped", {
      reason: "PRIVATE_PAGE_ERROR",
    });
    const entry = getSessionActivityLog()[0];
    expect(entry).toMatchObject(context);
    expect(JSON.stringify(entry)).not.toMatch(
      /PRIVATE_|private\.test|password|output/,
    );
    expect(Object.keys(entry).sort()).toEqual(
      [
        "action",
        "code",
        "connectionId",
        "databaseId",
        "details",
        "id",
        "level",
        "sessionId",
        "source",
        "timestamp",
      ].sort(),
    );
    recordSessionActivity(context, "autofill", "timeout", {
      reason: "next-not-advanced",
    });
    expect(getSessionActivityLog()[0].details).toContain(
      "Next was clicked once",
    );
  });
  it("rejects malformed identifiers, unknown codes and mismatched sources", () => {
    recordSessionActivity(
      { ...context, databaseId: "https://private.test/?secret=x" },
      "ssh_script",
      "started",
    );
    recordSessionActivity(undefined, "ssh_script", "started");
    recordSessionActivity(
      context,
      "UNKNOWN" as SessionActivitySource,
      "started",
    );
    recordSessionActivity(
      context,
      "autofill",
      "RAW_ERROR" as SessionActivityCode,
    );
    recordSessionActivity(context, "autofill", "completed");
    recordSessionActivity(context, "ssh_script", "submitted");
    expect(getSessionActivityLog()).toHaveLength(0);
  });
  it("separates same connection IDs in different owners and contains observer failures", () => {
    const unsubscribe = subscribeSessionActivityLog(() => {
      throw new Error("PRIVATE_OBSERVER_ERROR");
    });
    recordSessionActivity(context, "ssh_script", "started");
    recordSessionActivity(
      { ...context, databaseId: "db-b", sessionId: "session-b" },
      "ssh_script",
      "failed",
      { durationMs: Infinity },
    );
    expect(getSessionActivityLog().map((entry) => entry.databaseId)).toEqual([
      "db-b",
      "db-a",
    ]);
    expect(getSessionActivityLog()[0].duration).toBeUndefined();
    unsubscribe();
  });
});

describe("DSM page-helper auto-fill outcomes", () => {
  it.each([
    ["waiting_page", "info", "waiting for DSM to finish loading"],
    ["filling_username", "info", "filling the username"],
    ["filling_password", "info", "filling the password"],
    ["verifying_sign_in", "info", "observing the page outcome"],
    ["signed_in", "info", "not native proof of authentication"],
    ["rejected", "warn", "No retry was made"],
  ] as const)(
    "records the %s phase with fixed text",
    (code, level, summary) => {
      recordSessionActivity(context, "autofill", code);
      expect(getSessionActivityLog()[0]).toMatchObject({
        code,
        level,
        action: "Website auto-fill",
      });
      expect(getSessionActivityLog()[0].details).toContain(summary);
      recordSessionActivity(context, "ssh_script", code);
      expect(getSessionActivityLog()).toHaveLength(1);
    },
  );
  it.each([
    ["route-pending", "settling its sign-in route"],
    ["captcha-required", "CAPTCHA"],
    ["interactive-step-required", "interactive sign-in step"],
    ["user-input-detected", "Manual input"],
    ["unsafe-form-target", "unreviewed action or target"],
    ["account-mismatch", "did not match the saved username"],
    ["layout-unrecognized", "reviewed layout"],
    ["login-form-never-appeared", "login form never became ready"],
    ["left-signin-page", "after Sign in"],
    ["error-visible", "sign-in error"],
    ["no-sign-in-page", "No DSM sign-in page"],
  ])("appends the fixed explanation for %s", (reason, text) => {
    recordSessionActivity(context, "autofill", "stopped", { reason });
    expect(getSessionActivityLog()[0].details).toContain(text);
  });
  it.each([
    ["otp", "asking for a 2FA code"],
    ["approve", "approval in Synology Secure SignIn"],
    ["select-auth", "choose a sign-in method"],
    ["passkey", "passkey or hardware security key"],
    ["other", "another interactive sign-in step"],
  ])(
    "names the %s hand-off and the closed fingerprint on a terminal entry",
    (handoff, text) => {
      recordSessionActivity(context, "autofill", "stopped", {
        reason: "interactive-step-required",
        trace: {
          handoff,
          fingerprint: {
            root: 1,
            panel: 1,
            form: 1,
            field: 1,
            button: 12,
            hash: handoff,
            readyState: "complete",
            stage: "submitted",
          },
        },
      });
      const { details } = getSessionActivityLog()[0];
      expect(details).toContain(text);
      expect(details).toContain(
        `Page fingerprint: root 1, panel 1, form 1, field 1, button 9, route ${handoff}, document complete, stage submitted.`,
      );
    },
  );
  it("never copies secrets, URLs, tokens or page text from a trace", () => {
    recordSessionActivity(context, "autofill", "stopped", {
      reason: "interactive-step-required",
      trace: {
        handoff: "PRIVATE_STEP https://private.test/?token=PRIVATE_TOKEN",
        fingerprint: {
          root: "1",
          panel: -1,
          form: 1.5,
          field: Number.NaN,
          button: { valueOf: () => 1 },
          hash: "#/signin/otp?code=PRIVATE_CODE",
          readyState: "PRIVATE_STATE",
          stage: "password PRIVATE",
          username: "PRIVATE_USER",
          password: "PRIVATE_PASSWORD",
          text: "PRIVATE_PAGE_TEXT",
        },
        url: "https://user:PRIVATE_SECRET@private.test/",
      } as never,
    });
    const entry = getSessionActivityLog()[0];
    expect(JSON.stringify(entry)).not.toMatch(
      /PRIVATE|private\.test|token|username|password|fingerprint/i,
    );
    expect(Object.keys(entry).sort()).toEqual(
      [
        "action",
        "code",
        "connectionId",
        "databaseId",
        "details",
        "id",
        "level",
        "sessionId",
        "source",
        "timestamp",
      ].sort(),
    );
    const hostile = {};
    Object.defineProperty(hostile, "hash", {
      get() {
        throw new Error("PRIVATE_GETTER");
      },
    });
    recordSessionActivity(context, "autofill", "timeout", {
      reason: "page-never-ready",
      trace: { fingerprint: hostile },
    });
    expect(getSessionActivityLog()).toHaveLength(2);
    expect(getSessionActivityLog()[0].details).not.toContain("PRIVATE");
  });
  it("adds trace text only to terminal auto-fill entries", () => {
    const trace = {
      handoff: "otp",
      fingerprint: { root: 1, hash: "otp", stage: "submitted" },
    };
    recordSessionActivity(context, "autofill", "waiting_page", {
      reason: "route-pending",
      trace,
    });
    recordSessionActivity(context, "autofill", "awaiting_nas", { trace });
    recordSessionActivity(context, "ssh_macro", "failed", { trace });
    expect(
      getSessionActivityLog().some((entry) =>
        /Page fingerprint|2FA code/.test(entry.details),
      ),
    ).toBe(false);
    recordSessionActivity(context, "autofill", "signed_in", {
      reason: "left-signin-page",
      trace: { fingerprint: { hash: "other", readyState: "complete" } },
    });
    expect(getSessionActivityLog()[0].details).toBe(
      "Page helper observed DSM leave the sign-in page. This is inferred from the page, not native proof of authentication. The page left the DSM sign-in page after Sign in. Page fingerprint: route other, document complete.",
    );
  });
  it("keeps the existing reason-free and unknown-reason text unchanged", () => {
    recordSessionActivity(context, "autofill", "stopped");
    recordSessionActivity(context, "autofill", "stopped", {
      reason: "not-a-reason",
    });
    expect(getSessionActivityLog().map((entry) => entry.details)).toEqual([
      "Page helper stopped before completing submission.",
      "Page helper stopped before completing submission.",
    ]);
  });
});
