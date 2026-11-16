import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../../contexts/SettingsContext";
import type { ConnectionSession } from "../../types/connection/connection";
import type { QuickActionReference } from "../../types/connection/sessionQuickActions";
import {
  normalizeSessionQuickActions,
  quickActionReferenceKey as keyOf,
} from "../../utils/connection/sessionQuickActions";
import {
  loadSerialFavorites,
  SERIAL_QUICK_CONNECT_BUCKET,
  toggleSerialFavorite,
  reorderSerialFavorites,
} from "../../utils/serial/serialFavorites";
import {
  playSerialSteps,
  serialMacroSteps,
  serialPlaybackPreview,
  serialScriptSteps,
  SERIAL_DEFAULT_LINE_DELAY_MS,
  type SerialPlaybackStep,
} from "../../utils/serial/serialScriptPlayback";
import { getQuickConnectConnection } from "../../utils/session/runtimeConnectionRegistry";
import { useTerminalAppLibrary } from "../recording/useTerminalAppLibrary";

export interface SerialQuickActionItem extends QuickActionReference {
  name: string;
  description: string;
  missing: boolean;
}

/** A run waiting for the operator to approve the exact text. */
export interface SerialPendingRun {
  item: SerialQuickActionItem;
  preview: string;
  lineCount: number;
}

interface Options {
  session: ConnectionSession;
  connected: boolean;
  /** Sends text; `\n` becomes the connection's configured line ending. */
  sendInput: (text: string) => Promise<void>;
}

/**
 * Favorite/bookmarked scripts and macros for a serial session. Library bodies
 * stay in the app-wide automation library; favorites are identifier-only.
 * Runs go through the same review flow as SSH: the exact text is shown for
 * approval (unless the user disabled confirmation in Settings) and the entry is
 * re-verified against the library immediately before anything is sent.
 */
