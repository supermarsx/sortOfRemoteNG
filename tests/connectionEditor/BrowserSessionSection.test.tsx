import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserSessionSection from "../../src/components/connectionEditor/httpOptions/BrowserSessionSection";
import BrowserSessionRetentionFields from "../../src/components/SettingsDialog/sections/webBrowser/BrowserSessionRetentionFields";
import type { Mgr } from "../../src/components/connectionEditor/httpOptions/types";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_BROWSER_SESSION_RETENTION } from "../../src/utils/settings/browserSessionSettings";
import * as tauriInvoke from "../../src/utils/tauri/invoke";

const shared = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  settingsReady: true,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => shared,
}));
beforeEach(() => {
  shared.settings = {};
  shared.settingsReady = true;
});

function setup(initial: Partial<Connection> = {}) {
  const change = vi.fn();
  function Harness() {
    const [formData, setFormData] = useState<Partial<Connection>>({
      id: "connection",
      ...initial,
    });
    const update: Mgr["setFormData"] = (value) =>
      setFormData((previous) => {
        const next = typeof value === "function" ? value(previous) : value;
        change(next);
        return next;
      });
    return (
      <BrowserSessionSection mgr={{ formData, setFormData: update } as Mgr} />
    );
  }
  return { ...render(<Harness />), change };
}
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

