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

const AuthIcon: React.FC<{ hasAuth: boolean }> = ({ hasAuth }) => {
  if (!hasAuth) return null;
  return (
    <span data-tooltip="Basic Authentication">
      <User size={14} className="text-primary" />
    </span>
  );
};

export { AuthIcon };
export default SecurityIcon;
