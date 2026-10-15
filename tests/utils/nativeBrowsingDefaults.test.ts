import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/nativeBrowsingDefaults.json";
import {
  DEFAULT_HTTP_PROXY_POLICY,
  type HttpProxyPolicy,
} from "../../src/types/connection/httpProxyPolicy";
import {
  nativeBrowsingMode,
  nativeBrowserContentAllowed,
} from "../../src/utils/connection/nativeBrowsingDefaults";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import { resolveBrowserProxyPolicy } from "../../src/utils/settings/webBrowserSettings";
const connection = {
  protocol: "https" as const,
  hostname: "ordinary.example",
  port: 443,
};
describe("normal native browsing defaults", () => {
  it.each(fixtures)("matches the native parity case: $name", (fixture) => {
    expect(
      nativeBrowsingMode(
        fixture.policy as Partial<HttpProxyPolicy> | undefined,
      ) === "standard",
    ).toBe(fixture.standard);
  });
  it("migrates canonical false flags for native previews without widening legacy policy", () => {
    const policy = normalizeHttpProxyPolicy(undefined);
    expect(nativeBrowserContentAllowed(connection, policy, undefined)).toBe(
      true,
    );
    expect(policy.allowAllRequests).toBe(false);
    expect(policy.allowAllScripts).toBe(false);
    expect(resolveBrowserProxyPolicy(policy, undefined)).toEqual(policy);
  });
  it("persists an explicit restricted decision across normalization and shared inheritance", () => {
    const policy = normalizeHttpProxyPolicy({
      ...DEFAULT_HTTP_PROXY_POLICY,
      nativeBrowsingMode: "restricted",
    });
    expect(nativeBrowsingMode(JSON.parse(JSON.stringify(policy)))).toBe(
      "restricted",
    );
    expect(
      nativeBrowserContentAllowed(
        connection,
        resolveBrowserProxyPolicy(policy, undefined),
        undefined,
      ),
    ).toBe(false);
    expect(
      nativeBrowserContentAllowed(
        connection,
        resolveBrowserProxyPolicy(undefined, { defaultPolicy: policy }),
        undefined,
      ),
    ).toBe(false);
  });
  it("does not let standard browsing override explicit class blocks or page restrictions", () => {
    const policy = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      nativeBrowsingMode: "standard" as const,
    };
    const permissions = {
      version: 1 as const,
      websites: [
        {
          origin: "https://ordinary.example",
          requestClasses: { script: "deny" as const },
          destinations: [],
        },
      ],
    };
    expect(
      nativeBrowserContentAllowed(
        { ...connection, websiteDomainPermissions: permissions },
        policy,
        undefined,
      ),
    ).toBe(false);
    expect(nativeBrowserContentAllowed(connection, policy, permissions)).toBe(
      false,
    );
    expect(
      nativeBrowserContentAllowed(
        connection,
        { ...policy, sameOriginOnly: true },
        undefined,
      ),
    ).toBe(false);
    expect(
      nativeBrowserContentAllowed(
        connection,
        { ...policy, pageScripts: "block" },
        undefined,
      ),
    ).toBe(false);
  });
  it.each([null, true, "normal", 1])(
    "rejects malformed persisted modes %j",
    (nativeBrowsingMode) => {
      expect(() =>
        normalizeHttpProxyPolicy({
          ...DEFAULT_HTTP_PROXY_POLICY,
          nativeBrowsingMode,
        }),
      ).toThrow();
    },
  );
});
