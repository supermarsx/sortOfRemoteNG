import React from "react";

const ImportPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showImport) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="sor-totp-label">
        Import TOTP Configs (JSON)
      </div>
      <Textarea
        value={mgr.importText}
        onChange={(e) => {
          mgr.setImportText(e.target.value);
          mgr.setImportError("");
        }}
        placeholder='[{"secret":"...","account":"...","issuer":"...","digits":6,"period":30,"algorithm":"sha1"}]'
        variant="form-xs" className="w-full h-20 font-mono resize-none"
      />
      {mgr.importError && (
        <div className="text-[10px] text-red-400">{mgr.importError}</div>
      )}
      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={() => {
            mgr.setShowImport(false);
            mgr.setImportText("");
            mgr.setImportError("");
          }}
          className="sor-totp-action"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={mgr.handleImport}
          className="px-2 py-1 text-[10px] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded"
        >
          Import
        </button>
      </div>
    </div>
  );
};

export default ImportPanel;
