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
  const permissions = (() => {
    try {
      return {
        value: resolveHttpAutomationPermissions(
          options.settings.sessionQuickActions,
          options.connection?.httpAutomation,
        ),
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
    if (!savingRef.current) busyRef.current = false;
    recordingRef.current = false;
    bridge.cancel();
    valuePromptRef.current?.resolve(null);
    valuePromptRef.current = null;
    if (mounted.current) {
      setValuePrompt(null);
      setPendingRun(null);
      setRecording(false);
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
      setSteps([]);
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
      setSteps([]);
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
  }, [bridge, cancel, reload]);

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

  const startRecording = async () => {
    if (
      busyRef.current ||
      recordingRef.current ||
      !permissionsRef.current.value?.interactionMacrosEnabled ||
      !libraryReady ||
      libraryScope !== accessKey
    )
      return;
    setError(null);
    setSteps([]);
    setRecording(true);
    recordingRef.current = true;
    try {
      assertAccess(epoch.current);
      await bridge.request("recordStart", undefined, {
        onStep: (step) =>
          setSteps((current) =>
            current.length < 200 ? [...current, step] : current,
          ),
        onStop: () => {
          recordingRef.current = false;
          if (mounted.current) setRecording(false);
        },
      });
    } catch (failure) {
      if (mounted.current) {
        recordingRef.current = false;
        setRecording(false);
        setError(message(failure));
      }
    }
  };
  const stopRecording = async () => {
    if (!recordingRef.current) return;
    const captured = epoch.current,
      stoppedOperation = operation.current;
    recordingRef.current = false;
    setRecording(false);
    try {
      await bridge.request("recordStop");
      assertAccess(captured);
      if (operation.current === stoppedOperation) setOpen(true);
    } catch (failure) {
      if (
        mounted.current &&
        epoch.current === captured &&
        operation.current === stoppedOperation
      )
        setError(message(failure));
    }
  };

  const execute = async (item: WebAutomationItem) => {
    if (busyRef.current || recordingRef.current) return;
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
    if (busyRef.current || recordingRef.current) return;
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
    if (busyRef.current || recordingRef.current) return false;
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
    if (busyRef.current || recordingRef.current) return false;
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
      recordingRef.current
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
    error: permissions.error ?? error,
    libraryReady: libraryReady && libraryScope === accessKey,
    library: visibleLibrary,
    allItems,
    favorites,
    open,
    setOpen,
    busy,
    saving: savingRef.current,
    recording,
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
    clearSteps: () => setSteps([]),
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
