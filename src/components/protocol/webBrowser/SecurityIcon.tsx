import type { SectionProps } from "./types";
import React from "react";
import { ShieldAlert, Lock, User } from "lucide-react";

const SecurityIcon: React.FC<SectionProps> = ({ mgr }) => {
  if (mgr.isSecure) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mgr.setShowCertPopup((v) => !v);
        }}
        className="hover:bg-[var(--color-border)] rounded p-0.5 transition-colors"
        title="View certificate information"
      >
        <Lock size={14} className="text-success" />
      </button>
    );
  }
  return <ShieldAlert size={14} className="text-warning" />;
};

const AuthIcon: React.FC<{
  hasAuth: boolean;
  authLabel?: string;
  deferredLogin?: { label: string; detail: string; muted: boolean } | null;
  onRefresh?: () => void;
}> = ({ hasAuth, authLabel = "Basic Auth", deferredLogin, onRefresh }) => {
  if (deferredLogin)
    return (
      <button
        type="button"
        className="sor-icon-btn-sm"
        onClick={onRefresh}
        aria-label={deferredLogin.label}
        title={deferredLogin.detail}
        data-tooltip={deferredLogin.detail}
      >
        <User
          size={14}
          className={
            deferredLogin.muted
              ? "text-[var(--color-textMuted)]"
              : "text-primary"
          }
        />
      </button>
    );
  if (!hasAuth) return null;
  return (
    <span
      data-tooltip={`${authLabel} configured; this is not proof of successful sign-in`}
    >
      <User size={14} className="text-primary" />
    </span>
  );
};

export { AuthIcon };
export default SecurityIcon;
