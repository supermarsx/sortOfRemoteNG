import React from "react";
import { Copy, Check, Download, Upload, FileUp, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

const Toolbar: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <div className="flex items-center justify-end space-x-2 flex-wrap gap-y-1">
    <button
      type="button"
      onClick={mgr.handleExport}
      className="sor-micro-actions"
      title="Export to clipboard"
    >
      <Download size={11} />
      <span>Export</span>
      {mgr.copiedSecret === "export" && (
        <Check size={10} className="text-green-400" />
      )}
    </button>
    <button
      type="button"
      onClick={() => mgr.setShowImport(!mgr.showImport)}
      className="sor-micro-actions"
      title="Import from JSON"
    >
      <Upload size={11} />
      <span>Import</span>
    </button>
    <button
      type="button"
      onClick={() => mgr.setShowFileImport(true)}
      className="sor-micro-actions"
      title="Import from authenticator app"
    >
      <FileUp size={11} />
      <span>Import File</span>
    </button>
    {mgr.otherConnectionsWithTotp.length > 0 && (
      <button
        type="button"
        onClick={() => {
          mgr.setShowCopyFrom(!mgr.showCopyFrom);
          mgr.setShowReplicateTo(false);
        }}
        className="sor-micro-actions"
        title="Copy 2FA from another connection"
      >
        <ArrowDownToLine size={11} />
        <span>Copy From</span>
      </button>
    )}
    {mgr.configs.length > 0 && mgr.otherConnections.length > 0 && (
      <button
        type="button"
        onClick={() => {
          mgr.setShowReplicateTo(!mgr.showReplicateTo);
          mgr.setShowCopyFrom(false);
        }}
        className="sor-micro-actions"
        title="Replicate 2FA configs to other connections"
      >
        <ArrowUpFromLine size={11} />
        <span>Replicate To</span>
      </button>
    )}
  </div>
);

export default Toolbar;
