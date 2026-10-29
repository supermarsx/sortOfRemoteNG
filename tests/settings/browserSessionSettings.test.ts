import { describe, expect, it } from "vitest";
import schema from "../../src/types/settings/browserSession.schema.json";
import {
  browserSessionIsolationKey,
  DEFAULT_BROWSER_HTTP_CACHE,
  DEFAULT_BROWSER_SESSION_RETENTION,
  normalizeBrowserHttpCacheOverride,
  normalizeBrowserHttpCacheSettings,
  normalizeBrowserSessionOverrides,
  normalizeBrowserSessionRetention,
  resolveBrowserSessionRetention,
  resolveConnectionBrowserSettings,
} from "../../src/utils/settings/browserSessionSettings";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import type { BrowserSessionRetentionCapabilities } from "../../src/types/settings/browserSession";

describe("browser session contract", () => {
  const nativeBooleans = [
    "localStorageEnabled",
    "databasesEnabled",
    "webglEnabled",
    "cookiesEnabled",
    "mediaStreamEnabled",
    "crossOriginRequestsEnabled",
    "websiteExtensionsEnabled",
    "hideAutomationIndicator",
    "restoreCookies",
  ] as const;
  it.each(nativeBooleans)(
    "defaults %s on and preserves explicit false through sparse inheritance",
    (key) => {
      expect(schema.properties[key]).toMatchObject({
        type: "boolean",
        default: true,
      });
      expect(normalizeWebBrowserSettings(undefined)[key]).toBe(true);
      expect(normalizeWebBrowserSettings({ version: 1 })[key]).toBe(true);
      const globals = normalizeWebBrowserSettings({ [key]: false });
      expect(globals[key]).toBe(false);
      expect(resolveConnectionBrowserSettings(globals, undefined)[key]).toBe(
        false,
      );
      const saved = { version: 1, [key]: true };
      expect(normalizeBrowserSessionOverrides(saved)).toEqual(saved);
      expect(resolveConnectionBrowserSettings(globals, saved)[key]).toBe(true);
      expect(
        resolveConnectionBrowserSettings(undefined, {
          version: 1,
          [key]: false,
        })[key],
      ).toBe(false);
      expect(normalizeBrowserSessionOverrides({ version: 1 })).toEqual({
        version: 1,
      });
      expect(globals[key]).toBe(false);
      expect(saved).toEqual({ version: 1, [key]: true });
    },
  );
  it.each(nativeBooleans)(
    "rejects malformed %s without coercing truthy values or widening the policy",
    (key) => {
      for (const value of ["true", "false", 0, 1, null, {}, []]) {
        expect(() => normalizeWebBrowserSettings({ [key]: value })).toThrow(
          /Invalid web browser/,
        );
        expect(() =>
          normalizeBrowserSessionOverrides({ version: 1, [key]: value }),
        ).toThrow(/Invalid browser session/);
      }
      expect(() =>
        normalizeBrowserSessionOverrides({ version: 1, [key]: undefined }),
      ).toThrow();
    },
  );
  it("does not turn capability preferences into retention, route grants or unsupported Chromium settings", () => {
    const effective = resolveConnectionBrowserSettings(undefined, {
      version: 1,
      crossOriginRequestsEnabled: true,
      websiteExtensionsEnabled: true,
    });
    expect(effective.sessionRetention).toEqual(
      DEFAULT_BROWSER_SESSION_RETENTION,
    );
    expect(effective.defaultPolicy.allowAllRequests).toBe(false);
    expect(effective.defaultPolicy.allowAllScripts).toBe(false);
    expect(effective.defaultPolicy.allowCrossOriginRedirects).toBe(false);
    expect(() =>
      normalizeWebBrowserSettings({ chromiumExtensionsEnabled: true }),
    ).toThrow();
    expect(() =>
      normalizeBrowserSessionOverrides({
        version: 1,
        chromiumExtensionsEnabled: true,
      }),
    ).toThrow();
    expect(() =>
      normalizeBrowserSessionOverrides({ version: 1, webSqlEnabled: true }),
    ).toThrow();
  });
  it("canonicalizes the legacy mode in globals and connection overrides without mutating stored input", () => {
    const legacy = {
      ...DEFAULT_BROWSER_SESSION_RETENTION,
      mode: "encrypted-local",
      idleTimeoutMinutes: 75,
      maxAgeHours: 48,
      clearOnDatabaseLock: true,
    };
    const before = structuredClone(legacy);
    const canonical = { ...legacy, mode: "encrypted-database" };
    expect(normalizeBrowserSessionRetention(legacy)).toEqual(canonical);
    expect(normalizeBrowserSessionRetention(canonical)).toEqual(canonical);
    expect(
      normalizeWebBrowserSettings({ sessionRetention: legacy })
        .sessionRetention,
    ).toEqual(canonical);
    expect(
      normalizeBrowserSessionOverrides({
        version: 1,
        sessionRetention: legacy,
      }),
    ).toEqual({ version: 1, sessionRetention: canonical });
    expect(
      resolveConnectionBrowserSettings({ sessionRetention: legacy }, undefined)
        .sessionRetention,
    ).toEqual(canonical);
    expect(
      resolveConnectionBrowserSettings(
        { sessionRetention: DEFAULT_BROWSER_SESSION_RETENTION },
        { version: 1, sessionRetention: legacy },
      ).sessionRetention,
    ).toEqual(canonical);
    expect(
      JSON.stringify(
        normalizeBrowserSessionOverrides({
          version: 1,
          sessionRetention: legacy,
        }),
      ),
    ).not.toContain("encrypted-local");
    expect(legacy).toEqual(before);
    expect(schema.$defs.retention.properties.mode.enum).toContain(
      "encrypted-local",
    );
    expect(
      schema.$defs.retention.properties.mode["x-legacyAliases"][
        "encrypted-local"
      ],
    ).toBe("encrypted-database");
  });

  it("does not turn legacy sidecar support or an alias into active database retention", () => {
    const legacy = {
      ...DEFAULT_BROWSER_SESSION_RETENTION,
      mode: "encrypted-local",
    };
    const oldBackend = {
      memory: true,
      encryptedLocal: true,
    } as unknown as BrowserSessionRetentionCapabilities;
    for (const capabilities of [
      undefined,
      oldBackend,
      { memory: true, encryptedDatabase: false, encryptedLocal: true },
    ]) {
      expect(
        resolveBrowserSessionRetention(legacy, capabilities),
      ).toMatchObject({
        requested: { mode: "encrypted-database" },
        effective: { mode: "ephemeral" },
        supported: false,
      });
    }
    expect(
      resolveBrowserSessionRetention(legacy, {
        memory: false,
        encryptedDatabase: true,
      }),
    ).toMatchObject({
      requested: { mode: "encrypted-database" },
      effective: { mode: "encrypted-database" },
      supported: true,
    });
  });

  it("still rejects malformed legacy policies instead of repairing their other fields", () => {
    for (const policy of [
      { mode: "encrypted-local" },
      {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-local",
        maxAgeHours: 0,
      },
      {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-local",
        profilePath: "foreign",
      },
      {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-local",
        clearOnDatabaseLock: null,
      },
    ])
      expect(() => normalizeBrowserSessionRetention(policy)).toThrow(
        /Invalid browser session/,
      );
  });

  it("defaults missing settings to encrypted-database retention with 7-day idle and 30-day maximum age", () => {
    const resolved = resolveConnectionBrowserSettings(undefined, undefined);
    expect(resolved.sessionRetention).toEqual(
      DEFAULT_BROWSER_SESSION_RETENTION,
    );
    expect(resolved.sessionRetention).toEqual({
      version: 1,
      mode: "encrypted-database",
      idleTimeoutMinutes: 10080,
      maxAgeHours: 720,
      clearOnDatabaseLock: false,
    });
    expect(Object.isFrozen(DEFAULT_BROWSER_SESSION_RETENTION)).toBe(true);
    expect(resolved.manualFormSubmit).toBe(true);
    expect(normalizeBrowserSessionOverrides(undefined)).toBeUndefined();
    for (const [key, rule] of Object.entries(schema.$defs.retention.properties))
      expect(
        resolved.sessionRetention[
          key as keyof typeof resolved.sessionRetention
        ],
      ).toBe(rule.default);
  });

  it("resolves the default policy to encrypted-database only when the runtime supports it", () => {
    const supported = resolveBrowserSessionRetention(undefined, {
      memory: true,
      encryptedDatabase: true,
    });
    expect(supported).toMatchObject({
      requested: DEFAULT_BROWSER_SESSION_RETENTION,
      effective: DEFAULT_BROWSER_SESSION_RETENTION,
      supported: true,
    });
    expect(supported.reason).toBeUndefined();
    for (const capabilities of [
      undefined,
      { memory: true, encryptedDatabase: false },
      { memory: false, encryptedDatabase: false },
    ]) {
      const fallback = resolveBrowserSessionRetention(
        DEFAULT_BROWSER_SESSION_RETENTION,
        capabilities,
      );
      expect(fallback.requested).toEqual(DEFAULT_BROWSER_SESSION_RETENTION);
      expect(fallback.effective.mode).toBe("ephemeral");
      expect(fallback.supported).toBe(false);
      expect(fallback.reason).toContain("ephemeral storage");
    }
    expect(DEFAULT_BROWSER_SESSION_RETENTION.mode).toBe("encrypted-database");
  });

  it("publishes HTTP cache defaults and ranges in the schema", () => {
    const cache = schema.$defs.httpCache;
    expect(cache.additionalProperties).toBe(false);
    expect(cache.properties).toEqual({
      enabled: { type: "boolean", default: true },
      perConnectionMb: {
        type: "integer",
        minimum: 16,
        maximum: 1024,
        default: 128,
      },
      totalMb: { type: "integer", minimum: 128, maximum: 8192, default: 1024 },
      clearOnDatabaseLock: { type: "boolean", default: false },
    });
    const override = schema.$defs.httpCacheOverride;
    expect(override.additionalProperties).toBe(false);
    expect(Object.keys(override.properties).sort()).toEqual([
      "enabled",
      "perConnectionMb",
    ]);
    expect(override.properties.perConnectionMb.$ref).toBe(
      "#/$defs/httpCache/properties/perConnectionMb",
    );
  });

  it("defaults the page cache from the schema and keeps saved values", () => {
    expect(DEFAULT_BROWSER_HTTP_CACHE).toEqual({
      enabled: true,
      perConnectionMb: 128,
      totalMb: 1024,
      clearOnDatabaseLock: false,
    });
    expect(Object.isFrozen(DEFAULT_BROWSER_HTTP_CACHE)).toBe(true);
    expect(normalizeBrowserHttpCacheSettings(undefined)).toEqual(
      DEFAULT_BROWSER_HTTP_CACHE,
    );
    expect(normalizeWebBrowserSettings(undefined).httpCache).toEqual(
      DEFAULT_BROWSER_HTTP_CACHE,
    );
    const saved = { enabled: false, totalMb: 4096 };
    expect(normalizeWebBrowserSettings({ httpCache: saved }).httpCache).toEqual(
      { ...DEFAULT_BROWSER_HTTP_CACHE, ...saved },
    );
    expect(saved).toEqual({ enabled: false, totalMb: 4096 });
    for (const [key, rule] of Object.entries(schema.$defs.httpCache.properties))
      expect(
        DEFAULT_BROWSER_HTTP_CACHE[
          key as keyof typeof DEFAULT_BROWSER_HTTP_CACHE
        ],
      ).toBe(rule.default);
  });

  it.each([
    null,
    [],
    "on",
    { enabled: "true" },
    { perConnectionMb: 15 },
    { perConnectionMb: 1025 },
    { perConnectionMb: 64.5 },
    { totalMb: 127 },
    { totalMb: 8193 },
    { clearOnDatabaseLock: 1 },
    { directory: "C:/cache" },
  ])("rejects malformed global page-cache settings %j", (httpCache) => {
    expect(() => normalizeBrowserHttpCacheSettings(httpCache)).toThrow(
      /Invalid browser session/,
    );
    expect(() => normalizeWebBrowserSettings({ httpCache })).toThrow();
  });

  it.each([
    null,
    { enabled: 0 },
    { perConnectionMb: 8 },
    { perConnectionMb: 2048 },
    { totalMb: 1024 },
    { clearOnDatabaseLock: true },
    { path: "../other" },
  ])(
    "rejects a malformed or non-overridable page-cache override %j",
    (httpCache) => {
      expect(() => normalizeBrowserHttpCacheOverride(httpCache)).toThrow(
        /Invalid browser session/,
      );
      expect(() =>
        normalizeBrowserSessionOverrides({ version: 1, httpCache }),
      ).toThrow(/Invalid browser session/);
    },
  );

  it("resolves sparse page-cache overrides against the global settings", () => {
    const globals = normalizeWebBrowserSettings({
      httpCache: { enabled: false, perConnectionMb: 256, totalMb: 2048 },
    });
    expect(
      resolveConnectionBrowserSettings(globals, undefined).httpCache,
    ).toEqual({
      enabled: false,
      perConnectionMb: 256,
      totalMb: 2048,
      clearOnDatabaseLock: false,
    });
    const overrides = { version: 1, httpCache: { enabled: true } };
    expect(normalizeBrowserSessionOverrides(overrides)).toEqual(overrides);
    expect(
      resolveConnectionBrowserSettings(globals, overrides).httpCache,
    ).toEqual({
      enabled: true,
      perConnectionMb: 256,
      totalMb: 2048,
      clearOnDatabaseLock: false,
    });
    expect(
      resolveConnectionBrowserSettings(globals, {
        version: 1,
        httpCache: { perConnectionMb: 64 },
      }).httpCache,
    ).toMatchObject({ enabled: false, perConnectionMb: 64 });
    expect(
      resolveConnectionBrowserSettings(undefined, {
        version: 1,
        httpCache: { enabled: false },
      }).httpCache,
    ).toEqual({ ...DEFAULT_BROWSER_HTTP_CACHE, enabled: false });
    // An empty override is not materialized into the saved record.
    expect(
      normalizeBrowserSessionOverrides({ version: 1, httpCache: {} }),
    ).toEqual({ version: 1 });
    expect(overrides).toEqual({ version: 1, httpCache: { enabled: true } });
    expect(globals.httpCache?.enabled).toBe(false);
  });

  it.each([undefined, "real-origin", "legacy"])(
    "matches native manual-submit inheritance for engine %s without rewriting saved choices",
    (engine) => {
      for (const global of [undefined, false, true]) {
        for (const local of [undefined, false, true]) {
          const settings = {
            ...(engine === undefined ? {} : { engine }),
            ...(global === undefined ? {} : { manualFormSubmit: global }),
          };
          const overrides = {
            version: 1,
            minimumFormFillDelayMs: 50,
            ...(local === undefined ? {} : { manualFormSubmit: local }),
          };
          const before = structuredClone({ settings, overrides });
          expect(normalizeWebBrowserSettings(settings).manualFormSubmit).toBe(
            global ?? true,
          );
          expect(
            resolveConnectionBrowserSettings(settings, overrides)
              .manualFormSubmit,
          ).toBe(local ?? global ?? true);
          expect(normalizeBrowserSessionOverrides(overrides)).toEqual(
            overrides,
          );
          expect({ settings, overrides }).toEqual(before);
        }
      }
    },
  );

  it("preserves sparse inheritance and explicit false/zero values", () => {
    const saved = {
      version: 1,
      showBookmarksBar: false,
      minimumFormFillDelayMs: 0,
    };
    expect(normalizeBrowserSessionOverrides(saved)).toEqual(saved);
    const global = normalizeWebBrowserSettings({
      defaultZoomPercent: 140,
      minimumFormFillDelayMs: 4000,
    });
    const resolved = resolveConnectionBrowserSettings(global, saved);
    expect(resolved).toMatchObject({
      defaultZoomPercent: 140,
      minimumFormFillDelayMs: 0,
      showBookmarksBar: false,
    });
    expect(global.minimumFormFillDelayMs).toBe(4000);
    expect(
      resolveConnectionBrowserSettings(
        { ...global, defaultZoomPercent: 150 },
        saved,
      ).defaultZoomPercent,
    ).toBe(150);
  });

  it("never copies credential grants or engine selection into browser overrides", () => {
    for (const extra of [
      { engine: "legacy" },
      { allowAllRequests: true },
      { isolation: false },
      { profileId: "shared" },
      { defaultPolicy: {} },
      { sessionRetention: undefined },
    ])
      expect(() =>
        normalizeBrowserSessionOverrides({ version: 1, ...extra }),
      ).toThrow(/Invalid browser session/);
  });

  it.each([
    { version: 2 },
    { version: 1, defaultZoomPercent: 201 },
    { version: 1, defaultZoomPercent: 99.5 },
    { version: 1, showBookmarksBar: "false" },
    { version: 1, initialLoadTimeoutSeconds: 9 },
    { version: 1, documentReadyTimeoutSeconds: 241 },
    { version: 1, minimumFormSubmitDelayMs: -1 },
    { version: 1, minimumFormFillDelayMs: NaN },
    {
      version: 1,
      minimumFormFillDelayMs: 30000,
      minimumFormSubmitDelayMs: 30000,
    },
  ])("rejects malformed overrides %j", (value) => {
    expect(() => normalizeBrowserSessionOverrides(value)).toThrow();
  });

  it("validates the combined delay budget after inheritance", () => {
    expect(() =>
      resolveConnectionBrowserSettings(
        { minimumFormFillDelayMs: 30000 },
        { version: 1, minimumFormSubmitDelayMs: 23000 },
      ),
    ).toThrow(/52,000/);
    expect(
      resolveConnectionBrowserSettings(
        { minimumFormFillDelayMs: 30000 },
        { version: 1, minimumFormSubmitDelayMs: 22000 },
      ).minimumFormSubmitDelayMs,
    ).toBe(22000);
  });

  it("keeps a requested retention policy distinct from supported runtime behavior", () => {
    const requested = {
      ...DEFAULT_BROWSER_SESSION_RETENTION,
      mode: "encrypted-database" as const,
      clearOnDatabaseLock: false,
    };
    const unsupported = resolveBrowserSessionRetention(requested);
    expect(unsupported).toMatchObject({
      requested,
      effective: { mode: "ephemeral", clearOnDatabaseLock: false },
      supported: false,
    });
    expect(unsupported.reason).toContain("unavailable");
    expect(
      resolveBrowserSessionRetention(requested, {
        memory: true,
        encryptedDatabase: false,
      }).supported,
    ).toBe(false);
    const available = resolveBrowserSessionRetention(requested, {
      memory: false,
      encryptedDatabase: true,
    });
    expect(available.effective).toEqual(requested);
    expect(available.supported).toBe(true);
    expect(available.reason).toBeUndefined();
    expect(
      resolveBrowserSessionRetention(
        { ...requested, mode: "memory" },
        { memory: true, encryptedDatabase: false },
      ).effective.mode,
    ).toBe("memory");
    expect(resolveBrowserSessionRetention(undefined).effective.mode).toBe(
      "ephemeral",
    );
  });

  it("rejects incomplete and out-of-bounds retention policies without echoing stored input", () => {
    for (const value of [
      null,
      {},
      { mode: "memory" },
      { ...DEFAULT_BROWSER_SESSION_RETENTION, mode: "shared-profile-secret" },
      { ...DEFAULT_BROWSER_SESSION_RETENTION, idleTimeoutMinutes: 10081 },
      { ...DEFAULT_BROWSER_SESSION_RETENTION, maxAgeHours: 0 },
      { ...DEFAULT_BROWSER_SESSION_RETENTION, clearOnDatabaseLock: "false" },
    ]) {
      expect(() => normalizeBrowserSessionRetention(value)).toThrow(
        /Invalid browser session/,
      );
      expect(() => normalizeBrowserSessionRetention(value)).not.toThrow(
        /shared-profile-secret/,
      );
    }
  });

  it("matches native zero-idle semantics even when the selected mode is supported", () => {
    const result = resolveBrowserSessionRetention(
      {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-database",
        idleTimeoutMinutes: 0,
      },
      { memory: true, encryptedDatabase: true },
    );
    expect(result.supported).toBe(true);
    expect(result.requested.mode).toBe("encrypted-database");
    expect(result.effective.mode).toBe("ephemeral");
    expect(result.reason).toContain("zero idle expiry");
  });

  it("replaces a connection retention policy as a whole and preserves unrelated settings", () => {
    const global = normalizeWebBrowserSettings({
      engine: "legacy",
      sessionRetention: {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "memory",
      },
    });
    const resolved = resolveConnectionBrowserSettings(global, {
      version: 1,
      sessionRetention: DEFAULT_BROWSER_SESSION_RETENTION,
    });
    expect(resolved.sessionRetention).toEqual(
      DEFAULT_BROWSER_SESSION_RETENTION,
    );
    expect(resolved.engine).toBe("legacy");
    expect(resolved.defaultPolicy).toEqual(global.defaultPolicy);
  });

  it("separates database, connection and attempt identities without delimiter collisions", () => {
    const base = {
      owningDatabaseId: "db",
      connectionId: "connection",
      attemptId: "attempt",
    };
    const keys = [
      base,
      { ...base, owningDatabaseId: "other" },
      { ...base, connectionId: "other" },
      { ...base, attemptId: "other" },
      { ...base, owningDatabaseId: "a:b", connectionId: "c" },
      { ...base, owningDatabaseId: "a", connectionId: "b:c" },
    ].map(browserSessionIsolationKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of ["owningDatabaseId", "connectionId", "attemptId"])
      expect(() =>
        browserSessionIsolationKey({ ...base, [field]: " " }),
      ).toThrow();
  });
});
