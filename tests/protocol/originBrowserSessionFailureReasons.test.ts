import { describe, expect, it } from "vitest";
import { originBrowserSessionError } from "../../src/hooks/protocol/originBrowserSessionError";
import { originBrowserFailureReason } from "../../src/types/protocols/originBrowser";

const reasons = [
  "renderer",
  "session",
  "database-owner",
  "watchdog",
  "private-context",
  "private-proxy",
  "certificate-bridge",
  "native-state",
  "runtime-unavailable",
  "owner-window",
  "callback",
  "native-surface",
  "load",
] as const;
describe("frontend native-session failure reason contract", () => {
  it.each(reasons)("accepts %s only in a failed snapshot", (reason) => {
    expect(originBrowserFailureReason("failed", reason)).toBe(reason);
    for (const phase of [
      "starting",
      "attached",
      "closing",
      "closed",
      "other",
      undefined,
    ]) {
      expect(originBrowserFailureReason(phase, reason)).toBeUndefined();
    }
  });

  it.each([
    [
      "renderer",
      "page renderer stopped or its native communication bridge failed",
    ],
    ["session", "private browser session was no longer available or valid"],
    ["callback", "internal native browser callback failed"],
    ["native-surface", "could not maintain the embedded browser view"],
    ["load", "page could not be loaded"],
  ])(
    "explains %s with recovery without diagnosing a GPU cause",
    (reason, detail) => {
      const message = originBrowserSessionError(reason);
      expect(message).toContain(detail);
      expect(message).toContain("Reopen");
      expect(message).toContain("native browser diagnostics");
      expect(message).not.toMatch(
        /GPU|graphics driver|hardware acceleration|password|credentials|https?:\/\//i,
      );
    },
  );

  it.each([
    ["database-owner", "database-session authorization is no longer current"],
    ["watchdog", "UI callback did not complete before the watchdog deadline"],
    [
      "private-context",
      "private browser context could not be verified or kept available",
    ],
    [
      "private-proxy",
      "private browser proxy was unavailable or its required binding could not be verified",
    ],
    ["native-state", "could not safely access native browser session state"],
    [
      "certificate-bridge",
      "TLS admission bridge for this private session failed",
    ],
    ["runtime-unavailable", "native browser runtime was no longer available"],
    [
      "owner-window",
      "app window or document that owned this browser session is no longer current",
    ],
  ])(
    "explains the fixed %s boundary without guessing a deeper cause",
    (reason, evidence) => {
      const message = originBrowserSessionError(reason);
      expect(message).toContain(evidence);
      expect(message).toContain("native browser diagnostics");
      expect(message).toMatch(/Retry browser|Reopen|restart the app/);
      expect(message).not.toMatch(
        /GPU|graphics driver|hardware acceleration|password|https?:\/\//i,
      );
      if (reason !== "database-owner")
        expect(message).not.toMatch(/database|unlock|locked/i);
    },
  );

  it("does not mistake database authorization loss for a confirmed lock", () => {
    expect(originBrowserSessionError("database-owner")).toContain(
      "does not establish that the database is locked",
    );
  });

  it("distinguishes the session TLS bridge from certificate rejection without weakening trust", () => {
    const message = originBrowserSessionError("certificate-bridge");
    expect(message).toContain(
      "does not establish a server-certificate rejection",
    );
    expect(message).toContain(
      "Retry browser to create a fresh private context",
    );
    expect(message).toContain("TLS journal");
    expect(message).toContain(
      "Keep HTTPS trust settings and website credentials unchanged",
    );
  });

  it.each(["session", undefined, "unknown"])(
    "keeps generic %s recovery independent of database state",
    (reason) => {
      const message = originBrowserSessionError(reason);
      expect(message).not.toMatch(/database|unlock|locked/i);
      expect(message).toContain("native browser diagnostics");
    },
  );

  it.each(
    [
      undefined,
      null,
      false,
      1,
      "",
      "Renderer",
      "DatabaseOwner",
      "database-owner https://user:SECRET@example.test/?token=SECRET",
      "future-engine-fault",
      "renderer https://user:SECRET@example.test/?token=SECRET",
      { message: "SECRET" },
      new Error("SECRET"),
      {
        toString() {
          throw new Error("never stringify a native object");
        },
      },
    ].map((reason: unknown) => ({ reason })),
  )(
    "keeps missing, unknown and malformed reasons generic and redacted (%#)",
    ({ reason }) => {
      expect(originBrowserFailureReason("failed", reason)).toBeUndefined();
      const message = originBrowserSessionError(reason);
      expect(message).toContain("No cause was provided by the native browser.");
      expect(message).toContain("Reopen the tab.");
      expect(message).not.toMatch(
        /SECRET|example\.test|token=|future-engine|renderer|GPU/,
      );
    },
  );
});
