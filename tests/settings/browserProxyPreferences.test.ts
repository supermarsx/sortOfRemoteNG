import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeInternalProxySettings,
  normalizeWebBrowserSettings,
  resolveBrowserProxyPolicy,
} from "../../src/utils/settings/webBrowserSettings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";
import { DEFAULT_EXTERNAL_FONT_ORIGINS } from "../../src/types/connection/httpProxyPolicy";

describe("browser and internal proxy preferences", () => {
  it("fills missing preferences with manual-submit defaults and independent mutable copies", () => {
    const first = normalizeWebBrowserSettings(undefined);
    const second = normalizeWebBrowserSettings(undefined);
    expect(first).toMatchObject({
      version: 1,
      showBookmarksBar: true,
      showSecurityInfo: true,
      showLoadingProgress: true,
      defaultZoomPercent: 100,
      allowDownloads: false,
      allowPageDialogs: false,
      xsltEnabled: true,
      preferNativeUserAgent: true,
      preferNativeLanguage: true,
      hideAutomationIndicator: true,
      minimumFormFillDelayMs: 0,
      minimumFormSubmitDelayMs: 0,
      manualFormSubmit: true,
      popupPolicy: "tabs",
      initialLoadTimeoutSeconds: 30,
      documentReadyTimeoutSeconds: 120,
      defaultPolicy: { pageScripts: "allow", allowExternalFonts: true },
    });
    first.defaultPolicy.externalFontOrigins!.push("https://fonts.example.test");
    expect(second.defaultPolicy.externalFontOrigins).toEqual([
      ...DEFAULT_EXTERNAL_FONT_ORIGINS,
    ]);
    expect(normalizeInternalProxySettings(undefined)).toEqual({
      version: 1,
      connectTimeoutSeconds: 15,
      requestTimeoutSeconds: 120,
      poolIdleTimeoutSeconds: 20,
      maxIdleConnectionsPerHost: 4,
      tcpKeepaliveSeconds: 30,
    });
  });

  it.each([
    { connectTimeoutSeconds: 0 },
    { connectTimeoutSeconds: 121 },
    { requestTimeoutSeconds: 4 },
    { requestTimeoutSeconds: 601 },
    { requestTimeoutSeconds: 5, connectTimeoutSeconds: 10 },
    { poolIdleTimeoutSeconds: -1 },
    { maxIdleConnectionsPerHost: 33 },
    { tcpKeepaliveSeconds: 301 },
    { requestTimeoutSeconds: "120" },
    { poolIdleTimeoutSeconds: NaN },
    { version: 2 },
    { userAgent: "ignored-value" },
  ])("rejects invalid transport values %j", (value) => {
    expect(() => normalizeInternalProxySettings(value)).toThrow(
      /Invalid internal proxy/,
    );
  });

  it("supports disabling idle retention and TCP keepalive", () => {
    expect(
      normalizeInternalProxySettings({
        poolIdleTimeoutSeconds: 0,
        maxIdleConnectionsPerHost: 0,
        tcpKeepaliveSeconds: 0,
      }),
    ).toMatchObject({
      poolIdleTimeoutSeconds: 0,
      maxIdleConnectionsPerHost: 0,
      tcpKeepaliveSeconds: 0,
    });
  });

  it.each([
    { initialLoadTimeoutSeconds: 9 },
    { documentReadyTimeoutSeconds: 241 },
    { popupPolicy: "external" },
    { showBookmarksBar: "false" },
    { showSecurityInfo: null },
    { showLoadingProgress: 1 },
    { defaultZoomPercent: 49 },
    { defaultZoomPercent: 201 },
    { defaultZoomPercent: 100.5 },
    { defaultZoomPercent: "100" },
    { defaultZoomPercent: NaN },
    { allowDownloads: "true" },
    { allowPageDialogs: null },
    { xsltEnabled: null },
    { xsltEnabled: "false" },
    { xsltEnabled: 0 },
    { preferNativeUserAgent: "true" },
    { preferNativeLanguage: 1 },
    { hideAutomationIndicator: "true" },
    { minimumFormFillDelayMs: -1 },
    { minimumFormFillDelayMs: 30001 },
    { minimumFormFillDelayMs: 1.5 },
    { minimumFormSubmitDelayMs: "1000" },
    { minimumFormSubmitDelayMs: NaN },
    { minimumFormSubmitDelayMs: 30001 },
    { minimumFormFillDelayMs: 30000, minimumFormSubmitDelayMs: 30000 },
    { manualFormSubmit: 1 },
    { version: 2 },
    { allowUnrestrictedScripts: true },
  ])("rejects malformed browser settings %j", (value) => {
    expect(() => normalizeWebBrowserSettings(value)).toThrow(
      /Invalid web browser/,
    );
  });

  it("uses global policy only for an absent connection policy", () => {
    const global = normalizeWebBrowserSettings(undefined);
    global.defaultPolicy = {
      ...global.defaultPolicy,
      httpsOnly: true,
      pageScripts: "block",
    };
    expect(resolveBrowserProxyPolicy(undefined, global)).toMatchObject({
      httpsOnly: true,
      pageScripts: "block",
    });
    const saved = normalizeWebBrowserSettings(undefined).defaultPolicy;
    expect(resolveBrowserProxyPolicy(saved, global)).toMatchObject({
      httpsOnly: false,
      pageScripts: "allow",
    });
    expect(() => resolveBrowserProxyPolicy(null, global)).toThrow();
  });

  it("does not turn global defaults into a credential or redirect grant", () => {
    const defaultPolicy = normalizeWebBrowserSettings(undefined).defaultPolicy;
    for (const addition of [
      { queryParameters: [{ name: "token", value: "private-value" }] },
      { allowCrossOriginRedirects: true },
      { allowHttpDowngradeRedirects: true },
    ]) {
      expect(() =>
        normalizeWebBrowserSettings({
          defaultPolicy: { ...defaultPolicy, ...addition },
        }),
      ).toThrow(/Invalid web browser/);
    }
    expect(() =>
      normalizeWebBrowserSettings({
        defaultPolicy: {
          ...defaultPolicy,
          allowExternalFonts: true,
          externalFontOrigins: ["https://*.example.test"],
        },
      }),
    ).toThrow();
  });
});

