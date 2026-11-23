import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import {
  NATIVE_DISPLAY_COMMAND_EVENT,
  NATIVE_DISPLAY_FAILED_MESSAGE,
  NATIVE_DISPLAY_NEEDS_MAIN_MESSAGE,
  NATIVE_DISPLAY_RETURNED_EVENT,
  NATIVE_DISPLAY_SLOT_EVENT,
  NATIVE_DISPLAY_SLOT_TIMEOUT_MS,
  NATIVE_DISPLAY_STATE_EVENT,
  nativeDisplayStore,
  nativeDisplayTransport,
  parseDisplayAction,
  parseSlotReport,
  useNativeDisplayEntry,
  type NativeDisplayState,
} from "../../utils/session/nativeBrowserDisplay";

export interface NativeBrowserDisplayHostOptions {
  sessionId: string;
  identity: OriginBrowserIdentity | null;
  /** The native page is attached and may be moved. */
  attached: boolean;
  /** A prompt or failure only the main window can show. */
  needsOwnerWindow: boolean;
  /** Mirrored to the display window's toolbar. */
  state: NativeDisplayState;
  actions: {
    navigate(url: string): unknown;
    back(): unknown;
    forward(): unknown;
    reload(): unknown;
    stop(): unknown;
  };
  /** Put the session's tab back in the main window (idempotent). */
  restoreSession(): void;
  /** A floating popup notice; never an in-page bar. */
  notify(message: string): void;
}

const RETURN_MESSAGES: Record<string, string | null> = {
  // The user closed the detached window: the page is simply back.
  "target-closed": null,
  "claim-timed-out": NATIVE_DISPLAY_FAILED_MESSAGE,
  "return-failed":
    "The page could not return to the main window and was closed.",
};

/**
 * Main-window side of a display-only reparent. The page and its authority stay
 * in this window; this hook only moves the native child under the detached
 * window once that window reports a slot, then keeps the two in step.
 */
export function useNativeBrowserDisplayHost(
  options: NativeBrowserDisplayHostOptions,
): void {
  const { sessionId } = options;
  const entry = useNativeDisplayEntry(sessionId);
  const latest = useRef(options);
  latest.current = options;
  const active = entry !== undefined;
  const target = entry?.target;
  const phase = entry?.phase;
  const hasSlot = !!entry?.slot?.bounds;
  const busy = useRef(false);

  const closeDisplayWindow = (label: string) => {
    void WebviewWindow.getByLabel(label)
      .then((window) => window?.destroy())
      .catch(() => undefined);
  };

  /** Single exit: the page is back (or gone) and the viewer returns to main. */
  const finish = (message: string | null, closeTarget: boolean) => {
    const current = nativeDisplayStore.get(sessionId);
    nativeDisplayStore.clear(sessionId);
    busy.current = false;
    latest.current.restoreSession();
    if (message) latest.current.notify(message);
    if (current && closeTarget) closeDisplayWindow(current.target);
  };

  const release = async (message: string | null) => {
    const { identity } = latest.current;
    if (!nativeDisplayStore.get(sessionId)) return;
    nativeDisplayStore.update(sessionId, { phase: "returning" });
    if (identity) {
      try {
        await nativeDisplayTransport().release(identity);
      } catch {
        // Native returns the page itself when the window closes; the viewer
        // still goes back to main, where a lost page shows its own failure.
      }
    }
    finish(message, true);
  };

  // Events from the display window and from native.
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (promise: Promise<() => void>) =>
      promise
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => undefined);
    track(
      listen<unknown>(NATIVE_DISPLAY_SLOT_EVENT, (event) => {
        const slot = parseSlotReport(sessionId, event.payload);
        if (slot) nativeDisplayStore.update(sessionId, { slot });
      }),
    );
    track(
      listen<unknown>(NATIVE_DISPLAY_COMMAND_EVENT, (event) => {
        const action = parseDisplayAction(sessionId, event.payload);
        if (!action || nativeDisplayStore.get(sessionId)?.phase !== "claimed")
          return;
        const { actions } = latest.current;
        switch (action.kind) {
          case "navigate":
            void actions.navigate(action.url);
            break;
          case "back":
            void actions.back();
            break;
          case "forward":
            void actions.forward();
            break;
          case "reload":
            void actions.reload();
            break;
          case "stop":
            void actions.stop();
            break;
          case "release":
            void release(null);
            break;
        }
      }),
    );
    track(
      listen<{ sessionId?: unknown; kind?: unknown; reason?: unknown }>(
        NATIVE_DISPLAY_RETURNED_EVENT,
        (event) => {
          if (event.payload?.sessionId !== sessionId) return;
          const reason =
            typeof event.payload.reason === "string"
              ? event.payload.reason
              : null;
          const message = !reason
            ? null
            : reason in RETURN_MESSAGES
              ? RETURN_MESSAGES[reason]
              : NATIVE_DISPLAY_FAILED_MESSAGE;
          // Native already returned (or closed) the page.
          finish(message, event.payload.kind !== "returned");
        },
      ),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
    // `release` and `finish` read only refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId]);

  // The display window never opened: keep the page where it is.
  useEffect(() => {
    if (phase !== "requested") return;
    const timer = setTimeout(
      () => finish(NATIVE_DISPLAY_FAILED_MESSAGE, true),
      NATIVE_DISPLAY_SLOT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId]);

  // Move once the display window reports a slot, then claim it.
  useEffect(() => {
    const { identity, attached } = latest.current;
    if (phase !== "requested" || !hasSlot || !target || busy.current) return;
    if (!identity || !attached) return;
    busy.current = true;
    nativeDisplayStore.update(sessionId, { phase: "moving" });
    const transport = nativeDisplayTransport();
    void (async () => {
      let moved = false;
      try {
        await transport.move(identity, target);
        moved = true;
        nativeDisplayStore.update(sessionId, { phase: "waiting" });
        await transport.claim(identity, target);
        if (nativeDisplayStore.get(sessionId)) {
          nativeDisplayStore.update(sessionId, { phase: "claimed" });
        }
        busy.current = false;
      } catch {
        if (moved) {
          try {
            await transport.release(identity);
          } catch {
            // Native's own deadline returns an unclaimed page.
          }
        }
        finish(NATIVE_DISPLAY_FAILED_MESSAGE, true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasSlot, target, sessionId, options.identity, options.attached]);

  // A prompt or failure that only this window can show: take the page back.
  useEffect(() => {
    if (phase === "claimed" && options.needsOwnerWindow) {
      void release(NATIVE_DISPLAY_NEEDS_MAIN_MESSAGE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, options.needsOwnerWindow]);

  // Mirror page state to the display window's toolbar.
  const { state } = options;
  useEffect(() => {
    if (!target || phase === undefined) return;
    void emitTo(target, NATIVE_DISPLAY_STATE_EVENT, { sessionId, state }).catch(
      () => undefined,
    );
  }, [target, phase, sessionId, state]);
}
