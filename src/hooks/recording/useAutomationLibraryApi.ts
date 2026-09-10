import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import { useSettings } from "../../contexts/SettingsContext";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import { getInvoke } from "../../utils/tauri/invoke";
import { createAutomationLibraryApi } from "../../utils/recording/automationLibrary";
import { AutomationLibraryAccessError } from "../../utils/recording/automationLibraryAccess";
import type { AutomationLibraryDiagnostic } from "../../types/recording/automationLibrary";

/** Managers share this adapter; absence of a DB provider never creates side storage. */
export function useAutomationLibraryApi() {
  const context = useContext(ConnectionContext);
  const { settingsReady } = useSettings();
  const latest = useRef({
    database: context?.automationLibrary,
    settingsReady,
  });
  latest.current = { database: context?.automationLibrary, settingsReady };
  const live = useRef(false);
  const listenerReady = useRef(false);
  const [ready, setReady] = useState(false);
  const [diagnostic, setDiagnostic] =
    useState<AutomationLibraryDiagnostic | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [accessEpoch, setAccessEpoch] = useState(0);
  const api = useMemo(
    () =>
      createAutomationLibraryApi(
        () =>
          live.current && listenerReady.current && latest.current.settingsReady
            ? latest.current.database
            : undefined,
        () => {
          if (
            !live.current ||
            !latest.current.settingsReady ||
            !listenerReady.current
          )
            throw new AutomationLibraryAccessError({
              code: "initializing",
              message:
                "Wait for settings and the desktop access listener to initialize, then retry the library.",
              retryable: false,
            });
        },
      ),
    [],
  );
  useEffect(() => {
    live.current = true;
    listenerReady.current = false;
    setReady(false);
    setDiagnostic(null);
    let disposed = false,
      off: (() => void) | undefined;
    api.invalidateReviews();
    setAccessEpoch((value) => value + 1);
    void (async () => {
      if (!settingsReady) return;
      const invoke = await getInvoke();
      if (disposed) return;
      if (!invoke) {
        setDiagnostic({
          code: "desktop-required",
          message:
            "Protected automation libraries require the desktop app. No browser fallback was created.",
          retryable: true,
        });
        return;
      }
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen(ENCRYPTION_EVENT_LOCKED, () => {
        if (disposed) return;
        api.invalidateReviews();
        setAccessEpoch((value) => value + 1);
      });
      if (disposed) unlisten();
      else {
        off = unlisten;
        listenerReady.current = true;
        setReady(true);
        setAccessEpoch((value) => value + 1);
      }
    })().catch(() => {
      if (disposed) return;
      api.invalidateReviews();
      listenerReady.current = false;
      setReady(false);
      setAccessEpoch((value) => value + 1);
      setDiagnostic({
        code: "backend-unavailable",
        message:
          "The desktop access listener is unavailable. Restart the updated desktop app or retry; private library previews remain unavailable.",
        retryable: true,
      });
    });
    return () => {
      live.current = false;
      listenerReady.current = false;
      disposed = true;
      api.invalidateReviews();
      off?.();
    };
  }, [api, settingsReady, retryGeneration]);
  return {
    api,
    databaseScope:
      ready && settingsReady
        ? (context?.automationLibrary?.scope ?? null)
        : null,
    ready: ready && Boolean(settingsReady),
    diagnostic,
    retry: () => setRetryGeneration((value) => value + 1),
    settingsReady,
    accessEpoch,
    databaseRevision: context?.automationLibrary?.changeRevision ?? 0,
  };
}
