import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import type {
  WebAutomationDocument,
  WebAutomationItem,
  WebAutomationLibrary,
  WebInteractionMacro,
  WebInteractionStep,
} from "../../types/recording/webAutomation";
import {
  normalizeHttpAutomation,
  normalizeSessionQuickActions,
  resolveHttpAutomationPermissions,
} from "../../utils/connection/sessionQuickActions";
import {
  deleteWebAutomationItem,
  EMPTY_WEB_AUTOMATION_LIBRARY,
  normalizeWebAutomationItem,
  saveWebAutomationItem,
  WEB_AUTOMATION_STORE_KEY,
  webAutomationStore,
} from "../../utils/recording/webAutomationLibrary";
import { WebAutomationBridge } from "../../utils/recording/webAutomationBridge";
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
  blocked: boolean;
  navigationKey: string;
  iframe: React.RefObject<HTMLIFrameElement | null>;
  getDocument: () => WebAutomationDocument | null;
  updateConnection: (connection: Connection) => Promise<void>;
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
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false);
  const [steps, setSteps] = useState<WebInteractionStep[]>([]);
  const stepsRef = useRef<WebInteractionStep[]>([]);
  const setRecordedSteps = useCallback((next: WebInteractionStep[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, []);
  const [recordingPending, setRecordingPending] = useState(false);
  const recordingTransition = useRef<"starting" | "stopping" | null>(null);
  const recordingAttempt = useRef(0);
  const [pendingRun, setPendingRun] = useState<WebAutomationItem | null>(null);
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
        current.scopeKey &&
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
  const accessKey = `${options.ownerDatabaseId ?? ""}:${options.scopeKey}:${options.settingsReady}`;
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
    try {
      const checkOwner = captureWebAutomationAccess(
        latest.current.ownerDatabaseId,
      );
      const result = await webAutomationStore.load();
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
    }
  }, [assertAccess]);

  useEffect(() => {
    if (!options.settingsReady || !options.scopeKey) {
      cancel();
      bridge.cancel(true);
      setOpen(false);
      setLibrary(EMPTY_WEB_AUTOMATION_LIBRARY);
      setLibraryReady(false);
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
      cancel();
      bridge.cancel(true);
      setOpen(false);
      setLibraryReady(false);
      setLibrary(EMPTY_WEB_AUTOMATION_LIBRARY);
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

  const executionKey = `${options.navigationKey}:${options.blocked}:${options.scopeKey}:${JSON.stringify(permissions.value)}`;
  useEffect(() => {
    cancel();
    bridge.cancel(true);
  }, [executionKey, cancel, bridge]);

  // Re-evaluated on each authenticated document readiness/config change. Never
  // enables darkness from the global switch alone, nor before a trust decision.
  const darkEnabled = permissions.value?.forceDark === true;
  useEffect(() => {
    const current = latest.current;
    if (
      !current.settingsReady ||
      current.blocked ||
      !current.scopeKey ||
      !current.getDocument()
    )
      return;
    let alive = true;
    void bridge.request("dark", { enabled: darkEnabled }).catch((failure) => {
      if (alive && darkEnabled) setError(message(failure));
    });
    return () => {
      alive = false;
    };
  }, [
    executionKey,
    options.settingsReady,
    options.blocked,
    options.scopeKey,
    bridge,
    darkEnabled,
  ]);

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
    if (!libraryReady || libraryScope !== accessKey || revoked.current)
      return "The native website macro library is unavailable. Unlock its storage and reload the library.";
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
      !libraryReady ||
      libraryScope !== accessKey
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
      )
        setOpen(true);
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

  const execute = async (item: WebAutomationItem) => {
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
      validated = normalizeWebAutomationItem(item);
    } catch (failure) {
      setError(message(failure));
      return;
    }
    const captured = epoch.current,
      run = ++operation.current,
      doc = latest.current.getDocument();
    if (!doc) {
      setError("Wait for the current trusted page to be ready.");
      return;
    }
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
      if (validated.kind === "script")
        await bridge.request("script", { code: validated.code });
      else
        for (let index = 0; index < validated.steps.length; index++) {
          checkOwner();
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
  const requestRun = (item: WebAutomationItem) => {
    if (busyRef.current || recordingRef.current || recordingTransition.current)
      return;
    if (
      (item.kind === "script"
        ? permissionsRef.current.value?.confirmBeforeScriptRun
        : options.settings.macros?.confirmBeforeReplay) !== false
    )
      setPendingRun(item);
    else void execute(item);
  };
  const save = async (
    item: WebAutomationItem,
    expected?: WebAutomationItem,
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
      const result = await saveWebAutomationItem(item, expected, () => {
        assertAccess(captured);
        checkOwner();
      });
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
  const remove = async (expected: WebAutomationItem) => {
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
      const result = await deleteWebAutomationItem(expected, () => {
        assertAccess(captured);
        checkOwner();
      });
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
  const favorite = async (item: WebAutomationItem) => {
    const current = latest.current.connection;
    if (
      !current ||
      !libraryReady ||
      libraryScope !== accessKey ||
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
      const has = config.items.some(
        (ref) => ref.kind === item.kind && ref.id === item.id,
      );
      const items = has
        ? config.items.filter(
            (ref) => ref.kind !== item.kind || ref.id !== item.id,
          )
        : [...config.items, { kind: item.kind, id: item.id }];
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
  const allItems = [...visibleLibrary.macros, ...visibleLibrary.scripts];
  const favorites = (() => {
    try {
      return normalizeHttpAutomation(
        options.connection?.httpAutomation,
      ).items.flatMap((ref) => {
        const item = allItems.find(
          (candidate) => candidate.kind === ref.kind && candidate.id === ref.id,
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
  return {
    permissions: permissions.value,
    error: permissions.error ?? currentConsentFailure() ?? error,
    libraryReady: libraryReady && libraryScope === accessKey,
    library: visibleLibrary,
    allItems,
    favorites,
    open,
    setOpen,
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
    reload,
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
