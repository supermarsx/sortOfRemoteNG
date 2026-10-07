import { describe, expect, it } from "vitest";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

describe("native website permission persistence", () => {
  it("preserves an explicit shared policy without changing legacy proxy grants", () => {
    const previous = normalizeWebBrowserSettings(undefined);
    const next = normalizeWebBrowserSettings({
      ...previous,
      domainPermissions: {
        version: 1,
        websites: [
          {
            origin: "HTTPS://Portal.Example.test:443/",
            requestClasses: { script: "deny" },
            destinations: [
              {
                origin: "https://assets.example.test",
                requestClasses: { stylesheet: "allow", font: "allow" },
              },
            ],
          },
        ],
      },
    });
    expect(next.domainPermissions?.websites[0].origin).toBe(
      "https://portal.example.test",
    );
    expect(next.defaultPolicy).toEqual(previous.defaultPolicy);
    expect(
      normalizeWebBrowserSettings(JSON.parse(JSON.stringify(next))),
    ).toEqual(next);
  });

  it("does not synthesize grants for legacy settings", () => {
    expect(
      normalizeWebBrowserSettings(undefined).domainPermissions,
    ).toBeUndefined();
  });

  it.each([
    null,
    {},
    { version: 1, websites: [{ origin: "https://example.test?token=secret" }] },
  ])(
    "rejects malformed policy without silently restoring permissive defaults",
    (domainPermissions) => {
      expect(() =>
        normalizeWebBrowserSettings({ domainPermissions }),
      ).toThrow();
    },
  );
});
