import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import type {
  WebsiteDarkModeConfig,
  WebsiteDarkPreset,
  WebsiteDarkTheme,
} from "../../types/connection/websiteDarkMode";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import type {
  WebAutomationBridge,
  WebDarkOutcome,
} from "../../utils/recording/webAutomationBridge";
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
import { normalizeHttpProxyPolicy } from "../../utils/connection/httpProxyPolicy";
import { normalizeAdvancedProtocolConnection } from "../../utils/connection/normalizeAdvancedProtocolConnection";
import { getRuntimeWebNavigation } from "../../utils/session/runtimeConnectionRegistry";
import { httpRedirectConnectionOrigin } from "../../utils/protocol/httpRedirectTrustIdentity";

/**
 * What the open page actually got, and why. `engine` and `cssOnly` both mean
 * the page is themed; they differ in how, which is what makes an unexpectedly
 * plain page explainable instead of looking like a broken extension.
 */
export interface WebsiteDarkModeStatus {
  kind: "off" | "engine" | "cssOnly" | "failed";
  message: string;
}

export interface WebsiteDarkModeController {
  scopeKey: string;
  enabled: boolean;
  available: boolean;
  busy: boolean;
  error: string | null;
  unavailableReason: string;
  status: WebsiteDarkModeStatus;
  /** Appearance is saved only to this original connection, never a runtime ID. */
  savedConnectionName?: string;
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
const UNSAVED =
  "The dark-mode extension is stored on a saved website connection, and this page is a temporary session: the phone panel's “Open Web UI” button and redirect handoffs both open one. Open a saved HTTP or HTTPS connection to this address to configure it.";
const changed = () =>
  new Error(
    "The website or its database changed. Review the extension settings again.",
  );

/** The connection editor's own wording, so the message names what to change. */
const SCRIPTS_SETTING = "Internal proxy controls → Website scripts";
const ENGINE_REFUSED =
  `This page is themed with CSS only: ${SCRIPTS_SETTING} is set to “Block external script files” for this connection, so the dark-mode engine cannot load. ` +
  "Choose “Allow website scripts” there for full conversion.";
const SCRIPTS_BLOCKED = `The extension cannot theme this page: ${SCRIPTS_SETTING} is set to “Block website scripts and automation” for this connection.`;
/** The page refused the engine itself. Name no setting: the user has none. */
const PAGE_REFUSED =
  "This page is themed with CSS only: the website's own content security policy refused the dark-mode engine. That restriction belongs to the site, not to your settings.";
const NOT_APPLIED_YET =
  "The extension is not applied while this page is loading or waiting for a security decision.";
const ENGINE_APPLIED = "This page is themed by the dark-mode engine.";
const OFF = "The dark-mode extension is off for this page.";
const MODE_NAMES: Record<WebsiteDarkTheme["mode"], string> = {
  dynamic: "Dynamic colors",
  filter: "Filter",
  dynamicFilter: "Dynamic + filter",
  customCss: "Custom CSS",
};

/**
 * The page-script policy this proxy session runs under. `inline-only` emits a
 * `script-src` without `'self'`, which is what stops the dark-mode engine asset
 * from loading. Read-only: nothing here ever widens the policy.
 */
function pageScriptsPolicy(connection: Connection | undefined) {
  try {
    return normalizeHttpProxyPolicy(connection?.httpProxyPolicy).pageScripts;
  } catch {
    // An unusable policy blocks the whole session upstream of this hook.
    return "allow" as const;
  }
}

/** Private identity: retain target/auth/policy fields; never expose this key. */
function sourceIdentity(connection: Connection): string {
  const {
    httpAutomation,
    lastConnected: _lastConnected,
    connectionCount: _count,
    updatedAt: _updatedAt,
    ...source
  } = normalizeAdvancedProtocolConnection(connection);
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
  const runtimeConnection = options.connection;
  const navigation = runtimeConnection
    ? getRuntimeWebNavigation(runtimeConnection.id)
    : undefined;
  const provenance =
    navigation?.trustedRedirectSource ?? navigation?.synologyRedirectSource;
  let sourceProblem = "";
  if (navigation) {
    if (!provenance?.savedConnectionId) {
      sourceProblem = UNSAVED;
    } else {
      try {
        provenance.assertOwner();
        if (provenance.databaseId !== options.ownerDatabaseId) throw changed();
        const rows = context?.state.connections.filter(
          (row) => row.id === provenance.savedConnectionId,
        );
        if (rows?.length !== 1) throw changed();
        provenance.assertIdentity(rows[0]);
        if (httpRedirectConnectionOrigin(rows[0]) !== provenance.originalOrigin)
          throw changed();
        options = { ...options, connection: rows[0] };
      } catch {
        sourceProblem =
          "The original saved website changed or its database access expired. Reopen it before configuring this redirected page.";
      }
    }
  } else if (
    runtimeConnection &&
    context?.databaseAvailability?.status === "ready" &&
    context.databaseAvailability.databaseId === options.ownerDatabaseId &&
    !context.state.connections.some((row) => row.id === runtimeConnection.id)
  )
    sourceProblem = UNSAVED;
  // The policy of the connection this session opened, not of the saved row a
  // redirected page stores its appearance on.
  const scriptsPolicy = pageScriptsPolicy(runtimeConnection);
  const latest = useRef({ options, context });
  latest.current = { options, context };
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failureState, setFailureState] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [applyFailure, setApplyFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  /** Only what the page-side apply reported, so a save failure is never cleared. */
  const applyError = useRef<string | null>(null);
  const [applied, setApplied] = useState<{
    key: string;
    outcome: WebDarkOutcome;
  } | null>(null);
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
    runtimeSource = "invalid",
    appearanceKey = "invalid";
  try {
    if (sourceProblem) throw new Error(sourceProblem);
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
    runtimeSource = runtimeConnection
      ? sourceIdentity(runtimeConnection)
      : "absent";
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
    runtimeConnection?.id,
    runtimeSource,
    options.resetKey,
  ]);
  // A former page/owner's failure must not be shown for the next source. This
  // presentation scope is separate from the durable failed-save fences below.
  const error = failureState?.scope === scope ? failureState.message : null;
  const setError = useCallback(
    (message: string | null) =>
      setFailureState(message === null ? null : { scope, message }),
    [scope],
  );
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
      if (navigation) {
        if (
          !runtimeConnection ||
          getRuntimeWebNavigation(runtimeConnection.id) !== navigation
        )
          throw changed();
        provenance?.assertOwner();
      }
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
      provenance?.assertIdentity(live);
      return live;
    };
    const read = async () => {
      check();
      // readCurrent preserves the saved baseline. Both native database readers
      // await the encryption coordinator (unlike the macro try-lock reader),
      // so do not retry a whole database load or a revoked managed lease here.
      const snapshot = await target.readCurrent!();
      check();
      const matches = snapshot?.connections?.filter(
        (row) => row.id === connection.id,
      );
      if (matches?.length !== 1 || sourceIdentity(matches[0]) !== source)
        throw new Error(UNAVAILABLE);
      provenance?.assertIdentity(
        normalizeAdvancedProtocolConnection(matches[0]),
      );
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
  // The page-side engine asset is CSP-refused under `inline-only`, so the page
  // is told to theme itself with CSS instead of watching the script fail. This
  // reports the policy; it never changes it.
  const engineRefused = enabled === true && scriptsPolicy === "inline-only";
  const payloadKey = stableJsonStringify({
    enabled: enabled === true,
    theme,
    ...(engineRefused ? { cssOnly: true } : {}),
  });
  const applyKey = stableJsonStringify([
    scope,
    payloadKey,
    options.blocked,
    options.settingsReady,
    options.navigationKey,
    options.resetKey,
  ]);
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
    void current.bridge.request("dark", JSON.parse(payloadKey)).then(
      (outcome) => {
        if (!alive) return;
        // Which path the page took. The value is a closed enum checked by the
        // bridge; the wording shown for it is the app's own.
        setApplied((previous) =>
          previous?.key === applyKey && previous.outcome === outcome
            ? previous
            : outcome
              ? { key: applyKey, outcome }
              : null,
        );
        setApplyFailure((previous) => (previous ? null : previous));
        // The page is themed now, so retire that failure — and nothing else.
        const stale = applyError.current;
        applyError.current = null;
        if (stale)
          setFailureState((current) =>
            current?.message === stale ? null : current,
          );
      },
      (failure) => {
        if (!alive || !enabled) return;
        // One sentence, used for both the alert and the status, so the page's
        // own reason is never shown stripped of what it was trying to do.
        const message =
          failure instanceof Error
            ? `The extension could not theme this page: ${failure.message}`
            : "The extension could not be applied to this page.";
        applyError.current = message;
        setError(message);
        setApplyFailure({ key: applyKey, message });
      },
    );
    return () => {
      alive = false;
    };
  }, [
    payloadKey,
    applyKey,
    enabled,
    scope,
    options.blocked,
    options.settingsReady,
    options.navigationKey,
    options.resetKey,
    setError,
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

  // Four states, in the order a user would ask about them: off, refused
  // outright, failed on the page, themed the simple way, themed by the engine.
  const statusOf = (): WebsiteDarkModeStatus => {
    if (!enabled) return { kind: "off", message: OFF };
    if (scriptsPolicy === "block")
      return { kind: "failed", message: SCRIPTS_BLOCKED };
    if (applyFailure?.key === applyKey)
      return { kind: "failed", message: applyFailure.message };
    if (options.blocked) return { kind: "failed", message: NOT_APPLIED_YET };
    if (theme.mode === "filter" || theme.mode === "customCss")
      return {
        kind: "cssOnly",
        message: `This page is themed with CSS only: the “${MODE_NAMES[theme.mode]}” conversion mode does not use the dark-mode engine.`,
      };
    if (engineRefused) return { kind: "cssOnly", message: ENGINE_REFUSED };
    // Nothing in the app blocked the engine, so the page itself did.
    if (applied?.key === applyKey && applied.outcome === "cssOnly")
      return { kind: "cssOnly", message: PAGE_REFUSED };
    return { kind: "engine", message: ENGINE_APPLIED };
  };

  return {
    scopeKey: `${options.ownerDatabaseId ?? ""}:${options.scopeKey}:${capturedRevision}`,
    enabled: enabled === true,
    available: !problem && knownSavedScope === scope,
    busy,
    error,
    status: statusOf(),
    unavailableReason:
      problem ||
      (knownSavedScope === scope
        ? ""
        : error || "Checking the saved website's database access…"),
    savedConnectionName:
      knownSavedScope === scope ? options.connection?.name : undefined,
    configuration,
    theme,
    defaultTheme: global.defaults,
    presets: [...BUILTIN_WEBSITE_DARK_PRESETS, ...global.presets],
    setEnabled: (value) => save({ enabled: value }),
    updateConfiguration: (value) => save({ configuration: value }),
  };
}