export function useSerialQuickActions({
  session,
  connected,
  sendInput,
}: Options) {
  const { settings } = useSettings();
  const quick = normalizeSessionQuickActions(settings.sessionQuickActions);
  const enabled = quick.serialEnabled;
  const library = useTerminalAppLibrary(enabled && connected);
  const bucket = useMemo(
    () =>
      getQuickConnectConnection(session.connectionId)
        ? SERIAL_QUICK_CONNECT_BUCKET
        : session.connectionId,
    [session.connectionId],
  );
  const [references, setReferences] = useState<QuickActionReference[]>(() =>
    loadSerialFavorites(bucket),
  );
  useEffect(() => {
    setReferences(loadSerialFavorites(bucket));
  }, [bucket]);

  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    sent: number;
    total: number;
  } | null>(null);
  const [pending, setPending] = useState<
    | (SerialPendingRun & {
        steps: SerialPlaybackStep[];
        assertReviewed: () => Promise<void>;
      })
    | null
  >(null);
  const [lineDelayMs, setLineDelayMs] = useState(SERIAL_DEFAULT_LINE_DELAY_MS);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const sendRef = useRef(sendInput);
  sendRef.current = sendInput;

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const items = useMemo<SerialQuickActionItem[]>(
    () => [
      ...library.scripts.map((script) => ({
        kind: "script" as const,
        id: script.id,
        name: script.name,
        description: script.description,
        missing: false,
      })),
      ...library.macros.map((macro) => ({
        kind: "macro" as const,
        id: macro.id,
        name: macro.name,
        description: macro.description ?? "",
        missing: false,
      })),
    ],
    [library.scripts, library.macros],
  );

  const favorites = useMemo<SerialQuickActionItem[]>(() => {
    const byKey = new Map(items.map((item) => [keyOf(item), item]));
    return references.map(
      (reference) =>
        byKey.get(keyOf(reference)) ?? {
          ...reference,
          name: "Unavailable library entry",
          description: "The script or macro was removed or is unavailable.",
          missing: true,
        },
    );
  }, [items, references]);

  const isFavorite = useCallback(
    (reference: QuickActionReference) =>
      references.some((item) => keyOf(item) === keyOf(reference)),
    [references],
  );

  const toggleFavorite = useCallback(
    (reference: QuickActionReference) => {
      try {
        setReferences(toggleSerialFavorite(bucket, reference));
        setError(null);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Favorite not saved.",
        );
      }
    },
    [bucket],
  );

  const reorderFavorites = useCallback(
    (orderedKeys: readonly string[]) => {
      try {
        setReferences(reorderSerialFavorites(bucket, orderedKeys));
        setError(null);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Order not saved.",
        );
      }
    },
    [bucket],
  );

  const execute = useCallback(
    async (
      item: SerialQuickActionItem,
      steps: SerialPlaybackStep[],
      assertReviewed: () => Promise<void>,
    ) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // Re-verify the library entry right before the first byte is sent.
        await assertReviewed();
        setProgress({ sent: 0, total: steps.length });
        const result = await playSerialSteps(
          steps,
          (text) => sendRef.current(text),
          controller.signal,
          (sent, total) => setProgress({ sent, total }),
        );
        if (result.aborted) {
          setError(`Stopped after ${result.sent} of ${result.total} steps.`);
        }
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : `Could not run "${item.name}".`,
        );
      } finally {
        abortRef.current = null;
        runningRef.current = false;
        setRunning(false);
        setProgress(null);
      }
    },
    [],
  );

  const run = useCallback(
    async (reference: QuickActionReference) => {
      if (!enabled) {
        setError("Serial quick actions are disabled in Settings.");
        return;
      }
      if (!connected) {
        setError("Serial is not connected.");
        return;
      }
      if (runningRef.current || pending) return;
      setError(null);
      try {
        // Always the latest saved entry, so an edit applies immediately.
        const entry = await library.readEntry(reference.kind, reference.id);
        if (!entry) {
          throw new Error(
            "This library entry was removed or is unavailable. No substitute was used.",
          );
        }
        const reviewed = structuredClone(entry);
        // Capture the review against the exact reviewed copy.
        const assertReviewed =
          reference.kind === "script"
            ? library.reviewScript(
                reviewed as Parameters<typeof library.reviewScript>[0],
              )
            : library.reviewMacro(
                reviewed as Parameters<typeof library.reviewMacro>[0],
              );
        const steps =
          reference.kind === "script"
            ? serialScriptSteps(
                reviewed as Parameters<typeof serialScriptSteps>[0],
                lineDelayMs,
              )
            : serialMacroSteps(
                reviewed as Parameters<typeof serialMacroSteps>[0],
              );
        if (steps.length === 0) throw new Error("Nothing to send.");
        const item: SerialQuickActionItem = {
          kind: reference.kind,
          id: reference.id,
          name: entry.name,
          description: entry.description ?? "",
          missing: false,
        };
        if (quick.confirmBeforeScriptRun) {
          setPending({
            item,
            preview: serialPlaybackPreview(steps),
            lineCount: steps.length,
            // Approval runs the reviewed copy, re-verified before sending.
            steps,
            assertReviewed,
          });
          return;
        }
        await execute(item, steps, assertReviewed);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Action could not be run.",
        );
      }
    },
    [connected, enabled, execute, library, lineDelayMs, pending, quick],
  );

  const approve = useCallback(async () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    await execute(current.item, current.steps, current.assertReviewed);
  }, [execute, pending]);

  const cancel = useCallback(() => {
    setPending(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    enabled,
    available: library.available,
    libraryError: library.error,
    refresh: library.refresh,
    items,
    favorites,
    isFavorite,
    toggleFavorite,
    reorderFavorites,
    run,
    abort,
    running,
    progress,
    pending: pending
      ? {
          item: pending.item,
          preview: pending.preview,
          lineCount: pending.lineCount,
        }
      : null,
    approve,
    cancel,
    lineDelayMs,
    setLineDelayMs,
    error,
    canRun: enabled && connected && !running && !pending,
  };
}