describe("browser proxy settings persistence", () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    _resetInvokeCache();
    stored = { theme: "dark", proxyKeepaliveIntervalSeconds: 17 };
    vi.stubGlobal("__TAURI__", {
      core: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === "read_app_settings") return structuredClone(stored);
          if (command === "write_app_settings")
            Object.assign(stored, args.patch);
          return null;
        },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInvokeCache();
  });

  it("persists both sections without losing old proxy preferences", async () => {
    const manager = SettingsManager.getInstance();
    const initial = await manager.loadSettings();
    expect(initial.webBrowser?.popupPolicy).toBe("tabs");
    await manager.saveSettings({
      webBrowser: {
        ...initial.webBrowser!,
        showBookmarksBar: false,
        popupPolicy: "block",
        defaultZoomPercent: 125,
        showLoadingProgress: false,
        allowDownloads: true,
        allowPageDialogs: true,
        xsltEnabled: false,
        preferNativeUserAgent: false,
        preferNativeLanguage: false,
        hideAutomationIndicator: true,
        minimumFormFillDelayMs: 1000,
        minimumFormSubmitDelayMs: 2000,
        manualFormSubmit: true,
      },
      internalProxy: { ...initial.internalProxy!, connectTimeoutSeconds: 23 },
    });
    SettingsManager.resetInstance();
    const reloaded = await SettingsManager.getInstance().loadSettings();
    expect(reloaded.webBrowser?.showBookmarksBar).toBe(false);
    expect(reloaded.webBrowser?.popupPolicy).toBe("block");
    expect(reloaded.webBrowser).toMatchObject({
      defaultZoomPercent: 125,
      showLoadingProgress: false,
      allowDownloads: true,
      allowPageDialogs: true,
      xsltEnabled: false,
      preferNativeUserAgent: false,
      preferNativeLanguage: false,
      hideAutomationIndicator: true,
      minimumFormFillDelayMs: 1000,
      minimumFormSubmitDelayMs: 2000,
      manualFormSubmit: true,
    });
    expect(reloaded.internalProxy?.connectTimeoutSeconds).toBe(23);
    expect(reloaded.proxyKeepaliveIntervalSeconds).toBe(17);
    expect(stored.theme).toBe("dark");
  });

  it("rejects an invalid patch before persistence", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveSettings({
        internalProxy: {
          ...normalizeInternalProxySettings(undefined),
          requestTimeoutSeconds: -1,
        },
      }),
    ).rejects.toThrow(/Invalid internal proxy/);
    expect(stored.internalProxy).toBeUndefined();
  });

  it("persists exact resource choices and font opt-outs across a native settings reload", async () => {
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();
    const resourceOrigins = [
      { origin: "https://assets.example.test", kinds: ["stylesheet" as const] },
    ];
    await manager.saveSettings({
      webBrowser: {
        ...settings.webBrowser!,
        defaultPolicy: {
          ...settings.webBrowser!.defaultPolicy,
          allowExternalFonts: false,
          externalFontOrigins: [],
          externalResourceOrigins: resourceOrigins,
        },
      },
    });
    SettingsManager.resetInstance();
    const reloaded = await SettingsManager.getInstance().loadSettings();
    expect(reloaded.webBrowser?.defaultPolicy).toMatchObject({
      allowExternalFonts: false,
      externalFontOrigins: [],
      externalResourceOrigins: resourceOrigins,
    });
    await SettingsManager.getInstance().saveSettings({
      webBrowser: {
        ...reloaded.webBrowser!,
        defaultPolicy: {
          ...reloaded.webBrowser!.defaultPolicy,
          externalResourceOrigins: [],
        },
      },
    });
    SettingsManager.resetInstance();
    const disabled = await SettingsManager.getInstance().loadSettings();
    expect(disabled.webBrowser?.defaultPolicy.externalResourceOrigins).toEqual(
      [],
    );
  });
});
