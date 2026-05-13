import React from "react";
import { Download, Upload, ArrowLeftRight } from "lucide-react";
import { useImportExport } from "../../hooks/sync/useImportExport";
import ExportTab from "./ExportTab";
import type { ExportConfig } from "./types";
import ImportTab from "./ImportTab";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import PasswordPromptDialog from "./PasswordPromptDialog";

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
  const selectTab = (tab: typeof TAB_ORDER[number], focus = false) => {
    mgr.setActiveTab(tab);
    if (focus) {
      requestAnimationFrame(() => {
        document.getElementById(`import-export-tab-${tab}`)?.focus();
      });
    }
  };

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
        selectTab(TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length], true);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectTab(TAB_ORDER[(currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length], true);
        break;
      case "Home":
        event.preventDefault();
        selectTab(TAB_ORDER[0], true);
        break;
      case "End":
        event.preventDefault();
        selectTab(TAB_ORDER[TAB_ORDER.length - 1], true);
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
        tabIndex={mgr.activeTab === "export" ? 0 : -1}
        onClick={() => selectTab("export")}
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
        tabIndex={mgr.activeTab === "import" ? 0 : -1}
        onClick={() => selectTab("import")}
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

  const passwordPromptNode = (
    <PasswordPromptDialog
      isOpen={!!mgr.passwordPrompt}
      title={mgr.passwordPrompt?.title ?? ""}
      description={mgr.passwordPrompt?.description ?? ""}
      error={mgr.passwordPrompt?.error}
      onSubmit={mgr.submitPasswordPrompt}
      onCancel={mgr.cancelPasswordPrompt}
    />
  );

  const content = (
    <div className={embedded ? "" : "relative flex flex-1 min-h-0 flex-col"}>
      {!embedded && (
        <DialogHeader
          icon={ArrowLeftRight}
          iconColor="text-primary"
          iconBg="bg-primary/20"
          title="Import / Export"
          onClose={onClose}
        />
      )}

      <div className={embedded ? "mx-auto w-full max-w-4xl" : "p-6 overflow-y-auto"}>
        <TabBar mgr={mgr} />

        {mgr.activeTab === "export" && (
          <div role="tabpanel" id="import-export-panel-export" aria-labelledby="import-export-tab-export">
            <ExportTab
              connections={mgr.connections}
              config={{
                format: mgr.exportFormat,
                scopeMode: mgr.exportScopeMode,
                selectedDatabaseIds: mgr.selectedExportDatabaseIds,
                databaseOptions: mgr.exportDatabaseOptions,
                inclusion: mgr.exportInclusion,
                includePasswords: mgr.includePasswords,
                encrypted: mgr.exportEncrypted,
                password: mgr.exportPassword,
                keyDerivationIterations: mgr.exportKeyDerivationIterations,
                includeVpnData: mgr.includeVpnData,
                includeTunnelChains: mgr.includeTunnelChains,
                includeTabGroups: mgr.includeTabGroups,
                includeColorTags: mgr.includeColorTags,
                strengthSettings: {
                  showPasswordStrength: mgr.exportSecuritySettings.showPasswordStrength,
                  showEntropyBits: mgr.exportSecuritySettings.showEntropyBits,
                  minimumPasswordScore: mgr.exportSecuritySettings.minimumPasswordScore,
                  enforceMinimumPasswordScore: mgr.exportSecuritySettings.enforceMinimumPasswordScore,
                  detectCommonPasswords: mgr.exportSecuritySettings.detectCommonPasswords,
                  detectRepeatedCharacters: mgr.exportSecuritySettings.detectRepeatedCharacters,
                  detectSequentialPatterns: mgr.exportSecuritySettings.detectSequentialPatterns,
                  rewardUncommonSymbols: mgr.exportSecuritySettings.rewardUncommonSymbols,
                  customCommonPasswords: mgr.exportSecuritySettings.customCommonPasswords,
                },
              }}
              onConfigChange={(update) => {
                if (update.format !== undefined) mgr.setExportFormat(update.format);
                if (update.scopeMode !== undefined) mgr.setExportScopeMode(update.scopeMode);
                if (update.selectedDatabaseIds !== undefined) mgr.setSelectedExportDatabaseIds(update.selectedDatabaseIds);
                if (update.inclusion !== undefined) mgr.updateExportInclusion(update.inclusion);
                if (update.includePasswords !== undefined) mgr.setIncludePasswords(update.includePasswords);
                if (update.encrypted !== undefined) mgr.setExportEncrypted(update.encrypted);
                if (update.password !== undefined) mgr.setExportPassword(update.password);
                if (update.keyDerivationIterations !== undefined) mgr.setExportKeyDerivationIterations(update.keyDerivationIterations);
                if (update.includeVpnData !== undefined) mgr.setIncludeVpnData(update.includeVpnData);
                if (update.includeTunnelChains !== undefined) mgr.setIncludeTunnelChains(update.includeTunnelChains);
                if (update.includeTabGroups !== undefined) mgr.setIncludeTabGroups(update.includeTabGroups);
                if (update.includeColorTags !== undefined) mgr.setIncludeColorTags(update.includeColorTags);
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
              importAnalysis={mgr.importAnalysis}
              importFilters={mgr.importFilters}
              updateImportFilters={mgr.updateImportFilters}
              resetImportFilters={mgr.resetImportFilters}
              importOptions={mgr.importOptions}
              updateImportOptions={mgr.updateImportOptions}
              previewItems={mgr.importPreviewItems}
              visiblePreviewItems={mgr.visiblePreviewItems}
              availableProtocols={mgr.availableImportProtocols}
              selectedPreviewIds={mgr.selectedPreviewIds}
              selectedCount={mgr.selectedImportCount}
              handleFileSelect={mgr.handleFileSelect}
              confirmImport={() => mgr.confirmImport(mgr.importFilename)}
              cancelImport={mgr.cancelImport}
              togglePreviewSelection={mgr.togglePreviewSelection}
              selectAllVisiblePreviewItems={mgr.selectAllVisiblePreviewItems}
              deselectAllVisiblePreviewItems={mgr.deselectAllVisiblePreviewItems}
              selectAllImportablePreviewItems={mgr.selectAllImportablePreviewItems}
              detectedFormat={mgr.importAnalysis?.formatName}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (!isOpen && !embedded) return null;
  if (embedded) {
    return (
      <>
        {content}
        {passwordPromptNode}
      </>
    );
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-w-6xl rounded-xl overflow-hidden"
        contentClassName="bg-[var(--color-surface)]"
        dataTestId="import-export-dialog"
      >
        {content}
      </Modal>
      {passwordPromptNode}
    </>
  );
};
