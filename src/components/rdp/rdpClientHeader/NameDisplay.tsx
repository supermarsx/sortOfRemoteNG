import React from "react";
import { Mgr } from "./helpers";

const NameDisplay: React.FC<{
  mgr: Mgr;
  sessionName: string;
  sessionHostname: string;
}> = ({ mgr, sessionName, sessionHostname }) =>
  mgr.isEditingName ? (
    <div className="flex items-center space-x-1">
      <input
        ref={mgr.nameInputRef}
        type="text"
        value={mgr.editName}
        onChange={(e) => mgr.setEditName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") mgr.confirmRename();
          if (e.key === "Escape") mgr.cancelRename();
        }}
        onBlur={mgr.confirmRename}
        className="px-2 py-0.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] w-48"
      />
    </div>
  ) : (
    <span
      className="text-sm text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] transition-colors"
      onDoubleClick={mgr.startEditing}
      title="Double-click to rename"
    >
      RDP -{" "}
      {sessionName !== sessionHostname
        ? `${sessionName} (${sessionHostname})`
        : sessionHostname}
    </span>
  );

export default NameDisplay;
