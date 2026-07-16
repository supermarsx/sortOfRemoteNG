"use client";

import { Clipboard, Monitor, ShieldAlert, StopCircle } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ardKeysymForKey } from "../../hooks/protocol/ardRuntime";
import { useArdClient } from "../../hooks/protocol/useArdClient";
import type { ConnectionSession } from "../../types/connection/connection";

const pointerCoordinates = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) => {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  return {
    x: Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.round(((clientX - bounds.left) / width) * canvas.width),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.round(((clientY - bounds.top) / height) * canvas.height),
      ),
    ),
  };
};

export const ArdClient: React.FC<{ session: ConnectionSession }> = ({
  session,
}) => {
  const model = useArdClient(session);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const connected = model.status === "connected";
  const nativeHandoff = model.status === "nativeHandoff";

  useEffect(
    () => () => {
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
      }
    },
    [],
  );

  const sendPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!connected || model.settings.viewOnly) return;
    pendingPointerRef.current = pointerCoordinates(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const point = pendingPointerRef.current;
      pendingPointerRef.current = null;
      if (point) void model.sendInput({ type: "mouseMove", ...point });
    });
  };

  const sendPointerButton = (
    event: React.PointerEvent<HTMLCanvasElement>,
    pressed: boolean,
  ) => {
    if (!connected || model.settings.viewOnly) return;
    const point = pointerCoordinates(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    void model.sendInput({
      type: "mouseButton",
      button: Math.min(event.button, 2),
      pressed,
      ...point,
    });
  };

  const sendKey = (
    event: React.KeyboardEvent<HTMLCanvasElement>,
    pressed: boolean,
  ) => {
    if (!connected || model.settings.viewOnly) return;
    const keysym = ardKeysymForKey(event.key);
    if (keysym === null) return;
    event.preventDefault();
    void model.sendInput({ type: "keyboardKey", keysym, pressed });
  };

  const sendLocalClipboard = async () => {
    try {
      setActionError(null);
      const text = await navigator.clipboard.readText();
      await model.setClipboard(text);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const openNativeScreenSharing = async () => {
    try {
      setActionError(null);
      await model.launchNativeScreenSharing();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`Apple Remote Desktop session to ${session.hostname}`}
      data-testid="ard-client"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <Monitor size={15} aria-hidden />
        <span className="font-medium">Apple Remote Desktop</span>
        <span
          className="rounded-full border border-[var(--color-border)] px-2 py-1 uppercase"
          role="status"
          aria-live="polite"
        >
          {model.status.replace(/([A-Z])/g, " $1")}
        </span>
        {model.desktopWidth > 0 ? (
          <span className="text-[var(--color-textMuted)]">
            {model.desktopWidth} × {model.desktopHeight}
          </span>
        ) : null}
        {model.stats ? (
          <span className="text-[var(--color-textMuted)]">
            {model.stats.framesDecoded} frames · {model.stats.bytesReceived} B
            in
          </span>
        ) : null}
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-50"
          disabled={!connected}
          onClick={() => void sendLocalClipboard()}
        >
          <Clipboard size={13} aria-hidden /> Send local clipboard
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error disabled:opacity-50"
          disabled={!model.backendSessionId}
          onClick={() => void model.disconnect()}
        >
          <StopCircle size={13} aria-hidden /> Disconnect
        </button>
      </header>

      {(model.error || actionError) && (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {actionError || model.error}
        </div>
      )}

      {model.message && (
        <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
          {model.message}
        </div>
      )}

      {nativeHandoff || model.settings.authMode === "appleAccountNative" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
            <ShieldAlert
              className="mx-auto mb-4 text-[var(--color-warning)]"
              size={36}
            />
            <h2 className="mb-2 text-base font-semibold">
              Apple Account Screen Sharing
            </h2>
            <p className="mb-4 text-sm text-[var(--color-textSecondary)]">
              Apple Account identity is handled only by Apple&apos;s Screen
              Sharing app on macOS. SortOfRemoteNG neither asks for nor forwards
              your Apple Account password as an ARD credential.
            </p>
            <button
              type="button"
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => void openNativeScreenSharing()}
            >
              Open Apple Screen Sharing
            </button>
            {model.capabilities &&
            !model.capabilities.appleAccountNative.available ? (
              <p className="mt-3 text-xs text-[var(--color-warning)]">
                {model.capabilities.appleAccountNative.reason}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-black p-2">
          <canvas
            ref={model.canvasRef}
            className="mx-auto block max-h-full max-w-full bg-black outline-none"
            width={1024}
            height={768}
            role="application"
            aria-label="Apple Remote Desktop framebuffer"
            tabIndex={0}
            onContextMenu={(event) => event.preventDefault()}
            onPointerMove={sendPointerMove}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              sendPointerButton(event, true);
            }}
            onPointerUp={(event) => sendPointerButton(event, false)}
            onKeyDown={(event) => sendKey(event, true)}
            onKeyUp={(event) => sendKey(event, false)}
            onWheel={(event) => {
              if (!connected || model.settings.viewOnly) return;
              event.preventDefault();
              const point = pointerCoordinates(
                event.currentTarget,
                event.clientX,
                event.clientY,
              );
              void model.sendInput({
                type: "scroll",
                dx: Math.sign(event.deltaX),
                dy: Math.sign(event.deltaY),
                ...point,
              });
            }}
          />
        </div>
      )}

      <footer className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-textMuted)]">
        Embedded ARD uses direct TCP only. macOS-account mode is RFB security
        type 30; VNC-password mode uses the dedicated Screen Sharing VNC
        password.
        {model.settings.viewOnly ? " View-only input blocking is active." : ""}
      </footer>
    </section>
  );
};

export default ArdClient;
