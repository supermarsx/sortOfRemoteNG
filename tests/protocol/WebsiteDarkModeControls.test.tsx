import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WebsiteDarkModeControls from "../../src/components/protocol/webBrowser/WebsiteDarkModeControls";
import WebsiteAppearanceSection from "../../src/components/SettingsDialog/sections/WebsiteAppearanceSection";
import { SessionQuickActionsSection } from "../../src/components/connectionEditor/SessionQuickActionsSection";
import {
  DEFAULT_WEBSITE_DARK_THEME,
  normalizeWebsiteDarkModeConfig,
  BUILTIN_WEBSITE_DARK_PRESETS,
} from "../../src/utils/connection/websiteDarkMode";
import type { WebsiteDarkModeController } from "../../src/hooks/protocol/useWebsiteDarkMode";
import type { Connection } from "../../src/types/connection/connection";
import { defaultSettings } from "../../src/contexts/SettingsContext";

function controller(
  patch: Partial<WebsiteDarkModeController> = {},
): WebsiteDarkModeController {
  return {
    scopeKey: "owner:1",
    enabled: false,
    available: true,
    busy: false,
    error: null,
    status: { kind: "off", message: "The dark-mode extension is off." },
    unavailableReason: "",
    configuration: normalizeWebsiteDarkModeConfig(undefined),
    theme: { ...DEFAULT_WEBSITE_DARK_THEME },
    defaultTheme: { ...DEFAULT_WEBSITE_DARK_THEME },
    presets: [...BUILTIN_WEBSITE_DARK_PRESETS],
    setEnabled: vi.fn(async () => true),
    updateConfiguration: vi.fn(async () => true),
    ...patch,
  };
}
function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Dark-mode extension" }));
  // PopoverSurface positions on the next animation frame in production. A
  // resize drives that same positioning path synchronously in jsdom.
  fireEvent(window, new Event("resize"));
}

