import { describe, expect, it } from "vitest";

import {
  resolveStartupWindowAction,
  shouldHideOnClose,
  shouldHideOnMinimize,
} from "../../src/utils/window/trayPolicy";

describe("system tray window policy", () => {
  it("never hides a window when the restoration icon is disabled", () => {
    const settings = {
      showTrayIcon: false,
      minimizeToTray: true,
      closeToTray: true,
    };

    expect(shouldHideOnMinimize(settings)).toBe(false);
    expect(shouldHideOnClose(settings, false)).toBe(false);
  });

  it("uses the tray only when the icon and matching behavior are enabled", () => {
    expect(
      shouldHideOnMinimize({ showTrayIcon: true, minimizeToTray: true }),
    ).toBe(true);
    expect(
      shouldHideOnMinimize({ showTrayIcon: true, minimizeToTray: false }),
    ).toBe(false);
    expect(
      shouldHideOnClose({ showTrayIcon: true, closeToTray: true }, false),
    ).toBe(true);
  });

  it("lets an explicit tray Quit bypass close-to-tray", () => {
    expect(
      shouldHideOnClose({ showTrayIcon: true, closeToTray: true }, true),
    ).toBe(false);
  });

  it("resolves every startup window state and gives minimize precedence", () => {
    const defaults = {
      showTrayIcon: true,
      minimizeToTray: false,
      closeToTray: false,
      startMinimized: false,
      startMaximized: false,
    };

    expect(resolveStartupWindowAction(defaults)).toBe("show");
    expect(
      resolveStartupWindowAction({ ...defaults, startMaximized: true }),
    ).toBe("maximize");
    expect(
      resolveStartupWindowAction({ ...defaults, startMinimized: true }),
    ).toBe("minimize");
    expect(
      resolveStartupWindowAction({
        ...defaults,
        startMinimized: true,
        minimizeToTray: true,
      }),
    ).toBe("hide-to-tray");
    expect(
      resolveStartupWindowAction({
        ...defaults,
        startMinimized: true,
        startMaximized: true,
      }),
    ).toBe("minimize");
  });
});
