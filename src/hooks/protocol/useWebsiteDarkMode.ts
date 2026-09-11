import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import type {
  WebsiteDarkModeConfig,
  WebsiteDarkPreset,
  WebsiteDarkTheme,
} from "../../types/connection/websiteDarkMode";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import type { WebAutomationBridge } from "../../utils/recording/webAutomationBridge";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import {
  normalizeHttpAutomation,
  normalizeSessionQuickActions,
} from "../../utils/connection/sessionQuickActions";
import {
  BUILTIN_WEBSITE_DARK_PRESETS,
  normalizeWebsiteDarkModeConfig,
  normalizeWebsiteDarkModeSettings,
} from "../../utils/connection/websiteDarkMode";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";

export interface WebsiteDarkModeController {
  scopeKey: string;
  enabled: boolean;
  available: boolean;
  busy: boolean;
  error: string | null;
  unavailableReason: string;
  configuration: WebsiteDarkModeConfig;
  theme: WebsiteDarkTheme;
  defaultTheme: WebsiteDarkTheme;
  presets: WebsiteDarkPreset[];
  setEnabled: (enabled: boolean) => Promise<boolean>;
  updateConfiguration: (
    configuration: WebsiteDarkModeConfig,
  ) => Promise<boolean>;
}

interface Options {
  connection: Connection | undefined;
  ownerDatabaseId: string | undefined;
  settings: GlobalSettings;
  settingsReady: boolean;
  scopeKey: string;
  blocked: boolean;
  navigationKey: string;
  getDocument: () => WebAutomationDocument | null;
  updateConnection: (connection: Connection) => Promise<void>;
  bridge: WebAutomationBridge;
  /** Reapply after the shared bridge's security cancellation, not library reads. */
  resetKey: string;
}

const UNAVAILABLE =
  "Open and unlock this saved website's owning database to configure the dark-mode extension.";
const SAVE_FAILED =
  "The dark-mode extension setting could not be confirmed saved. Retry after restoring database access.";
const changed = () =>
  new Error(
    "The website or its database changed. Review the extension settings again.",
  );

/** Private identity: retain target/auth/policy fields; never expose this key. */
function sourceIdentity(connection: Connection): string {
  const {
    httpAutomation,
    lastConnected: _lastConnected,
    connectionCount: _count,
    updatedAt: _updatedAt,
    ...source
  } = connection;
  const {
    forceDark: _enabled,
    darkMode: _theme,
    ...automation
  } = normalizeHttpAutomation(httpAutomation);
  const timestamp = new Date(source.createdAt).getTime();
  return stableJsonStringify({
    ...source,
    createdAt: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : source.createdAt,
    httpAutomation: automation,
  });
}

function appearance(connection: Connection) {
  const config = normalizeHttpAutomation(connection.httpAutomation);
  return {
    enabled: config.forceDark,
    configuration: normalizeWebsiteDarkModeConfig(config.darkMode),
  };
}

