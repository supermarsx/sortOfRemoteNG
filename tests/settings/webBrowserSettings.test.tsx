import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WebBrowserSettings from "../../src/components/SettingsDialog/sections/WebBrowserSettings";
import InternalProxySettings from "../../src/components/SettingsDialog/sections/InternalProxySettings";
import ProxySettings from "../../src/components/SettingsDialog/sections/ProxySettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  normalizeInternalProxySettings,
  normalizeWebBrowserSettings,
} from "../../src/utils/settings/webBrowserSettings";
import { normalizeWebsiteDarkModeSettings } from "../../src/utils/connection/websiteDarkMode";
import {
  DEFAULT_VALUES,
  SETTINGS_TABS,
  TAB_DEFAULTS,
  SETTINGS_TAB_IDS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";

function setup(
  section: "browser" | "internal" = "browser",
  initial: Partial<GlobalSettings> = {},
  ready = true,
) {
  const update = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState<GlobalSettings>({
      ...defaultSettings,
      ...initial,
    });
    const updateSettings = (patch: Partial<GlobalSettings>) => {
      update(patch);
      setSettings((current) => ({ ...current, ...patch }));
    };
    return section === "browser" ? (
      <WebBrowserSettings settings={settings} updateSettings={updateSettings} />
    ) : (
      <InternalProxySettings
        settings={settings}
        updateSettings={updateSettings}
        settingsReady={ready}
      />
    );
  }
  return { ...render(<Harness />), update };
}

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

