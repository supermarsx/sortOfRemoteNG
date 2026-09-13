import { describe, expect, it } from "vitest";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { normalizeSynologySettings } from "../../src/types/protocols/synology";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  isSynologyDefaultRedirect,
  isSynologyDefaultRedirectOrigin,
  synologyDefaultRedirectOrigins,
  synologyRedirectDefaultsForConnection,
  withSynologyRedirectDefaults,
} from "../../src/utils/protocol/synologyRedirectDefaults";

const portals = [
  "https://global.quickconnect.to",
  "https://www.quickconnect.to",
];
const source = "https://my-nas.fr3.quickconnect.to";
const context = { version: 1 as const, originalOrigin: source };

describe("closed Synology redirect defaults", () => {
  it("permits HTTPS known-shape regions only for the original alias, including a return to its original region", () => {
    const policy = withSynologyRedirectDefaults(
      { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
      context,
    );
    for (const origin of [
      source,
      "https://my-nas.de2.quickconnect.to",
      "https://my-nas.us123.quickconnect.to",
    ]) {
      expect(isSynologyDefaultRedirect(policy, portals[0], origin + "/")).toBe(
        true,
      );
      expect(isSynologyDefaultRedirect(policy, origin, source + "/")).toBe(
        true,
      );
    }
    for (const origin of [
      "http://my-nas.fr3.quickconnect.to",
      "https://my-nas.fr3.quickconnect.to:5001",
      "https://other-nas.fr3.quickconnect.to",
      "https://my-nas.fr.quickconnect.to",
      "https://my-nas.fr3x.quickconnect.to",
      "https://my-nas.x.fr3.quickconnect.to",
      "https://my-nas.fr3.quickconnect.to.",
      "https://my-nas.fr3.quickconnect.to.attacker.invalid",
    ]) {
      expect(isSynologyDefaultRedirectOrigin(source, origin)).toBe(false);
      expect(isSynologyDefaultRedirect(policy, portals[0], origin + "/")).toBe(
        false,
      );
    }
    expect(
      isSynologyDefaultRedirect(
        { ...policy, synologyQuickConnectDefaults: undefined },
        portals[0],
        source + "/",
      ),
    ).toBe(false);
  });
  it("permits only the original NAS direct HTTPS namespace at ports5001/5002, including later source validation", () => {
    const policy = withSynologyRedirectDefaults(
      { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
      context,
    );
    const allowed = [
      "https://my-nas.direct.quickconnect.to:5001",
      "https://my-nas.direct.quickconnect.to:5002",
      "https://192-168-50-100.my-nas.direct.quickconnect.to:5002",
    ];
    for (const origin of allowed) {
      expect(isSynologyDefaultRedirectOrigin(source, origin)).toBe(true);
      expect(
        isSynologyDefaultRedirect(policy, source, origin + "/webman/"),
      ).toBe(true);
      expect(isSynologyDefaultRedirect(policy, origin, portals[0] + "/")).toBe(
        true,
      );
    }
    for (const origin of [
      "http://my-nas.direct.quickconnect.to:5001",
      "https://my-nas.direct.quickconnect.to",
      "https://my-nas.direct.quickconnect.to:5003",
      "https://other-nas.direct.quickconnect.to:5001",
      "https://x.y.my-nas.direct.quickconnect.to:5001",
      "https://my-nas.direct.quickconnect.to.attacker.invalid:5001",
      "https://x_y.my-nas.direct.quickconnect.to:5001",
    ]) {
      expect(isSynologyDefaultRedirectOrigin(source, origin)).toBe(false);
      expect(isSynologyDefaultRedirect(policy, source, origin + "/")).toBe(
        false,
      );
    }
    expect(
      isSynologyDefaultRedirectOrigin(
        "https://global.quickconnect.to",
        allowed[0],
      ),
    ).toBe(false);
    expect(
      isSynologyDefaultRedirectOrigin(
        "https://custom.internal:5001",
        allowed[0],
      ),
    ).toBe(false);
  });
  it("retains only the original alias through all allowed portal hops", () => {
    const origins = [
      "http://my-nas.quickconnect.to",
      "https://my-nas.quickconnect.to",
      ...portals,
    ];
    expect(synologyDefaultRedirectOrigins(source)).toEqual(origins);
    expect(
      synologyDefaultRedirectOrigins("https://my-nas.quickconnect.to"),
    ).toEqual(origins);
    const policy = withSynologyRedirectDefaults(
      DEFAULT_HTTP_PROXY_POLICY,
      context,
    );
    for (const current of [source, ...origins]) {
      for (const target of origins)
        expect(
          isSynologyDefaultRedirect(policy, current, `${target}/path`),
        ).toBe(true);
      for (const target of [
        "http://other-nas.quickconnect.to/",
        "http://my-nas.fr3.quickconnect.to/",
        "https://other-nas.quickconnect.to/",
        "https://my-nas.quickconnect.to:5001/",
        "http://global.quickconnect.to/",
        "http://www.quickconnect.to/",
        "https://global.quickconnect.to:5001/",
        "https://www.quickconnect.to.attacker.invalid/",
        "http://my-nas.quickconnect.cn/",
      ])
        expect(isSynologyDefaultRedirect(policy, current, target)).toBe(false);
    }
    expect(
      isSynologyDefaultRedirect(
        policy,
        "https://other-nas.quickconnect.to",
        `${portals[0]}/`,
      ),
    ).toBe(false);
  });
  it.each([
    "https://nas.example:5001",
    "http://[::1]:5000",
    "https://quickconnect.to",
    "https://global.quickconnect.to",
    "https://www.quickconnect.to",
    "https://relay.quickconnect.to",
    "https://nas.direct.quickconnect.to",
    "https://nas.region.direct.quickconnect.to",
    "https://nas.fr.quickconnect.to",
    "https://nas.fr3x.quickconnect.to",
  ])("does not invent an alias for %s", (origin) => {
    expect(synologyDefaultRedirectOrigins(origin)).toEqual(portals);
  });
  it.each([
    "https://nas.quickconnect.to/",
    "https://nas.quickconnect.to:443",
    "https://nas.quickconnect.to:5001",
    "https://nas.quickconnect.to.",
    "https://user:private@nas.quickconnect.to",
    "https://nas.quickconnect.to?token=private",
    "https://nas.quickconnect.to#next",
    "https://nas.quickconnect.to:0",
    "ftp://nas.quickconnect.to",
    "https://NAS.quickconnect.to",
    "https://-nas.quickconnect.to",
    "https://nas-.quickconnect.to",
    "https://%6eas.quickconnect.to",
    "https://*.quickconnect.to",
  ])("rejects noncanonical runtime scope %s", (origin) => {
    expect(() => synologyDefaultRedirectOrigins(origin)).toThrow(
      "Invalid Synology QuickConnect redirect defaults.",
    );
    expect(() =>
      withSynologyRedirectDefaults(DEFAULT_HTTP_PROXY_POLICY, {
        version: 1,
        originalOrigin: origin,
      }),
    ).toThrow();
  });
  it("validates context shape and never grants malformed destination syntax", () => {
    for (const malformed of [
      null,
      { version: 2, originalOrigin: source },
      { version: 1, originalOrigin: source, enabled: true },
      {
        version: 1,
        get originalOrigin() {
          throw new Error("private");
        },
      },
    ]) {
      expect(() =>
        withSynologyRedirectDefaults(
          DEFAULT_HTTP_PROXY_POLICY,
          malformed as never,
        ),
      ).toThrow("Invalid Synology QuickConnect redirect defaults.");
    }
    const policy = withSynologyRedirectDefaults(
      DEFAULT_HTTP_PROXY_POLICY,
      context,
    );
    for (const target of [
      "https://user@global.quickconnect.to/",
      "https://global.quickconnect.to./",
      "https://global.quickconnect.to/?secret=x",
      "https://global.quickconnect.to/#next",
      "https://%67lobal.quickconnect.to/",
      "https://global.quickconnect.to\\@evil.invalid/",
    ])
      expect(isSynologyDefaultRedirect(policy, source, target)).toBe(false);
  });
  it("overrides only the broad redirect flags, never HTTPS-only or destination scheme", () => {
    const saved = { ...DEFAULT_HTTP_PROXY_POLICY, queryParameters: [] };
    const policy = withSynologyRedirectDefaults(saved, context);
    expect(
      isSynologyDefaultRedirect(
        policy,
        portals[0],
        "http://my-nas.quickconnect.to/",
      ),
    ).toBe(true);
    expect(
      isSynologyDefaultRedirect(
        { ...policy, httpsOnly: true },
        portals[0],
        "http://my-nas.quickconnect.to/",
      ),
    ).toBe(false);
    expect(
      isSynologyDefaultRedirect(
        { ...policy, httpsOnly: true },
        source,
        "https://my-nas.quickconnect.to/",
      ),
    ).toBe(true);
    expect(saved).not.toHaveProperty("synologyQuickConnectDefaults");
    expect(saved.allowCrossOriginRedirects).toBe(false);
    expect(saved.allowHttpDowngradeRedirects).toBe(false);
    expect(() => normalizeHttpProxyPolicy(policy)).toThrow();
    expect(isSynologyDefaultRedirect(saved, source, `${portals[0]}/`)).toBe(
      false,
    );
  });
  it("qualifies only HTTP(S) QuickConnect or explicit DSM websites, never API/group/disabled connections", () => {
    const connection = {
      protocol: "https" as const,
      hostname: "my-nas.fr3.quickconnect.to",
      port: 443,
    };
    expect(synologyRedirectDefaultsForConnection(connection)).toEqual(context);
    const custom = {
      ...connection,
      hostname: "nas.example",
      port: 5001,
      httpApplication: {
        version: 1 as const,
        id: "synology-dsm" as const,
        loginMode: "manual" as const,
      },
    };
    expect(synologyRedirectDefaultsForConnection(custom)?.originalOrigin).toBe(
      "https://nas.example:5001",
    );
    expect(
      synologyRedirectDefaultsForConnection({
        ...connection,
        hostname: "generic.example",
      }),
    ).toBeUndefined();
    expect(
      synologyRedirectDefaultsForConnection({ ...connection, port: 5001 }),
    ).toBeUndefined();
    expect(
      synologyRedirectDefaultsForConnection({ ...connection, isGroup: true }),
    ).toBeUndefined();
    expect(
      synologyRedirectDefaultsForConnection({
        ...connection,
        protocol: "synology",
      }),
    ).toBeUndefined();
    expect(
      synologyRedirectDefaultsForConnection({
        ...custom,
        synologySettings: { version: 1, useHttps: true, accessMode: "native" },
      }),
    ).toBeUndefined();
    expect(
      synologyRedirectDefaultsForConnection({
        ...connection,
        synologySettings: {
          version: 1,
          useHttps: true,
          useDefaultRedirectDestinations: false,
        },
      }),
    ).toBeUndefined();
  });
  it("strictly preserves saved opt-out, including across JSON round trips", () => {
    expect(normalizeSynologySettings(undefined)).not.toHaveProperty(
      "useDefaultRedirectDestinations",
    );
    const settings = {
      version: 1,
      useHttps: true,
      accessMode: "website",
      useDefaultRedirectDestinations: false,
    };
    expect(
      normalizeSynologySettings(JSON.parse(JSON.stringify(settings))),
    ).toEqual(settings);
    for (const value of [undefined, null, 0, 1, "false", [], {}])
      expect(() =>
        normalizeSynologySettings({
          version: 1,
          useHttps: true,
          useDefaultRedirectDestinations: value,
        }),
      ).toThrow();
  });
});
