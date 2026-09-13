import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

export const DangerConfirm: React.FC<{
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}> = ({ label, onConfirm, disabled }) => {
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation();
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-error">
          {t("yubikey.confirmPrompt", "Are you sure?")}
        </span>
        <button
          onClick={() => {
            if (disabled) return;
            onConfirm();
            setConfirming(false);
          }}
          disabled={disabled}
          className="sor-btn sor-btn-danger px-2 py-1 text-xs rounded"
        >
          {t("yubikey.confirmYes", "Yes, proceed")}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="sor-btn sor-btn-secondary px-2 py-1 text-xs rounded"
        >
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className="sor-btn sor-btn-danger flex items-center gap-1 px-3 py-1.5 text-xs rounded disabled:opacity-50"
    >
      <AlertTriangle className="w-3 h-3" />
      {label}
    </button>
  );
};

export const InterfaceBadge: React.FC<{ label: string; active: boolean }> = ({
  label,
  active,
}) => (
  <span
    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
      active
        ? "bg-primary/10 text-primary"
        : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
    }`}
  >
    {label}
  </span>
);