describe("Dark-mode extension UI", () => {
  it("opens as an anchored certificate-style popover and dismisses with Escape", () => {
    render(<WebsiteDarkModeControls controller={controller()} />);
    const trigger = screen.getByRole("button", {
      name: "Dark-mode extension",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    open();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("website-dark-mode-popover")).toContainElement(
      screen.getByRole("dialog", { name: "Dark-mode extension settings" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Dark-mode extension settings" }),
    ).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
  it("previews app defaults immediately without discarding the saved override", () => {
    const override = { ...DEFAULT_WEBSITE_DARK_THEME, brightness: 72 };
    const value = controller({
      enabled: true,
      configuration: { version: 1, useGlobalDefaults: false, theme: override },
      theme: override,
      defaultTheme: { ...DEFAULT_WEBSITE_DARK_THEME, brightness: 93 },
    });
    render(<WebsiteDarkModeControls controller={value} />);
    expect(
      screen.getByRole("button", { name: "Dark-mode extension" }),
    ).toHaveClass("ring-1", "ring-inset", "ring-primary/40");
    expect(
      screen.getByRole("button", { name: "Dark-mode extension" }),
    ).not.toHaveClass("bg-primary/10");
    open();
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "72",
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use app appearance defaults" }),
    );
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "93",
    );
    expect(value.updateConfiguration).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use app appearance defaults" }),
    );
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "72",
    );
  });
  it("resets the open draft on owner scope changes", () => {
    const initial = controller({
      configuration: {
        ...normalizeWebsiteDarkModeConfig(undefined),
        useGlobalDefaults: false,
      },
    });
    const view = render(<WebsiteDarkModeControls controller={initial} />);
    open();
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "42" },
    });
    view.rerender(
      <WebsiteDarkModeControls
        controller={{ ...initial, scopeKey: "owner:2" }}
      />,
    );
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "100",
    );
    expect(initial.updateConfiguration).not.toHaveBeenCalled();
  });
  it.each(["Dynamic colors", "Filter", "Dynamic + filter", "Custom CSS"])(
    "offers the %s conversion mode",
    (mode) => {
      render(
        <WebsiteDarkModeControls
          controller={controller({
            configuration: {
              ...normalizeWebsiteDarkModeConfig(undefined),
              useGlobalDefaults: false,
            },
          })}
        />,
      );
      open();
      select("Conversion mode", mode);
      expect(
        screen.getByRole("combobox", { name: "Conversion mode" }),
      ).toHaveTextContent(mode);
    },
  );
  it("uses explicit enable and disable actions; appearance editing never enables", async () => {
    const value = controller();
    const view = render(<WebsiteDarkModeControls controller={value} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Enable extension" }));
    await waitFor(() => expect(value.setEnabled).toHaveBeenCalledWith(true));
    view.rerender(
      <WebsiteDarkModeControls controller={{ ...value, enabled: true }} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Disable extension" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use app appearance defaults" }),
    );
    select("Apply appearance preset", "AMOLED");
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await waitFor(() =>
      expect(value.updateConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          useGlobalDefaults: false,
          theme: expect.objectContaining({ backgroundColor: "#000000" }),
        }),
      ),
    );
    expect(value.setEnabled).toHaveBeenCalledTimes(1);
  });
  it("keeps failed saves visible and never reports success", async () => {
    const value = controller({ updateConfiguration: vi.fn(async () => false) });
    render(<WebsiteDarkModeControls controller={value} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not saved");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("fails closed when unavailable and shows the actionable reason", () => {
    render(
      <WebsiteDarkModeControls
        controller={controller({
          available: false,
          unavailableReason: "Unlock the owning database first.",
        })}
      />,
    );
    open();
    expect(
      screen.getByRole("button", { name: "Enable extension" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save appearance" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Unlock the owning database first."),
    ).toHaveAttribute("role", "status");
  });
  it.each([
    ["off", false, "Dark-mode extension disabled"],
    ["engine", true, "Dark-mode extension enabled"],
    ["cssOnly", true, "Dark-mode extension enabled, CSS only"],
    ["failed", true, "Dark-mode extension could not theme this page"],
  ] as const)(
    "tells the %s state apart in the toolbar",
    (kind, enabled, tooltip) => {
      render(
        <WebsiteDarkModeControls
          controller={controller({
            enabled,
            status: { kind, message: "Because of this." },
          })}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Dark-mode extension" }),
      ).toHaveAttribute("data-tooltip", tooltip);
    },
  );
  it("separates a themed-with-CSS page from one it could not theme", () => {
    const view = render(
      <WebsiteDarkModeControls
        controller={controller({
          enabled: true,
          status: {
            kind: "cssOnly",
            message: "Themed with CSS only: external script files are blocked.",
          },
        })}
      />,
    );
    open();
    expect(
      screen.getByText(
        "Themed with CSS only: external script files are blocked.",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();

    render(
      <WebsiteDarkModeControls
        controller={controller({
          enabled: true,
          status: {
            kind: "failed",
            message: "Cannot theme this page: website scripts are blocked.",
          },
        })}
      />,
    );
    open();
    expect(
      screen.getByText("Cannot theme this page: website scripts are blocked."),
    ).toHaveAttribute("role", "alert");
  });
  it("shows a shared unavailable error only once without claiming a setting was saved", () => {
    render(
      <WebsiteDarkModeControls
        controller={controller({
          available: false,
          error: "Unlock the owning database first.",
          unavailableReason: "Unlock the owning database first.",
        })}
      />,
    );
    open();
    expect(
      screen.getAllByText("Unlock the owning database first."),
    ).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unlock the owning database first.",
    );
    expect(
      screen.queryByText(/Saved for this connection/),
    ).not.toBeInTheDocument();
  });
  it("rejects resource CSS before invoking persistence", async () => {
    const value = controller({
      configuration: {
        ...normalizeWebsiteDarkModeConfig(undefined),
        useGlobalDefaults: false,
      },
    });
    render(<WebsiteDarkModeControls controller={value} />);
    open();
    select("Conversion mode", "Custom CSS");
    fireEvent.change(screen.getByRole("textbox", { name: "Custom CSS" }), {
      target: { value: "body {background:url(https://tracker.test)}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved",
    );
    expect(value.updateConfiguration).not.toHaveBeenCalled();
  });
  it("edits settings defaults and custom presets without enabling websites", () => {
    const update = vi.fn();
    function Settings() {
      const [settings, setSettings] = useState(defaultSettings);
      return (
        <WebsiteAppearanceSection
          settings={settings}
          updateSettings={(patch) => {
            update(patch);
            setSettings({ ...settings, ...patch });
          }}
        />
      );
    }
    render(<Settings />);
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "80" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply appearance defaults" }),
    );
    expect(update).toHaveBeenLastCalledWith({
      websiteDarkMode: expect.objectContaining({
        defaults: expect.objectContaining({ brightness: 80 }),
      }),
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Custom preset name" }),
      { target: { value: "My evening" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save defaults as preset" }),
    );
    expect(screen.getByText("My evening")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove preset My evening" }),
    );
    expect(screen.queryByText("My evening")).not.toBeInTheDocument();
    expect(update.mock.calls.every(([patch]) => !patch.httpAutomation)).toBe(
      true,
    );
  });
  it("keeps connection appearance draft-only and consent independent", () => {
    function Editor() {
      const [formData, setFormData] = useState<Partial<Connection>>({
        id: "one",
      });
      return (
        <>
          <SessionQuickActionsSection
            formData={formData}
            setFormData={setFormData}
            protocol="http"
          />
          <output data-testid="draft">{JSON.stringify(formData)}</output>
        </>
      );
    }
    render(<Editor />);
    fireEvent.click(screen.getByText("Dark-mode extension appearance"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use app appearance defaults" }),
    );
    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), {
      target: { value: "110" },
    });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({
      id: "one",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to connection draft" }),
    );
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toMatchObject({
      httpAutomation: {
        forceDark: false,
        darkMode: { useGlobalDefaults: false, theme: { contrast: 110 } },
      },
    });
  });
});
