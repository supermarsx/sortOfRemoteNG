import React from "react";
import { ExternalLink, Shield, ShieldAlert, AlertTriangle, ServerCrash, WifiOff, RefreshCw } from "lucide-react";

const ERROR_BASE =
  "flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors";
const ERROR_PRIMARY = `${ERROR_BASE} bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]`;
const ERROR_SECONDARY = `${ERROR_BASE} bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)]`;
const ERROR_WARNING = `${ERROR_BASE} bg-orange-600 hover:bg-orange-700 text-[var(--color-text)] disabled:opacity-50`;

const ErrorPage: React.FC<SectionProps> = ({ mgr }) => {
  const { loadError, session, handleRefresh, handleOpenExternal, hasAuth } =
    mgr;

  // Certificate / TLS error
  if (
    loadError.includes("certificate") ||
    loadError.includes("Certificate") ||
    loadError.includes("SSL") ||
    loadError.includes("CERT_") ||
    loadError.includes("self-signed") ||
    loadError.includes("trust provider")
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-orange-900/30 flex items-center justify-center mb-4">
          <ShieldAlert size={32} className="text-orange-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Certificate Error
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          The connection to{" "}
          <span className="text-yellow-400">{session.hostname}</span> failed
          because the server&apos;s SSL/TLS certificate is not trusted.
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            This usually means:
          </p>
          <ul className="sor-guidance-list sor-guidance-list-disc">
            <li>
              The server is using a{" "}
              <span className="text-orange-400">self-signed certificate</span>
            </li>
            <li>
              The certificate chain is incomplete or issued by an untrusted CA
            </li>
            <li>The certificate has expired or is not yet valid</li>
            <li>
              The hostname does not match the certificate&apos;s subject
            </li>
          </ul>
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mt-3 mb-2">
            To fix this:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>
              Edit this connection and{" "}
              <span className="text-blue-400">
                uncheck &quot;Verify SSL Certificate&quot;
              </span>{" "}
              to trust self-signed certs
            </li>
            <li>
              Or install the server&apos;s CA certificate into your system trust
              store
            </li>
          </ol>
        </div>
        <details className="mb-4 max-w-lg text-left">
          <summary className="text-xs text-[var(--color-textMuted)] cursor-pointer hover:text-[var(--color-textSecondary)]">
            Technical details
          </summary>
          <pre className="mt-2 text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3 whitespace-pre-wrap break-all">
            {loadError}
          </pre>
        </details>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Retry Connection</span>
          </button>
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Internal proxy failure
  if (
    loadError.includes("refused") ||
    loadError.includes("Upstream request failed") ||
    loadError.includes("proxy")
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4">
          <ServerCrash size={32} className="text-red-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Internal Proxy Error
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            Troubleshooting steps:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>
              Open the{" "}
              <span className="text-blue-400">Internal Proxy Manager</span>{" "}
              from the toolbar and check the proxy status
            </li>
            <li>
              Verify the target host{" "}
              <span className="text-yellow-400">{session.hostname}</span> is
              reachable on your network
            </li>
            <li>
              Check the proxy error log for detailed failure information
            </li>
            <li>Try restarting the proxy session via the manager</li>
          </ol>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Retry Connection</span>
          </button>
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Timeout error
  if (loadError.includes("timed out")) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
          <WifiOff size={32} className="text-yellow-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Connection Timed Out
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            Possible causes:
          </p>
          <ul className="sor-guidance-list sor-guidance-list-disc">
            <li>
              The server at{" "}
              <span className="text-yellow-400">{session.hostname}</span> is
              not responding
            </li>
            <li>A firewall is blocking the connection</li>
            <li>The hostname or port may be incorrect</li>
            <li>
              Network connectivity issues between you and the target
            </li>
            <li>The internal proxy session may have died</li>
          </ul>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={handleRefresh} className={ERROR_PRIMARY}>
            <RefreshCw size={14} /> <span>Try Again</span>
          </button>
          {hasAuth && (
            <button
              onClick={mgr.handleRestartProxy}
              disabled={mgr.proxyRestarting}
              className={ERROR_WARNING}
            >
              <RefreshCw
                size={14}
                className={mgr.proxyRestarting ? "animate-spin" : ""}
              />{" "}
              <span>
                {mgr.proxyRestarting ? "Restarting…" : "Reconnect Proxy"}
              </span>
            </button>
          )}
          <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
            <ExternalLink size={14} /> <span>Open Externally</span>
          </button>
        </div>
      </div>
    );
  }

  // Auth error
  if (loadError.includes("Authentication required")) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-blue-900/30 flex items-center justify-center mb-4">
          <Shield size={32} className="text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          Authentication Required
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
          {loadError}
        </p>
        <div className="sor-surface-card sor-web-error-panel text-left">
          <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
            To fix this:
          </p>
          <ol className="sor-guidance-list sor-guidance-list-decimal">
            <li>Edit this connection in the sidebar</li>
            <li>
              Set Authentication Type to{" "}
              <span className="text-blue-400">Basic Authentication</span>
            </li>
            <li>Enter the correct username and password</li>
            <li>Save and reconnect</li>
          </ol>
        </div>
        <button onClick={handleRefresh} className={ERROR_PRIMARY}>
          <RefreshCw size={14} /> <span>Try Again</span>
        </button>
      </div>
    );
  }

  // Generic error
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
        <AlertTriangle size={32} className="text-yellow-400" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
        Unable to Load Webpage
      </h3>
      <p className="text-[var(--color-textSecondary)] mb-4 max-w-lg text-sm">
        {loadError}
      </p>
      <div className="sor-surface-card sor-web-error-panel text-left">
        <p className="text-sm text-[var(--color-textSecondary)] font-medium mb-2">
          Common issues:
        </p>
        <ul className="sor-guidance-list sor-guidance-list-disc">
          <li>The website blocks embedding (X-Frame-Options)</li>
          <li>CORS restrictions prevent loading</li>
          <li>The server is not responding</li>
          <li>The internal proxy may have died unexpectedly</li>
          <li>Invalid URL or hostname</li>
        </ul>
      </div>
      <div className="flex items-center space-x-3">
        <button onClick={handleRefresh} className={ERROR_PRIMARY}>
          <RefreshCw size={14} /> <span>Try Again</span>
        </button>
        {hasAuth && (
          <button
            onClick={mgr.handleRestartProxy}
            disabled={mgr.proxyRestarting}
            className={ERROR_WARNING}
          >
            <RefreshCw
              size={14}
              className={mgr.proxyRestarting ? "animate-spin" : ""}
            />{" "}
            <span>
              {mgr.proxyRestarting ? "Restarting…" : "Reconnect Proxy"}
            </span>
          </button>
        )}
        <button onClick={handleOpenExternal} className={ERROR_SECONDARY}>
          <ExternalLink size={14} /> <span>Open Externally</span>
        </button>
      </div>
    </div>
  );
};

export default ERROR_BASE;
