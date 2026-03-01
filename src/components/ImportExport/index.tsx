import React from "react";
import { Download, Upload, ArrowLeftRight } from "lucide-react";
import { useImportExport } from "../../hooks/sync/useImportExport";
import ExportTab from "./ExportTab";
import ImportTab from "./ImportTab";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";

type Mgr = ReturnType<typeof useImportExport>;

interface ImportExportProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  initialTab?: "export" | "import";
}

/* ── Sub-components ──────────────────────────────────────────────── */

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex space-x-1 mb-6 bg-[var(--color-border)] rounded-lg p-1">
    <button
      onClick={() => mgr.setActiveTab("export")}
      className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
        mgr.activeTab === "export"
          ? "bg-blue-600 text-[var(--color-text)]"
          : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      }`}
    >
      <Download size={16} className="inline mr-2" />
      Export
    </button>
    <button
      onClick={() => mgr.setActiveTab("import")}
      className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
        mgr.activeTab === "import"
          ? "bg-blue-600 text-[var(--color-text)]"
          : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      }`}
    >
      <Upload size={16} className="inline mr-2" />
      Import
    </button>
  </div>
);

/* ── Root component ──────────────────────────────────────────────── */

export const ImportExport: React.FC<ImportExportProps> = ({
  isOpen,
  onClose,
  embedded = false,
  initialTab = "export",
}) => {
  const mgr = useImportExport({ isOpen, onClose, initialTab });

  const content = (
    <div className={embedded ? "" : "relative flex flex-1 min-h-0 flex-col"}>
      {!embedded && (
        <DialogHeader
          icon={ArrowLeftRight}
          iconColor="text-indigo-500"
          iconBg="bg-indigo-500/20"
          title="Import / Export Connections"
          onClose={onClose}
        />
      )}

      <div className={embedded ? "p-0" : "p-6 overflow-y-auto"}>
        <TabBar mgr={mgr} />

        {mgr.activeTab === "export" && (
          <ExportTab
            connections={mgr.connections}
            exportFormat={mgr.exportFormat}
            setExportFormat={mgr.setExportFormat}
            includePasswords={mgr.includePasswords}
            setIncludePasswords={mgr.setIncludePasswords}
            exportEncrypted={mgr.exportEncrypted}
            setExportEncrypted={mgr.setExportEncrypted}
            exportPassword={mgr.exportPassword}
            setExportPassword={mgr.setExportPassword}
            isProcessing={mgr.isProcessing}
            handleExport={mgr.handleExport}
          />
        )}

        {mgr.activeTab === "import" && (
          <ImportTab
            isProcessing={mgr.isProcessing}
            handleImport={mgr.handleImport}
            fileInputRef={mgr.fileInputRef}
            importResult={mgr.importResult}
            handleFileSelect={mgr.handleFileSelect}
            confirmImport={() => mgr.confirmImport(mgr.importFilename)}
            cancelImport={mgr.cancelImport}
          />
        )}
      </div>
    </div>
  );

  if (!isOpen && !embedded) return null;
  if (embedded) return content;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-2xl rounded-xl overflow-hidden"
      contentClassName="bg-[var(--color-surface)]"
    >
      {content}
    </Modal>
  );
};
