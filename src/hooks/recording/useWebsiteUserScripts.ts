import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import {
  webAutomationStore,
  saveWebAutomationItem,
  deleteWebAutomationItem,
  WEB_AUTOMATION_STORE_KEY,
} from "../../utils/recording/webAutomationLibrary";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import { getInvoke } from "../../utils/tauri/invoke";
import type { BrowserScript } from "../../types/recording/webAutomation";
import type { AutomationLibraryDiagnostic } from "../../types/recording/automationLibrary";
import {
  AutomationLibraryAccessError,
  automationLibraryDiagnostic,
} from "../../utils/recording/automationLibraryAccess";

const INITIALIZING: AutomationLibraryDiagnostic = {
  code: "initializing",
  message:
    "Waiting for app settings to initialize. Library data has not been reset.",
  retryable: false,
};
const LOCKED: AutomationLibraryDiagnostic = {
  code: "locked",
  message:
    "App encryption was locked. Unlock it, then explicitly retry the app-wide library.",
  retryable: true,
};

/** App-wide management is independent of connection DB ownership. Never executes code. */
export function useWebsiteUserScripts() {
  const { settingsReady } = useSettings();
  const [scripts, setScripts] = useState<BrowserScript[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [desktopAvailable, setDesktopAvailable] = useState<boolean | null>(
    null,
  );
  const [diagnostic, setDiagnostic] =
    useState<AutomationLibraryDiagnostic | null>(null);
  const [epoch, setEpoch] = useState(0);
  const live = useRef(false),
    revoked = useRef(false),
    generation = useRef(0),
    readId = useRef(0),
    writing = useRef(false),
    pendingReload = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const latestReady = useRef(settingsReady);
  latestReady.current = settingsReady;
  const invalidatePending = useCallback(() => {
    generation.current++;
  }, []);
  const assertCurrent = useCallback((captured = generation.current) => {
    if (
      !live.current ||
      revoked.current ||
      !latestReady.current ||
      captured !== generation.current
    )
      throw new AutomationLibraryAccessError({
        code: "access-changed",
        message:
          "Library access changed. Retry and review the current library before continuing.",
        retryable: true,
      });
  }, []);
  const revoke = useCallback(() => {
    generation.current++;
    revoked.current = true;
    pendingReload.current = false;
    setScripts([]);
    setReady(false);
    setBusy(false);
    setEpoch((value) => value + 1);
    setDiagnostic(LOCKED);
  }, []);
  const reload = useCallback(async () => {
    if (!latestReady.current) {
      setDiagnostic(INITIALIZING);
      return;
    }
    if (writing.current) {
      pendingReload.current = true;
      return;
    }
    const wasReady = readyRef.current && !revoked.current;
    const captured = ++generation.current,
      read = ++readId.current;
    revoked.current = false;
    if (!wasReady) setReady(false);
    try {
      const invoke = await getInvoke();
      if (live.current && captured === generation.current)
        setDesktopAvailable(Boolean(invoke));
      if (!invoke)
        throw new AutomationLibraryAccessError({
          code: "desktop-required",
          message:
            "This protected library requires the desktop app. No browser or plaintext fallback was created.",
          retryable: true,
        });
      assertCurrent(captured);
      const result = await webAutomationStore.load();
      assertCurrent(captured);
      if (read !== readId.current) return;
      setScripts(result.value?.scripts ?? []);
      setReady(true);
      setDiagnostic(null);
    } catch (failure) {
      if (
        live.current &&
        captured === generation.current &&
        read === readId.current
      ) {
        const nextDiagnostic = automationLibraryDiagnostic(failure);
        if (
          !wasReady ||
          ["locked", "access-changed", "desktop-required"].includes(
            nextDiagnostic.code,
          )
        ) {
          setReady(false);
          setScripts([]);
        }
        setDiagnostic(nextDiagnostic);
      }
    }
  }, [assertCurrent]);
  useEffect(() => {
    live.current = true;
    let disposed = false,
      offNative: (() => void) | undefined;
    const changed = (event: Event) => {
      if (
        (event as CustomEvent).detail?.key === WEB_AUTOMATION_STORE_KEY &&
        !revoked.current &&
        !writing.current
      )
        void reload();
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    if (!settingsReady) {
      generation.current++;
      setScripts([]);
      setReady(false);
      setBusy(false);
      setDiagnostic(INITIALIZING);
    } else {
      void (async () => {
        try {
          const invoke = await getInvoke();
          if (disposed) return;
          if (invoke) {
            const { listen } = await import("@tauri-apps/api/event");
            const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
            if (disposed) {
              off();
              return;
            }
            offNative = off;
          }
          await reload();
        } catch (failure) {
          if (!disposed) setDiagnostic(automationLibraryDiagnostic(failure));
        }
      })();
    }
    return () => {
      live.current = false;
      disposed = true;
      invalidatePending();
      offNative?.();
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    };
  }, [settingsReady, reload, revoke, invalidatePending]);
  const renderedGeneration = generation.current;
  const mutate = async (
    operation: (check: () => void) => Promise<{ scripts: BrowserScript[] }>,
  ) => {
    if (writing.current) return false;
    const captured = renderedGeneration;
    try {
      assertCurrent(captured);
      if (!ready)
        throw new AutomationLibraryAccessError({
          code: "access-changed",
          message: "Load the app-wide library before editing it.",
          retryable: true,
        });
      writing.current = true;
      setBusy(true);
      setDiagnostic(null);
      const library = await operation(() => assertCurrent(captured));
      assertCurrent(captured);
      setScripts(library.scripts);
      return true;
    } catch (failure) {
      if (live.current && captured === generation.current)
        setDiagnostic(automationLibraryDiagnostic(failure));
      return false;
    } finally {
      writing.current = false;
      if (live.current) {
        setBusy(false);
        if (pendingReload.current && latestReady.current) {
          pendingReload.current = false;
          void reload();
        }
      }
    }
  };
  const accessible = ready && settingsReady && !revoked.current;
  return {
    scripts: accessible ? scripts : [],
    ready: accessible,
    busy,
    error: diagnostic?.message ?? null,
    diagnostic,
    epoch,
    scope: { kind: "app" as const },
    settingsReady,
    desktopAvailable,
    save: (item: BrowserScript, expected?: BrowserScript) =>
      mutate((check) => saveWebAutomationItem(item, expected, check)),
    remove: (expected: BrowserScript) =>
      mutate((check) => deleteWebAutomationItem(expected, check)),
    reload,
  };
}
