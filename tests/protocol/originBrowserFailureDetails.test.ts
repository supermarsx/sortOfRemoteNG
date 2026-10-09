import { describe, expect, it } from "vitest";
import {
  getOriginBrowserFailureDetails,
  type BrowserRecoveryAction,
} from "../../src/hooks/protocol/originBrowserFailureDetails";
import {
  originBrowserPolicyFailures,
  originBrowserStartupError,
} from "../../src/hooks/protocol/originBrowserStartupError";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";
import type { OriginBrowserSnapshot } from "../../src/types/protocols/originBrowser";
import { originBrowserRuntimeFailure } from "../../src/types/protocols/originBrowser";
import browserSessionSchema from "../../src/types/settings/browserSession.schema.json";

const state = (
  change: Partial<OriginBrowserState> = {},
): OriginBrowserState => ({
  phase: "error",
  error: "SECRET: untrusted native message",
  snapshot: null,
  unavailableReason: null,
  ...change,
});
const snapshot = (
  change: Partial<OriginBrowserSnapshot> = {},
): OriginBrowserSnapshot => ({
  identity: {
    ownerDatabaseId: "SECRET",
    connectionId: "SECRET",
    sessionId: "SECRET",
    attemptId: "SECRET",
  },
  sequence: 1,
  phase: "attached",
  displayUrl: "https://SECRET/",
  currentUrl: "https://SECRET/?token=SECRET",
  title: "SECRET",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...change,
});
const startup = (message: string) =>
  state({ startupFailure: originBrowserStartupError("create", message) });

