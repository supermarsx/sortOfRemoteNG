import { describe, expect, it } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  originBrowserConnectionTarget,
  originBrowserDisplayUrl,
} from "../../src/hooks/protocol/originBrowserConnectionTarget";

const connection = {
  id: "fixture",
  hostname: "fixture.invalid",
  protocol: "https",
  port: 443,
} as Connection;
const session = {
  ...connection,
  connectionId: connection.id,
  id: "tab",
  status: "connected",
  startTime: new Date(),
} as ConnectionSession;
describe("native connection target", () => {
  it("preserves a saved page while redacting its display URL", () => {
    const target = originBrowserConnectionTarget(connection, {
      ...session,
      hostname: "https://fixture.invalid/login?ticket=private#state",
    });
    expect(target).toBe("https://fixture.invalid/login?ticket=private#state");
    expect(originBrowserDisplayUrl(target)).toBe(
      "https://fixture.invalid/login",
    );
  });
  it("preserves an explicit non-default saved port", () => {
    expect(
      originBrowserConnectionTarget({ ...connection, port: 8443 }, session),
    ).toBe("https://fixture.invalid:8443/");
  });
  it.each([
    "http://fixture.invalid",
    "https://fixture.invalid:8443",
    "https://user:secret@fixture.invalid",
    "javascript:alert(1)",
  ])("rejects conflicting or unsafe saved targets: %s", (hostname) => {
    expect(() =>
      originBrowserConnectionTarget(connection, { ...session, hostname }),
    ).toThrow();
  });
  it("rejects unsafe display URLs", () => {
    expect(
      originBrowserDisplayUrl("https://user:secret@fixture.invalid/"),
    ).toBe("");
    expect(originBrowserDisplayUrl("javascript:alert(1)")).toBe("");
  });
});
