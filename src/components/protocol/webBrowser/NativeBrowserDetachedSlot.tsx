"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowLeft, ArrowRight, RotateCw, Undo2, X } from "lucide-react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { ConnectionSession } from "../../../types/connection/connection";
import { originBrowserBounds } from "../../../types/protocols/originBrowser";
import { useOriginBrowserOverlays } from "../../../hooks/protocol/useOriginBrowserOverlays";
import {
  NATIVE_DISPLAY_COMMAND_EVENT,
  NATIVE_DISPLAY_SLOT_EVENT,
  NATIVE_DISPLAY_STATE_EVENT,
  parseDisplayState,
  type NativeDisplayAction,
  type NativeDisplayState,
} from "../../../utils/session/nativeBrowserDisplay";

/** Re-sent while idle so a report is never lost to a listener that mounted late. */
const HEARTBEAT_MS = 2_000;

/**
 * Detached-window side of a display-only reparent. It renders no remote
 * content and holds no authority: only a slot (bounds + overlay rectangles) the
 * `main` window draws the live page into, and a thin toolbar whose actions are
 * relayed to `main`'s browser controller.
 */
export function NativeBrowserDetachedSlot({
  session,
}: {
  session: ConnectionSession;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const overlays = useOriginBrowserOverlays(true);
  const [state, setState] = useState<NativeDisplayState | null>(null);
  const [address, setAddress] = useState("");
  const editing = useRef(false);
  const lastReport = useRef<{ key: string; payload: unknown } | null>(null);

  const report = useCallback(() => {
    const node = slot.current;
    let bounds = null;
    if (node && document.visibilityState !== "hidden") {
      const rect = node.getBoundingClientRect();
      const x = Math.max(0, rect.left);
      const y = Math.max(0, rect.top);
      bounds = originBrowserBounds({
        x,
        y,
        width: Math.min(window.innerWidth, rect.right) - x,
        height: Math.min(window.innerHeight, rect.bottom) - y,
      });
    }
    const payload = {
      sessionId: session.id,
      bounds,
      rectangles: overlays.rectangles,
      blocked: overlays.blocked,
    };
    const key = JSON.stringify(payload);
    lastReport.current = { key, payload };
    void emitTo("main", NATIVE_DISPLAY_SLOT_EVENT, payload).catch(
      () => undefined,
    );
  }, [overlays.blocked, overlays.rectangles, session.id]);
  const reportRef = useRef(report);
  reportRef.current = report;

  // Geometry: the slot's CSS-pixel box in this window; main/native apply this
  // window's DPI scale. Re-measured on any layout or visibility change.
  useLayoutEffect(() => {
    const node = slot.current;
    if (!node) return;
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        reportRef.current();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    const heartbeat = setInterval(() => reportRef.current(), HEARTBEAT_MS);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      clearInterval(heartbeat);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);
  // Overlay changes (menus, dialogs here) re-report immediately.
  useEffect(() => {
    report();
  }, [report]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(NATIVE_DISPLAY_STATE_EVENT, (event) => {
      const next = parseDisplayState(session.id, event.payload);
      if (next) setState(next);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [session.id]);

  useEffect(() => {
    if (state && !editing.current) setAddress(state.url);
  }, [state]);

  const send = (action: NativeDisplayAction) =>
    void emitTo("main", NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: session.id,
      action,
    }).catch(() => undefined);

  const attached = state?.phase === "attached";
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2 py-1"
        role="toolbar"
        aria-label="Browser controls"
      >
        <button
          type="button"
          className="sor-btn sor-btn-ghost"
          aria-label="Back"
          disabled={!attached || !state?.canGoBack}
          onClick={() => send({ kind: "back" })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-ghost"
          aria-label="Forward"
          disabled={!attached || !state?.canGoForward}
          onClick={() => send({ kind: "forward" })}
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        {state?.loading ? (
          <button
            type="button"
            className="sor-btn sor-btn-ghost"
            aria-label="Stop"
            onClick={() => send({ kind: "stop" })}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="sor-btn sor-btn-ghost"
            aria-label="Reload"
            disabled={!attached}
            onClick={() => send({ kind: "reload" })}
          >
            <RotateCw size={16} aria-hidden="true" />
          </button>
        )}
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const url = address.trim();
            if (url && attached) send({ kind: "navigate", url });
            editing.current = false;
          }}
        >
          <input
            className="sor-form-input w-full text-sm"
            aria-label="Address"
            value={address}
            disabled={!attached}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          data-tooltip="Show this page in the main window again"
          onClick={() => send({ kind: "release" })}
        >
          <Undo2 size={16} aria-hidden="true" />
          Return to main window
        </button>
      </div>
      <div
        ref={slot}
        role="region"
        aria-label={state?.title || session.name}
        aria-busy={state?.loading === true}
        data-native-display-slot={session.id}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden text-sm text-[var(--color-textSecondary)]"
      >
        {!attached && (
          <p role="status" className="p-3">
            Showing this page from the main window...
          </p>
        )}
      </div>
    </div>
  );
}
