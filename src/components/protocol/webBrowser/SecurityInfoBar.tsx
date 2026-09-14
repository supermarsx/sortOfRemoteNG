import type { SectionProps } from "./types";
import React from "react";
import { Shield, AlertTriangle } from "lucide-react";

const SecurityInfoBar: React.FC<SectionProps> = ({ mgr }) => (
  <div
    role="group"
    aria-label="Website connection information"
    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
  >
    {mgr.isSecure ? (
      <div className="flex items-center space-x-1 text-success">
        <Shield size={12} />
        <span>Secure connection (HTTPS)</span>
      </div>
    ) : (
      <div className="flex items-center space-x-1 text-warning">
        <AlertTriangle size={12} />
        <span>Not secure (HTTP)</span>
      </div>
    )}
    {mgr.isSecure &&
      mgr.certIdentity?.validTo &&
      new Date(mgr.certIdentity.validTo).getTime() < Date.now() && (
        <span
          className="flex items-center gap-1 text-warning"
          title="The certificate validity period has ended. A remembered exact-fingerprint approval remains separate from certificate expiry."
        >
          <AlertTriangle size={12} aria-hidden="true" />
          Certificate expired
        </span>
      )}
    <span className="text-[var(--color-textMuted)]">•</span>
    <span className="min-w-0 break-all text-[var(--color-textSecondary)]">
      Connected to {mgr.session.hostname}
    </span>
    {mgr.deferredLogin ? (
      <>
        <span className="text-[var(--color-textMuted)]">•</span>
        <button
          type="button"
          className="sor-icon-btn-sm min-w-0 text-left"
          aria-label="Refresh saved login status"
          title={mgr.deferredLogin.detail}
          data-tooltip={mgr.deferredLogin.detail}
          onClick={() => void mgr.refreshDeferredLoginStatus?.()}
        >
          <span
            className={
              mgr.deferredLogin.muted
                ? "text-[var(--color-textSecondary)]"
                : "text-primary"
            }
          >
            {mgr.deferredLogin.text}
          </span>
        </button>
      </>
    ) : (
      mgr.hasAuth && (
        <>
          <span className="text-[var(--color-textMuted)]">•</span>
          <span className="text-primary">
            {mgr.authLabel ?? "Basic Auth"} configured:{" "}
            {mgr.resolvedCreds?.username}
          </span>
        </>
      )
    )}
  </div>
);

export default SecurityInfoBar;
