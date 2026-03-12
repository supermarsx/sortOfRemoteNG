import React from "react";
import {
  Database,
  MonitorSmartphone,
  CircleDot,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAppStatusBar } from "../../hooks/app/useAppStatusBar";
import { Connection, ConnectionSession } from "../../types/connection/connection";
import { CollectionManager } from "../../utils/connection/collectionManager";

interface AppStatusBarProps {
  connections: Connection[];
  sessions: ConnectionSession[];
  collectionManager: CollectionManager;
  isInitialized: boolean;
}

type Mgr = ReturnType<typeof useAppStatusBar>;

const CollectionLabel: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex items-center gap-1.5">
    <Database size={12} className="text-[var(--color-textMuted)]" />
    <span>
      {mgr.collectionName ?? mgr.t("statusBar.noCollection", "No collection")}
    </span>
    <span className="text-[var(--color-textMuted)]">
      ({mgr.connectionCount})
    </span>
  </div>
);

const SessionIndicator: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { connected, connecting, errored, total } = mgr.sessionsByStatus;
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <MonitorSmartphone size={12} className="text-[var(--color-textMuted)]" />
      {connected > 0 && (
        <span className="flex items-center gap-1">
          <CircleDot size={8} className="text-success" />
          {connected}
        </span>
      )}
      {connecting > 0 && (
        <span className="flex items-center gap-1">
          <Loader2 size={8} className="animate-spin text-primary" />
          {connecting}
        </span>
      )}
      {errored > 0 && (
        <span className="flex items-center gap-1">
          <AlertCircle size={8} className="text-error" />
          {errored}
        </span>
      )}
    </div>
  );
};

const ProtocolTags: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const entries = Object.entries(mgr.protocolCounts);
  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {entries.map(([proto, count]) => (
        <span
          key={proto}
          className="app-badge app-badge--neutral"
        >
          {proto} {count > 1 ? `×${count}` : ""}
        </span>
      ))}
    </div>
  );
};

export const AppStatusBar: React.FC<AppStatusBarProps> = (props) => {
  const mgr = useAppStatusBar(props);

  if (!mgr.isInitialized) return null;

  return (
    <div className="app-status-bar">
      <div className="flex items-center gap-4">
        <CollectionLabel mgr={mgr} />
        <SessionIndicator mgr={mgr} />
        <ProtocolTags mgr={mgr} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[var(--color-textMuted)]">
          sortOfRemoteNG
        </span>
      </div>
    </div>
  );
};
