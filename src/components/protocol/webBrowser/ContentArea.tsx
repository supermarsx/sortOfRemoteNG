import type { SectionProps } from "./types";
import { ErrorPage } from "./ERROR_BASE";
import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import progressStyles from "./NavigationProgress.module.css";
import { EMPTY_WEB_FRAME_SANDBOX } from "../../../utils/protocol/webBrowserFrame";
import RedirectReviewPanel from "./RedirectReviewPanel";
import TrustCheckStatus from "./TrustCheckStatus";

const ContentArea: React.FC<SectionProps> = ({ mgr }) => {
  const reviewing = !!(mgr.redirectReview?.review || mgr.redirectReview?.error);
  return (
    <div
      className="flex-1 min-h-0 relative"
      aria-busy={mgr.isLoading}
      style={
        mgr.websiteDarkBootstrap
          ? {
              backgroundColor: mgr.websiteDarkBootstrap.backgroundColor,
              color: mgr.websiteDarkBootstrap.textColor,
            }
          : undefined
      }
    >
      {/* Proxy-dead banner */}
      {!reviewing && !mgr.proxyAlive && !mgr.isLoading && !mgr.loadError && (
        <div className="absolute top-0 inset-x-0 z-20 bg-error/90 border-b border-error px-4 py-2 flex items-center justify-between text-xs text-error">
          <div className="flex items-center gap-2">
            <WifiOff size={14} className="text-error" />
            <span>Internal proxy session died unexpectedly.</span>
          </div>
          <button
            onClick={mgr.handleRestartProxy}
            disabled={mgr.proxyRestarting}
            className="flex items-center gap-1 px-3 py-1 bg-error hover:bg-error/90 rounded text-[var(--color-text)] transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={mgr.proxyRestarting ? "animate-spin" : ""}
            />
            {mgr.proxyRestarting ? "Restarting…" : "Reconnect proxy"}
          </button>
        </div>
      )}

      {mgr.isLoading &&
        mgr.showLoadingIndicator &&
        !mgr.trustPrompt &&
        !mgr.loadError && (
          <div
            className={progressStyles.track}
            data-testid="web-navigation-progress"
            role="progressbar"
            aria-label="Loading page"
            aria-valuetext="Waiting for the page to become ready"
          >
            <span className={progressStyles.segment} aria-hidden="true" />
          </div>
        )}

      {/* Keyed by attempt so a retried check counts from zero again. */}
      {mgr.trustCheck &&
        mgr.isLoading &&
        !mgr.trustPrompt &&
        !mgr.loadError &&
        !reviewing && (
          <TrustCheckStatus
            key={mgr.trustCheck.startedAt}
            trustCheck={mgr.trustCheck}
          />
        )}

      {/* No browsing context exists before a validated proxy navigation is ready.
        The controller retains pending navigation for attachIframe, so retry
        mounts and targets the replacement frame without an idle blank frame. */}
      {mgr.shouldMountIframe && (
        <iframe
          ref={mgr.attachIframe ?? mgr.iframeRef}
          src="about:blank"
          className={`h-full w-full border-0 ${
            mgr.loadError || reviewing ? "invisible pointer-events-none" : ""
          }`}
          aria-hidden={mgr.loadError || reviewing ? true : undefined}
          inert={
            reviewing ||
            !!mgr.pageInteractionBlocked ||
            !!mgr.trustPrompt ||
            !!mgr.loadError
          }
          tabIndex={
            reviewing ||
            mgr.pageInteractionBlocked ||
            mgr.trustPrompt ||
            mgr.loadError
              ? -1
              : undefined
          }
          title={mgr.session.name}
          style={
            mgr.websiteDarkBootstrap
              ? { backgroundColor: mgr.websiteDarkBootstrap.backgroundColor }
              : undefined
          }
          onLoad={mgr.handleIframeLoad}
          // Start with an opaque, fully sandboxed blank. attachIframe owns the
          // subsequent sandbox/src transition and only enables the existing
          // website flags for a validated, isolated proxy origin. React leaves
          // this unchanged initial prop alone on ordinary component rerenders.
          sandbox={EMPTY_WEB_FRAME_SANDBOX}
        />
      )}
      {mgr.redirectHandoffPending && !mgr.loadError && (
        <div
          className="absolute inset-0 z-10 bg-[var(--color-background)]"
          data-testid="web-redirect-handoff-shield"
          aria-label="Preparing redirected website"
          style={
            mgr.websiteDarkBootstrap
              ? { backgroundColor: mgr.websiteDarkBootstrap.backgroundColor }
              : undefined
          }
        />
      )}
      {reviewing && (
        <div className="absolute inset-0 z-20">
          <RedirectReviewPanel
            manager={mgr.redirectReview}
            onReload={mgr.handleRefresh}
          />
        </div>
      )}
      {mgr.loadError && !reviewing && (
        <div className="absolute inset-0 z-20">
          <ErrorPage mgr={mgr} />
        </div>
      )}
    </div>
  );
};

export default ContentArea;