describe("browser connection overrides", () => {
  it("repairs invalid overrides without clearing unrelated connection edits", () => {
    const { change } = setup({
      name: "Unsaved name",
      browserSession: {
        version: 1,
        defaultZoomPercent: 400,
        cookiesEnabled: false,
      },
    });
    fireEvent.click(screen.getByText("Repair saved settings"));
    const repaired = {
      version: 1,
      defaultZoomPercent: 125,
      cookiesEnabled: false,
    };
    fireEvent.change(screen.getByLabelText("Browser session overrides JSON"), {
      target: { value: JSON.stringify(repaired) },
    });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply repaired settings" }),
    );
    expect(change.mock.lastCall?.[0]).toMatchObject({
      name: "Unsaved name",
      browserSession: repaired,
    });
  });

  it("refuses repaired overrides which still conflict with inherited delays", () => {
    shared.settings = { webBrowser: { minimumFormFillDelayMs: 30000 } };
    const { change } = setup({
      browserSession: { version: 1, minimumFormSubmitDelayMs: 30000 },
    });
    fireEvent.click(screen.getByText("Repair saved settings"));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply repaired settings" }),
    );
    expect(change).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent(
      "repair is still invalid",
    );
  });
  it.each([
    ["localStorageEnabled", "Allow localStorage"],
    ["webglEnabled", "Allow page-canvas WebGL"],
    ["cookiesEnabled", "Allow cookies"],
    ["mediaStreamEnabled", "Allow media-stream APIs"],
    ["crossOriginRequestsEnabled", "Allow normal cross-origin requests"],
    ["websiteExtensionsEnabled", "Allow app login and website scripts"],
  ])(
    "saves only an explicit %s override and restores live inheritance",
    (key, label) => {
      const { change } = setup();
      expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(
        "Use app default (on)",
      );
      expect(screen.getByRole("combobox", { name: label })).toBeEnabled();
      expect(change).not.toHaveBeenCalled();
      choose(label, key === "webglEnabled" ? "Off (unsupported for native)" : "Off");
      expect(change.mock.lastCall?.[0].browserSession).toEqual({
        version: 1,
        [key]: false,
      });
      choose(label, "Use app default (on)");
      expect(change.mock.lastCall?.[0].browserSession).toBeUndefined();
    },
  );
  it("keeps native IndexedDB and legacy-only automation overrides inactive without dropping saved values", () => {
    const { change } = setup({
      name: "Unsaved name",
      browserSession: {
        version: 1,
        databasesEnabled: false,
        hideAutomationIndicator: false,
      },
    });
    for (const name of [
      "Allow IndexedDB",
      "Hide WebDriver indicator (legacy only)",
    ]) {
      const control = screen.getByRole("combobox", { name });
      expect(control).toBeDisabled();
      expect(control).toHaveTextContent("Off");
    }
    expect(change).not.toHaveBeenCalled();
    choose("Allow cookies", "Off");
    expect(change.mock.lastCall?.[0]).toMatchObject({
      name: "Unsaved name",
      browserSession: {
        version: 1,
        cookiesEnabled: false,
        databasesEnabled: false,
        hideAutomationIndicator: false,
      },
    });
  });
  it("edits and resets the legacy automation preference without enabling native-only controls", () => {
    shared.settings = { webBrowser: { engine: "legacy" } };
    const { change } = setup();
    const label = "Hide WebDriver indicator (legacy only)";
    expect(screen.getByRole("combobox", { name: label })).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "Allow media-stream APIs" }),
    ).toBeDisabled();
    choose(label, "Off");
    expect(change.mock.lastCall?.[0].browserSession).toEqual({
      version: 1,
      hideAutomationIndicator: false,
    });
    choose(label, "Use app default (on)");
    expect(change.mock.lastCall?.[0].browserSession).toBeUndefined();
  });
  it("describes native requests without promising persistent storage or camera/route permission", () => {
    setup();
    expect(
      screen.getByRole("region", { name: "Native browser capabilities" }),
    ).toHaveClass("space-y-3");
    expect(
      screen.getByText(
        /Camera and microphone requests ask you through a native prompt/,
      ),
    ).toHaveTextContent("never automatically grants access");
    expect(screen.getByText(/Screen capture is unsupported/)).toHaveTextContent(
      "WebRTC non-proxied UDP remains disabled",
    );
    const webglGuidance = screen.getByText(/Requires a compatible GPU and driver/);
    expect(webglGuidance).toBeVisible();
    expect(webglGuidance).toHaveTextContent(
      "cannot disable all WebGL contexts, including OffscreenCanvas",
    );
    expect(webglGuidance).toHaveTextContent("Off blocks new native attempts");
    expect(
      screen.getByText(
        /Turning this off does not disable globally forced dark styling/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/private closure and do not enable the WebDriver flag/),
    ).toBeVisible();
    expect(
      screen.getByText(
        /CORS and the same-origin policy \(SOP\) remain enforced/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/localStorage and IndexedDB remain ephemeral/),
    ).toBeVisible();
    expect(
      screen.getByText(/does not enable the removed WebSQL API/),
    ).toBeVisible();
    expect(screen.queryByRole("combobox", { name: /Chromium/ })).toBeNull();
  });
  it("normalizes a legacy override on the next edit without enabling retention or rewriting on render", () => {
    const legacy = {
      version: 1,
      sessionRetention: {
        ...DEFAULT_BROWSER_SESSION_RETENTION,
        mode: "encrypted-local",
        maxAgeHours: 48,
      },
    };
    const { change } = setup({
      browserSession: legacy as unknown as Connection["browserSession"],
    });
    expect(
      screen.getByRole("combobox", { name: "Requested cookie retention" }),
    ).toHaveTextContent("Sign-in cookies in this encrypted database");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Encrypted database retention is configured",
    );
    expect(screen.getByText(/Only cookies can be retained/)).toHaveTextContent(
      "does not preserve a full browser profile",
    );
    expect(
      screen.getByText(
        /does not confirm that previously retained cookie data has been migrated/,
      ),
    ).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    choose("Show bookmarks bar", "Off");
    expect(change.mock.lastCall?.[0].browserSession).toMatchObject({
      showBookmarksBar: false,
      sessionRetention: { mode: "encrypted-database", maxAgeHours: 48 },
    });
    expect(legacy.sessionRetention.mode).toBe("encrypted-local");
  });

  it("uses native support to enable policy controls without granting owner access or changing the draft", async () => {
    const invoke = vi.fn().mockResolvedValue({
      memory: true,
      encryptedDatabase: true,
      policyExpiration: true,
      clearOnDatabaseLock: true,
    });
    const probe = vi.spyOn(tauriInvoke, "getInvoke").mockResolvedValue(invoke);
    const { change, unmount } = setup({
      browserSession: {
        version: 1,
        sessionRetention: {
          ...DEFAULT_BROWSER_SESSION_RETENTION,
          mode: "encrypted-database",
        },
      },
    });
    try {
      expect(screen.getByRole("status")).toHaveTextContent(
        "runtime support has not been confirmed",
      );
      await waitFor(() =>
        expect(
          screen.getByRole("spinbutton", {
            name: "Retained session idle expiry (minutes)",
          }),
        ).toBeVisible(),
      );
      expect(screen.queryByRole("status")).toBeNull();
      expect(invoke.mock.calls).toEqual([
        ["origin_browser_retention_capabilities"],
      ]);
      expect(change).not.toHaveBeenCalled();
    } finally {
      unmount();
      probe.mockRestore();
    }
  });

  it("uses themed controls and inherits without changing the saved connection", () => {
    shared.settings = { webBrowser: { defaultZoomPercent: 135 } };
    const { container, change } = setup();
    const zoom = screen.getByRole("spinbutton", { name: "Website zoom (%)" });
    expect(zoom).toHaveValue(135);
    expect(zoom).toBeDisabled();
    expect(zoom).toHaveClass("sor-settings-input");
    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /engine/i })).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("saves only explicit fields and restores inheritance on reset", () => {
    const { change } = setup({
      name: "Preserve",
      httpFormAutomation: {
        version: 1,
        fillDelayMs: 100,
        submitDelayMs: 0,
        detectionTimeoutMs: 8000,
        submit: false,
        fields: [],
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override Website zoom (%)" }),
    );
    const zoom = screen.getByRole("spinbutton", { name: "Website zoom (%)" });
    fireEvent.change(zoom, { target: { value: "150" } });
    fireEvent.blur(zoom);
    choose("Show bookmarks bar", "Off");
    expect(change.mock.lastCall?.[0]).toMatchObject({
      name: "Preserve",
      browserSession: {
        version: 1,
        defaultZoomPercent: 150,
        showBookmarksBar: false,
      },
      httpFormAutomation: { submit: false },
    });
    expect(Object.keys(change.mock.lastCall?.[0].browserSession)).toHaveLength(
      3,
    );
    choose("Show bookmarks bar", /Use app default/);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override Website zoom (%)" }),
    );
    expect(change.mock.lastCall?.[0].browserSession).toBeUndefined();
  });

  it("rejects a delay override conflicting with inherited app settings", () => {
    shared.settings = { webBrowser: { minimumFormFillDelayMs: 30000 } };
    const { change } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Override Minimum submit delay (ms)",
      }),
    );
    const input = screen.getByRole("spinbutton", {
      name: "Minimum submit delay (ms)",
    });
    fireEvent.change(input, { target: { value: "30000" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("52,000");
    expect(
      change.mock.lastCall?.[0].browserSession.minimumFormSubmitDelayMs,
    ).toBe(0);
  });

  it("distinguishes configured cookie retention from available support", () => {
    const { change } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override session retention" }),
    );
    choose(
      "Requested cookie retention",
      "Sign-in cookies in this encrypted database",
    );
    expect(change.mock.lastCall?.[0].browserSession.sessionRetention.mode).toBe(
      "encrypted-database",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "saving this preference does not activate retention",
    );
    expect(screen.getByText(/Only cookies can be retained/)).toBeVisible();
    expect(
      screen.queryByRole("spinbutton", { name: /Retained session/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Clear retained cookies/ }),
    ).toBeNull();
  });

  it("exposes expiry and snapshot deletion controls only with explicit native approval", () => {
    render(
      <BrowserSessionRetentionFields
        value={DEFAULT_BROWSER_SESSION_RETENTION}
        onChange={vi.fn()}
        capabilities={{
          memory: true,
          encryptedDatabase: false,
          policyExpiration: true,
          clearOnDatabaseLock: true,
        }}
      />,
    );
    expect(
      screen.getByRole("spinbutton", {
        name: "Retained session idle expiry (minutes)",
      }),
    ).toHaveValue(30);
    expect(
      screen.getByRole("checkbox", {
        name: /^Clear retained cookies when the database locks/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByText(/Database lock always stops live browser attempts/),
    ).toBeVisible();
  });

  it("waits for settings hydration without writing defaults", () => {
    shared.settingsReady = false;
    const { change } = setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("preserves invalid saved overrides until an explicit reset", () => {
    const { change } = setup({
      browserSession: { version: 1, defaultZoomPercent: 900 },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("invalid");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset browser session overrides" }),
    );
    expect(change.mock.lastCall?.[0].browserSession).toBeUndefined();
  });
});
