import type { OriginBrowserIdentity } from "./originBrowser";

/** Native receipt only; saved settings are never evidence of runtime support. */
export interface NativeBrowserExtensionReceipt {
  version: 1;
  identity: OriginBrowserIdentity;
  appControls: boolean;
  appEnabled: boolean;
  forcedDark: true;
  chromium: "unsupportedPrivateContext";
}

export type NativeBrowserExtensionChange =
  | { kind: "app"; enabled: boolean | undefined }
  | { kind: "scripts"; enabled: boolean }
  | { kind: "macros"; enabled: boolean }
  | { kind: "login"; enabled: boolean }
  | {
      kind: "appearance";
      enabled: boolean;
      configuration: import("../connection/websiteDarkMode").WebsiteDarkModeConfig;
    };

export const CHROMIUM_EXTENSION_UNAVAILABLE =
  "Chrome Web Store add-ons cannot be installed here. Use the built-in automation and appearance tools in this popup.";

export const NATIVE_EXTENSION_WIRING_REQUIRED =
  "This native session has not confirmed support for app-extension controls.";
