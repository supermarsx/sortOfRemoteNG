"use client";

import { useContext, useLayoutEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import type {
  NativeBrowserExtensionChange,
  NativeBrowserExtensionReceipt,
} from "../../types/protocols/nativeBrowserExtensions";
import { NATIVE_EXTENSION_WIRING_REQUIRED } from "../../types/protocols/nativeBrowserExtensions";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import {
  nativeBrowserExtensionSettings,
  persistNativeBrowserExtension,
} from "../../utils/connection/nativeBrowserExtensions";
import { getRuntimeWebNavigation } from "../../utils/session/runtimeConnectionRegistry";
import { normalizeWebBrowserSettings } from "../../utils/settings/webBrowserSettings";
import {
  normalizeWebsiteDarkModeConfig,
  normalizeWebsiteDarkModeSettings,
} from "../../utils/connection/websiteDarkMode";

export interface NativeBrowserExtensionsOptions {
  connection?: Connection;
  ownerDatabaseId?: string;
  identity: OriginBrowserIdentity | null;
  /** Supplied by native owner after all app-extension gates are installed. */
  receipt?: NativeBrowserExtensionReceipt | null;
  webBrowserSettings: unknown;
  websiteDarkModeSettings?: unknown;
  settingsReady: boolean;
  blocked: boolean;
  updateConnection(connection: Connection): Promise<void>;
}

const sameIdentity = (a: OriginBrowserIdentity, b: OriginBrowserIdentity) =>
  a.ownerDatabaseId === b.ownerDatabaseId &&
  a.connectionId === b.connectionId &&
  a.sessionId === b.sessionId &&
  a.attemptId === b.attemptId;
const SAVE_FAILED =
  "Extension settings were not confirmed saved. Reopen the saved connection after checking database access.";

/** Database/connection-scoped settings; no extension downloads, page IPC or side storage. */
export function useNativeBrowserExtensions(
  options: NativeBrowserExtensionsOptions,
) {
  const context = useContext(ConnectionContext);
  const latest = useRef({ options, context });
  latest.current = { options, context };
  const epoch = useRef(0);
  const mounted = useRef(false);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    scope: string;
    error?: string;
    saved?: boolean;
  } | null>(null);
  const [, refresh] = useState(0);
  const scope = JSON.stringify([
    options.ownerDatabaseId,
    options.connection?.id,
    context?.databaseAvailability?.generation,
    options.identity,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useLayoutEffect(() => {
    mounted.current = true;
    epoch.current++;
    const off = onDatabaseAccessChange(() => {
      epoch.current++;
      refresh((value) => value + 1);
    });
    return () => {
      mounted.current = false;
      // Monotonic access epoch, not a captured DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      off();
    };
  }, []);

  let requested = {
    app: undefined as boolean | undefined,
    scripts: false,
    macros: false,
    login: false,
  };
  let globalEnabled = true;
  let reason = "";
  let appearance = {
    enabled: options.connection?.httpAutomation?.forceDark ?? true,
    configuration: normalizeWebsiteDarkModeConfig(undefined),
    defaults: normalizeWebsiteDarkModeSettings(undefined),
  };
  try {
    if (!options.settingsReady) throw new Error("Loading browser settings…");
    globalEnabled = normalizeWebBrowserSettings(
      options.webBrowserSettings,
    ).websiteExtensionsEnabled;
    if (
      !options.connection ||
      options.connection.isGroup ||
      !["http", "https"].includes(options.connection.protocol)
    )
      throw new Error(
        "Open a saved website connection to configure extensions.",
      );
    requested = nativeBrowserExtensionSettings(options.connection);
    appearance = {
      enabled: options.connection.httpAutomation?.forceDark ?? true,
      configuration: normalizeWebsiteDarkModeConfig(
        options.connection.httpAutomation?.darkMode,
      ),
      defaults: normalizeWebsiteDarkModeSettings(
        options.websiteDarkModeSettings,
      ),
    };
    const availability = context?.databaseAvailability;
    if (
      !options.ownerDatabaseId ||
      availability?.status !== "ready" ||
      availability.databaseId !== options.ownerDatabaseId ||
      !context?.getCurrentConnections ||
      DatabaseManager.getInstance().getCurrentDatabase()?.id !==
        options.ownerDatabaseId
    )
      throw new Error(
        "Unlock this connection's owning database to configure extensions.",
      );
    if (getRuntimeWebNavigation(options.connection.id))
      throw new Error(
        "Configure extensions on the original saved connection, then reopen the website.",
      );
    if (options.blocked)
      throw new Error(
        "Extension controls are unavailable while this session is blocked.",
      );
    const identity = options.identity,
      receipt = options.receipt;
    if (
      !identity ||
      identity.ownerDatabaseId !== options.ownerDatabaseId ||
      identity.connectionId !== options.connection.id ||
      !receipt ||
      !receipt.identity ||
      receipt.version !== 1 ||
      receipt.appControls !== true ||
      typeof receipt.appEnabled !== "boolean" ||
      receipt.forcedDark !== true ||
      receipt.chromium !== "unsupportedPrivateContext" ||
      !sameIdentity(identity, receipt.identity)
    )
      throw new Error(NATIVE_EXTENSION_WIRING_REQUIRED);
    if (
      context
        .getCurrentConnections({
          databaseId: options.ownerDatabaseId,
          generation: availability.generation,
        })
        .filter((row) => row.id === options.connection!.id).length !== 1
    )
      throw new Error(
        "Save this website connection before configuring extensions.",
      );
  } catch (error) {
    reason =
      error instanceof Error
        ? error.message
        : "Extension settings are unavailable.";
  }
  const availabilityRef = useRef(reason);
  availabilityRef.current = reason;

  const save = async (
    change: NativeBrowserExtensionChange,
  ): Promise<boolean> => {
    if (
      writing.current ||
      reason ||
      !options.connection ||
      !options.ownerDatabaseId
    )
      return false;
    const capturedEpoch = epoch.current;
    const captured = latest.current;
    const generation = captured.context!.databaseAvailability!.generation;
    const connectionId = options.connection.id,
      databaseId = options.ownerDatabaseId;
    const manager = DatabaseManager.getInstance();
    const target = manager.captureCurrentDatabaseDataTarget();
    const assertCurrent = () => {
      const current = latest.current;
      if (
        !mounted.current ||
        epoch.current !== capturedEpoch ||
        currentScope.current !== scope ||
        availabilityRef.current ||
        current.options.blocked ||
        !current.options.settingsReady ||
        current.options.ownerDatabaseId !== databaseId ||
        current.options.connection?.id !== connectionId ||
        current.context?.databaseAvailability?.status !== "ready" ||
        current.context.databaseAvailability.databaseId !== databaseId ||
        current.context.databaseAvailability.generation !== generation ||
        manager.getCurrentDatabase()?.id !== databaseId ||
        target?.databaseId !== databaseId ||
        !target.assertAccessible ||
        !target.readCurrent
      )
        throw new Error(SAVE_FAILED);
      target.assertAccessible();
    };
    const unique = (rows: readonly Connection[] | undefined): Connection => {
      const matches = rows?.filter((row) => row.id === connectionId);
      if (matches?.length !== 1) throw new Error(SAVE_FAILED);
      return matches[0];
    };
    writing.current = true;
    setBusy(true);
    setResult(null);
    try {
      await persistNativeBrowserExtension(
        {
          assertCurrent,
          current: () => {
            assertCurrent();
            return unique(
              latest.current.context!.getCurrentConnections!({
                databaseId,
                generation,
              }),
            );
          },
          read: async () => {
            assertCurrent();
            const data = await target!.readCurrent!();
            assertCurrent();
            return unique(data?.connections);
          },
          write: async (connection) => {
            assertCurrent();
            await captured.options.updateConnection(connection);
            assertCurrent();
          },
        },
        change,
      );
      assertCurrent();
      setResult({ scope, saved: true });
      return true;
    } catch {
      if (mounted.current && currentScope.current === scope)
        setResult({ scope, error: SAVE_FAILED });
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return {
    scope,
    requested,
    appearance,
    globalEnabled,
    effectiveEnabled: requested.app ?? globalEnabled,
    activeEnabled: !reason ? options.receipt!.appEnabled : null,
    available: !reason,
    reason,
    busy,
    loginConfigurable:
      !options.connection?.httpApplication ||
      ["form", "manual"].includes(options.connection.httpApplication.loginMode),
    error: result?.scope === scope ? result.error : undefined,
    saved: result?.scope === scope && result.saved === true,
    save,
  };
}

export type NativeBrowserExtensionsController = ReturnType<
  typeof useNativeBrowserExtensions
>;
