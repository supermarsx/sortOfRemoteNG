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