function number(label: string, value: string) {
  const input = screen.getByRole("spinbutton", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

describe("Web Browser settings", () => {
  it("rejects a combined delay budget that cannot leave form detection time", () => {
    const { update } = setup();
    number("Minimum autofill delay (ms)", "30000");
    update.mockClear();
    number("Minimum sign-in submit delay (ms)", "30000");
    expect(screen.getByRole("alert")).toHaveTextContent("52,000 ms");
    expect(update).not.toHaveBeenCalled();
  });
  it("saves page controls and compatibility restrictions through themed settings", () => {
    const { update } = setup();
    number("Website zoom (%)", "125");
    expect(update.mock.lastCall?.[0].webBrowser.defaultZoomPercent).toBe(125);
    for (const [label, field, expected] of [
      ["Show loading progress", "showLoadingProgress", false],
      ["Allow website downloads", "allowDownloads", true],
      ["Allow website dialogs", "allowPageDialogs", true],
      ["Keep browser identity consistent", "preferNativeUserAgent", false],
      ["Keep browser language consistent", "preferNativeLanguage", false],
      ["Hide WebDriver indicator", "hideAutomationIndicator", true],
      ["Require manual sign-in submission", "manualFormSubmit", true],
    ] as const) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: new RegExp(`^${label}`) }),
      );
      expect(update.mock.lastCall?.[0].webBrowser[field]).toBe(expected);
    }
    expect(
      screen.getByText(/Saved User-Agent overrides will be honored/),
    ).toBeVisible();
    expect(screen.getByText("Runtime cookie support")).toBeVisible();
    expect(screen.getByText("Runtime automation indicator")).toBeVisible();
    expect(screen.getByText(/detectable JavaScript override/)).toBeVisible();
    number("Minimum autofill delay (ms)", "1500");
    number("Minimum sign-in submit delay (ms)", "2000");
    expect(update.mock.lastCall?.[0].webBrowser).toMatchObject({
      minimumFormFillDelayMs: 1500,
      minimumFormSubmitDelayMs: 2000,
    });
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy.queryParameters,
    ).toEqual([]);
  });
  it("fills legacy defaults, retains appearance, and shows honest native identity and policy scope", () => {
    const { container, update } = setup("browser", { webBrowser: undefined });
    expect(
      screen.getByRole("checkbox", { name: /Show bookmarks bar/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Show security information/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("spinbutton", { name: "Initial load timeout" }),
    ).toHaveValue(30);
    expect(
      screen.getByRole("spinbutton", { name: "Document ready timeout" }),
    ).toHaveValue(120);
    expect(screen.getByLabelText("Native user agent")).toHaveTextContent(
      navigator.userAgent,
    );
    expect(
      screen.getByText(/Explicit saved connection policies override/),
    ).toHaveTextContent("close and reopen");
    expect(screen.getByText(/not a full browser/)).toHaveTextContent(
      "do not guarantee Google sign-in or Cloudflare",
    );
    expect(
      screen.getByText(/Security warnings remain visible/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Tactical RMM popups" }),
    ).toHaveTextContent("Open in tabs");
    expect(
      container.querySelector('[data-setting-key="websiteDarkMode"]'),
    ).toBeInTheDocument();
    expect(container.querySelector("select")).toBeNull();
    expect(
      screen.queryByText("Enable proxy health checks"),
    ).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: /^Hide WebDriver/ }),
    ).not.toBeChecked();
    expect(screen.queryByText(/detectable JavaScript override/)).toBeNull();
  });

  it("updates browser preferences and bookmark confirmation without losing policy settings", () => {
    const config = normalizeWebBrowserSettings(undefined);
    config.defaultPolicy.httpsOnly = true;
    const { update } = setup("browser", { webBrowser: config });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show bookmarks bar/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show security information/ }),
    );
    choose("Tactical RMM popups", "Block popups");
    expect(update).toHaveBeenLastCalledWith({
      webBrowser: {
        ...config,
        showBookmarksBar: false,
        showSecurityInfo: false,
        popupPolicy: "block",
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Confirm before deleting all bookmarks/,
      }),
    );
    expect(update).toHaveBeenLastCalledWith({
      confirmDeleteAllBookmarks: false,
    });
  });

  it("applies every script/cache choice through themed selects without creating credential grants", () => {
    const { update } = setup();
    for (const [label, value] of [
      ["Inline scripts only", "inline-only"],
      ["Block scripts", "block"],
      ["Allow scripts", "allow"],
    ]) {
      choose("Page scripts", label);
      expect(
        update.mock.lastCall?.[0].webBrowser.defaultPolicy.pageScripts,
      ).toBe(value);
    }
    choose("Website cache", "Bypass cache");
    expect(update.mock.lastCall?.[0].webBrowser.defaultPolicy.cacheMode).toBe(
      "bypass",
    );
    choose("Website cache", "Normal caching");
    fireEvent.click(screen.getByRole("checkbox", { name: /Require HTTPS/ }));
    expect(update.mock.lastCall?.[0].webBrowser.defaultPolicy).toMatchObject({
      httpsOnly: true,
      cacheMode: "normal",
      queryParameters: [],
      allowCrossOriginRedirects: false,
      allowHttpDowngradeRedirects: false,
    });
  });

  it.each([
    ["Initial load timeout", "initialLoadTimeoutSeconds", 10, 120],
    ["Document ready timeout", "documentReadyTimeoutSeconds", 30, 240],
    ["Minimum autofill delay (ms)", "minimumFormFillDelayMs", 0, 30000],
    ["Minimum sign-in submit delay (ms)", "minimumFormSubmitDelayMs", 0, 30000],
  ] as const)("validates %s locally before saving", (label, key, min, max) => {
    const { update } = setup();
    for (const value of ["", "1.5", String(min - 1), String(max + 1)]) {
      number(label, value);
      expect(screen.getByRole("alert")).toHaveTextContent("whole number");
      expect(update).not.toHaveBeenCalled();
      expect(
        screen.getByRole("combobox", { name: "Page scripts" }),
      ).toBeEnabled();
    }
    number(label, String(max));
    expect(update.mock.lastCall?.[0].webBrowser[key]).toBe(max);
    number(label, String(min));
    expect(update.mock.lastCall?.[0].webBrowser[key]).toBe(min);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports keyboard commit and cancelling a partial numeric draft", () => {
    const { update } = setup();
    const input = screen.getByRole("spinbutton", {
      name: "Initial load timeout",
    });
    fireEvent.change(input, { target: { value: "" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(update.mock.lastCall?.[0].webBrowser.initialLoadTimeoutSeconds).toBe(
      40,
    );
  });

  it("uses themed font controls and keeps saved origins readable while inactive", () => {
    const config = normalizeWebBrowserSettings(undefined);
    const origin = "https://fonts.example.com";
    config.defaultPolicy.externalFontOrigins = [origin];
    const { update } = setup("browser", { webBrowser: config });
    const input = screen.getByRole("textbox", { name: "External font origin" });
    const add = screen.getByRole("button", { name: "Add font origin" });
    const origins = screen.getByRole("list", { name: "Saved font origins" });
    const remove = within(origins).getByRole("button", {
      name: "Remove font origin " + origin,
    });

    expect(input).toHaveClass("sor-settings-input");
    expect(input).toHaveStyle({ maxWidth: "none" });
    expect(input).toHaveAccessibleDescription(
      /Allow up to 16 exact HTTPS origins/,
    );
    expect(add).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(remove).toHaveClass("sor-btn", "sor-icon-btn-sm");
    expect(within(origins).getByRole("listitem")).toHaveTextContent(origin);
    expect(input).toBeDisabled();
    expect(add).toBeDisabled();
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(update).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Credentials, login forwarding and consent/),
    ).toHaveTextContent("These defaults do not grant login consent.");

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    );
    expect(input).toBeEnabled();
    expect(remove).toBeEnabled();
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "https://other.example.com" } });
    expect(add).toBeEnabled();
  });

  it("validates exact font origins, normalizes them, rejects duplicates and supports removal", () => {
    const { update } = setup();
    expect(screen.getByLabelText("External font origin")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    );
    update.mockClear();
    const input = screen.getByLabelText("External font origin");
    const add = screen.getByRole("button", { name: "Add font origin" });
    for (const value of [
      "http://fonts.example.com",
      "https://*.example.com",
      "https://fonts.example.com/font.woff",
      "https://user:secret@fonts.example.com",
      "https://fonts.example.com?token=x",
      "https://fonts.example.com#fragment",
    ]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(add);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "exact HTTPS origins",
      );
      expect(update).not.toHaveBeenCalled();
    }
    fireEvent.change(input, {
      target: { value: "https://FONTS.example.com/" },
    });
    fireEvent.click(add);
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy.externalFontOrigins,
    ).toEqual(["https://fonts.example.com"]);
    update.mockClear();
    fireEvent.change(input, {
      target: { value: "https://fonts.example.com/" },
    });
    fireEvent.click(add);
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove font origin https://fonts.example.com",
      }),
    );
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy.externalFontOrigins,
    ).toEqual([]);
  });

  it("preserves font origins under same-origin restrictions and enforces the origin count", () => {
    const config = normalizeWebBrowserSettings(undefined);
    config.defaultPolicy.allowExternalFonts = true;
    config.defaultPolicy.externalFontOrigins = Array.from(
      { length: 16 },
      (_, i) => "https://font" + i + ".example.com",
    );
    const { update } = setup("browser", { webBrowser: config });
    fireEvent.change(screen.getByLabelText("External font origin"), {
      target: { value: "https://extra.example.com" },
    });
    expect(
      screen.getByRole("button", { name: "Add font origin" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Restrict to the same origin/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText("External font origin")).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Remove font origin https://font0.example.com",
      }),
    ).toBeDisabled();
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy.externalFontOrigins,
    ).toEqual(config.defaultPolicy.externalFontOrigins);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Restrict to the same origin/ }),
    );
    expect(screen.getByLabelText("External font origin")).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    ).toBeChecked();
  });

  it("requires explicit recovery of invalid saved policies", () => {
    const config = normalizeWebBrowserSettings(undefined);
    config.defaultPolicy.allowCrossOriginRedirects = true;
    const { update } = setup("browser", { webBrowser: config });
    expect(screen.getByRole("alert")).toHaveTextContent("settings are invalid");
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Web Browser settings" }),
    );
    expect(update).toHaveBeenCalledWith({
      webBrowser: normalizeWebBrowserSettings(undefined),
    });
    expect(
      screen.getByRole("combobox", { name: "Page scripts" }),
    ).toBeInTheDocument();
  });
});

