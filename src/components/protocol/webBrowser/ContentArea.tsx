import type { SectionProps } from "./types";
import { ErrorPage } from "./ERROR_BASE";
import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import progressStyles from "./NavigationProgress.module.css";

const ContentArea: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex-1 relative" aria-busy={mgr.isLoading}>
    {/* Proxy-dead banner */}
    {!mgr.proxyAlive && !mgr.isLoading && !mgr.loadError && (
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

    {/* Keep the iframe mounted while the recovery screen is visible. Retry and
        Back clear the error and navigate synchronously; unmounting here made
        iframeRef null for that navigation, so the replacement frame reopened
        at about:blank instead of the requested page. */}
    <iframe
      ref={mgr.attachIframe ?? mgr.iframeRef}
      src="about:blank"
      className={`h-full w-full border-0 ${
        mgr.loadError ? "invisible pointer-events-none" : ""
      }`}
      aria-hidden={mgr.loadError ? true : undefined}
      inert={
        !!mgr.pageInteractionBlocked || !!mgr.trustPrompt || !!mgr.loadError
      }
      tabIndex={
        mgr.pageInteractionBlocked || mgr.trustPrompt || mgr.loadError
          ? -1
          : undefined
      }
      title={mgr.session.name}
      onLoad={mgr.handleIframeLoad}
      // Cookie-backed managed UIs require same-origin behavior. The proxy
      // origin is deliberately excluded from Tauri capabilities, while
      // popups and downloads stay blocked until mediated handlers exist.
      sandbox="allow-same-origin allow-scripts allow-forms"
    />
    {mgr.loadError && (
      <div className="absolute inset-0 z-20">
        <ErrorPage mgr={mgr} />
      </div>
    )}
  </div>
);

export default ContentArea;
