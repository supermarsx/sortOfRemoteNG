import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { AutomationScope } from "../../types/recording/automationLibrary";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import type {
  WebAutomationDocument,
  WebAutomationItem,
  WebAutomationLibrary,
  WebInteractionMacro,
  WebInteractionStep,
} from "../../types/recording/webAutomation";
import { prepareWebsiteScript } from "../../utils/recording/websiteScriptCompiler";
import { useWebsiteDarkMode } from "./useWebsiteDarkMode";
import {
  normalizeHttpAutomation,
  normalizeSessionQuickActions,
  resolveHttpAutomationPermissions,
  quickActionReferenceKey,
  quickActionReferenceScope,
} from "../../utils/connection/sessionQuickActions";
import {
  deleteWebAutomationItem,
  EMPTY_WEB_AUTOMATION_LIBRARY,
  normalizeWebAutomationItem,
  normalizeWebAutomationLibrary,
  saveWebAutomationItem,
  WEB_AUTOMATION_STORE_KEY,
  webAutomationStore,
} from "../../utils/recording/webAutomationLibrary";
import { WebAutomationBridge } from "../../utils/recording/webAutomationBridge";
import {
  AutomationLibraryAccessError,
  automationLibraryDiagnostic,
} from "../../utils/recording/automationLibraryAccess";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { getInvoke } from "../../utils/tauri/invoke";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";

