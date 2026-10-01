import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalMacro } from "../../types/recording/macroTypes";
import type { ManagedScript } from "../../components/recording/scriptManager/shared";
import {
  TERMINAL_MACROS_STORE_KEY,
  validateTerminalMacros,
} from "../../utils/recording/terminalMacroPersistence";
import { nativeManagedScriptsStore } from "../../utils/recording/managedScriptPersistence";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { automationLibraryDiagnostic } from "../../utils/recording/automationLibraryAccess";
import { useAutomationLibraryApi } from "./useAutomationLibraryApi";

/** Toolbar entries and recordings use the app library. Database entries stay
 * behind explicit manager/favorite scopes; callers guard session execution. */
export function useTerminalAppLibrary(enabled: boolean) {
  const bridge = useAutomationLibraryApi();
  const available = Boolean(enabled && bridge.ready && bridge.settingsReady);
  const key = `${bridge.accessEpoch}:${available}`;
  const latest = useRef({ api: bridge.api, key, available });
  latest.current = { api: bridge.api, key, available };
  const live = useRef(false);
  const sequence = useRef(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    scripts: ManagedScript[];
    macros: TerminalMacro[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    const current = latest.current;
    if (!live.current || !current.available)
      throw new Error(
        "Wait for the app-wide terminal library to become available.",
      );
    const assertCurrent = () => {
      if (
        !live.current ||
        !latest.current.available ||
        latest.current.key !== current.key
      )
        throw new Error(
          "App-wide terminal library access changed. Reload before continuing.",
        );
    };
    return { api: current.api, assertCurrent, key: current.key };
  }, []);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const capturedKey = latest.current.key;
    try {
      const owner = capture();
      const [scripts, macros] = await Promise.all([
        owner.api.read({ kind: "app" }, "terminal-script"),
        owner.api.read({ kind: "app" }, "terminal-macro"),
      ]);
      owner.assertCurrent();
      if (request !== sequence.current) return;
      setLoaded({
        key: owner.key,
        scripts: scripts.entries.map((entry) => entry.payload),
        macros: macros.entries.map((entry) => entry.payload),
      });
      setError(null);
    } catch (failure) {
      if (
        !live.current ||
        latest.current.key !== capturedKey ||
        request !== sequence.current
      )
        return;
      setLoaded(null);
      setError(automationLibraryDiagnostic(failure).message);
    }
  }, [capture]);
  useEffect(() => {
    const requestSequence = sequence;
    live.current = true;
    setLoaded(null);
    setError(null);
    if (available) void refresh();
    const handleStorageChange = (event: Event) => {
      const storeKey = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (
        available &&
        (storeKey === nativeManagedScriptsStore.key ||
          storeKey === TERMINAL_MACROS_STORE_KEY)
      )
        void refresh();
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, handleStorageChange);
    return () => {
      live.current = false;
      requestSequence.current++;
      window.removeEventListener(
        APP_DATA_STORE_CHANGED_EVENT,
        handleStorageChange,
      );
    };
  }, [key, available, refresh]);

  const captureMacroSave = useCallback(() => {
    // Capture app access at recording start. Database switches do not change
    // the destination; an app lock or settings reset invalidates this save.
    const owner = capture();
    return async (macro: TerminalMacro) => {
      owner.assertCurrent();
      const [recording] = validateTerminalMacros([macro]);
      const current = await owner.api.read({ kind: "app" }, "terminal-macro");
      owner.assertCurrent();
      if (current.entries.some((entry) => entry.payload.id === recording.id))
        throw new Error(
          "A macro with this identity already exists; existing data was retained.",
        );
      await owner.api.apply(current, [
        {
          operation: "put",
          entry: { family: "terminal-macro", payload: recording },
        },
      ]);
      owner.assertCurrent();
      await refresh();
    };
  }, [capture, refresh]);

  const reviewScript = useCallback(
    (script: ManagedScript) => {
      const owner = capture();
      const reviewed = JSON.stringify(script);
      return async () => {
        owner.assertCurrent();
        const library = await owner.api.read(
          { kind: "app" },
          "terminal-script",
        );
        owner.assertCurrent();
        if (
          !library.entries.some(
            (entry) => JSON.stringify(entry.payload) === reviewed,
          )
        )
          throw new Error(
            "The saved script changed. Reload the app-wide library before running it.",
          );
      };
    },
    [capture],
  );
  const reviewMacro = useCallback(
    (macro: TerminalMacro) => {
      const owner = capture();
      const reviewed = JSON.stringify(macro);
      return async () => {
        owner.assertCurrent();
        const library = await owner.api.read({ kind: "app" }, "terminal-macro");
        owner.assertCurrent();
        if (
          !library.entries.some(
            (entry) => JSON.stringify(entry.payload) === reviewed,
          )
        )
          throw new Error(
            "The saved macro changed. Reload the app-wide library before replaying it.",
          );
      };
    },
    [capture],
  );
  const library = available && loaded?.key === key ? loaded : null;
  return {
    available,
    error: available
      ? error
      : (bridge.diagnostic?.message ??
        "Wait for the app-wide terminal library to become available."),
    scripts: library?.scripts ?? [],
    macros: library?.macros ?? [],
    refresh,
    captureMacroSave,
    reviewScript,
    reviewMacro,
  };
}
