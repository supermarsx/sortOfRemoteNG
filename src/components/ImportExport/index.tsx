import React from "react";
import { Download, Upload, ArrowLeftRight } from "lucide-react";
import { useImportExport } from "../../hooks/sync/useImportExport";
import ExportTab, { type ExportConfig } from "./ExportTab";
import ImportTab from "./ImportTab";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";

const TAB_ORDER = ["export", "import"] as const;

type Mgr = ReturnType<typeof useImportExport>;

interface ImportExportProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  initialTab?: "export" | "import";
}

/* ── Sub-components ──────────────────────────────────────────────── */

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tab: typeof TAB_ORDER[number],
  ) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    if (currentIndex < 0) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        mgr.setActiveTab(TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length]);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        mgr.setActiveTab(TAB_ORDER[(currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
        break;
      case "Home":
        event.preventDefault();
        mgr.setActiveTab(TAB_ORDER[0]);
        break;
      case "End":
        event.preventDefault();
        mgr.setActiveTab(TAB_ORDER[TAB_ORDER.length - 1]);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex space-x-1 mb-6 bg-[var(--color-border)] rounded-lg p-1" role="tablist" aria-label="Import and export tabs">
      <button
        id="import-export-tab-export"
        type="button"
        role="tab"
        data-testid="export-tab"
        aria-selected={mgr.activeTab === "export"}
        aria-controls="import-export-panel-export"
        onClick={() => mgr.setActiveTab("export")}
        onKeyDown={(event) => handleKeyDown(event, "export")}
        className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
          mgr.activeTab === "export"
            ? "bg-primary text-[var(--color-text)]"
            : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        }`}
      >
        <Download size={16} className="inline mr-2" />
        Export
      </button>
      <button
        id="import-export-tab-import"
        type="button"
        role="tab"
        data-testid="import-tab"
        aria-selected={mgr.activeTab === "import"}
        aria-controls="import-export-panel-import"
        onClick={() => mgr.setActiveTab("import")}
        onKeyDown={(event) => handleKeyDown(event, "import")}
        className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
          mgr.activeTab === "import"
            ? "bg-primary text-[var(--color-text)]"
            : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        }`}
      >
        <Upload size={16} className="inline mr-2" />
        Import
      </button>
    </div>
  );
};

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
          iconColor="text-primary"
          iconBg="bg-primary/20"
          title="Import / Export Connections"
          onClose={onClose}
        />
      )}

      <div className={embedded ? "p-0" : "p-6 overflow-y-auto"}>
        <TabBar mgr={mgr} />

        {mgr.activeTab === "export" && (
          <div role="tabpanel" id="import-export-panel-export" aria-labelledby="import-export-tab-export">
            <ExportTab
              connections={mgr.connections}
              config={{
                format: mgr.exportFormat,
                includePasswords: mgr.includePasswords,
                encrypted: mgr.exportEncrypted,
                password: mgr.exportPassword,
              }}
              onConfigChange={(update) => {
                if (update.format !== undefined) mgr.setExportFormat(update.format);
                if (update.includePasswords !== undefined) mgr.setIncludePasswords(update.includePasswords);
                if (update.encrypted !== undefined) mgr.setExportEncrypted(update.encrypted);
                if (update.password !== undefined) mgr.setExportPassword(update.password);
              }}
              isProcessing={mgr.isProcessing}
              handleExport={mgr.handleExport}
            />
          </div>
        )}

        {mgr.activeTab === "import" && (
          <div role="tabpanel" id="import-export-panel-import" aria-labelledby="import-export-tab-import">
            <ImportTab
              isProcessing={mgr.isProcessing}
              handleImport={mgr.handleImport}
              fileInputRef={mgr.fileInputRef}
              importResult={mgr.importResult}
              handleFileSelect={mgr.handleFileSelect}
              confirmImport={() => mgr.confirmImport(mgr.importFilename)}
              cancelImport={mgr.cancelImport}
            />
          </div>
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
      dataTestId="import-export-dialog"
    >
      {content}
    </Modal>
  );
};
