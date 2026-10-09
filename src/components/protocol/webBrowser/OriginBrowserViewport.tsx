"use client";

import React, { useLayoutEffect, useRef } from "react";
import {
  AlertTriangle,
  LoaderCircle,
  RotateCw,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import type { OriginBrowserController } from "../../../hooks/protocol/useOriginBrowser";
import type { SettingsTabId } from "../../SettingsDialog/settingsConstants";
import { originBrowserBounds } from "../../../types/protocols/originBrowser";
import { getOriginBrowserFailureDetails } from "../../../hooks/protocol/originBrowserFailureDetails";

export interface OriginBrowserViewportProps {
  controller: OriginBrowserController;
  active: boolean;
  ownerAvailable: boolean;
  dialogOpen: boolean;
  preserveRenderingUnderOverlays?: boolean;
  title: string;
  showLoadingProgress?: boolean;
  /** Shell-selected native view; a popup need not share the root's load state. */
  loading?: boolean;
  /** Shell settings and target must be ready before a new attempt is requested. */
  retryAllowed?: boolean;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  /** Shell-owned recovery actions; keep confirmation portals mounted on overlays. */
  errorActions?: React.ReactNode;
  /** Detailed failure presentation supplied by the owning browser shell. */
  errorDetails?: React.ReactNode;
  className?: string;
}

/** Layout anchor for a native child. Remote content never enters the app DOM. */
export function OriginBrowserViewport({
  controller,
  active,
  ownerAvailable,
  dialogOpen,
  preserveRenderingUnderOverlays = false,
  title,
  showLoadingProgress = true,
  loading,
  retryAllowed = true,
  onOpenSettings,
  errorActions,
  errorDetails,
  className,
}: OriginBrowserViewportProps) {
  const element = useRef<HTMLDivElement>(null);
  const { setViewport, focus, close, state } = controller;
  const unavailableDetail =
    state.phase === "unavailable"
      ? getOriginBrowserFailureDetails(state)[0]
      : undefined;
  const certificatePolicyBlocked =
    state.phase === "error" &&
    (state.startupFailure?.category === "certificate-policy" ||
      state.startupFailure?.category === "certificate-bridge") &&
    state.startupFailure.stage === "create";
  const interactive =
    active &&
    ownerAvailable &&
    !dialogOpen &&
    state.phase === "attached" &&
    !state.error;
  const hiddenForOverlay = dialogOpen && !preserveRenderingUnderOverlays;
  const measureRef = useRef<(() => void) | null>(null);
  const retryable =
    state.phase === "error" ||
    (state.phase === "unavailable" &&
      state.unavailableReason === "host-unavailable");
  const canRetry =
    retryable && retryAllowed && active && ownerAvailable && !dialogOpen;
  const retryAction = retryable && (
    <button
      type="button"
      className="sor-btn sor-btn-primary"
      data-tooltip="Start a new browser attempt using the current settings"
      disabled={!canRetry}
      onClick={() => {
        if (canRetry) controller.reconnect();
      }}
    >
      <RotateCw size={16} aria-hidden="true" />
      Retry browser
    </button>
  );
  const settingsAction = onOpenSettings && (
    <button
      type="button"
      className="sor-btn sor-btn-secondary"
      data-tooltip="Review the browser engine and shared browser settings"
      disabled={!active || dialogOpen}
      onClick={() => {
        if (active && !dialogOpen) onOpenSettings("webBrowser");
      }}
    >
      <Settings2 size={16} aria-hidden="true" />
      Open Web Browser settings
    </button>
  );

  useLayoutEffect(
    () => () => {
      void close();
    },
    [close],
  );

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      if (
        !active ||
        !ownerAvailable ||
        hiddenForOverlay ||
        document.visibilityState === "hidden"
      ) {
        setViewport(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      const x = Math.max(0, rect.left);
      const y = Math.max(0, rect.top);
      // Intersect the shell content area in CSS/logical pixels. Native owns DPI.
      setViewport(
        originBrowserBounds({
          x,
          y,
          width: Math.min(window.innerWidth, rect.right) - x,
          height: Math.min(window.innerHeight, rect.bottom) - y,
        }),
      );
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("visibilitychange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      measureRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("visibilitychange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      setViewport(null);
    };
  }, [active, ownerAvailable, hiddenForOverlay, setViewport]);

  // Sibling layout can move this slot without changing its own dimensions.
  useLayoutEffect(() => {
    measureRef.current?.();
  });

  return (
    <div
      ref={element}
      className={`relative flex-1 min-h-0 min-w-0 overflow-hidden bg-[var(--color-background)] text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${className ?? ""}`}
      role="region"
      aria-label={title}
      aria-hidden={
        !active ||
        dialogOpen ||
        (!ownerAvailable &&
          state.phase !== "unavailable" &&
          state.phase !== "error" &&
          !state.error)
      }
      aria-busy={
        loading ??
        (state.phase === "starting" ||
          (state.phase === "attached" && state.snapshot?.loading === true))
      }
      tabIndex={interactive ? 0 : -1}
      onFocus={(event) => {
        if (interactive && event.currentTarget.contains(event.target))
          void focus();
      }}
      onPointerDown={(event) => {
        if (interactive && event.currentTarget.contains(event.target as Node))
          void focus();
      }}
      data-origin-browser-viewport=""
    >
      {showLoadingProgress && state.phase === "starting" && (
        <p
          role="status"
          className="m-4 flex items-center gap-2 text-sm text-[var(--color-textSecondary)]"
        >
          <LoaderCircle
            size={16}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none text-primary"
          />
          Starting native browser…
        </p>
      )}
      {(state.phase === "error" ||
        state.error ||
        state.phase === "unavailable") && (
        <div
          data-native-browser-occlusion=""
          className="absolute inset-0 min-h-0 overflow-y-auto bg-[var(--color-background)]"
        >
          {state.phase === "unavailable" ? (
            <div
              role="status"
              className="sor-alert-warning m-4 space-y-3 text-sm leading-relaxed text-[var(--color-text)]"
            >
              <p>
                <AlertTriangle
                  size={16}
                  aria-hidden="true"
                  className="inline-block mr-2 text-warning"
                />
                Experimental native browser unavailable.{" "}
                {unavailableDetail?.problem}
              </p>
              <p>{unavailableDetail?.nextStep}</p>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Failure code: <code>{unavailableDetail?.code}</code>
                {
                  " · No settings were changed and no automatic fallback was used."
                }
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {errorActions}
                {retryAction}
                {!errorActions && settingsAction}
              </div>
            </div>
          ) : certificatePolicyBlocked ? (
            <div
              role="alert"
              className="sor-alert-warning m-4 flex items-start gap-3 text-sm leading-relaxed text-[var(--color-text)]"
            >
              <ShieldAlert
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
              <div className="min-w-0 space-y-2 break-words">
                <h3 className="font-medium">
                  {state.startupFailure?.category === "certificate-bridge"
                    ? "Certificate verifier runtime required"
                    : "HTTPS trust policy not supported"}
                </h3>
                <p>
                  {state.startupFailure?.category === "certificate-bridge"
                    ? "This CEF runtime is missing the app's certificate-verifier bridge. Install or rebuild the patched browser runtime so the saved database trust policy can be enforced."
                    : "The native runtime cannot enforce this connection's saved HTTPS trust policy. Review its certificate trust configuration and the installed browser runtime."}
                </p>
                <p className="text-[var(--color-textSecondary)]">
                  Your existing trust policy is unchanged, including any
                  inherited global trust policy. No settings were changed and no
                  fallback was used.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {retryAction}
                  {errorActions}
                  {!errorActions && settingsAction}
                </div>
              </div>
            </div>
          ) : (
            (state.phase === "error" || state.error) && (
              <div
                role="alert"
                className="sor-alert-error m-4 space-y-2 text-sm text-[var(--color-text)]"
              >
                <p>{state.error || "Native browser session failed."}</p>
                {retryable && (
                  <p className="text-[var(--color-textSecondary)]">
                    Retry starts a new browser attempt using the current
                    connection settings.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {retryAction}
                  {errorActions}
                  {!errorActions && settingsAction}
                </div>
              </div>
            )
          )}
          {errorDetails && (
            <div className="mx-4 mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]">
              {errorDetails}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OriginBrowserViewport;