export function useWebsiteDarkMode(
  options: Options,
): WebsiteDarkModeController {
  const context = useContext(ConnectionContext);
  const latest = useRef({ options, context });
  latest.current = { options, context };
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [knownSavedScope, setKnownSavedScope] = useState<string | null>(null);
  const [verified, setVerified] = useState<{
    scope: string;
    appearance: string;
    enabled: boolean;
  } | null>(null);
  const failures = useRef(new Set<string>());
  let configuration = normalizeWebsiteDarkModeConfig(undefined);
  let global = normalizeWebsiteDarkModeSettings(undefined);
  let requestedEnabled = false,
    problem = "",
    source = "invalid",
    appearanceKey = "invalid";
  try {
    global = normalizeWebsiteDarkModeSettings(options.settings.websiteDarkMode);
    if (
      !options.connection ||
      options.connection.isGroup ||
      !["http", "https"].includes(options.connection.protocol)
    )
      throw new Error(
        "Save an HTTP or HTTPS connection before configuring the extension.",
      );
    const current = appearance(options.connection);
    configuration = current.configuration;
    requestedEnabled = current.enabled;
    appearanceKey = stableJsonStringify(current);
    source = sourceIdentity(options.connection);
    if (!options.settingsReady) problem = "Wait for global settings to load.";
    else if (
      !normalizeSessionQuickActions(options.settings.sessionQuickActions)
        .allowWebForceDark
    )
      problem =
        "The dark-mode extension is unavailable in global website settings.";
    else if (!options.scopeKey || !options.ownerDatabaseId)
      problem = UNAVAILABLE;
    else if (
      context &&
      (context.databaseAvailability?.status !== "ready" ||
        context.databaseAvailability.databaseId !== options.ownerDatabaseId)
    )
      problem = UNAVAILABLE;
  } catch (failure) {
    problem =
      failure instanceof Error
        ? failure.message
        : "Review the dark-mode extension settings.";
  }
  const scope = stableJsonStringify([
    options.ownerDatabaseId,
    options.scopeKey,
    source,
  ]);
  const revision = useRef({ scope, value: 0 });
  if (revision.current.scope !== scope)
    revision.current = { scope, value: revision.current.value + 1 };
  const capturedRevision = revision.current.value;
  const status = useRef({ scope, appearanceKey, problem });
  status.current = { scope, appearanceKey, problem };

  const capture = () => {
    if (
      !mounted.current ||
      status.current.scope !== scope ||
      revision.current.value !== capturedRevision
    )
      throw changed();
    const current = latest.current,
      connection = current.options.connection;
    const capturedLifetime = lifetime.current;
    const manager = DatabaseManager.getInstance();
    const target = manager.captureCurrentDatabaseDataTarget();
    const availability = current.context?.databaseAvailability;
    if (
      !connection ||
      !current.options.ownerDatabaseId ||
      !current.options.scopeKey ||
      !current.options.settingsReady ||
      manager.getCurrentDatabase()?.id !== current.options.ownerDatabaseId ||
      target?.databaseId !== current.options.ownerDatabaseId ||
      !target.assertAccessible ||
      !target.readCurrent ||
      (current.context &&
        (availability?.status !== "ready" ||
          availability.databaseId !== current.options.ownerDatabaseId))
    )
      throw new Error(UNAVAILABLE);
    const check = () => {
      target.assertAccessible!();
      if (
        !mounted.current ||
        lifetime.current !== capturedLifetime ||
        revision.current.value !== capturedRevision ||
        status.current.scope !== scope ||
        manager.getCurrentDatabase()?.id !== current.options.ownerDatabaseId ||
        latest.current.options.ownerDatabaseId !==
          current.options.ownerDatabaseId ||
        latest.current.options.scopeKey !== current.options.scopeKey ||
        !latest.current.options.settingsReady ||
        !latest.current.options.connection ||
        sourceIdentity(latest.current.options.connection) !== source ||
        (current.context &&
          (latest.current.context?.databaseAvailability?.status !== "ready" ||
            latest.current.context.databaseAvailability.databaseId !==
              availability?.databaseId ||
            latest.current.context.databaseAvailability.generation !==
              availability?.generation))
      )
        throw changed();
    };
    const liveConnection = () => {
      check();
      const ctx = latest.current.context;
      const rows =
        ctx?.getCurrentConnections &&
        availability?.status === "ready" &&
        availability.databaseId
          ? ctx.getCurrentConnections({
              databaseId: availability.databaseId,
              generation: availability.generation,
            })
          : ctx?.state.connections;
      const matches = rows?.filter((row) => row.id === connection.id);
      const live = matches
        ? matches.length === 1
          ? matches[0]
          : undefined
        : latest.current.options.connection;
      if (!live || sourceIdentity(live) !== source) throw changed();
      return live;
    };
    const read = async () => {
      check();
      const snapshot = await target.readCurrent!();
      check();
      const matches = snapshot?.connections?.filter(
        (row) => row.id === connection.id,
      );
      if (matches?.length !== 1 || sourceIdentity(matches[0]) !== source)
        throw new Error(UNAVAILABLE);
      liveConnection();
      return matches[0];
    };
    check();
    return { check, liveConnection, read };
  };

  useEffect(() => {
    mounted.current = true;
    lifetime.current++;
    const off = onDatabaseAccessChange((event) => {
      if (event.status === "suspended") {
        revision.current.value++;
        setVerified(null);
        options.bridge.cancel(true);
      }
      setRefresh((value) => value + 1);
    });
    return () => {
      mounted.current = false;
      // Monotonic async lease, not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      lifetime.current++;
      off();
    };
  }, [options.bridge]);

  useEffect(() => {
    if (problem || writing.current) return;
    let alive = true;
    const verify = async () => {
      try {
        const access = capture();
        const saved = appearance(await access.read());
        access.check();
        if (!alive || writing.current) return;
        setKnownSavedScope(scope);
        const savedKey = stableJsonStringify(saved);
        if (savedKey !== status.current.appearanceKey)
          throw new Error(SAVE_FAILED);
        setVerified({
          scope,
          appearance: savedKey,
          enabled: saved.enabled && !failures.current.has(scope),
        });
        if (!failures.current.has(scope)) setError(null);
      } catch (failure) {
        if (alive) {
          setVerified(null);
          setError(failure instanceof Error ? failure.message : UNAVAILABLE);
        }
      }
    };
    void verify();
    return () => {
      alive = false;
    };
    // capture is render-bound intentionally; all captured authority is keyed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, appearanceKey, problem, refresh]);

  const enabled =
    !problem &&
    verified?.scope === scope &&
    verified.appearance === appearanceKey &&
    verified.enabled &&
    requestedEnabled &&
    !failures.current.has(scope);
  const theme = configuration.useGlobalDefaults
    ? global.defaults
    : configuration.theme;
  const payloadKey = stableJsonStringify({ enabled: enabled === true, theme });
  useEffect(() => {
    const current = latest.current.options;
    if (
      current.blocked ||
      !current.settingsReady ||
      !current.scopeKey ||
      !current.getDocument()
    )
      return;
    let alive = true;
    void current.bridge
      .request("dark", JSON.parse(payloadKey))
      .catch((failure) => {
        if (alive && enabled)
          setError(
            failure instanceof Error
              ? failure.message
              : "The extension could not be applied to this page.",
          );
      });
    return () => {
      alive = false;
    };
  }, [
    payloadKey,
    enabled,
    scope,
    options.blocked,
    options.settingsReady,
    options.navigationKey,
    options.resetKey,
  ]);

  const save = async (next: {
    enabled?: boolean;
    configuration?: WebsiteDarkModeConfig;
  }): Promise<boolean> => {
    if (writing.current) return false;
    const initial = status.current.appearanceKey;
    try {
      if (
        status.current.scope !== scope ||
        revision.current.value !== capturedRevision
      )
        throw changed();
      if (status.current.problem) throw new Error(status.current.problem);
      if (next.enabled !== undefined && typeof next.enabled !== "boolean")
        throw new Error("Choose whether to enable the extension.");
      const normalized =
        next.configuration === undefined
          ? undefined
          : normalizeWebsiteDarkModeConfig(next.configuration);
      const access = capture();
      writing.current = true;
      setBusy(true);
      setError(null);
      await access.read();
      access.check();
      const live = access.liveConnection();
      if (stableJsonStringify(appearance(live)) !== initial) throw changed();
      const existing = normalizeHttpAutomation(live.httpAutomation);
      const updated = {
        ...live,
        httpAutomation: {
          ...existing,
          ...(next.enabled !== undefined ? { forceDark: next.enabled } : {}),
          ...(normalized ? { darkMode: normalized } : {}),
        },
      };
      const expected = stableJsonStringify(appearance(updated));
      await latest.current.options.updateConnection(updated);
      access.check();
      const saved = appearance(await access.read());
      access.check();
      const observed = stableJsonStringify(appearance(access.liveConnection()));
      if (
        stableJsonStringify(saved) !== expected ||
        (observed !== expected && observed !== initial)
      )
        throw new Error(SAVE_FAILED);
      failures.current.delete(scope);
      setVerified({ scope, appearance: expected, enabled: saved.enabled });
      return true;
    } catch (failure) {
      failures.current.add(scope);
      if (mounted.current && status.current.scope === scope) {
        setVerified(null);
        setError(
          `${SAVE_FAILED} ${failure instanceof Error ? failure.message : ""}`.trim(),
        );
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) {
        setBusy(false);
        setRefresh((value) => value + 1);
      }
    }
  };

  return {
    scopeKey: `${options.ownerDatabaseId ?? ""}:${options.scopeKey}:${capturedRevision}`,
    enabled: enabled === true,
    available: !problem && knownSavedScope === scope,
    busy,
    error,
    unavailableReason:
      problem ||
      (knownSavedScope === scope
        ? ""
        : error || "Checking the saved website's database access…"),
    configuration,
    theme,
    defaultTheme: global.defaults,
    presets: [...BUILTIN_WEBSITE_DARK_PRESETS, ...global.presets],
    setEnabled: (value) => save({ enabled: value }),
    updateConfiguration: (value) => save({ configuration: value }),
  };
}
