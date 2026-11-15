import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  PlugZap,
} from "lucide-react";
import type { RowStatus } from "../../../utils/ssh/serverStatsTable";

const META: Record<
  RowStatus,
  { label: string; key: string; Icon: React.ElementType; cls: string }
> = {
  online: {
    label: "Online",
    key: "serverStats.statusOnline",
    Icon: CheckCircle2,
    cls: "text-success",
  },
  stale: {
    label: "Stale",
    key: "serverStats.statusStale",
    Icon: AlertTriangle,
    cls: "text-warning",
  },
  error: {
    label: "Error",
    key: "serverStats.statusError",
    Icon: XCircle,
    cls: "text-error",
  },
  pending: {
    label: "Waiting",
    key: "serverStats.statusPending",
    Icon: Loader2,
    cls: "text-[var(--color-textSecondary)]",
  },
  disconnected: {
    label: "Disconnected",
    key: "serverStats.statusDisconnected",
    Icon: PlugZap,
    cls: "text-[var(--color-textSecondary)]",
  },
};

/** Icon + text label, never colour alone. */
export const StatusBadge: React.FC<{ status: RowStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const m = META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${m.cls}`}
    >
      <m.Icon size={12} aria-hidden="true" />
      {t(m.key, m.label)}
    </span>
  );
};
