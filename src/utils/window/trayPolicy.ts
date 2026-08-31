import type { GlobalSettings } from "../../types/settings/settings";

type TrayBehaviorSettings = Pick<
  GlobalSettings,
  | "showTrayIcon"
  | "minimizeToTray"
  | "closeToTray"
  | "startMinimized"
  | "startMaximized"
>;

export type StartupWindowAction =
  "show" | "maximize" | "minimize" | "hide-to-tray";

export const hasUsableTray = (
  settings: Pick<GlobalSettings, "showTrayIcon">,
): boolean => settings.showTrayIcon === true;

export const shouldHideOnMinimize = (
  settings: Pick<GlobalSettings, "showTrayIcon" | "minimizeToTray">,
): boolean => hasUsableTray(settings) && settings.minimizeToTray === true;

export const shouldHideOnClose = (
  settings: Pick<GlobalSettings, "showTrayIcon" | "closeToTray">,
  explicitQuit: boolean,
): boolean =>
  !explicitQuit && hasUsableTray(settings) && settings.closeToTray === true;

/**
 * Resolve mutually-conflicting persisted startup flags deterministically.
 * Minimized takes precedence because it is the less intrusive user request;
 * settings UI changes now keep the two flags mutually exclusive, but older
 * settings documents may still contain both.
 */
export const resolveStartupWindowAction = (
  settings: TrayBehaviorSettings,
): StartupWindowAction => {
  if (settings.startMinimized) {
    return shouldHideOnMinimize(settings) ? "hide-to-tray" : "minimize";
  }
  if (settings.startMaximized) return "maximize";
  return "show";
};
