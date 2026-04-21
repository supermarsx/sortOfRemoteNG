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
            onConfirm();
            setConfirming(false);
          }}
          className="px-2 py-1 text-xs bg-error text-[var(--color-text)] rounded hover:bg-error/90"
        >
          {t("yubikey.confirmYes", "Yes, proceed")}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80"
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
      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-error/10 text-error rounded hover:bg-error/20 disabled:opacity-50"
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
      active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
    }`}
  >
    {label}
  </span>
);
