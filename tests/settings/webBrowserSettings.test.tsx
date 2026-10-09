import React, { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WebBrowserSettings from "../../src/components/SettingsDialog/sections/WebBrowserSettings";
import BrowserNativeCapabilitiesCard from "../../src/components/SettingsDialog/sections/webBrowser/BrowserNativeCapabilitiesCard";
import InternalProxySettings from "../../src/components/SettingsDialog/sections/InternalProxySettings";
import ProxySettings from "../../src/components/SettingsDialog/sections/ProxySettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { BrowserSessionRetentionCapabilities } from "../../src/types/settings/browserSession";
import * as tauriInvoke from "../../src/utils/tauri/invoke";
import { DEFAULT_BROWSER_SESSION_RETENTION } from "../../src/utils/settings/browserSessionSettings";
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
import {
  DEFAULT_EXTERNAL_FONT_ORIGINS,
  DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
} from "../../src/types/connection/httpProxyPolicy";

// The directory picker has its own native-command tests; here only its placement
// in the global settings page is part of the settings contract.
vi.mock(
  "../../src/components/SettingsDialog/sections/webBrowser/BrowserDataDirectorySettings",
  () => ({ default: () => <section aria-label="Browser working data" /> }),
);

function setup(
  section: "browser" | "internal" = "browser",
  initial: Partial<GlobalSettings> = {},
  ready = true,
  retentionCapabilities?: BrowserSessionRetentionCapabilities,
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
      <WebBrowserSettings
        settings={settings}
        updateSettings={updateSettings}
        retentionCapabilities={retentionCapabilities}
      />
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

function choose(label: string, option: string | RegExp) {
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
  it("enables idle prewarm by default, preserves opt-out and rejects malformed values", () => {
    expect(normalizeWebBrowserSettings(undefined).idlePrewarmEnabled).toBe(
      true,
    );
    expect(
      normalizeWebBrowserSettings({ idlePrewarmEnabled: false })
        .idlePrewarmEnabled,
    ).toBe(false);
    expect(() =>
      normalizeWebBrowserSettings({ idlePrewarmEnabled: "true" }),
    ).toThrow();
    const { update } = setup();
    const toggle = screen.getByRole("checkbox", {
      name: /^Prewarm browser while idle/,
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(update).toHaveBeenLastCalledWith({
      webBrowser: expect.objectContaining({ idlePrewarmEnabled: false }),
    });
  });
  it("configures supported default-on native preferences and gates unsupported controls", () => {
    const { update } = setup();
    const card = screen.getByRole("region", {
      name: "Native browser capabilities",
    });
    expect(card.querySelector(".sor-settings-card")).not.toBeNull();
    expect(
      within(card).getByText(/not an indication of active capabilities/),
    ).toBeVisible();
    for (const [label, key] of [
      ["Allow localStorage", "localStorageEnabled"],
      ["Allow page-canvas WebGL", "webglEnabled"],
      ["Allow cookies", "cookiesEnabled"],
      ["Allow media-stream APIs", "mediaStreamEnabled"],
      ["Allow normal cross-origin requests", "crossOriginRequestsEnabled"],
      ["Allow app login and website scripts", "websiteExtensionsEnabled"],
    ] as const) {
      const toggle = within(card).getByRole("checkbox", {
        name: new RegExp(`^${label}`),
      });
      expect(toggle).toBeChecked();
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveClass("sor-settings-checkbox");
      fireEvent.click(toggle);
      expect(update.mock.lastCall?.[0].webBrowser[key]).toBe(false);
    }
    expect(
      screen.getByRole("checkbox", { name: /^Hide WebDriver indicator/ }),
    ).toBeDisabled();
    expect(
      within(card).getByRole("checkbox", { name: /^Allow IndexedDB/ }),
    ).toBeDisabled();
    expect(within(card).getByText(/deprecated databases switch/)).toBeVisible();
    expect(
      within(card).getByText(
        /cannot disable all WebGL contexts, including OffscreenCanvas/,
      ),
    ).toBeVisible();
    expect(
      within(card).getByText(/requests ask you through a native prompt/),
    ).toHaveTextContent("never automatically grants access");
    expect(
      within(card).getByText(/Screen capture is unsupported/),
    ).toHaveTextContent("WebRTC non-proxied UDP remains disabled");
    expect(
      within(card).getByText(
        /Turning this off does not disable globally forced dark styling/,
      ),
    ).toBeVisible();
    expect(within(card).getAllByRole("checkbox")).toHaveLength(7);
    expect(
      within(card).getByText(
        /Installable Chromium extensions are not supported/,
      ),
    ).toBeVisible();
    const directory = screen.getByRole("region", {
      name: "Browser working data",
    });
    expect(
      card.compareDocumentPosition(directory) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([true, false])(
    "WebGL capability guidance preserves the saved global value %s until explicitly changed",
    (webglEnabled) => {
      const { update } = setup("browser", {
        webBrowser: normalizeWebBrowserSettings({ webglEnabled }),
      });
      const toggle = screen.getByRole("checkbox", {
        name: /^Allow page-canvas WebGL/,
      });
      expect((toggle as HTMLInputElement).checked).toBe(webglEnabled);
      expect(toggle).toBeEnabled();
      const guidance = screen.getByText(/Requires a compatible GPU and driver/);
      expect(guidance).toBeVisible();
      expect(guidance).toHaveTextContent(
        "Chromium’s safety blocklist remains enforced",
      );
      expect(guidance).toHaveTextContent(
        "Off is unsupported because native CEF cannot disable all WebGL contexts, including OffscreenCanvas",
      );
      expect(guidance).toHaveTextContent("Off blocks new native attempts");
      expect(guidance).toHaveTextContent("Existing values are preserved");
      expect(update).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox", { name: /^Allow cookies/ }));
      expect(update.mock.lastCall?.[0].webBrowser.webglEnabled).toBe(
        webglEnabled,
      );
      expect((toggle as HTMLInputElement).checked).toBe(webglEnabled);
      update.mockClear();
      fireEvent.click(toggle);
      expect(update).toHaveBeenCalledExactlyOnceWith({
        webBrowser: expect.objectContaining({ webglEnabled: !webglEnabled }),
      });
    },
  );

  it.each([
    { saved: true, defaultValue: false, label: "On" },
    { saved: false, defaultValue: true, label: "Off (unsupported for native)" },
    { saved: undefined, defaultValue: false, label: "Use app default (off)" },
    { saved: undefined, defaultValue: true, label: "Use app default (on)" },
  ])(
    "WebGL capability guidance preserves the connection selection $label",
    ({ saved, defaultValue, label }) => {
      const onChange = vi.fn();
      const overrides = { webglEnabled: saved };
      render(
        <BrowserNativeCapabilitiesCard
          defaults={normalizeWebBrowserSettings({ webglEnabled: defaultValue })}
          engine="real-origin"
          scope="connection"
          overrides={overrides}
          onChange={onChange}
        />,
      );
      const select = screen.getByRole("combobox", {
        name: "Allow page-canvas WebGL",
      });
      expect(select).toHaveTextContent(label);
      expect(
        screen.getByText(/Requires a compatible GPU and driver/),
      ).toHaveTextContent("Existing values are preserved");
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(select);
      expect(
        screen.getByRole("option", { name: "Off (unsupported for native)" }),
      ).toBeVisible();
      fireEvent.mouseDown(
        screen.getByRole("option", { name: /^On$/ }),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith("webglEnabled", true);
      expect(overrides.webglEnabled).toBe(saved);
    },
  );

  it("preserves saved inactive native preferences when editing a supported field", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({
        databasesEnabled: false,
        hideAutomationIndicator: false,
      }),
    });
    for (const name of [/^Allow IndexedDB/, /^Hide WebDriver indicator/]) {
      const toggle = screen.getByRole("checkbox", { name });
      expect(toggle).toBeDisabled();
      expect(toggle).not.toBeChecked();
    }
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Allow cookies/ }));
    expect(update.mock.lastCall?.[0].webBrowser).toMatchObject({
      cookiesEnabled: false,
      databasesEnabled: false,
      hideAutomationIndicator: false,
    });
  });

  it("does not present native-only settings as active in the legacy engine", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({
        engine: "legacy",
        cookiesEnabled: false,
      }),
    });
    const card = screen.getByRole("region", {
      name: "Native browser capabilities",
    });
    expect(within(card).getByRole("status")).toHaveTextContent(
      "do not apply to the legacy rewrite browser",
    );
    for (const toggle of within(card).getAllByRole("checkbox"))
      expect(toggle).toBeDisabled();
    expect(
      within(card).getByRole("checkbox", { name: /^Allow cookies/ }),
    ).not.toBeChecked();
    expect(update).not.toHaveBeenCalled();
  });
  it("displays a legacy request as database retention and saves the canonical mode without claiming payload migration", () => {
    const saved = {
      ...normalizeWebBrowserSettings(undefined),
      sessionRetention: {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-local",
      },
    };
    const { update } = setup("browser", {
      webBrowser: saved as unknown as GlobalSettings["webBrowser"],
    });
    expect(
      screen.getByRole("combobox", { name: "Requested cookie retention" }),
    ).toHaveTextContent("Sign-in cookies in this encrypted database");
    expect(
      screen.getByText(
        /retention is configured but runtime support has not been confirmed/,
      ),
    ).toHaveTextContent("Encrypted database");
    expect(screen.getByText(/Only cookies can be retained/)).toHaveTextContent(
      "inside the owning encrypted database",
    );
    expect(screen.getByText(/Only cookies can be retained/)).toHaveTextContent(
      "included in that database's sync and exports",
    );
    expect(
      screen.getByText(
        /does not confirm that previously retained cookie data has been migrated/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/on this machine|excluded from cloud sync/),
    ).toBeNull();
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^Show bookmarks bar/ }),
    );
    expect(update.mock.lastCall?.[0].webBrowser.sessionRetention.mode).toBe(
      "encrypted-database",
    );
    expect(saved.sessionRetention.mode).toBe("encrypted-local");
  });

  it("reveals retention policy controls only after the native support probe completes", async () => {
    const invoke = vi.fn().mockResolvedValue({
      memory: true,
      encryptedDatabase: true,
      policyExpiration: true,
      clearOnDatabaseLock: true,
    });
    const probe = vi.spyOn(tauriInvoke, "getInvoke").mockResolvedValue(invoke);
    const { update, unmount } = setup();
    try {
      expect(
        screen.queryByRole("spinbutton", {
          name: "Retained session idle expiry (minutes)",
        }),
      ).toBeNull();
      await waitFor(() =>
        expect(
          screen.getByRole("spinbutton", {
            name: "Retained session idle expiry (minutes)",
          }),
        ).toBeVisible(),
      );
      expect(invoke.mock.calls).toEqual([
        ["origin_browser_retention_capabilities"],
      ]);
      expect(
        screen.getByText(/Restore requires unlocking the owning database/),
      ).toBeVisible();
      expect(update).not.toHaveBeenCalled();
    } finally {
      unmount();
      probe.mockRestore();
    }
  });

  it("honors supplied support without probing and keeps unavailable controls hidden", () => {
    const probe = vi.spyOn(tauriInvoke, "getInvoke");
    const { unmount } = setup("browser", {}, true, {
      memory: false,
      encryptedDatabase: false,
      policyExpiration: false,
      clearOnDatabaseLock: false,
    });
    try {
      expect(probe).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("spinbutton", {
          name: "Retained session idle expiry (minutes)",
        }),
      ).toBeNull();
    } finally {
      unmount();
      probe.mockRestore();
    }
  });

  it("mounts themed engine selection and shared website defaults", () => {
    const { update, container } = setup();
    expect(container.querySelector("select")).toBeNull();
    expect(
      screen
        .getByRole("combobox", { name: "Default browser engine" })
        .closest(".sor-settings-select-row"),
    ).toHaveClass("flex-wrap");
    expect(
      screen.getByRole("combobox", { name: "Default browser engine" }),
    ).toHaveTextContent("Real-origin native browser (experimental)");
    expect(update).not.toHaveBeenCalled();
    choose("Default browser engine", "Legacy rewrite browser");
    expect(update.mock.lastCall?.[0].webBrowser.engine).toBe("legacy");
    choose(
      "Default browser engine",
      /^Real-origin native browser \(experimental\)/,
    );
    expect(update.mock.lastCall?.[0].webBrowser.engine).toBe("real-origin");
    expect(
      screen.getByRole("heading", {
        name: "Shared website request permissions",
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("New website origin"), {
      target: { value: "https://fixture.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add website" }));
    expect(
      update.mock.lastCall?.[0].webBrowser.domainPermissions.websites[0].origin,
    ).toBe("https://fixture.invalid");
    expect(update.mock.lastCall?.[0].webBrowser.engine).toBe("real-origin");
  });
  it("preserves persisted legacy engine preferences without rewriting them on render", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({ engine: "legacy" }),
    });
    expect(
      screen.getByRole("combobox", { name: "Default browser engine" }),
    ).toHaveTextContent("Legacy rewrite browser");
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show bookmarks bar/ }),
    );
    expect(update.mock.lastCall?.[0].webBrowser.engine).toBe("legacy");
  });
  it("shows common font and resource defaults without writing on render", () => {
    const { update } = setup("browser", { webBrowser: undefined });
    expect(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    ).toBeChecked();
    const fonts = screen.getByRole("list", { name: "Saved font origins" });
    expect(within(fonts).getAllByRole("listitem")).toHaveLength(4);
    for (const origin of DEFAULT_EXTERNAL_FONT_ORIGINS)
      expect(within(fonts).getByText(origin)).toBeVisible();
    const resources = screen.getByRole("list", {
      name: "Saved external resource origins",
    });
    for (const row of DEFAULT_EXTERNAL_RESOURCE_ORIGINS)
      expect(within(resources).getByText(row.origin)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves explicit font opt-outs and empty resource lists until the matching restore action", () => {
    const config = normalizeWebBrowserSettings(undefined);
    Object.assign(config.defaultPolicy, {
      allowExternalFonts: false,
      externalFontOrigins: [],
      externalResourceOrigins: [],
      pageScripts: "block",
    });
    const { update } = setup("browser", { webBrowser: config });
    expect(
      screen.getByRole("checkbox", { name: /Allow external fonts/ }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("list", { name: "Saved font origins" }),
    ).toBeNull();
    expect(
      screen.queryByRole("list", { name: "Saved external resource origins" }),
    ).toBeNull();
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore common fonts" }),
    );
    expect(update.mock.lastCall?.[0].webBrowser.defaultPolicy).toMatchObject({
      allowExternalFonts: true,
      externalFontOrigins: [...DEFAULT_EXTERNAL_FONT_ORIGINS],
      externalResourceOrigins: [],
      pageScripts: "block",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore common resource defaults" }),
    );
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy
        .externalResourceOrigins,
    ).toEqual(DEFAULT_EXTERNAL_RESOURCE_ORIGINS);
    expect(update.mock.lastCall?.[0].webBrowser.defaultPolicy.pageScripts).toBe(
      "block",
    );
  });

  it("edits script and stylesheet defaults without changing font opt-outs or security controls", () => {
    const config = normalizeWebBrowserSettings(undefined);
    Object.assign(config.defaultPolicy, {
      allowExternalFonts: false,
      externalFontOrigins: [],
      externalResourceOrigins: [],
      httpsOnly: true,
      pageScripts: "inline-only",
    });
    const { update } = setup("browser", { webBrowser: config });
    const input = screen.getByLabelText("External resource origin");
    expect(input).toHaveClass("sor-settings-input");
    expect(
      screen.getByText(/External script grants are inactive/),
    ).toBeVisible();
    fireEvent.change(input, {
      target: { value: "HTTPS://Assets.Example.test:443/" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Stylesheets" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add resource origin" }),
    );
    expect(update.mock.lastCall?.[0].webBrowser.defaultPolicy).toMatchObject({
      externalResourceOrigins: [
        { origin: "https://assets.example.test", kinds: ["stylesheet"] },
      ],
      externalFontOrigins: [],
      allowExternalFonts: false,
      httpsOnly: true,
      pageScripts: "inline-only",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Restrict to the same origin/ }),
    );
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Restore common resource defaults" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Restore common fonts" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Remove resource origin https://assets.example.test",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Restrict to the same origin/ }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove resource origin https://assets.example.test",
      }),
    );
    expect(
      update.mock.lastCall?.[0].webBrowser.defaultPolicy
        .externalResourceOrigins,
    ).toEqual([]);
  });

  it("rejects a combined delay budget that cannot leave form detection time", () => {
    const { update } = setup();
    number("Minimum autofill delay (ms)", "30000");
    update.mockClear();
    number("Minimum sign-in submit delay (ms)", "30000");
    expect(screen.getByRole("alert")).toHaveTextContent("52,000 ms");
    expect(update).not.toHaveBeenCalled();
  });
  it("saves page controls and compatibility restrictions through themed settings", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({
        engine: "legacy",
        hideAutomationIndicator: false,
      }),
    });
    number("Website zoom (%)", "125");
    expect(update.mock.lastCall?.[0].webBrowser.defaultZoomPercent).toBe(125);
    for (const [label, field, expected] of [
      ["Show loading progress", "showLoadingProgress", false],
      ["Allow website downloads", "allowDownloads", true],
      ["Allow website dialogs", "allowPageDialogs", true],
      ["Keep browser identity consistent", "preferNativeUserAgent", false],
      ["Keep browser language consistent", "preferNativeLanguage", false],
      ["Hide WebDriver indicator", "hideAutomationIndicator", true],
      ["Require manual sign-in submission", "manualFormSubmit", false],
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
      screen.getByRole("checkbox", {
        name: /Require manual sign-in submission/,
      }),
    ).toBeChecked();
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
      screen.getByRole("combobox", { name: "Website popups" }),
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
    ).toBeChecked();
    expect(screen.queryByText(/detectable JavaScript override/)).toBeNull();
    expect(
      screen.getByText(/private closure and do not enable the WebDriver flag/),
    ).toBeVisible();
  });

  it("updates browser preferences and bookmark confirmation without losing policy settings", () => {
    const config = normalizeWebBrowserSettings({ engine: "legacy" });
    config.defaultPolicy.httpsOnly = true;
    const { update } = setup("browser", { webBrowser: config });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show bookmarks bar/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show security information/ }),
    );
    choose("Website popups", "Block popups");
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

  it("honors native popup preferences while keeping unsupported dialogs inactive", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({
        allowDownloads: true,
        allowPageDialogs: true,
        popupPolicy: "tabs",
      }),
    });
    const downloads = screen.getByRole("checkbox", {
      name: /^Allow website downloads/,
    });
    expect(downloads).toBeEnabled();
    expect(downloads).toBeChecked();
    for (const name of [/^Allow website dialogs/]) {
      expect(screen.getByRole("checkbox", { name })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    }
    expect(
      screen.getByRole("combobox", { name: "Website popups" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "Website popups" }),
    ).toHaveTextContent("Open in tabs");
    expect(screen.getByText(/Open allowed native popups/)).toHaveTextContent(
      "Destination restrictions still apply. Close and reopen the website",
    );
    expect(
      screen.queryByText(/saved legacy popup preference is inactive/),
    ).toBeNull();
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (entry) => entry.key === "webBrowser.popupPolicy",
      ),
    ).toMatchObject({
      label: "Website popups",
      tags: expect.arrayContaining(["tactical", "rmm"]),
    });
    expect(update).not.toHaveBeenCalled();
    number("Website zoom (%)", "125");
    expect(update.mock.lastCall?.[0].webBrowser).toMatchObject({
      allowDownloads: true,
      allowPageDialogs: true,
      popupPolicy: "tabs",
    });
    choose("Website popups", "Block popups");
    expect(update.mock.lastCall?.[0].webBrowser).toMatchObject({
      popupPolicy: "block",
      allowDownloads: true,
      allowPageDialogs: true,
    });
    expect(
      screen.getByRole("combobox", { name: "Website popups" }),
    ).toHaveTextContent("Block popups");
    choose("Website popups", "Open in tabs");
    expect(update.mock.lastCall?.[0].webBrowser.popupPolicy).toBe("tabs");
    choose("Default browser engine", "Legacy rewrite browser");
    expect(
      screen.getByRole("checkbox", { name: /^Allow website downloads/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Website popups" }),
    ).toHaveTextContent("Open in tabs");
    expect(
      screen.getByText(/Legacy popup handling supports Tactical RMM only/),
    ).toBeVisible();
  });

  it("renders the global XSLT control beside dialogs and saves its change without changing dialog policy", () => {
    const { update } = setup("browser", {
      webBrowser: normalizeWebBrowserSettings({ allowPageDialogs: true }),
    });
    const dialogs = screen.getByRole("checkbox", {
      name: /^Allow website dialogs/,
    });
    const xslt = screen.getByRole("checkbox", { name: /^Enable XSLT/ });
    expect(dialogs.closest(".sor-settings-card")).toContainElement(xslt);
    expect(xslt).toBeChecked();
    fireEvent.click(xslt);
    expect(update.mock.lastCall?.[0].webBrowser).toMatchObject({
      xsltEnabled: false,
      allowPageDialogs: true,
    });
  });

  it("saves requested cookie retention without claiming support or exposing unapproved policy controls", () => {
    const { update } = setup();
    expect(
      screen.getByRole("combobox", { name: "Requested cookie retention" }),
    ).toHaveTextContent("Ephemeral");
    choose("Requested cookie retention", /Memory/);
    expect(update.mock.lastCall?.[0].webBrowser.sessionRetention).toMatchObject(
      { version: 1, mode: "memory" },
    );
    expect(
      screen.getByText(/saving this preference does not activate retention/),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("spinbutton", { name: /Retained session/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Clear retained cookies/ }),
    ).toBeNull();
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
    config.defaultPolicy.allowExternalFonts = false;
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
    const config = normalizeWebBrowserSettings(undefined);
    config.defaultPolicy.allowExternalFonts = false;
    config.defaultPolicy.externalFontOrigins = [];
    const { update } = setup("browser", { webBrowser: config });
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

  it("does not accept all-script trust as a global default", () => {
    const config = normalizeWebBrowserSettings(undefined);
    config.defaultPolicy.allowAllScripts = true;
    expect(() => normalizeWebBrowserSettings(config)).toThrow();
  });

  it("keeps all-request trust connection-only and rejects a saved global opt-in", () => {
    const config = normalizeWebBrowserSettings(undefined);
    expect(config.defaultPolicy.allowAllRequests).toBe(false);
    expect(
      normalizeWebBrowserSettings(config).defaultPolicy.allowAllRequests,
    ).toBe(false);
    config.defaultPolicy.allowAllRequests = true;
    expect(() => normalizeWebBrowserSettings(config)).toThrow();
    const { update } = setup("browser", { webBrowser: config });
    expect(screen.getByRole("alert")).toHaveTextContent("settings are invalid");
    expect(update).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("checkbox", { name: /Allow all website requests/ }),
    ).not.toBeInTheDocument();
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
    expect(defaultSettings.webBrowser?.engine).toBe("real-origin");
    expect((DEFAULT_VALUES.webBrowser as { engine: string }).engine).toBe(
      "real-origin",
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
