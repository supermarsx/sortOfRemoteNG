import { describe, expect, it } from "vitest";
import {
  websiteDiagnosticsText,
  nativeObservationsText,
} from "../../src/utils/protocol/websiteDiagnosticsText";
import type { NativeHttpObservationsSnapshot } from "../../src/utils/protocol/webNetworkGuard";

describe("privacy-bounded website diagnostic copy", () => {
  it("copies closed report fields and omits unrelated QuickConnect capabilities", () => {
    const status = {
      status: "current" as const,
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    };
    const text = websiteDiagnosticsText(
      [
        {
          kind: "fetch",
          reason: "origin-not-approved",
          origin: "https://example.test",
        },
        {
          kind: "fetch",
          reason: "origin-not-approved",
          origin: "https://example.test/?private-token=secret",
        },
        { kind: "secret-kind", reason: "origin-not-approved", origin: null },
        { kind: "fetch", reason: "secret-reason", origin: null },
      ],
      null,
      status,
      false,
    );
    expect(text).toContain(
      "https://example.test | fetch | origin-not-approved",
    );
    expect(text).not.toMatch(
      /private-token|secret-kind|secret-reason|QuickConnect|Same-NAS/,
    );
    expect(websiteDiagnosticsText([], null, status, true)).toContain(
      "QuickConnect navigation: off or unavailable",
    );
  });
  const snapshot = (): NativeHttpObservationsSnapshot => ({
    scope: "application",
    total: 4,
    documentBlocked: 1,
    recent: [
      {
        sequence: 1,
        method: "POST",
        origin: "http://ipc.localhost",
        resourceKind: "xhr",
        sourceKind: "document",
        documentBlocked: false,
      },
      {
        sequence: 2,
        method: "GET",
        origin: "https://other.test",
        resourceKind: "fetch",
        sourceKind: "document",
        documentBlocked: false,
      },
      {
        sequence: 3,
        method: "GET",
        origin: "http://proxy.localhost:43123",
        resourceKind: "fetch",
        sourceKind: "document",
        documentBlocked: false,
      },
      {
        sequence: 4,
        method: "GET",
        origin: "https://blocked.test",
        resourceKind: "document",
        sourceKind: "document",
        documentBlocked: true,
      },
    ],
  });
  it("copies only displayed filter rows and visible blocked exceptions, never hidden IPC", () => {
    const text = nativeObservationsText(
      snapshot(),
      "current",
      "http://proxy.localhost:43123",
    );
    expect(text).toContain("http://proxy.localhost:43123");
    expect(text).toContain("Blocked document requests outside this filter:");
    expect(text).toContain("https://blocked.test");
    expect(text).not.toMatch(/ipc.localhost|other.test/);
    expect(text).toContain("response outcome unknown");
    const all = nativeObservationsText(snapshot(), "all");
    expect(all).toContain("http://ipc.localhost");
    expect(all.indexOf("4 | GET")).toBeLessThan(all.indexOf("1 | POST"));
  });
  it("handles absent or malformed snapshots without throwing or leaking URLs", () => {
    expect(nativeObservationsText(null)).toMatch(
      /No native HTTP observation snapshot/,
    );
    const invalid = snapshot();
    invalid.recent[0].origin =
      "https://user:password@example.test/private?token=secret";
    expect(nativeObservationsText(invalid)).toBe(
      "Native HTTP observation snapshot is unavailable.",
    );
  });
});
