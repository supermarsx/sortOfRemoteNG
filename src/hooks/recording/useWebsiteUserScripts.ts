import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import { captureWebAutomationAccess } from "../protocol/useWebAutomation";
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

/** Mounted only after explicitly opening Website userscripts. Never executes code. */
export function useWebsiteUserScripts() {
  const { settingsReady } = useSettings();
  const [owner] = useState(
    () => DatabaseManager.getInstance().getCurrentDatabase()?.id,
  );
  const [scripts, setScripts] = useState<BrowserScript[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const live = useRef(false);
  const revoked = useRef(false);
  const generation = useRef(0);
  const readId = useRef(0);
  const checkRef = useRef<(() => void) | null>(null);
  const latestReady = useRef(settingsReady);
  latestReady.current = settingsReady;
  const assertCurrent = useCallback((captured = generation.current) => {
    if (
      !live.current ||
      revoked.current ||
      !latestReady.current ||
      captured !== generation.current ||
      !checkRef.current
    )
      throw new Error(
        "Website script access changed. Reopen this view after unlocking its owning database.",
      );
    checkRef.current();
  }, []);
  const revoke = useCallback(() => {
    generation.current++;
    revoked.current = true;
    checkRef.current = null;
    setScripts([]);
    setReady(false);
    setBusy(false);
    setEpoch((value) => value + 1);
    setError(
      "Access changed. Reopen Website userscripts after unlocking the original database.",
    );
  }, []);
  const reload = useCallback(async () => {
    const captured = generation.current;
    const read = ++readId.current;
    try {
      assertCurrent(captured);
      const result = await webAutomationStore.load();
      assertCurrent(captured);
      if (read !== readId.current) return;
      setScripts(result.value?.scripts ?? []);
      setReady(true);
      setError(null);
    } catch {
      if (
        live.current &&
        captured === generation.current &&
        read === readId.current
      ) {
        setReady(false);
        setScripts([]);
        setError(
          "The protected website script library is unavailable. Unlock storage and its owning database, then reopen this view. No fallback library was created.",
        );
      }
    }
  }, [assertCurrent]);
  useEffect(() => {
    live.current = true;
    try {
      checkRef.current = captureWebAutomationAccess(owner);
      void reload();
    } catch {
      revoke();
    }
    const manager = DatabaseManager.getInstance();
    const offCurrent = manager.onCurrentDatabaseChange(() => {
      try {
        assertCurrent();
      } catch {
        revoke();
      }
    });
    const offAccess = onDatabaseAccessChange((event) => {
      if (event.status === "suspended" && event.databaseId === owner) revoke();
    });
    const changed = (event: Event) => {
      if (
        (event as CustomEvent).detail?.key === WEB_AUTOMATION_STORE_KEY &&
        !revoked.current
      )
        void reload();
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    let disposed = false,
      offNative: (() => void) | undefined;
    void getInvoke()
      .then(async (invoke) => {
        if (!invoke || disposed) return;
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
        if (disposed) off();
        else offNative = off;
      })
      .catch(() => {});
    return () => {
      live.current = false;
      disposed = true;
      // Monotonic invalidation counter, not a captured DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      checkRef.current = null;
      offCurrent();
      offAccess();
      offNative?.();
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    };
  }, [owner, reload, revoke, assertCurrent]);
  useEffect(() => {
    if (settingsReady === false) revoke();
  }, [settingsReady, revoke]);
  const save = async (item: BrowserScript, expected?: BrowserScript) => {
    const captured = generation.current;
    try {
      assertCurrent(captured);
      setBusy(true);
      setError(null);
      const library = await saveWebAutomationItem(item, expected, () =>
        assertCurrent(captured),
      );
      assertCurrent(captured);
      setScripts(library.scripts);
      return true;
    } catch {
      if (live.current && captured === generation.current)
        setError(
          "Script was not saved. Check storage access, credential-free source, size limits, and concurrent edits; reload and review before retrying.",
        );
      return false;
    } finally {
      if (live.current && captured === generation.current) setBusy(false);
    }
  };
  const remove = async (expected: BrowserScript) => {
    const captured = generation.current;
    try {
      assertCurrent(captured);
      setBusy(true);
      setError(null);
      const library = await deleteWebAutomationItem(expected, () =>
        assertCurrent(captured),
      );
      assertCurrent(captured);
      setScripts(library.scripts);
      return true;
    } catch {
      if (live.current && captured === generation.current)
        setError(
          "Script was not deleted. Reload and review its current version before retrying.",
        );
      return false;
    } finally {
      if (live.current && captured === generation.current) setBusy(false);
    }
  };
  let accessible = ready;
  try {
    assertCurrent();
  } catch {
    accessible = false;
  }
  return {
    scripts: accessible ? scripts : [],
    ready: accessible,
    busy,
    error,
    epoch,
    save,
    remove,
    reload,
  };
}