describe("fixed actionable native failure details", () => {
  it("prefers recorded engine evidence for a recognized deferred create runtime failure only", () => {
    const runtimeFailure = { code: "ui-dispatch", stage: "preparing" } as const;
    const initial = startup(
      "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.",
    );
    expect(
      getOriginBrowserFailureDetails({ ...initial, runtimeFailure })[0].code,
    ).toBe("engine-ui-dispatch");
    expect(
      getOriginBrowserFailureDetails({
        ...initial,
        runtimeFailure,
        startupFailure: {
          stage: "create",
          category: "connection",
          code: "credentials-unavailable",
        },
      })[0].code,
    ).toBe("credentials-unavailable");
  });
  it("routes private-proxy connection failure to browser diagnostics, not website credentials", () => {
    const details = getOriginBrowserFailureDetails(
      state({
        phase: "attached",
        snapshot: snapshot({ loadFailure: { code: -130, category: "proxy" } }),
      }),
    );
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      code: "load-proxy-connection",
      action: "browser-settings",
    });
    expect(details[0].problem).toContain("configured proxy endpoint");
    expect(details[0].nextStep).toContain("Retry browser");
    expect(JSON.stringify(details)).not.toContain("SECRET");
  });
  it.each([
    [
      "sessionRetention must be an object when present",
      "sessionRetention",
      "retention-object",
      "version, mode, idleTimeoutMinutes, maxAgeHours, and clearOnDatabaseLock",
    ],
    [
      "sessionRetention.version is required and must be 1",
      "sessionRetention.version",
      "retention-version",
      "numeric value 1",
    ],
    [
      "sessionRetention.mode is required and must be ephemeral, memory, encrypted-database or encrypted-local",
      "sessionRetention.mode",
      "retention-mode",
      "ephemeral, memory, or encrypted-database",
    ],
    [
      "sessionRetention.idleTimeoutMinutes is required and must be an integer from 0 to 10080",
      "sessionRetention.idleTimeoutMinutes",
      "retention-idle-range",
      "0 to 10080 minutes",
    ],
    [
      "sessionRetention.maxAgeHours is required and must be an integer from 1 to 8760",
      "sessionRetention.maxAgeHours",
      "retention-age-range",
      "1 to 8760 hours",
    ],
    [
      "sessionRetention.clearOnDatabaseLock is required and must be a boolean",
      "sessionRetention.clearOnDatabaseLock",
      "retention-clear-on-lock-type",
      "true or false",
    ],
    [
      "sessionRetention contains an unsupported field",
      "sessionRetention",
      "retention-fields",
      "native did not report the unsupported field's name",
    ],
  ])(
    "identifies the exact retention constraint %s at each scope",
    (rule, field, code, correction) => {
      for (const [scope, action] of [
        ["settings.webBrowser", "browser-settings"],
        ["connection.browserSession", "browser-session"],
      ] as const) {
        const [detail] = getOriginBrowserFailureDetails(
          startup(`Saved browser policy rejected (${scope}): ${rule}`),
        );
        expect(detail).toMatchObject({
          code: `${scope}:${code}`,
          field: `${scope}.${field}`,
          action,
        });
        expect(detail.problem).toContain(rule);
        expect(detail.nextStep).toContain(correction);
        expect(JSON.stringify(detail)).not.toContain("SECRET");
      }
    },
  );

  it("preserves the accepted retention alias without promising runtime support or cookie migration", () => {
    const [detail] = getOriginBrowserFailureDetails(
      startup(
        "Saved browser policy rejected (connection.browserSession): sessionRetention.mode is required and must be ephemeral, memory, encrypted-database or encrypted-local",
      ),
    );
    expect(detail.problem).toContain(
      browserSessionSchema.$defs.retention.properties.mode.enum[3],
    );
    expect(detail.nextStep).toContain("encrypted-local is accepted on read");
    expect(detail.nextStep).toContain(
      "does not establish runtime support or migrate cookie data",
    );
  });

  it.each([
    ["settings.webBrowser", "browser-settings"],
    ["connection.browserSession", "browser-session"],
  ] as const)("identifies excessive combined delays in %s", (scope, action) => {
    const [detail] = getOriginBrowserFailureDetails(
      startup(
        `Saved browser policy rejected (${scope}): minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms`,
      ),
    );
    expect(detail).toMatchObject({
      code: `${scope}:form-delays-total`,
      action,
    });
    expect(detail.field).toBe(
      `${scope}.minimumFormFillDelayMs + minimumFormSubmitDelayMs`,
    );
    expect(detail.nextStep).toContain("this settings layer");
    expect(detail.nextStep).toContain("0 to 30000 ms each");
    expect(detail.nextStep).toContain("52000 ms (52 seconds)");
  });

  it("distinguishes an inherited delay conflict from either layer's own values", () => {
    const [detail] = getOriginBrowserFailureDetails(
      startup(
        "Saved browser policy rejected (effective.browserSession): inherited minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
      ),
    );
    expect(detail).toMatchObject({
      code: "effective.browserSession:inherited-form-delays-total",
      action: "browser-session",
    });
    expect(detail.field).toBe(
      "effective.browserSession.minimumFormFillDelayMs + minimumFormSubmitDelayMs",
    );
    expect(detail.nextStep).toContain(
      "connection.browserSession delay overrides",
    );
    expect(detail.nextStep).toContain("inherited settings.webBrowser defaults");
    expect(detail.nextStep).toContain(
      "effective combined total at most 52000 ms",
    );
  });

  it("rejects known preference rules under an unreported native scope", () => {
    for (const native of [
      "Saved browser policy rejected (connection.httpProxyPolicy): defaultZoomPercent must be an integer from 50 to 200 when present",
      "Saved browser policy rejected (effective.browserSession): sessionRetention.version is required and must be 1",
      "Saved browser policy rejected (settings.webBrowser): inherited minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
      "Saved browser policy rejected (effective.browserSession): minimumFormFillDelayMs + minimumFormSubmitDelayMs must total at most 52000 ms",
    ]) {
      expect(originBrowserStartupError("create", native).code).toBeUndefined();
      const [detail] = getOriginBrowserFailureDetails(startup(native));
      expect(detail.code).toBe("startup-create");
      expect(detail.problem).toContain("without a recognized specific cause");
    }
  });

  it.each([
    ["defaultZoomPercent", "%"],
    ["initialLoadTimeoutSeconds", "seconds"],
    ["documentReadyTimeoutSeconds", "seconds"],
    ["minimumFormFillDelayMs", "ms"],
    ["minimumFormSubmitDelayMs", "ms"],
  ] as const)(
    "uses the native schema's actual %s bounds and units",
    (field, unit) => {
      const { minimum, maximum } = browserSessionSchema.properties[field];
      for (const [scope, action] of [
        ["settings.webBrowser", "browser-settings"],
        ["connection.browserSession", "browser-session"],
      ] as const) {
        const entry = originBrowserPolicyFailures.find(
          (failure) => failure.field === `${scope}.${field}`,
        );
        expect(entry, `${scope}.${field}`).toBeDefined();
        const [detail] = getOriginBrowserFailureDetails(startup(entry!.native));
        expect(detail.field).toBe(`${scope}.${field}`);
        expect(detail.action).toBe(action);
        expect(detail.problem).toContain(String(minimum));
        expect(detail.problem).toContain(String(maximum));
        expect(detail.nextStep).toContain(unit);
        expect(detail.nextStep).toContain(String(minimum));
        expect(detail.nextStep).toContain(String(maximum));
        expect(detail.nextStep).toMatch(/whole|integer/);
      }
    },
  );

  it.each([
    "showBookmarksBar",
    "showSecurityInfo",
    "showLoadingProgress",
  ] as const)("retains the exact %s display preference rejection", (field) => {
    for (const [scope, action] of [
      ["settings.webBrowser", "browser-settings"],
      ["connection.browserSession", "browser-session"],
    ] as const) {
      const [detail] = getOriginBrowserFailureDetails(
        startup(
          `Saved browser policy rejected (${scope}): ${field} must be a boolean when present`,
        ),
      );
      expect(detail.field).toBe(`${scope}.${field}`);
      expect(detail.action).toBe(action);
      expect(detail.nextStep).toContain("true or false");
    }
  });

  it("directs bundled catalog failures to installation repair", () => {
    for (const native of [
      "Saved browser policy rejected (bundled.commonResourceOrigins): externalResourceOrigins[].origin must be an exact HTTPS origin",
      "Saved browser policy rejected (bundled.externalFontOrigins): externalFontOrigins must be an array",
      "Saved browser policy rejected (bundled.googleRoutes): route entries must be exact HTTPS origins",
    ]) {
      const [detail] = getOriginBrowserFailureDetails(startup(native));
      expect(detail.action).toBe("browser-settings");
      expect(detail.nextStep).toContain("Repair or reinstall");
      expect(detail.field).toMatch(/^bundled\./);
    }
  });

  it.each([
    "localStorageEnabled",
    "databasesEnabled",
    "webglEnabled",
    "cookiesEnabled",
    "mediaStreamEnabled",
    "crossOriginRequestsEnabled",
    "websiteExtensionsEnabled",
    "hideAutomationIndicator",
    "manualFormSubmit",
  ])("identifies malformed preference %s at the correct scope", (field) => {
    for (const [scope, action] of [
      ["connection.browserSession", "browser-session"],
      ["settings.webBrowser", "browser-settings"],
    ] as const) {
      const [detail] = getOriginBrowserFailureDetails(
        startup(
          `Saved browser policy rejected (${scope}): ${field} must be a boolean when present`,
        ),
      );
      expect(detail.field).toBe(`${scope}.${field}`);
      expect(detail.action).toBe(action);
      expect(detail.problem).toContain("must be a boolean");
      expect(detail.nextStep).toMatch(/boolean|true or false/);
    }
  });

  it.each([
    [
      "settings.webBrowser",
      "allowDownloads must be a boolean when present",
      "allowDownloads",
      "true or false",
      "browser-settings",
    ],
    [
      "settings.webBrowser",
      "popupPolicy must be tabs or block when present",
      "popupPolicy",
      "tabs",
      "browser-settings",
    ],
    [
      "settings.webBrowser",
      "version must be 1 when present",
      "version",
      "1",
      "browser-settings",
    ],
    [
      "connection.browserSession",
      "version must be 1",
      "version",
      "1",
      "browser-session",
    ],
  ])(
    "explains the expected value for %s %s",
    (scope, rule, field, correction, action) => {
      const [detail] = getOriginBrowserFailureDetails(
        startup(`Saved browser policy rejected (${scope}): ${rule}`),
      );
      expect(detail.field).toBe(`${scope}.${field}`);
      expect(detail.action).toBe(action);
      expect(detail.nextStep).toContain(correction);
    },
  );

  it("does not turn an unidentified preference failure into a permission diagnosis", () => {
    const [detail] = getOriginBrowserFailureDetails(
      startup("Saved browser preferences are invalid"),
    );
    expect(detail.code).toBe("preferences-invalid");
    expect(detail.problem).toContain("did not identify the field or value");
    expect(detail.nextStep).toContain("before changing values");
  });

  it.each([
    [
      "Saved website permission policy is invalid or unsupported",
      "permissions-invalid",
      "permissions",
    ],
    [
      "Saved browser permission policy is invalid or unsupported",
      "permissions-invalid",
      "permissions",
    ],
    [
      "Saved website credentials are unavailable or invalid in the owning database; review its credential reference",
      "credential-reference",
      "credentials",
    ],
    [
      "Saved browser network route is invalid or unsupported; no direct fallback",
      "network-route",
      "network",
    ],
    [
      "Saved application entry or login route has no native translation",
      "application-unsupported",
      "application",
    ],
    [
      "Browser saved database owner is unavailable or changed",
      "owner-unavailable",
      "database",
    ],
    [
      "Saved browser session retention settings are invalid.",
      "session-retention",
      "browser-session",
    ],
    [
      "Saved browser application settings could not be read",
      "settings-unavailable",
      "browser-settings",
    ],
  ])(
    "maps exact %s to the appropriate recovery target",
    (message, code, action) => {
      const details = getOriginBrowserFailureDetails(startup(message));
      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({ code, action });
      expect(details[0].problem).not.toContain("SECRET");
      expect(details[0].nextStep.length).toBeGreaterThan(20);
    },
  );

  it("does not claim a specific invalid setting for the legacy permission error", () => {
    const [detail] = getOriginBrowserFailureDetails(
      startup("Saved website permission policy is invalid or unsupported"),
    );
    expect(detail.field).toContain("field not reported");
    expect(detail.problem).toContain(
      "does not identify the setting, scope, or rejected value",
    );
    expect(detail.nextStep).toContain("before changing it");
  });

  it.each([
    [
      "connection.httpProxyPolicy",
      "pageScripts must be allow when present",
      "pageScripts",
      "Allow",
      "legacy-proxy",
    ],
    [
      "connection.httpProxyPolicy",
      "allowAllRequests must be false when present",
      "allowAllRequests",
      "Update and restart",
      "legacy-proxy",
    ],
    [
      "connection.httpProxyPolicy",
      "allowAllScripts must be false when present",
      "allowAllScripts",
      "Update and restart",
      "legacy-proxy",
    ],
    [
      "connection.httpProxyPolicy",
      "allowAllRequests must be a boolean when present",
      "allowAllRequests",
      "checkbox",
      "legacy-proxy",
    ],
    [
      "connection.httpProxyPolicy",
      "allowAllScripts must be a boolean when present",
      "allowAllScripts",
      "checkbox",
      "legacy-proxy",
    ],
    [
      "settings.webBrowser.defaultPolicy",
      "allowAllRequests is connection-only",
      "allowAllRequests",
      "intended saved connection",
      "browser-settings",
    ],
    [
      "settings.webBrowser.defaultPolicy",
      "allowAllScripts is connection-only",
      "allowAllScripts",
      "intended saved connection",
      "browser-settings",
    ],
    [
      "settings.webBrowser.defaultPolicy",
      "pageScripts must be allow when present",
      "pageScripts",
      "Allow",
      "browser-settings",
    ],
    [
      "settings.webBrowser.defaultPolicy",
      "httpsOnly must be false when present for temporary HTTP",
      "httpsOnly",
      "global",
      "browser-settings",
    ],
    [
      "connection.websiteDomainPermissions",
      "version must be 1",
      "version",
      "1",
      "permissions",
    ],
    [
      "settings.webBrowser.domainPermissions",
      "websites[].origin must be an exact HTTPS origin",
      "websites[].origin",
      "HTTPS",
      "browser-settings",
    ],
    [
      "connection.websiteDomainPermissions",
      "websites[].requestClasses decisions must be inherit, allow or deny",
      "websites[].requestClasses",
      "inherit, allow, or deny",
      "permissions",
    ],
    [
      "connection.httpTrustedRedirectDestinations",
      "origins must contain at most 32 entries",
      "origins",
      "32",
      "legacy-proxy",
    ],
    [
      "connection.browserSession",
      "databasesEnabled=false is unsupported by the native browser",
      "databasesEnabled",
      "true",
      "browser-session",
    ],
    [
      "settings.webBrowser",
      "webglEnabled=false is unsupported by the native browser",
      "webglEnabled",
      "true",
      "browser-settings",
    ],
  ])(
    "identifies %s / %s without raw saved values",
    (scope, rule, field, correction, action) => {
      const [detail] = getOriginBrowserFailureDetails(
        startup(`Saved browser policy rejected (${scope}): ${rule}`),
      );
      expect(detail.field).toBe(`${scope}.${field}`);
      expect(detail.problem).toContain(rule);
      expect(detail.nextStep).toContain(correction);
      expect(detail.action).toBe(action);
      expect(detail.code.startsWith(`${scope}:`)).toBe(true);
    },
  );

  it("does not permit navigation automatically when a specific rule denies it", () => {
    for (const scope of [
      "connection.websiteDomainPermissions",
      "settings.webBrowser.domainPermissions",
    ]) {
      const [detail] = getOriginBrowserFailureDetails(
        startup(
          `Saved browser policy rejected (${scope}): websites[].destinations[].requestClasses.navigation denies initial navigation`,
        ),
      );
      expect(detail.field).toBe(
        `${scope}.websites[].destinations[].requestClasses.navigation`,
      );
      expect(detail.nextStep).toContain("Keep deny if intended");
    }
  });

  it("retains every policy discriminator through the details mapper with an actionable target", () => {
    const actions: BrowserRecoveryAction[] = [
      "connection",
      "application",
      "credentials",
      "permissions",
      "network",
      "browser-session",
      "trust",
      "database",
      "browser-settings",
      "legacy-proxy",
    ];
    for (const { native, code } of originBrowserPolicyFailures) {
      const [detail] = getOriginBrowserFailureDetails(startup(native));
      expect(detail.code).toBe(code);
      expect(actions).toContain(detail.action);
      expect(detail.field).toBeTruthy();
      expect(detail.nextStep).toBeTruthy();
      expect(JSON.stringify(detail)).not.toContain("SECRET");
    }
  });

  it("uses configuration validation's separate fields and recovery destinations", () => {
    const details = getOriginBrowserFailureDetails(
      state({
        configurationFailure: {
          issues: [
            "url-credentials",
            "expectedSecurityRevision:missing",
            "consent-kind",
          ],
        },
      }),
    );
    expect(details.map(({ code, action }) => [code, action])).toEqual([
      ["url-credentials", "connection"],
      ["expectedSecurityRevision:missing", "database"],
      ["consent-kind", "application"],
    ]);
    expect(JSON.stringify(details)).not.toContain("SECRET");
  });

  it.each([
    ["dns", "network"],
    ["connection", "network"],
    ["timeout", "network"],
    ["network-changed", "network"],
    ["offline", "network"],
    ["proxy", "network"],
    ["certificate", "trust"],
    ["tls", "trust"],
    ["blocked", "permissions"],
    ["http", "connection"],
    ["redirect", "application"],
    ["cache", "browser-session"],
    ["other", "connection"],
  ] as const)(
    "routes the load category %s without reading page content",
    (category, action) => {
      const details = getOriginBrowserFailureDetails(
        state({
          phase: "attached",
          snapshot: snapshot({ loadFailure: { code: -105, category } }),
        }),
      );
      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({ code: `load-${category}`, action });
      expect(JSON.stringify(details)).not.toContain("SECRET");
    },
  );

  it.each([
    ["renderer", "browser-settings"],
    ["session", "browser-settings"],
    ["database-owner", "database"],
    ["watchdog", "browser-settings"],
    ["private-context", "browser-settings"],
    ["private-proxy", "browser-settings"],
    ["certificate-bridge", "browser-settings"],
    ["redirect-denied", "permissions"],
    ["native-state", "browser-settings"],
    ["runtime-unavailable", "browser-settings"],
    ["owner-window", "browser-settings"],
    ["callback", "browser-settings"],
    ["native-surface", "browser-settings"],
    ["load", "connection"],
  ] as const)("routes native terminal reason %s", (failureReason, action) => {
    const details = getOriginBrowserFailureDetails(
      state({
        snapshot: snapshot({
          phase: "failed",
          failureReason,
          loadFailure: { code: -105, category: "dns" },
        }),
      }),
    );
    expect(details[0]).toMatchObject({
      code: `native-${failureReason}`,
      action,
    });
    expect(JSON.stringify(details)).not.toContain("SECRET");
    if (failureReason !== "database-owner") {
      expect(JSON.stringify(details)).not.toMatch(/database|unlock|locked/i);
    }
  });

  it("routes denied redirects to permission review without weakening protections or blaming credentials", () => {
    const [detail] = getOriginBrowserFailureDetails(
      state({
        snapshot: snapshot({
          phase: "failed",
          failureReason: "redirect-denied",
        }),
      }),
    );
    expect(detail).toMatchObject({
      code: "native-redirect-denied",
      action: "permissions",
    });
    expect(detail.problem).toContain(
      "does not establish rejected website credentials",
    );
    expect(detail.nextStep).toContain("permitted destinations");
    expect(detail.nextStep).toContain(
      "Keep destination checks, HTTPS trust settings, and proxy protections enabled",
    );
    expect(JSON.stringify(detail)).not.toContain("SECRET");
  });

  it("describes database-owner as lost authorization, not confirmed database lock", () => {
    const [detail] = getOriginBrowserFailureDetails(
      state({
        snapshot: snapshot({
          phase: "failed",
          failureReason: "database-owner",
        }),
      }),
    );
    expect(detail.problem).toContain(
      "database-session authorization is no longer current",
    );
    expect(detail.problem).toContain(
      "does not establish that the database is locked",
    );
    expect(detail.nextStep).toContain("owning database");
    expect(detail.action).toBe("database");
  });

  it("routes a failed-session TLS bridge to fresh-context recovery, not trust changes", () => {
    const [detail] = getOriginBrowserFailureDetails(
      state({
        snapshot: snapshot({
          phase: "failed",
          failureReason: "certificate-bridge",
        }),
      }),
    );
    expect(detail.problem).toContain(
      "does not establish a server-certificate rejection",
    );
    expect(detail.nextStep).toContain("fresh private context");
    expect(detail.nextStep).toContain("TLS journal");
    expect(detail.nextStep).toContain(
      "Keep HTTPS trust settings and website credentials unchanged",
    );
    expect(detail).toMatchObject({
      code: "native-certificate-bridge",
      action: "browser-settings",
    });
  });

  it.each([undefined, "session", "SECRET-native-reason"])(
    "keeps generic terminal reason %s neutral and redacted",
    (reason) => {
      const [detail] = getOriginBrowserFailureDetails(
        state({
          snapshot: snapshot({
            phase: "failed",
            failureReason: reason as never,
          }),
        }),
      );
      expect(detail.action).toBe("browser-settings");
      expect(detail.nextStep).toContain("native browser diagnostics");
      expect(JSON.stringify(detail)).not.toMatch(
        /database|unlock|locked|SECRET/i,
      );
    },
  );

  it.each([
    ["runtime-missing", "browser-settings"],
    ["platform-unsupported", "browser-settings"],
    ["containment-unverified", "browser-settings"],
    ["policy-unavailable", "browser-settings"],
    ["owner-unavailable", "database"],
    ["host-unavailable", "browser-settings"],
  ] as const)(
    "routes native unavailability %s",
    (unavailableReason, action) => {
      expect(
        getOriginBrowserFailureDetails(
          state({ phase: "unavailable", unavailableReason }),
        )[0],
      ).toMatchObject({ code: `unavailable-${unavailableReason}`, action });
    },
  );

  it.each([
    "presentation",
    "navigation",
    "control",
    "state",
    "cleanup",
  ] as const)(
    "explains the exact failed %s operation without guessing its cause",
    (operationFailure) => {
      const [detail] = getOriginBrowserFailureDetails(
        state({ operationFailure }),
      );
      expect(detail.code).toBe(`operation-${operationFailure}`);
      expect(detail.problem).not.toContain("SECRET");
      expect(detail.nextStep).toBeTruthy();
    },
  );

  it.each(["listen", "status", "owner-check", "create", "resync"] as const)(
    "handles the broad connection category at %s without claiming credential or permission rejection",
    (stage) => {
      const [detail] = getOriginBrowserFailureDetails(
        state({ startupFailure: { stage, category: "connection" } }),
      );
      expect(detail.code).toBe(`startup-${stage}`);
      expect(detail.action).toBe(
        stage === "owner-check" ? "database" : "browser-settings",
      );
    },
  );

  it("preserves MFA reason recovery only at creation", () => {
    const startupFailure = {
      stage: "create",
      category: "connection",
      reason: "mfa-origin-mismatch",
    } as const;
    const [detail] = getOriginBrowserFailureDetails(state({ startupFailure }));
    expect(detail.action).toBe("application");
    expect(detail.nextStep).toContain("re-enable automatic codes");
    for (const stage of [
      "listen",
      "status",
      "owner-check",
      "resync",
    ] as const) {
      expect(
        getOriginBrowserFailureDetails(
          state({ startupFailure: { ...startupFailure, stage } }),
        )[0].problem,
      ).not.toContain("two-factor");
    }
  });

  it("does not parse raw display errors into a diagnosis", () => {
    const details = getOriginBrowserFailureDetails(
      state({
        error: "Saved website permission policy is invalid or unsupported",
      }),
    );
    expect(details[0]).toMatchObject({
      code: "unknown-failure",
      action: "browser-settings",
    });
    expect(details[0].problem).toContain("No supported structured cause");
  });

  it.each(["SECRET", "__proto__", "constructor", "toString"])(
    "safely handles unknown discriminators %s",
    (value) => {
      const changes = [
        {
          startupFailure: {
            stage: "create",
            category: "connection",
            code: value,
          },
        },
        { startupFailure: { stage: value, category: "connection" } },
        { operationFailure: value },
        { phase: "unavailable", unavailableReason: value },
        {
          snapshot: snapshot({
            phase: "failed",
            failureReason: value as never,
          }),
        },
        {
          snapshot: snapshot({
            loadFailure: { code: -105, category: value as never },
          }),
        },
        { configurationFailure: { issues: [value] } },
      ];
      for (const change of changes) {
        const details = getOriginBrowserFailureDetails(
          state(change as Partial<OriginBrowserState>),
        );
        expect(details).toHaveLength(1);
        expect(details[0].action).toBe("browser-settings");
        expect(JSON.stringify(details)).not.toContain(value);
      }
    },
  );

  it("does not read display strings when structured evidence is present", () => {
    const input = startup(
      "Saved browser permission policy is invalid or unsupported",
    );
    Object.defineProperty(input, "error", {
      get() {
        throw new Error("must not read prose");
      },
    });
    expect(getOriginBrowserFailureDetails(input)[0].action).toBe("permissions");
  });

  it("ignores stale terminal/load fields outside their native phase", () => {
    for (const phase of ["starting", "closing", "closed"] as const) {
      expect(
        getOriginBrowserFailureDetails(
          state({
            phase,
            error: null,
            snapshot: snapshot({
              phase,
              failureReason: "renderer",
              loadFailure: { code: -105, category: "dns" },
            }),
          }),
        ),
      ).toEqual([]);
    }
  });

  it.each([
    ["data-directory", "working-data directory"],
    ["runtime-package", "CEF runtime package"],
    ["startup-provider", "startup provider"],
    ["certificate-bridge", "certificate-verifier bridge"],
    ["runtime-policy", "runtime policy checks"],
    ["startup-timeout", "deadline"],
    ["ui-dispatch", "UI thread"],
    ["runtime-initialization", "finish initialization"],
  ] as const)(
    "explains the retained %s engine fault rather than guessing from the broad capability",
    (code, problem) => {
      const details = getOriginBrowserFailureDetails(
        state({
          phase: "unavailable",
          unavailableReason: "policy-unavailable",
          runtimeFailure: { code, stage: "preparing" },
        }),
      );
      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({
        code: `engine-${code}`,
        action: "browser-settings",
      });
      expect(details[0].problem).toContain(problem);
      expect(details[0].nextStep.length).toBeGreaterThan(40);
      expect(JSON.stringify(details)).not.toContain("SECRET");
    },
  );

  it.each([
    undefined,
    null,
    "SECRET",
    [],
    {},
    { code: "SECRET", stage: "preparing" },
    { code: "__proto__", stage: "preparing" },
    { code: "runtime-package", stage: "SECRET" },
    { code: "runtime-package" },
  ])("ignores unknown or malformed engine diagnostics %j", (value) => {
    expect(originBrowserRuntimeFailure(value)).toBeUndefined();
    const details = getOriginBrowserFailureDetails(
      state({
        phase: "unavailable",
        unavailableReason: "host-unavailable",
        runtimeFailure: value as never,
      }),
    );
    expect(details[0].code).toBe("unavailable-host-unavailable");
    expect(details[0].problem).toContain(
      "no specific prerequisite was reported",
    );
    expect(JSON.stringify(details)).not.toMatch(/SECRET|__proto__/);
  });

  it("does not substitute engine history for an owning database failure", () => {
    const details = getOriginBrowserFailureDetails(
      state({
        phase: "unavailable",
        unavailableReason: "owner-unavailable",
        runtimeFailure: { code: "runtime-package", stage: "preparing" },
      }),
    );
    expect(details[0].code).toBe("unavailable-owner-unavailable");
  });

  it("returns independent detail objects and leaves source state unchanged", () => {
    const input = Object.freeze(
      startup(
        "Saved browser policy rejected (connection.httpProxyPolicy): pageScripts must be allow when present",
      ),
    );
    const before = JSON.stringify(input);
    getOriginBrowserFailureDetails(input)[0].problem = "SECRET";
    expect(getOriginBrowserFailureDetails(input)[0].problem).not.toContain(
      "SECRET",
    );
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["idle", "starting", "attached", "closing", "closed"] as const)(
    "does not invent a failure in healthy %s state",
    (phase) => {
      expect(
        getOriginBrowserFailureDetails(state({ phase, error: null })),
      ).toEqual([]);
    },
  );
});
