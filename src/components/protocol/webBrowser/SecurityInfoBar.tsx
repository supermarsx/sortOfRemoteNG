import type { SectionProps } from "./types";
import React from "react";
import { Shield, AlertTriangle } from "lucide-react";

const SecurityInfoBar: React.FC<SectionProps> = ({ mgr }) => (
  <div className="flex items-center space-x-2 text-xs">
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
    <span className="text-[var(--color-textSecondary)]">
      Connected to {mgr.session.hostname}
    </span>
    {mgr.hasAuth && (
      <>
        <span className="text-[var(--color-textMuted)]">•</span>
        <span className="text-primary">
          {mgr.authLabel ?? "Basic Auth"} configured:{" "}
          {mgr.resolvedCreds?.username}
        </span>
      </>
    )}
  </div>
);

export default SecurityInfoBar;
