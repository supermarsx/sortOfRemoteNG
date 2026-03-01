import React from "react";
import { Check, ArrowUpFromLine } from "lucide-react";
import { Checkbox } from "../../ui/forms";

const ReplicateToPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showReplicateTo) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Replicate {mgr.configs.length} 2FA config
        {mgr.configs.length !== 1 ? "s" : ""} to connections
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {mgr.otherConnections.map((conn) => {
          const existing = (conn.totpConfigs ?? []).length;
          return (
            <label
              key={conn.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-border)]/60 hover:bg-[var(--color-border)] rounded cursor-pointer transition-colors"
            >
              <Checkbox checked={mgr.selectedReplicateIds.has(conn.id)} onChange={() => mgr.toggleReplicateTarget(conn.id)} variant="form" className="w-3.5 h-3.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[var(--color-text)] truncate">
                  {conn.name}
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)] truncate">
                  {conn.hostname}
                  {conn.username ? ` · ${conn.username}` : ""}
                  {existing > 0 && ` · ${existing} existing`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-textMuted)]">
          {mgr.selectedReplicateIds.size} selected (duplicates will be skipped)
        </span>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => {
              mgr.setShowReplicateTo(false);
            }}
            className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mgr.handleReplicateTo}
            disabled={mgr.selectedReplicateIds.size === 0}
            className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-text)] rounded flex items-center gap-1"
          >
            {mgr.replicateDone ? (
              <>
                <Check size={10} /> Done
              </>
            ) : (
              <>
                <ArrowUpFromLine size={10} /> Replicate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReplicateToPanel;
