import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";

const ContentArea: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex-1 relative">
    {/* Proxy-dead banner */}
    {mgr.hasAuth && !mgr.proxyAlive && !mgr.isLoading && !mgr.loadError && (
      <div className="absolute top-0 inset-x-0 z-20 bg-red-900/90 border-b border-red-700 px-4 py-2 flex items-center justify-between text-xs text-red-200">
        <div className="flex items-center gap-2">
          <WifiOff size={14} className="text-red-400" />
          <span>Internal proxy session died unexpectedly.</span>
        </div>
        <button
          onClick={mgr.handleRestartProxy}
          disabled={mgr.proxyRestarting}
          className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-[var(--color-text)] transition-colors disabled:opacity-50"
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-[var(--color-textSecondary)] mb-2">
            Loading {mgr.currentUrl}...
          </p>
          <p className="text-[var(--color-textMuted)] text-xs">
            Taking too long?{" "}
            <button
              onClick={mgr.handleCancelLoading}
              className="text-blue-500 hover:text-blue-400 underline"
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
