import React from "react";
import { Copy, ArrowDownToLine } from "lucide-react";

const CopyFromPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showCopyFrom) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Copy 2FA from another connection
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {mgr.otherConnectionsWithTotp.map((conn) => (
          <button
            key={conn.id}
            type="button"
            onClick={() => mgr.handleCopyFrom(conn)}
            className="w-full flex items-center justify-between px-2 py-1.5 bg-[var(--color-border)]/60 hover:bg-[var(--color-border)] rounded text-left transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-text)] truncate">
                {conn.name}
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)] truncate">
                {conn.hostname}
                {conn.username ? ` · ${conn.username}` : ""}
                {" · "}
                {conn.totpConfigs!.length} config
                {conn.totpConfigs!.length !== 1 ? "s" : ""}
              </div>
            </div>
            <ArrowDownToLine
              size={12}
              className="text-[var(--color-textSecondary)] ml-2 flex-shrink-0"
            />
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => mgr.setShowCopyFrom(false)}
          className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default CopyFromPanel;
