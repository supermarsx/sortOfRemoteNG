import { describe, expect, it } from "vitest";
import {
  WEBSITE_REQUEST_CLASSES,
  type WebsiteDomainPermissionsSettings,
  type WebsitePermissionQuery,
  type WebsiteRequestClassPermissions,
} from "../../src/types/settings/websiteDomainPermissions";
import {
  MAX_WEBSITE_PERMISSION_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH,
  MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_WEBSITES,
  canonicalWebsitePermissionOrigin,
  normalizeWebsiteDomainPermissions,
  resolveWebsiteRequestClassDefault,
  resolveWebsiteRequestPermission,
} from "../../src/utils/settings/websiteDomainPermissions";

const WEBSITE = "https://example.com";
const DESTINATION = "https://cdn.example.com";
const policy = (
  requestClasses: WebsiteRequestClassPermissions = {},
  destinationClasses: WebsiteRequestClassPermissions = {},
): WebsiteDomainPermissionsSettings => ({
  version: 1,
  websites: [
    {
      origin: WEBSITE,
      requestClasses,
      destinations: [
        { origin: DESTINATION, requestClasses: destinationClasses },
      ],
    },
  ],
});
const query = (
  overrides: Partial<WebsitePermissionQuery> = {},
): WebsitePermissionQuery => ({
  websiteOrigin: WEBSITE,
  destinationOrigin: DESTINATION,
  requestClass: "script",
  ...overrides,
});

