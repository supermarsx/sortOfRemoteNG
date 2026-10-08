import type { Connection } from "../../types/connection/connection";
import type { NativeBrowserExtensionChange } from "../../types/protocols/nativeBrowserExtensions";
import { normalizeHttpAutomation } from "./sessionQuickActions";
import { normalizeBrowserSessionOverrides } from "../settings/browserSessionSettings";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeWebsiteDarkModeConfig } from "./websiteDarkMode";

const invalid = () => new Error("Invalid website-extension settings.");

export function nativeBrowserExtensionSettings(connection: Connection) {
  const session = normalizeBrowserSessionOverrides(connection.browserSession);
  const automation = normalizeHttpAutomation(connection.httpAutomation);
  return {
    app: session?.websiteExtensionsEnabled,
    scripts: automation.scriptInjectionEnabled,
    macros: automation.interactionMacrosEnabled,
    login: connection.httpApplication
      ? connection.httpApplication.loginMode === "form"
      : connection.httpAutoLogin === true,
  };
}

/** Patch only existing saved fields. Consent, TLS, routes and dark styles are separate. */
export function changeNativeBrowserExtension(
  connection: Connection,
  change: NativeBrowserExtensionChange,
): Connection {
  nativeBrowserExtensionSettings(connection);
  if (
    !change ||
    (typeof change.enabled !== "boolean" &&
      !(change.kind === "app" && change.enabled === undefined))
  )
    throw invalid();
  switch (change.kind) {
    case "appearance":
      return {
        ...connection,
        httpAutomation: {
          ...normalizeHttpAutomation(connection.httpAutomation),
          forceDark: change.enabled,
          darkMode: normalizeWebsiteDarkModeConfig(change.configuration),
        },
      };
    case "app": {
      const browserSession = {
        ...connection.browserSession,
        version: 1 as const,
      };
      if (change.enabled === undefined)
        delete browserSession.websiteExtensionsEnabled;
      else browserSession.websiteExtensionsEnabled = change.enabled;
      return {
        ...connection,
        browserSession:
          Object.keys(browserSession).length === 1 ? undefined : browserSession,
      };
    }
    case "scripts":
    case "macros":
      return {
        ...connection,
        httpAutomation: {
          ...normalizeHttpAutomation(connection.httpAutomation),
          [change.kind === "scripts"
            ? "scriptInjectionEnabled"
            : "interactionMacrosEnabled"]: change.enabled,
        },
      };
    case "login":
      // Do not silently replace HTTP Basic authentication with form login.
      if (
        connection.httpApplication &&
        !["form", "manual"].includes(connection.httpApplication.loginMode)
      )
        throw new Error(
          "Configure this application's login method in the connection editor.",
        );
      return {
        ...connection,
        httpAutoLogin: change.enabled,
        ...(connection.httpApplication
          ? {
              httpApplication: {
                ...connection.httpApplication,
                loginMode: change.enabled ? "form" : "manual",
              },
            }
          : {}),
      };
    default:
      throw invalid();
  }
}

/** Private comparison only. Never render/log it: connection fields may contain secrets. */
export function nativeExtensionConnectionRevision(
  connection: Connection,
): string {
  const value: Record<string, unknown> = { ...connection };
  for (const key of [
    "updatedAt",
    "lastConnected",
    "lastAccessed",
    "lastUsed",
    "connectionCount",
  ])
    delete value[key];
  return stableJsonStringify(value);
}

export interface NativeExtensionPersistence {
  /** Must synchronously fence database ID, access generation and selected connection. */
  assertCurrent(): void;
  current(): Connection;
  /** Read through the captured owning database lease without adopting its CAS baseline. */
  read(): Promise<Connection>;
  /** The existing connection writer retains database CAS and encrypted persistence. */
  write(connection: Connection): Promise<void>;
}

/** A save is successful only after reading it back from the captured database. */
export async function persistNativeBrowserExtension(
  persistence: NativeExtensionPersistence,
  change: NativeBrowserExtensionChange,
): Promise<Connection> {
  persistence.assertCurrent();
  const current = persistence.current();
  const initial = nativeExtensionConnectionRevision(current);
  const saved = await persistence.read();
  persistence.assertCurrent();
  if (
    nativeExtensionConnectionRevision(saved) !== initial ||
    nativeExtensionConnectionRevision(persistence.current()) !== initial
  )
    throw new Error(
      "The saved connection changed. Reload before editing extensions.",
    );
  const updated = changeNativeBrowserExtension(persistence.current(), change);
  const expected = nativeExtensionConnectionRevision(updated);
  persistence.assertCurrent();
  await persistence.write(updated);
  persistence.assertCurrent();
  const confirmed = await persistence.read();
  persistence.assertCurrent();
  if (
    nativeExtensionConnectionRevision(confirmed) !== expected ||
    nativeExtensionConnectionRevision(persistence.current()) !== expected
  )
    throw new Error(
      "The extension setting could not be confirmed saved. Reload before retrying.",
    );
  return confirmed;
}