describe("Internal Proxy settings", () => {
  it.each([
    ["Connect timeout", "connectTimeoutSeconds", 1, 120],
    ["Request timeout", "requestTimeoutSeconds", 5, 600],
    ["Pool idle timeout", "poolIdleTimeoutSeconds", 0, 300],
    ["Maximum idle connections per host", "maxIdleConnectionsPerHost", 0, 32],
    ["TCP keepalive interval", "tcpKeepaliveSeconds", 0, 300],
  ] as const)(
    "enforces %s bounds including zero where supported",
    (label, key, min, max) => {
      const config = normalizeInternalProxySettings(undefined);
      config.connectTimeoutSeconds = 1;
      const { update } = setup("internal", { internalProxy: config });
      for (const value of ["", "1.5", String(min - 1), String(max + 1)]) {
        number(label, value);
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("whole number");
      }
      number(label, String(max));
      expect(update.mock.lastCall?.[0].internalProxy[key]).toBe(max);
      number(label, String(min));
      expect(update.mock.lastCall?.[0].internalProxy[key]).toBe(min);
    },
  );

  it("rejects a connect timeout above the request timeout without resetting the page", () => {
    const config = normalizeInternalProxySettings(undefined);
    config.requestTimeoutSeconds = 20;
    const { update } = setup("internal", { internalProxy: config });
    number("Connect timeout", "30");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "at least the connect timeout",
    );
    number("Request timeout", "40");
    number("Connect timeout", "30");
    expect(update.mock.lastCall?.[0].internalProxy).toMatchObject({
      connectTimeoutSeconds: 30,
      requestTimeoutSeconds: 40,
    });
    update.mockClear();
    number("Request timeout", "29");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("30 to 600");
  });

  it("keeps health checks separate from TCP keepalive and uses actual disabled controls", () => {
    const { update } = setup("internal", {
      proxyKeepaliveEnabled: false,
      proxyAutoRestart: false,
    });
    expect(
      screen.getByRole("spinbutton", { name: "Health-check interval" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /Auto-restart dead proxies/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("spinbutton", { name: "Max consecutive auto-restarts" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Enable proxy health checks/ }),
    );
    number("Health-check interval", "20");
    expect(update).toHaveBeenLastCalledWith({
      proxyKeepaliveIntervalSeconds: 20,
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Auto-restart dead proxies/ }),
    );
    number("Max consecutive auto-restarts", "0");
    expect(update).toHaveBeenLastCalledWith({ proxyMaxAutoRestarts: 0 });
    number("TCP keepalive interval", "0");
    expect(
      screen.getByRole("checkbox", { name: /Enable proxy health checks/ }),
    ).toBeChecked();
    expect(
      screen.getByText(
        "Proxy sessions and request diagnostics are available in Session Manager.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved transport changes/)).toHaveTextContent(
      "reloading an active page keeps its existing transport",
    );
    expect(
      screen.getByText(/loopback-only and authenticated/),
    ).toHaveTextContent(
      "including supported redirects and secondary resources",
    );
  });

  it("disables transport, health and request log changes while settings are unavailable", () => {
    setup("internal", {}, false);
    for (const input of [
      ...screen.getAllByRole("spinbutton"),
      ...screen.getAllByRole("checkbox"),
    ])
      expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Apply log limit" }),
    ).toBeDisabled();
  });

  it("retains upstream proxy controls separately", () => {
    render(
      <ProxySettings
        settings={defaultSettings}
        updateSettings={vi.fn()}
        updateProxy={vi.fn()}
      />,
    );
    expect(screen.getByText("Upstream Proxy")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Enable global proxy/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Proxy request log limit"),
    ).not.toBeInTheDocument();
  });
});

