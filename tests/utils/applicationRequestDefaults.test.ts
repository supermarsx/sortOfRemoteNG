import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { WEBSITE_REQUEST_CLASSES } from "../../src/types/settings/websiteDomainPermissions";
import {
  applicationRequestDefaultOrigin,
  applicationRequestsAllowed,
  setApplicationRequestPermission,
} from "../../src/utils/connection/applicationRequestDefaults";
import { resolveWebsiteRequestPermission } from "../../src/utils/settings/websiteDomainPermissions";
const origin = "https://zoom.us";
const row: Partial<Connection> = {
  protocol: "https",
  hostname: "zoom.us",
  port: 443,
  httpApplication: { version: 1, id: "zoom", loginMode: "manual" },
};
const defaults = Object.fromEntries(
  WEBSITE_REQUEST_CLASSES.map((key) => [key, "allow"]),
);
describe("Zoom origin-bound request defaults", () => {
  it("keeps exact app-origin pins when inline ports override default editor ports", () => {
    expect(
      applicationRequestDefaultOrigin({ ...row, hostname: "zoom.us:443" }),
    ).toBe(origin);
    expect(
      applicationRequestDefaultOrigin({ ...row, hostname: "zoom.us:8443" }),
    ).toBeNull();
    expect(
      applicationRequestDefaultOrigin({
        ...row,
        hostname: "zoom.us:443",
        port: 8443,
      }),
    ).toBeNull();
  });
  it("previews all actual request classes without mutating normalized or persisted false", () => {
    const connection = {
      ...row,
      httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
    };
    expect(
      applicationRequestsAllowed(
        connection,
        connection.httpProxyPolicy,
        undefined,
      ),
    ).toBe(true);
    expect(connection.httpProxyPolicy.allowAllRequests).toBe(false);
    expect(applicationRequestDefaultOrigin(connection)).toBe(origin);
  });
  it.each([
    { hostname: "zoom.us.evil.test" },
    { hostname: "www.zoom.us" },
    { port: 8443 },
    { port: 0 },
    { port: NaN },
    { hostname: "zoom.us:0", port: undefined },
    { hostname: "https://zoom.us:8443/signin" },
    { protocol: "http" as const },
    { isGroup: true },
    {
      httpApplication: {
        version: 1 as const,
        id: "linkedin",
        loginMode: "manual" as const,
      },
    },
  ])("refuses an unrelated or malformed saved source %j", (change) => {
    expect(applicationRequestDefaultOrigin({ ...row, ...change })).toBeNull();
  });
  it.each(WEBSITE_REQUEST_CLASSES)(
    "honors explicit %s class denials",
    (requestClass) => {
      const permissions = {
        version: 1 as const,
        websites: [
          {
            origin,
            requestClasses: { [requestClass]: "deny" as const },
            destinations: [],
          },
        ],
      };
      expect(
        applicationRequestsAllowed(
          { ...row, websiteDomainPermissions: permissions },
          DEFAULT_HTTP_PROXY_POLICY,
          undefined,
        ),
      ).toBe(false);
      expect(
        applicationRequestsAllowed(row, DEFAULT_HTTP_PROXY_POLICY, permissions),
      ).toBe(false);
    },
  );
  it.each([
    { sameOriginOnly: true },
    { pageScripts: "block" as const },
    { pageScripts: "inline-only" as const },
  ])("honors native restrictions %j", (change) => {
    expect(
      applicationRequestsAllowed(
        row,
        { ...DEFAULT_HTTP_PROXY_POLICY, ...change },
        undefined,
      ),
    ).toBe(false);
  });
  it("revokes unlisted destinations while preserving own-origin use and destination denials across a round trip", () => {
    const connection = {
      ...row,
      websiteDomainPermissions: {
        version: 1 as const,
        websites: [
          {
            origin,
            requestClasses: {},
            destinations: [
              {
                origin: "https://blocked.example",
                requestClasses: { script: "deny" as const },
              },
            ],
          },
        ],
      },
    };
    const denied = JSON.parse(
      JSON.stringify(setApplicationRequestPermission(connection, false)),
    );
    expect(
      applicationRequestsAllowed(
        { ...row, websiteDomainPermissions: denied },
        DEFAULT_HTTP_PROXY_POLICY,
        undefined,
      ),
    ).toBe(false);
    for (const requestClass of WEBSITE_REQUEST_CLASSES) {
      const query = {
        websiteOrigin: origin,
        requestClass,
        connectionOverrides: denied,
        applicationDefaults: defaults,
      };
      expect(
        resolveWebsiteRequestPermission({ ...query, destinationOrigin: origin })
          .decision,
      ).toBe("allow");
      expect(
        resolveWebsiteRequestPermission({
          ...query,
          destinationOrigin: "https://unlisted.example",
        }).decision,
      ).toBe("deny");
    }
    const allowed = setApplicationRequestPermission(
      { ...row, websiteDomainPermissions: denied },
      true,
    );
    expect(
      applicationRequestsAllowed(
        { ...row, websiteDomainPermissions: allowed },
        DEFAULT_HTTP_PROXY_POLICY,
        undefined,
      ),
    ).toBe(true);
    expect(allowed.websites[0].destinations[0]).toEqual(
      connection.websiteDomainPermissions.websites[0].destinations[0],
    );
    expect(
      connection.websiteDomainPermissions.websites[0].requestClasses,
    ).toEqual({});
  });
  it("does not turn existing shared or connection own-source denials into allowances on opt-out", () => {
    const shared = {
      version: 1 as const,
      websites: [
        {
          origin,
          requestClasses: { worker: "deny" as const },
          destinations: [
            { origin, requestClasses: { navigation: "deny" as const } },
          ],
        },
      ],
    };
    const denied = setApplicationRequestPermission(row, false, shared);
    const own = denied.websites[0].destinations.find(
      (entry) => entry.origin === origin,
    )!;
    expect(own.requestClasses.worker).toBe("deny");
    expect(own.requestClasses.navigation).toBe("deny");
  });
  it("refuses invalid shared settings and full destination lists without changing existing permissions", () => {
    expect(() =>
      setApplicationRequestPermission(row, false, { version: 2 }),
    ).toThrow();
    const connection = {
      ...row,
      websiteDomainPermissions: {
        version: 1 as const,
        websites: [
          {
            origin,
            requestClasses: {},
            destinations: Array.from({ length: 32 }, (_, i) => ({
              origin: `https://asset${i}.example`,
              requestClasses: { script: "deny" as const },
            })),
          },
        ],
      },
    };
    const before = structuredClone(connection);
    expect(() => setApplicationRequestPermission(connection, false)).toThrow();
    expect(connection).toEqual(before);
  });
});