interface Options {
  connection: Connection | undefined;
  ownerDatabaseId: string | undefined;
  settings: GlobalSettings;
  settingsReady: boolean;
  scopeKey: string;
  appearanceScopeKey?: string;
  blocked: boolean;
  navigationKey: string;
  iframe: React.RefObject<HTMLIFrameElement | null>;
  getDocument: () => WebAutomationDocument | null;
  updateConnection: (connection: Connection) => Promise<void>;
}
export type ScopedWebAutomationItem = WebAutomationItem & {
  scope?: AutomationScope;
};
function payloadOf(item: ScopedWebAutomationItem): WebAutomationItem {
  const { scope: _scope, ...payload } = item;
  return normalizeWebAutomationItem(payload);
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Website action failed.";
const macroConsentKey = (options: Options) =>
  options.ownerDatabaseId && options.connection
    ? JSON.stringify([options.ownerDatabaseId, options.connection.id])
    : null;

/** A saved connection ID alone is not an owner receipt; cloned databases may
 * contain the same ID. The session must carry its creation-time owner. */
export function captureWebAutomationAccess(
  ownerDatabaseId: string | undefined,
) {
  const manager = DatabaseManager.getInstance();
  const target = manager.captureCurrentDatabaseDataTarget();
  if (
    !ownerDatabaseId ||
    manager.getCurrentDatabase()?.id !== ownerDatabaseId ||
    !target ||
    target.databaseId !== ownerDatabaseId ||
    !target.assertAccessible
  )
    throw new Error(
      "This web session does not have access to its owning database. Reopen the original database and reconnect if its owner is unknown.",
    );
  const check = () => {
    if (manager.getCurrentDatabase()?.id !== ownerDatabaseId)
      throw new Error(
        "The owning database changed. Website automation stopped.",
      );
    target.assertAccessible!();
  };
  check();
  return check;
}

export function useWebAutomation(options: Options) {
  const context = useContext(ConnectionContext);
  const databaseScopeKey = JSON.stringify(
    context?.automationLibrary?.scope ?? null,
  );
  const database = useRef(context?.automationLibrary);
  database.current = context?.automationLibrary;
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true),
    epoch = useRef(0),
    revoked = useRef(false),
    loaded = useRef(false);
  const [library, setLibrary] = useState<WebAutomationLibrary>(
    EMPTY_WEB_AUTOMATION_LIBRARY,
  );
  const [libraryReady, setLibraryReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [databaseLibrary, setDatabaseLibrary] = useState<{
    access: string;
    scope: string;
    items: ScopedWebAutomationItem[];
  } | null>(null);
  const [databaseLibraryError, setDatabaseLibraryError] = useState<
    string | null
  >(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false);
  const [libraryKind, setLibraryKind] = useState<
    "script" | "macro" | undefined
  >();
  const [steps, setSteps] = useState<WebInteractionStep[]>([]);
  const stepsRef = useRef<WebInteractionStep[]>([]);
  const setRecordedSteps = useCallback((next: WebInteractionStep[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, []);
  const [recordingPending, setRecordingPending] = useState(false);
  const recordingTransition = useRef<"starting" | "stopping" | null>(null);
  const recordingAttempt = useRef(0);
  const [pendingRun, setPendingRun] = useState<ScopedWebAutomationItem | null>(
    null,
  );
  const [valuePrompt, setValuePrompt] = useState<{
    index: number;
    resolve: (value: string | null) => void;
  } | null>(null);
  const valuePromptRef = useRef(valuePrompt);
  valuePromptRef.current = valuePrompt;
  const operation = useRef(0);
  const busyRef = useRef(false),
    recordingRef = useRef(false);
  const savingRef = useRef(false);
  const [libraryScope, setLibraryScope] = useState("");
  const readGeneration = useRef(0);
  const databaseReadGeneration = useRef(0);
  // Access revocation changes the operation epoch, but Provider can retain an
  // optimistic dirty connection. Its failed-save receipt therefore survives
  // lock/reload and is cleared only by a verified retry for this exact owner.
  const failedMacroConsents = useRef(new Map<string, string>());
  const currentConsentFailure = () => {
    const key = macroConsentKey(latest.current);
    return key ? (failedMacroConsents.current.get(key) ?? null) : null;
  };
  const permissions = (() => {
    try {
      const value = resolveHttpAutomationPermissions(
        options.settings.sessionQuickActions,
        options.connection?.httpAutomation,
      );
      // Provider saves publish an optimistic connection before flushing. A
      // refused flush must not turn that optimistic flag into execution consent.
      if (currentConsentFailure()) value.interactionMacrosEnabled = false;
      return {
        value,
        error: null,
      };
    } catch {
      return {
        value: null,
        error:
          "Website automation configuration is invalid. Review HTTP Advanced settings; no capabilities have been enabled.",
      };
    }
  })();
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const bridgeRef = useRef<WebAutomationBridge | null>(null);
  if (!bridgeRef.current)
    bridgeRef.current = new WebAutomationBridge(() => {
      const current = latest.current,
        doc = current.getDocument(),
        frame = current.iframe.current?.contentWindow;
      try {
        captureWebAutomationAccess(current.ownerDatabaseId)();
      } catch {
        return null;
      }
      return !revoked.current &&
        current.settingsReady &&
        (current.appearanceScopeKey ?? current.scopeKey) &&
        !current.blocked &&
        doc &&
        frame
        ? { frame, document: doc }
        : null;
    });
  const bridge = bridgeRef.current;
  const cancel = useCallback(() => {
    operation.current++;
    recordingAttempt.current++;
    recordingTransition.current = null;
    if (!savingRef.current) busyRef.current = false;
    recordingRef.current = false;
    bridge.cancel();
    valuePromptRef.current?.resolve(null);
    valuePromptRef.current = null;
    if (mounted.current) {
      setValuePrompt(null);
      setPendingRun(null);
      setRecording(false);
      setRecordingPending(false);
      if (!savingRef.current) setBusy(false);
    }
  }, [bridge]);
  const accessKey = `${options.ownerDatabaseId ?? ""}:${options.scopeKey}:${options.settingsReady}:${databaseScopeKey}`;
  const previousAccess = useRef(accessKey);
  if (previousAccess.current !== accessKey) {
    previousAccess.current = accessKey;
    epoch.current++;
    loaded.current = false;
  }
  const assertAccess = useCallback((captured: number) => {
    if (
      !mounted.current ||
      epoch.current !== captured ||
      revoked.current ||
      !latest.current.settingsReady ||
      !latest.current.scopeKey
    )
      throw new Error(
        "Library access changed. Reload before continuing; a pending save may already have completed.",
      );
    captureWebAutomationAccess(latest.current.ownerDatabaseId)();
  }, []);
  const reload = useCallback(async () => {
    const captured = epoch.current;
    const read = ++readGeneration.current;
    if (!latest.current.settingsReady || !latest.current.scopeKey) return;
    setError(null);
    setLibraryLoading(true);
    try {
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const result = await webAutomationStore
        .load()
        .catch((failure: unknown) => {
          throw new AutomationLibraryAccessError(
            automationLibraryDiagnostic(failure),
          );
        });
      if (
        !mounted.current ||
        epoch.current !== captured ||
        read !== readGeneration.current
      )
        return;
      checkOwner();
      revoked.current = false;
      assertAccess(captured);
      loaded.current = true;
      setLibrary(result.value ?? EMPTY_WEB_AUTOMATION_LIBRARY);
      setLibraryReady(true);
      setLibraryScope(previousAccess.current);
    } catch (failure) {
      if (
        mounted.current &&
        epoch.current === captured &&
        read === readGeneration.current
      ) {
        setLibraryReady(false);
        setError(message(failure));
      }
    } finally {
      if (
        mounted.current &&
        epoch.current === captured &&
        read === readGeneration.current
      )
        setLibraryLoading(false);
    }
  }, [assertAccess]);

  const readDatabase = useCallback(
    async (scope: AutomationScope, captured: number) => {
      assertAccess(captured);
      const api = database.current,
        receipt = api?.scope;
      if (
        scope.kind !== "database" ||
        scope.databaseId !== latest.current.ownerDatabaseId ||
        !api ||
        !receipt ||
        receipt.databaseId !== scope.databaseId
      )
        throw new Error(
          "The exact owning database library is unavailable; no app-wide fallback was used.",
        );
      const expected = { ...receipt };
      const value = await api.read(expected);
      assertAccess(captured);
      if (JSON.stringify(database.current?.scope) !== JSON.stringify(expected))
        throw new Error(
          "Database library access changed. Reload before continuing.",
        );
      return { api, expected, value };
    },
    [assertAccess],
  );
  const reloadDatabase = useCallback(async () => {
    const read = ++databaseReadGeneration.current,
      captured = epoch.current,
      scope = database.current?.scope;
    if (!scope || scope.databaseId !== latest.current.ownerDatabaseId) {
      setDatabaseLibrary(null);
      setDatabaseLibraryError(null);
      return;
    }
    try {
      const result = await readDatabase(
        { kind: "database", databaseId: scope.databaseId },
        captured,
      );
      if (read !== databaseReadGeneration.current) return;
      setDatabaseLibrary({
        access: previousAccess.current,
        scope: JSON.stringify(result.expected),
        items: [
          ...result.value.website.macros,
          ...result.value.website.scripts,
        ].map((item) => ({
          ...item,
          scope: { kind: "database", databaseId: scope.databaseId },
        })),
      });
      setDatabaseLibraryError(null);
    } catch (failure) {
      if (
        mounted.current &&
        epoch.current === captured &&
        read === databaseReadGeneration.current
      ) {
        setDatabaseLibrary(null);
        setDatabaseLibraryError(message(failure));
      }
    }
  }, [readDatabase]);
  useEffect(() => {
    if (options.settingsReady && options.scopeKey) void reloadDatabase();
    else setDatabaseLibrary(null);
  }, [
    accessKey,
    options.settingsReady,
    options.scopeKey,
    databaseScopeKey,
    context?.automationLibrary?.changeRevision,
    reloadDatabase,
  ]);

  const resolveItem = async (
    item: ScopedWebAutomationItem,
    captured: number,
  ) => {
    assertAccess(captured);
    const checkOwner = captureWebAutomationAccess(
      latest.current.ownerDatabaseId,
    );
    const scope = quickActionReferenceScope(item);
    const current =
      scope.kind === "app"
        ? ((await webAutomationStore.load()).value ??
          EMPTY_WEB_AUTOMATION_LIBRARY)
        : (await readDatabase(scope, captured)).value.website;
    assertAccess(captured);
    checkOwner();
    const saved = [...current.macros, ...current.scripts].find(
      (entry) => entry.kind === item.kind && entry.id === item.id,
    );
    if (
      !saved ||
      JSON.stringify(normalizeWebAutomationItem(saved)) !==
        JSON.stringify(payloadOf(item))
    )
      throw new Error(
        "The selected website item changed or was deleted. Reload and review its exact library source before running.",
      );
    return normalizeWebAutomationItem(saved);
  };

  useEffect(() => {
    if (!options.settingsReady || !options.scopeKey) {
      cancel();
      bridge.cancel(true);
      setOpen(false);
      setLibrary(EMPTY_WEB_AUTOMATION_LIBRARY);
      setDatabaseLibrary(null);
      setLibraryReady(false);
      setLibraryLoading(false);
      setRecordedSteps([]);
      return;
    }
    if (!loaded.current) void reload();
  }, [
    accessKey,
    options.settingsReady,
    options.scopeKey,
    cancel,
    reload,
    bridge,
    setRecordedSteps,
  ]);

  useEffect(() => {
    mounted.current = true;
    const receive = (event: MessageEvent) => bridge.handleMessage(event);
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.key === WEB_AUTOMATION_STORE_KEY)
        void reload();
    };
    window.addEventListener("message", receive);
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    const revoke = () => {
      epoch.current++;
      revoked.current = true;
      loaded.current = false;
      setError(
        "Website library access was revoked. Unlock its storage, then reload the library.",
      );
      cancel();
      bridge.cancel(true);
      setOpen(false);
      setLibraryReady(false);
      setLibraryLoading(false);
      setLibrary(EMPTY_WEB_AUTOMATION_LIBRARY);
      setDatabaseLibrary(null);
      setRecordedSteps([]);
    };
    const offDatabase = onDatabaseAccessChange((event) => {
      if (event.status === "suspended") revoke();
    });
    let offNative: (() => void) | undefined,
      disposed = false;
    void getInvoke()
      .then(async (invoke) => {
        if (!invoke || disposed) return;
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
        if (disposed) off();
        else offNative = off;
      })
      .catch(() => {
        /* Native library operations still fail closed if runtime is unavailable. */
      });
    return () => {
      mounted.current = false;
      disposed = true;
      // This is a monotonic invalidation counter, not a captured DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      cancel();
      bridge.cancel(true);
      offDatabase();
      offNative?.();
      window.removeEventListener("message", receive);
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    };
  }, [bridge, cancel, reload, setRecordedSteps]);

  const executionKey = `${options.navigationKey}:${options.blocked}:${accessKey}:${JSON.stringify(permissions.value)}`;
  useEffect(() => {
    cancel();
    bridge.cancel(true);
  }, [executionKey, cancel, bridge]);

  const darkMode = useWebsiteDarkMode({
    ...options,
    scopeKey: options.appearanceScopeKey ?? options.scopeKey,
    bridge,
    resetKey: executionKey,
  });

  // Consent is a connection setting, not an implicit command to the website.
  // This check intentionally does not treat missing per-connection consent as
  // generic unavailability; the UI can offer an explicit, durable Enable action.
  const recordingConfigurationProblem = () => {
    const current = latest.current;
    if (!current.connection || current.connection.isGroup)
      return "Save and open an HTTP or HTTPS connection before recording macros.";
    if (!["http", "https"].includes(current.connection.protocol))
      return "Website macro recording is available only for HTTP and HTTPS connections.";
    if (!current.settingsReady)
      return "Wait for global settings to become ready.";
    const availability = normalizeSessionQuickActions(
      current.settings.sessionQuickActions,
    );
    if (!availability.httpEnabled)
      return "Website quick actions are disabled in global settings.";
    if (!availability.allowWebMacros)
      return "Website macros are disabled in global settings.";
    try {
      normalizeHttpAutomation(current.connection.httpAutomation);
      captureWebAutomationAccess(current.ownerDatabaseId)();
    } catch (failure) {
      return message(failure);
    }
    return null;
  };
  const recordingUnavailableReason = (() => {
    const problem = recordingConfigurationProblem();
    if (problem) return problem;
    if (revoked.current)
      return "Website library access was revoked. Unlock its storage, then reload the library.";
    if (
      !(libraryReady && libraryScope === accessKey) &&
      !(
        databaseLibrary?.access === accessKey &&
        databaseLibrary.scope === databaseScopeKey
      )
    )
      return libraryLoading
        ? "Loading website macro library…"
        : (error ??
            databaseLibraryError ??
            "Website macro library is not ready. Reload the library.");
    if (options.blocked || !options.getDocument())
      return "Wait for the current page to become ready and complete any certificate review.";
    if (busy) return "Wait for the current website action or save to finish.";
    return null;
  })();
  const canEnableMacroRecording =
    !recordingConfigurationProblem() &&
    !busy &&
    !recording &&
    !recordingPending &&
    permissions.value?.interactionMacrosEnabled === false;
  const enableMacroRecording = async (): Promise<boolean> => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return false;
    const current = latest.current.connection;
    const captured = epoch.current;
    const consentKey = macroConsentKey(latest.current);
    setError(null);
    busyRef.current = true;
    savingRef.current = true;
    setBusy(true);
    try {
      const problem = recordingConfigurationProblem();
      if (problem || !current)
        throw new Error(problem ?? "The connection is unavailable.");
      assertAccess(captured);
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const config = normalizeHttpAutomation(current.httpAutomation);
      if (config.interactionMacrosEnabled && !currentConsentFailure())
        return true;
      const enabled = { ...config, interactionMacrosEnabled: true };
      const check = () => {
        assertAccess(captured);
        checkOwner();
        const problem = recordingConfigurationProblem();
        if (problem) throw new Error(problem);
        if (
          latest.current.connection?.id !== current.id ||
          latest.current.connection.protocol !== current.protocol
        )
          throw new Error(
            "The connection changed. Review macro permission again.",
          );
      };
      check();
      if (latest.current.connection !== current)
        throw new Error(
          "The connection changed. Review macro permission again.",
        );
      await latest.current.updateConnection({
        ...current,
        httpAutomation: enabled,
      });
      check();
      const observed = latest.current.connection;
      if (
        observed !== current &&
        JSON.stringify(normalizeHttpAutomation(observed?.httpAutomation)) !==
          JSON.stringify(enabled)
      )
        throw new Error(
          "Website macro settings changed during saving. Review the current connection before recording.",
        );
      if (consentKey) failedMacroConsents.current.delete(consentKey);
      return true;
    } catch (failure) {
      const explanation = `Macro permission could not be confirmed saved. ${message(failure)}`;
      // A save can settle after lock or a database switch. Retain its refusal
      // against the captured owner, never against whichever database is visible.
      if (consentKey) failedMacroConsents.current.set(consentKey, explanation);
      if (
        mounted.current &&
        epoch.current === captured &&
        consentKey === macroConsentKey(latest.current)
      ) {
        setError(explanation);
      }
      return false;
    } finally {
      busyRef.current = false;
      savingRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const startRecording = async (): Promise<boolean> => {
    if (
      busyRef.current ||
      recordingRef.current ||
      recordingTransition.current ||
      !permissionsRef.current.value?.interactionMacrosEnabled ||
      (!(libraryReady && libraryScope === accessKey) &&
        !(
          databaseLibrary?.access === accessKey &&
          databaseLibrary.scope === databaseScopeKey
        ))
    )
      return false;
    if (stepsRef.current.length) {
      setError(
        "Review or discard the unsaved recording before starting a new macro.",
      );
      return false;
    }
    const problem = recordingConfigurationProblem();
    if (problem || latest.current.blocked || !latest.current.getDocument()) {
      setError(
        problem ??
          "Wait for the current page and certificate review before recording.",
      );
      return false;
    }
    const captured = epoch.current,
      attempt = ++recordingAttempt.current;
    setError(null);
    recordingTransition.current = "starting";
    setRecordingPending(true);
    recordingRef.current = true;
    try {
      assertAccess(captured);
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      await bridge.request("recordStart", undefined, {
        onStep: (step) => {
          if (
            recordingAttempt.current === attempt &&
            recordingRef.current &&
            stepsRef.current.length < 200
          )
            setRecordedSteps([...stepsRef.current, step]);
        },
        onStop: () => {
          if (recordingAttempt.current !== attempt) return;
          recordingRef.current = false;
          // A Stop request owns the transition until its promise settles,
          // including a limit notification that arrives before its ACK.
          const stopping = recordingTransition.current === "stopping";
          if (!stopping) recordingTransition.current = null;
          if (mounted.current) {
            setRecording(false);
            if (!stopping) setRecordingPending(false);
          }
        },
      });
      if (recordingAttempt.current !== attempt || !recordingRef.current)
        return false;
      assertAccess(captured);
      checkOwner();
      const problem = recordingConfigurationProblem();
      if (problem || !permissionsRef.current.value?.interactionMacrosEnabled)
        throw new Error(problem ?? "Website macro recording was disabled.");
      setRecording(true);
      return true;
    } catch (failure) {
      if (mounted.current && recordingAttempt.current === attempt) {
        bridge.cancel();
        recordingRef.current = false;
        setRecording(false);
        if (epoch.current === captured) setError(message(failure));
      }
      return false;
    } finally {
      if (recordingAttempt.current === attempt) {
        recordingTransition.current = null;
        if (mounted.current) setRecordingPending(false);
      }
    }
  };
  const stopRecording = async () => {
    if (!recordingRef.current || recordingTransition.current) return;
    const captured = epoch.current,
      stoppedOperation = operation.current,
      attempt = recordingAttempt.current;
    recordingTransition.current = "stopping";
    setRecordingPending(true);
    setRecording(false);
    try {
      await bridge.request("recordStop");
      assertAccess(captured);
      if (
        operation.current === stoppedOperation &&
        recordingAttempt.current === attempt
      ) {
        setLibraryKind(undefined);
        setOpen(true);
      }
    } catch (failure) {
      if (
        mounted.current &&
        epoch.current === captured &&
        operation.current === stoppedOperation &&
        recordingAttempt.current === attempt
      )
        setError(message(failure));
    } finally {
      if (recordingAttempt.current === attempt) {
        recordingRef.current = false;
        recordingTransition.current = null;
        if (mounted.current) setRecordingPending(false);
      }
    }
  };
  const discardRecording = () => {
    if (recordingRef.current || recordingTransition.current) cancel();
    setRecordedSteps([]);
  };

  const execute = async (item: ScopedWebAutomationItem) => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return;
    setPendingRun(null);
    setError(null);
    const permission = permissionsRef.current.value;
    if (
      !permission ||
      (item.kind === "macro"
        ? !permission.interactionMacrosEnabled
        : !permission.scriptInjectionEnabled)
    ) {
      setError(
        "This website capability is disabled. Review the connection and global settings.",
      );
      return;
    }
    let validated: WebAutomationItem;
    try {
      validated = payloadOf(item);
    } catch (failure) {
      setError(message(failure));
      return;
    }
    const captured = epoch.current,
      run = ++operation.current,
      currentDocument = latest.current.getDocument();
    if (!currentDocument) {
      setError("Wait for the current trusted page to be ready.");
      return;
    }
    const doc = { ...currentDocument };
    const check = () => {
      assertAccess(captured);
      const enabled = permissionsRef.current.value;
      if (
        !enabled ||
        (item.kind === "script"
          ? !enabled.scriptInjectionEnabled
          : !enabled.interactionMacrosEnabled)
      )
        throw new Error("Website automation was disabled; the run stopped.");
      const current = latest.current.getDocument();
      if (
        operation.current !== run ||
        !current ||
        current.generation !== doc.generation ||
        current.token !== doc.token ||
        current.sessionId !== doc.sessionId
      )
        throw new Error("The page changed; website replay stopped.");
    };
    setBusy(true);
    busyRef.current = true;
    try {
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      check();
      validated = await resolveItem(item, captured);
      check();
      if (validated.kind === "script") {
        const code = await prepareWebsiteScript(validated);
        checkOwner();
        check();
        await resolveItem(item, captured);
        checkOwner();
        check();
        await bridge.request("script", { code });
      } else
        for (let index = 0; index < validated.steps.length; index++) {
          checkOwner();
          check();
          await resolveItem(item, captured);
          check();
          const step = validated.steps[index];
          let value: string | null = null;
          if (step.kind === "fill") {
            value = await new Promise<string | null>((resolve) => {
              const prompt = { index: index + 1, resolve };
              valuePromptRef.current = prompt;
              setValuePrompt(prompt);
            });
            if (value === null)
              throw new Error(
                "Website replay cancelled; no field value was saved.",
              );
            check();
            checkOwner();
            await resolveItem(item, captured);
            check();
          }
          await bridge.request("step", {
            step,
            ...(value === null ? {} : { value }),
          });
          value = null;
          if (index + 1 < validated.steps.length)
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
      check();
      checkOwner();
    } catch (failure) {
      if (mounted.current && epoch.current === captured)
        setError(message(failure));
    } finally {
      if (operation.current === run) {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const requestRun = async (item: ScopedWebAutomationItem) => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return;
    const captured = epoch.current,
      requestedOperation = ++operation.current;
    try {
      await resolveItem(item, captured);
      assertAccess(captured);
      if (
        requestedOperation !== operation.current ||
        busyRef.current ||
        recordingRef.current
      )
        return;
    } catch (failure) {
      if (mounted.current && epoch.current === captured)
        setError(message(failure));
      return;
    }
    if (
      (item.kind === "script"
        ? permissionsRef.current.value?.confirmBeforeScriptRun
        : options.settings.macros?.confirmBeforeReplay) !== false
    )
      setPendingRun(structuredClone(item));
    else void execute(item);
  };
  const save = async (
    item: ScopedWebAutomationItem,
    expected?: ScopedWebAutomationItem,
  ) => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return false;
    const captured = epoch.current;
    busyRef.current = true;
    savingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      assertAccess(captured);
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const scope = quickActionReferenceScope(item);
      if (
        expected &&
        quickActionReferenceKey(item) !== quickActionReferenceKey(expected)
      )
        throw new Error(
          "A library edit cannot change its owning scope or identifier.",
        );
      if (scope.kind === "database") {
        const {
          api,
          expected: receipt,
          value,
        } = await readDatabase(scope, captured);
        const payload = payloadOf(item),
          prior = expected ? payloadOf(expected) : undefined;
        const collection =
          payload.kind === "script"
            ? value.website.scripts
            : value.website.macros;
        const found = collection.find((entry) => entry.id === payload.id);
        if (
          JSON.stringify(
            found ? normalizeWebAutomationItem(found) : undefined,
          ) !== JSON.stringify(prior)
        )
          throw new Error("The database item changed. Reload before saving.");
        const website = normalizeWebAutomationLibrary({
          ...value.website,
          [payload.kind === "script" ? "scripts" : "macros"]: [
            ...collection.filter((entry) => entry.id !== payload.id),
            payload,
          ],
        });
        checkOwner();
        assertAccess(captured);
        await api.compareAndSwap(receipt, value, {
          ...value,
          revision: value.revision + 1,
          website,
        });
        assertAccess(captured);
        checkOwner();
        await reloadDatabase();
        return true;
      }
      const result = await saveWebAutomationItem(
        payloadOf(item),
        expected ? payloadOf(expected) : undefined,
        () => {
          assertAccess(captured);
          checkOwner();
        },
      );
      assertAccess(captured);
      checkOwner();
      setLibrary(result);
      return true;
    } catch (failure) {
      if (mounted.current && epoch.current === captured)
        setError(message(failure));
      return false;
    } finally {
      busyRef.current = false;
      savingRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const remove = async (expected: ScopedWebAutomationItem) => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return false;
    const captured = epoch.current;
    busyRef.current = true;
    savingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      assertAccess(captured);
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const scope = quickActionReferenceScope(expected);
      if (scope.kind === "database") {
        const {
          api,
          expected: receipt,
          value,
        } = await readDatabase(scope, captured);
        const payload = payloadOf(expected),
          field = payload.kind === "script" ? "scripts" : "macros";
        const found = value.website[field].find(
          (entry) => entry.id === payload.id,
        );
        if (
          JSON.stringify(
            found ? normalizeWebAutomationItem(found) : undefined,
          ) !== JSON.stringify(payload)
        )
          throw new Error("The database item changed. Reload before deleting.");
        const website = normalizeWebAutomationLibrary({
          ...value.website,
          [field]: value.website[field].filter(
            (entry) => entry.id !== payload.id,
          ),
        });
        const provenance = { ...value.provenance };
        delete provenance[`website-${payload.kind}:${payload.id}`];
        checkOwner();
        assertAccess(captured);
        await api.compareAndSwap(receipt, value, {
          ...value,
          revision: value.revision + 1,
          website,
          provenance,
        });
        assertAccess(captured);
        checkOwner();
        await reloadDatabase();
        return true;
      }
      const result = await deleteWebAutomationItem(payloadOf(expected), () => {
        assertAccess(captured);
        checkOwner();
      });
      assertAccess(captured);
      checkOwner();
      setLibrary(result);
      return true;
    } catch (failure) {
      if (mounted.current && epoch.current === captured)
        setError(message(failure));
      return false;
    } finally {
      busyRef.current = false;
      savingRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const favorite = async (
    item: ScopedWebAutomationItem,
    removeOnly = false,
  ) => {
    const current = latest.current.connection;
    if (
      !current ||
      (!(libraryReady && libraryScope === accessKey) &&
        !(
          databaseLibrary?.access === accessKey &&
          databaseLibrary.scope === databaseScopeKey
        )) ||
      revoked.current ||
      busyRef.current ||
      recordingRef.current ||
      recordingTransition.current
    )
      return;
    const captured = epoch.current;
    busyRef.current = true;
    savingRef.current = true;
    setBusy(true);
    try {
      assertAccess(captured);
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const config = normalizeHttpAutomation(current.httpAutomation);
      const key = quickActionReferenceKey(item),
        scope = quickActionReferenceScope(item);
      const has = config.items.some(
        (ref) => quickActionReferenceKey(ref) === key,
      );
      if (removeOnly && !has) return;
      const items = has
        ? config.items.filter((ref) => quickActionReferenceKey(ref) !== key)
        : [
            ...config.items,
            {
              kind: item.kind,
              id: item.id,
              ...(scope.kind === "database" ? { scope } : {}),
            },
          ];
      if (!has) await resolveItem(item, captured);
      if (items.length > 64)
        throw new Error("Use at most 64 website favorites.");
      checkOwner();
      if (latest.current.connection !== current)
        throw new Error(
          "The connection changed. Review its favorites before saving.",
        );
      await latest.current.updateConnection({
        ...current,
        httpAutomation: { ...config, items },
      });
      assertAccess(captured);
      checkOwner();
    } catch (failure) {
      if (mounted.current && epoch.current === captured)
        setError(
          `Favorite update could not be confirmed saved. ${message(failure)}`,
        );
    } finally {
      busyRef.current = false;
      savingRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const visibleLibrary =
    libraryScope === accessKey && libraryReady
      ? library
      : EMPTY_WEB_AUTOMATION_LIBRARY;
  const allItems: ScopedWebAutomationItem[] = [
    ...visibleLibrary.macros,
    ...visibleLibrary.scripts,
    ...(databaseLibrary?.access === accessKey &&
    databaseLibrary.scope === databaseScopeKey &&
    !revoked.current
      ? databaseLibrary.items
      : []),
  ];
  const favorites = (() => {
    try {
      return normalizeHttpAutomation(
        options.connection?.httpAutomation,
      ).items.flatMap((ref) => {
        const item = allItems.find(
          (candidate) =>
            quickActionReferenceKey(candidate) === quickActionReferenceKey(ref),
        );
        return item ? [item] : [];
      });
    } catch {
      return [];
    }
  })();
  const recordedMacro = (name: string): WebInteractionMacro => {
    const date = new Date().toISOString();
    return {
      kind: "macro",
      id: crypto.randomUUID(),
      name,
      description:
        "Recorded structural interactions; field values are requested at replay.",
      steps,
      createdAt: date,
      updatedAt: date,
    };
  };
  const managementReady =
    !revoked.current &&
    ((libraryReady && libraryScope === accessKey) ||
      (databaseLibrary?.access === accessKey &&
        databaseLibrary.scope === databaseScopeKey));
  const managementEpoch = epoch.current;
  const openLibrary = (kind?: "script" | "macro") => {
    if (
      !managementReady ||
      busyRef.current ||
      recordingTransition.current ||
      recordingRef.current
    )
      return;
    try {
      assertAccess(managementEpoch);
      setLibraryKind(kind);
      setOpen(true);
    } catch (failure) {
      setError(message(failure));
    }
  };
  return {
    darkMode,
    permissions: permissions.value,
    error:
      permissions.error ??
      currentConsentFailure() ??
      error ??
      databaseLibraryError,
    libraryReady:
      (libraryReady && libraryScope === accessKey) ||
      (databaseLibrary?.access === accessKey &&
        databaseLibrary.scope === databaseScopeKey &&
        !revoked.current),
    availableDatabaseScope:
      databaseLibrary?.access === accessKey &&
      databaseLibrary.scope === databaseScopeKey &&
      !revoked.current &&
      context?.automationLibrary?.scope?.databaseId === options.ownerDatabaseId
        ? { kind: "database" as const, databaseId: options.ownerDatabaseId! }
        : null,
    library: visibleLibrary,
    allItems,
    favorites,
    open,
    setOpen,
    openLibrary,
    libraryKind,
    busy,
    saving: savingRef.current,
    recording,
    recordingPending,
    recordingScopeKey: `${accessKey}:${options.connection?.id ?? ""}:${options.connection?.protocol ?? ""}:${epoch.current}`,
    recordingUnavailableReason,
    canEnableMacroRecording,
    enableMacroRecording,
    discardRecording,
    steps,
    startRecording,
    stopRecording,
    requestRun,
    pendingRun,
    setPendingRun,
    execute,
    cancel,
    reload: async () => {
      await reload();
      await reloadDatabase();
    },
    save,
    remove,
    favorite,
    recordedMacro,
    clearSteps: () => setRecordedSteps([]),
    valuePrompt,
    answerValue: (value: string | null) => {
      valuePromptRef.current?.resolve(value);
      valuePromptRef.current = null;
      setValuePrompt(null);
    },
    pageReady:
      !!options.getDocument() &&
      !options.blocked &&
      options.settingsReady &&
      !!options.scopeKey &&
      !revoked.current,
  };
}
