import React from "react";
import { Download, Upload, ArrowLeftRight, Copy } from "lucide-react";
import { useImportExport } from "../../hooks/sync/useImportExport";
import ExportTab from "./ExportTab";
import ImportTab from "./ImportTab";
import CloneTab from "./CloneTab";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import PasswordPromptDialog from "./PasswordPromptDialog";

const TAB_ORDER = ["export", "import", "clone"] as const;

type Mgr = ReturnType<typeof useImportExport>;

interface ImportExportProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  initialTab?: "export" | "import" | "clone";
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

  const tabs: Array<{
    value: typeof TAB_ORDER[number];
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    testId: string;
  }> = [
    { value: "export", label: "Export", icon: Download, testId: "export-tab" },
    { value: "import", label: "Import", icon: Upload, testId: "import-tab" },
    { value: "clone", label: "Clone", icon: Copy, testId: "clone-tab" },
  ];

  return (
    <div
      className="flex space-x-1 mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-1"
      role="tablist"
      aria-label="Import and export tabs"
    >
      {tabs.map(({ value, label, icon: Icon, testId }) => {
        const active = mgr.activeTab === value;
        return (
          <button
            key={value}
            id={`import-export-tab-${value}`}
            type="button"
            role="tab"
            data-testid={testId}
            aria-selected={active}
            aria-controls={`import-export-panel-${value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => selectTab(value)}
            onKeyDown={(event) => handleKeyDown(event, value)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
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
              onUnlockDatabase={mgr.handleUnlockDatabase}
            />
          </div>
        )}

        {mgr.activeTab === "clone" && (
          <div role="tabpanel" id="import-export-panel-clone" aria-labelledby="import-export-tab-clone">
            <CloneTab
              sourceMode={mgr.cloneSourceMode}
              setSourceMode={mgr.setCloneSourceMode}
              selectedSourceDatabaseIds={mgr.selectedCloneSourceDatabaseIds}
              setSelectedSourceDatabaseIds={mgr.setSelectedCloneSourceDatabaseIds}
              inclusion={mgr.cloneInclusion}
              updateInclusion={mgr.updateCloneInclusion}
              sourceCatalog={mgr.cloneSourceCatalog}
              isSourceCatalogLoading={mgr.isCloneSourceCatalogLoading}
              targetDatabaseIds={mgr.cloneTargetDatabaseIds}
              setTargetDatabaseIds={mgr.setCloneTargetDatabaseIds}
              conflictPolicy={mgr.cloneConflictPolicy}
              setConflictPolicy={mgr.setCloneConflictPolicy}
              addTags={mgr.cloneAddTags}
              setAddTags={mgr.setCloneAddTags}
              preserveFolders={mgr.clonePreserveFolders}
              setPreserveFolders={mgr.setClonePreserveFolders}
              includeCredentials={mgr.cloneIncludeCredentials}
              setIncludeCredentials={mgr.setCloneIncludeCredentials}
              switchToTargetAfterClone={mgr.cloneSwitchToTargetDatabaseAfterClone}
              setSwitchToTargetAfterClone={mgr.setCloneSwitchToTargetDatabaseAfterClone}
              databaseOptions={mgr.cloneDatabaseOptions}
              isCloning={mgr.isCloning}
              cloneResult={mgr.cloneResult}
              onClone={mgr.handleClone}
              onClearResult={mgr.clearCloneResult}
              onUnlockDatabase={mgr.handleUnlockDatabase}
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
              importDatabaseOptions={mgr.importDatabaseOptions}
              importTargetMode={mgr.importTargetMode}
              setImportTargetMode={mgr.setImportTargetMode}
              selectedImportDatabaseId={mgr.selectedImportDatabaseId}
              setSelectedImportDatabaseId={mgr.setSelectedImportDatabaseId}
              importFormatSelection={mgr.importFormatSelection}
              setImportFormatSelection={mgr.setImportFormatSelection}
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
              handleFileDrop={mgr.handleFileDrop}
              confirmImport={() => mgr.confirmImport(mgr.importFilename)}
              cancelImport={mgr.cancelImport}
              togglePreviewSelection={mgr.togglePreviewSelection}
              selectAllVisiblePreviewItems={mgr.selectAllVisiblePreviewItems}
              deselectAllVisiblePreviewItems={mgr.deselectAllVisiblePreviewItems}
              selectAllImportablePreviewItems={mgr.selectAllImportablePreviewItems}
              detectedFormat={mgr.importAnalysis?.formatName}
              onUnlockDatabase={mgr.handleUnlockDatabase}
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