describe("exact HTTPS website permission origins", () => {
  it.each([
    ["https://EXAMPLE.com/", WEBSITE],
    ["HTTPS://example.com:443", WEBSITE],
    ["https://example.com:8443/", "https://example.com:8443"],
    ["https://bücher.example", "https://xn--bcher-kva.example"],
    ["https://xn--bcher-kva.example/", "https://xn--bcher-kva.example"],
    ["https://192.0.2.1", "https://192.0.2.1"],
    ["https://[2001:0DB8:0:0:0:0:0:1]:8443", "https://[2001:db8::1]:8443"],
  ])("canonicalizes %s without expanding the origin", (input, expected) => {
    expect(canonicalWebsitePermissionOrigin(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    "example.com",
    "//example.com",
    "http://example.com",
    "wss://example.com",
    "ws://example.com",
    "file:///example.com",
    "https://*.example.com",
    "https://example.com.*",
    "https://example.com/path",
    "https://example.com/.",
    "https://example.com//",
    "https://user:secret@example.com",
    "https://@example.com",
    "https://example.com?",
    "https://example.com?token=secret",
    "https://example.com#",
    "https://example.com/#fragment",
    " https://example.com",
    "https://example.com ",
    "https://exam\nple.com",
    "https://exam\tple.com",
    "https://exam\u00adple.com",
    "https://example.com\\evil.test",
    "https://%65xample.com",
    "https:////example.com",
    "https:///example.com",
    "https://example.com:",
    "https://example.com:0",
    "https://example.com:0443",
    "https://example.com:65536",
    "https://example.com:abc",
    "https://example.com.",
    "https://-example.com",
    "https://exam_ple.com",
    "https://example..com",
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://0177.0.0.1",
    "https://[fe80::1%25eth0]",
    `https://${"x".repeat(64)}.com`,
    `https://${"x".repeat(MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH)}`,
  ])("rejects unsafe or ambiguous origin %j", (input) => {
    expect(() => canonicalWebsitePermissionOrigin(input)).toThrow(
      "Invalid website request permissions.",
    );
  });
});

describe("bounded public website policy", () => {
  it("defaults only an absent document and clones/normalizes valid rules", () => {
    expect(normalizeWebsiteDomainPermissions(undefined)).toEqual({
      version: 1,
      websites: [],
    });
    const input = policy(
      { script: "inherit", worker: "deny" },
      { font: "allow" },
    );
    input.websites[0].origin = "https://EXAMPLE.com:443/";
    const result = normalizeWebsiteDomainPermissions(input);
    expect(result.websites[0].origin).toBe(WEBSITE);
    result.websites[0].requestClasses.worker = "allow";
    result.websites[0].destinations[0].requestClasses.font = "deny";
    expect(input.websites[0].requestClasses.worker).toBe("deny");
    expect(input.websites[0].destinations[0].requestClasses.font).toBe("allow");
    expect(input.websites[0].origin).toBe("https://EXAMPLE.com:443/");
  });

  it.each([
    null,
    [],
    {},
    { version: 2, websites: [] },
    { version: "1", websites: [] },
    { version: 1, websites: null },
    { version: 1, websites: [], token: "secret" },
    { version: 1, websites: new Array(1) },
    { version: 1, websites: [null] },
    { version: 1, websites: [{ origin: WEBSITE, credentials: "secret" }] },
    { version: 1, websites: [{ origin: WEBSITE, requestClasses: null }] },
    {
      version: 1,
      websites: [{ origin: WEBSITE, requestClasses: { unknown: "allow" } }],
    },
    {
      version: 1,
      websites: [{ origin: WEBSITE, requestClasses: { script: true } }],
    },
    {
      version: 1,
      websites: [{ origin: WEBSITE, requestClasses: { script: "ALLOW" } }],
    },
    {
      version: 1,
      websites: [{ origin: WEBSITE, requestClasses: { script: undefined } }],
    },
    { version: 1, websites: [{ origin: WEBSITE, destinations: null }] },
    { version: 1, websites: [{ origin: WEBSITE, destinations: new Array(1) }] },
    {
      version: 1,
      websites: [
        {
          origin: WEBSITE,
          destinations: [{ origin: DESTINATION, secret: "secret" }],
        },
      ],
    },
    {
      version: 1,
      websites: [
        {
          origin: WEBSITE,
          destinations: [
            { origin: DESTINATION, requestClasses: { inline: "allow" } },
          ],
        },
      ],
    },
    JSON.parse('{"version":1,"websites":[],"__proto__":{"script":"allow"}}'),
    Object.assign(Object.create({ inherited: "allow" }) as object, {
      version: 1,
      websites: [],
    }),
    { version: 1, websites: [], [Symbol("secret")]: "secret" },
  ])(
    "rejects malformed/unknown fields without exposing secrets (%#)",
    (input) => {
      expect(() => normalizeWebsiteDomainPermissions(input)).toThrow(
        "Invalid website request permissions.",
      );
      expect(
        resolveWebsiteRequestPermission(
          query({
            sharedSettings: input,
            applicationDefaults: { script: "allow" },
          }),
        ),
      ).toEqual({ decision: "deny", source: "invalid-policy" });
    },
  );

  it("rejects duplicate canonical websites and destinations", () => {
    const websites = policy();
    websites.websites.push({
      ...websites.websites[0],
      origin: "https://EXAMPLE.com:443/",
    });
    expect(() => normalizeWebsiteDomainPermissions(websites)).toThrow();
    const destinations = policy();
    destinations.websites[0].destinations.push({
      origin: "https://CDN.example.com/",
      requestClasses: { script: "deny" },
    });
    expect(() => normalizeWebsiteDomainPermissions(destinations)).toThrow();
    const idn = policy();
    idn.websites[0].destinations = [
      "https://bücher.example",
      "https://xn--bcher-kva.example",
    ].map((origin) => ({ origin, requestClasses: {} }));
    expect(() => normalizeWebsiteDomainPermissions(idn)).toThrow();
  });

  it("enforces website, per-website destination and total destination limits without truncation", () => {
    const sites = {
      version: 1,
      websites: Array.from(
        { length: MAX_WEBSITE_PERMISSION_WEBSITES },
        (_, i) => ({
          origin: `https://site${i}.example`,
          requestClasses: {},
          destinations: [],
        }),
      ),
    };
    expect(normalizeWebsiteDomainPermissions(sites).websites).toHaveLength(
      MAX_WEBSITE_PERMISSION_WEBSITES,
    );
    expect(() =>
      normalizeWebsiteDomainPermissions({
        ...sites,
        websites: [...sites.websites, { origin: "https://extra.example" }],
      }),
    ).toThrow();
    const rules = policy();
    rules.websites[0].destinations = Array.from(
      { length: MAX_WEBSITE_PERMISSION_DESTINATIONS },
      (_, i) => ({ origin: `https://cdn${i}.example`, requestClasses: {} }),
    );
    expect(
      normalizeWebsiteDomainPermissions(rules).websites[0].destinations,
    ).toHaveLength(MAX_WEBSITE_PERMISSION_DESTINATIONS);
    expect(() =>
      normalizeWebsiteDomainPermissions({
        version: 1,
        websites: [
          {
            ...rules.websites[0],
            destinations: [
              ...rules.websites[0].destinations,
              { origin: "https://extra.example" },
            ],
          },
        ],
      }),
    ).toThrow();
    const full = {
      version: 1,
      websites: Array.from(
        {
          length:
            MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS /
            MAX_WEBSITE_PERMISSION_DESTINATIONS,
        },
        (_, i) => ({
          ...rules.websites[0],
          origin: `https://site${i}.example`,
        }),
      ),
    };
    expect(normalizeWebsiteDomainPermissions(full).websites).toHaveLength(8);
    expect(() =>
      normalizeWebsiteDomainPermissions({
        ...full,
        websites: [
          ...full.websites,
          {
            origin: "https://extra.example",
            destinations: [{ origin: DESTINATION }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("effective website permission precedence", () => {
  it.each(WEBSITE_REQUEST_CLASSES)(
    "resolves every precedence level for %s",
    (requestClass) => {
      const shared = policy(
        { [requestClass]: "deny" },
        { [requestClass]: "allow" },
      );
      const connection = policy(
        { [requestClass]: "deny" },
        { [requestClass]: "allow" },
      );
      const input = query({
        requestClass,
        sharedSettings: shared,
        connectionOverrides: connection,
        applicationDefaults: { [requestClass]: "allow" },
      });
      expect(
        resolveWebsiteRequestPermission({ ...input, nativeConstraint: "deny" }),
      ).toEqual({ decision: "deny", source: "native-constraint" });
      expect(resolveWebsiteRequestPermission(input)).toEqual({
        decision: "allow",
        source: "connection-destination",
      });
      connection.websites[0].destinations[0].requestClasses[requestClass] =
        "inherit";
      expect(resolveWebsiteRequestPermission(input)).toEqual({
        decision: "deny",
        source: "connection-class",
      });
      connection.websites[0].requestClasses[requestClass] = "inherit";
      expect(resolveWebsiteRequestPermission(input)).toEqual({
        decision: "allow",
        source: "shared-destination",
      });
      shared.websites[0].destinations[0].requestClasses[requestClass] =
        "inherit";
      expect(resolveWebsiteRequestPermission(input)).toEqual({
        decision: "deny",
        source: "shared-class",
      });
      shared.websites[0].requestClasses[requestClass] = "inherit";
      expect(resolveWebsiteRequestPermission(input)).toEqual({
        decision: "allow",
        source: "application-default",
      });
      expect(
        resolveWebsiteRequestPermission({
          ...input,
          applicationDefaults: undefined,
        }),
      ).toEqual({ decision: "deny", source: "application-default" });
    },
  );

  it("respects explicit denies and class overrides independently of allow/deny direction", () => {
    expect(
      resolveWebsiteRequestPermission(
        query({
          sharedSettings: policy({ script: "allow" }, { script: "deny" }),
        }),
      ),
    ).toEqual({ decision: "deny", source: "shared-destination" });
    expect(
      resolveWebsiteRequestPermission(
        query({
          sharedSettings: policy({}, { script: "deny" }),
          connectionOverrides: policy({ script: "allow" }),
        }),
      ),
    ).toEqual({ decision: "allow", source: "connection-class" });
    expect(
      resolveWebsiteRequestPermission(
        query({
          connectionOverrides: policy({ script: "allow" }, { script: "deny" }),
        }),
      ),
    ).toEqual({ decision: "deny", source: "connection-destination" });
  });

  it.each([
    "https://sub.cdn.example.com",
    "https://cdn.example.com.evil.test",
    "https://cdn.example.com:8443",
    WEBSITE,
  ])("never broadens an exact destination to %s", (destinationOrigin) => {
    expect(
      resolveWebsiteRequestPermission(
        query({
          destinationOrigin,
          sharedSettings: policy({}, { script: "allow" }),
        }),
      ),
    ).toEqual({ decision: "deny", source: "application-default" });
  });

  it.each([
    "https://sub.example.com",
    "https://example.com:8443",
    "https://other.test",
  ])(
    "keeps shared and connection grants bound to the website origin (%s)",
    (websiteOrigin) => {
      expect(
        resolveWebsiteRequestPermission(
          query({
            websiteOrigin,
            sharedSettings: policy({ script: "allow" }),
            connectionOverrides: policy({}, { script: "allow" }),
          }),
        ),
      ).toEqual({ decision: "deny", source: "application-default" });
    },
  );

  it("matches IDN/default-port canonical forms and keeps request classes independent", () => {
    const shared = policy({ script: "allow" }, { font: "allow" });
    shared.websites[0].destinations[0].origin = "https://bücher.example:443/";
    expect(
      resolveWebsiteRequestPermission(
        query({
          sharedSettings: shared,
          websiteOrigin: "https://EXAMPLE.com:443/",
          destinationOrigin: "https://xn--bcher-kva.example",
          requestClass: "font",
        }),
      ),
    ).toEqual({ decision: "allow", source: "shared-destination" });
    expect(
      resolveWebsiteRequestPermission(
        query({ sharedSettings: shared, requestClass: "worker" }),
      ),
    ).toEqual({ decision: "deny", source: "application-default" });
  });

  it.each([
    { requestClass: "other" },
    { requestClass: "inline" },
    { requestClass: "SCRIPT" },
    { requestClass: null },
    { destinationOrigin: undefined },
    { destinationOrigin: "https://cdn.example.com/path" },
    { destinationOrigin: "wss://cdn.example.com" },
    { websiteOrigin: "http://example.com" },
  ])("denies unknown requests even with explicit allows (%j)", (overrides) => {
    expect(
      resolveWebsiteRequestPermission(
        query({ sharedSettings: policy({ script: "allow" }), ...overrides }),
      ),
    ).toEqual({ decision: "deny", source: "invalid-request" });
  });

  it.each([
    null,
    { script: true },
    { script: "inherit" },
    { other: "allow" },
    { script: "allow", credentials: "secret" },
  ])("rejects malformed application defaults %j", (applicationDefaults) => {
    expect(
      resolveWebsiteRequestPermission(
        query({
          applicationDefaults,
          connectionOverrides: policy({ script: "allow" }),
        }),
      ),
    ).toEqual({ decision: "deny", source: "invalid-policy" });
  });

  it("rejects corrupt masked rules and never treats malformed native input as permission", () => {
    expect(
      resolveWebsiteRequestPermission(
        query({
          sharedSettings: { version: 9, websites: [] },
          connectionOverrides: policy({}, { script: "allow" }),
        }),
      ),
    ).toEqual({ decision: "deny", source: "invalid-policy" });
    expect(
      resolveWebsiteRequestPermission(
        query({
          sharedSettings: policy({ script: "allow" }),
          nativeConstraint: "allow" as "deny",
        }),
      ),
    ).toEqual({ decision: "deny", source: "invalid-policy" });
  });

  it("previews class defaults separately from destination-specific effective rules", () => {
    const input = query({
      sharedSettings: policy({ script: "deny" }, { script: "allow" }),
    });
    expect(resolveWebsiteRequestClassDefault(input)).toEqual({
      decision: "deny",
      source: "shared-class",
    });
    expect(resolveWebsiteRequestPermission(input)).toEqual({
      decision: "allow",
      source: "shared-destination",
    });
    expect(
      resolveWebsiteRequestClassDefault({ ...input, nativeConstraint: "deny" }),
    ).toEqual({ decision: "deny", source: "native-constraint" });
  });
});
