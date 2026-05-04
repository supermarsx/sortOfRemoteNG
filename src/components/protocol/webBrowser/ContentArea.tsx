import type { SectionProps } from "./types";
import { ErrorPage } from "./ERROR_BASE";
import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { LoadingElement } from "../../ui/display/loadingElement";

const ContentArea: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex-1 relative">
    {/* Proxy-dead banner */}
    {mgr.hasAuth && !mgr.proxyAlive && !mgr.isLoading && !mgr.loadError && (
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

    {mgr.isLoading && (
      <div className="absolute inset-0 bg-[var(--color-background)] flex items-center justify-center z-10">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <LoadingElement size={48} ariaLabel={`Loading ${mgr.currentUrl}`} />
          </div>
          <p className="text-[var(--color-textSecondary)] mb-2">
            Loading {mgr.currentUrl}...
          </p>
          <p className="text-[var(--color-textMuted)] text-xs">
            Taking too long?{" "}
            <button
              onClick={mgr.handleCancelLoading}
              className="text-primary hover:text-primary underline"
            >
              Cancel
            </button>
          </p>
        </div>
      </div>
    )}

    {mgr.loadError ? (
      <ErrorPage mgr={mgr} />
    ) : (
      <iframe
        ref={mgr.iframeRef}
        src="about:blank"
        className="w-full h-full border-0"
        title={mgr.session.name}
        onLoad={mgr.handleIframeLoad}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    )}
  </div>
);

export default ContentArea;
