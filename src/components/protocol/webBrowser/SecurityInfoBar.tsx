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
    <span className="text-[var(--color-textMuted)]">•</span>
    <span className="text-[var(--color-textSecondary)]">
      Connected to {mgr.session.hostname}
    </span>
    {mgr.hasAuth && (
      <>
        <span className="text-[var(--color-textMuted)]">•</span>
        <span className="text-primary">
          Basic Auth: {mgr.resolvedCreds?.username}
        </span>
      </>
    )}
  </div>
);

export default SecurityInfoBar;