describe("Browser and Internal Proxy navigation, search and resets", () => {
  it.each([
    ["browser", "webBrowser"],
    ["internal", "internalProxy"],
  ] as const)("renders every indexed anchor in %s", (component, section) => {
    const { container } = setup(component);
    for (const entry of SETTINGS_SEARCH_INDEX.filter(
      (item) => item.section === section,
    )) {
      expect(
        container.querySelector('[data-setting-key="' + entry.key + '"]'),
        entry.key,
      ).not.toBeNull();
    }
  });

  it("resets complete settings in their own tab and recognizes the new deep-link ID", () => {
    expect(SETTINGS_TAB_IDS).toContain("internalProxy");
    expect(
      SETTINGS_TABS.find((tab) => tab.id === "internalProxy")?.labelKey,
    ).toBe("Internal Proxy");
    expect(TAB_DEFAULTS.webBrowser).toEqual([
      "webBrowser",
      "websiteDarkMode",
      "confirmDeleteAllBookmarks",
    ]);
    expect(TAB_DEFAULTS.internalProxy).toEqual(
      expect.arrayContaining([
        "internalProxy",
        "proxyRequestLogLimit",
        "proxyKeepaliveEnabled",
        "proxyKeepaliveIntervalSeconds",
        "proxyAutoRestart",
        "proxyMaxAutoRestarts",
      ]),
    );
    expect(TAB_DEFAULTS.proxy).not.toContain("proxyRequestLogLimit");
    expect(DEFAULT_VALUES.webBrowser).toEqual(
      normalizeWebBrowserSettings(undefined),
    );
    expect(DEFAULT_VALUES.internalProxy).toEqual(
      normalizeInternalProxySettings(undefined),
    );
    expect(DEFAULT_VALUES.websiteDarkMode).toEqual(
      normalizeWebsiteDarkModeSettings(undefined),
    );
    for (const key of [
      ...TAB_DEFAULTS.webBrowser,
      ...TAB_DEFAULTS.internalProxy,
    ])
      expect(DEFAULT_VALUES[key], key).not.toBeUndefined();
  });
});
