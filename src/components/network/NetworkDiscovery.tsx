import React, { useEffect, useId, useState } from "react";
import {
  Search,
  Plus,
  Radar,
  Pause,
  Play,
  History,
  X,
  Trash2,
  Save,
} from "lucide-react";
import { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { DiscoveryHostsTable } from "./DiscoveryHostsTable";
import { DiscoveryConfigSidebar } from "./DiscoveryConfigSidebar";
import { DiscoveryScanProgress } from "./DiscoveryScanProgress";
import { configuredDiscoveryPorts } from "../../utils/discovery/discoveryPresets";
import { effectiveDiscoveryPingMethod } from "../../utils/discovery/discoveryPing";
import type { SavedDiscoveryScan } from "../../utils/discovery/scanHistory";
import { exportDiscoveryScanCsv } from "../../utils/discovery/exportDiscoveryScan";
import { DiscoveryScanHistory } from "./DiscoveryScanHistory";
import {
  DiscoverySpreadsheetDialog,
  type DiscoverySpreadsheetRequest,
} from "./DiscoverySpreadsheetDialog";

interface NetworkDiscoveryProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  allowCreateConnections?: boolean;
  onActivateSession?: (id: string) => void;
}

type Mgr = ReturnType<typeof useNetworkDiscovery>;

/* ── Sub-components ──────────────────────────────────────────────── */

const DiscoveryHeader: React.FC<{ mgr: Mgr; onClose?: () => void }> = ({
  mgr,
  onClose,
}) => (
  <DialogHeader
    icon={Radar}
    iconColor="text-primary"
    iconBg="bg-primary/20"
    title={mgr.t("networkDiscovery.title")}
    subtitle="Discover hosts, ports and identifiable services"
    onClose={onClose}
  />
);

const ScanControls: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={mgr.handleScan}
        disabled={
          mgr.isScanning ||
          mgr.saveStatus === "saving" ||
          !mgr.config.ipRange.trim() ||
          ((mgr.config.serviceScanEnabled === false ||
            configuredDiscoveryPorts(mgr.config).length === 0) &&
            (!mgr.native ||
              effectiveDiscoveryPingMethod(mgr.config) === "none"))
        }
        className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
      >
        <Search size={16} />
        <span>{mgr.t("networkDiscovery.startScan")}</span>
      </button>
      {mgr.isScanning && (
        <button
          type="button"
          disabled={mgr.isStopping || !mgr.native}
          onClick={mgr.handlePauseResume}
          className="sor-btn-secondary-sm disabled:opacity-50"
        >
          {mgr.isPaused ? <Play size={15} /> : <Pause size={15} />}
          {mgr.isPaused ? "Resume scan" : "Pause scan"}
        </button>
      )}
      {mgr.isScanning && (
        <button
          onClick={mgr.handleStop}
          disabled={mgr.isStopping}
          className="px-4 py-2 bg-danger hover:bg-danger/90 text-[var(--color-text)] rounded-md transition-colors"
        >
          {mgr.isStopping ? "Stopping…" : mgr.t("networkDiscovery.stop")}
        </button>
      )}
      <button
        type="button"
        onClick={mgr.handleSaveToHistory}
        disabled={!mgr.canSaveToHistory}
        className="sor-btn-secondary-sm disabled:opacity-50"
      >
        <Save size={15} />
        {mgr.saveStatus === "saving" ? "Saving…" : "Save to history"}
      </button>
      <button
        type="button"
        onClick={mgr.handleDiscardResults}
        disabled={!mgr.canDiscardResults}
        className="sor-btn-secondary-sm disabled:opacity-50"
      >
        <Trash2 size={15} />
        Discard results
      </button>
      {mgr.allowCreateConnections && mgr.selectedServices.size > 0 && (
        <button
          onClick={mgr.handleCreateConnections}
          className="px-4 py-2 bg-success hover:bg-success/90 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
        >
          <Plus size={16} />
          <span>
            {mgr.t("networkDiscovery.createConnections", {
              count: mgr.selectedServices.size,
            })}
          </span>
        </button>
      )}
    </div>
    <p className="text-xs text-[var(--color-textSecondary)]">
      Results are not saved automatically. Save to history before starting
      another scan. Completed, stopped and failed scans can be saved. Discard
      results clears the current results and selection; saved history is kept.
      {mgr.isScanning && " Stop the scan before saving or discarding results."}
      {mgr.saveStatus === "saving" &&
        " Wait for saving to finish before starting another scan or discarding results."}
    </p>
    {mgr.saveStatus === "saved" && (
      <p role="status" className="text-xs text-success">
        Saved to history.
      </p>
    )}
    {mgr.saveStatus === "error" && (
      <p role="alert" className="text-xs text-error">
        Could not persist this scan to history: {mgr.saveError}. Results are
        still available. Choose Save to history to retry.
      </p>
    )}
  </>
);

function SavedScanView({
  scan,
  mgr,
  onUseTargets,
  onExportDocument,
}: {
  scan: SavedDiscoveryScan;
  mgr: Mgr;
  onUseTargets: () => void;
  onExportDocument: (request: DiscoverySpreadsheetRequest) => void;
}) {
  const [filter, setFilter] = useState("");
  const filteredHosts = scan.hosts.filter((host) =>
    `${host.ip} ${host.hostname ?? ""} ${host.services.map((service) => `${service.port} ${service.product ?? ""} ${service.service}`).join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const viewManager: Mgr = {
    ...mgr,
    config: scan.config,
    discoveredHosts: scan.hosts,
    filteredHosts,
    filterText: filter,
    setFilterText: setFilter,
    selectedHosts: new Set(),
    toggleHostSelection: () => {},
    allowCreateConnections: false,
    handleExportCSV: () => exportDiscoveryScanCsv(scan, filteredHosts),
  };
  return (
    <section aria-label="Saved scan results" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {scan.name?.trim() || new Date(scan.startedAt).toLocaleString()}
          </h3>
          {scan.name?.trim() && (
            <time
              dateTime={new Date(scan.startedAt).toISOString()}
              className="block text-xs text-[var(--color-textSecondary)]"
            >
              {new Date(scan.startedAt).toLocaleString()}
            </time>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            {scan.outcome} · {scan.hosts.length} live hosts ·{" "}
            {scan.hosts.reduce(
              (total, host) => total + host.openPorts.length,
              0,
            )}{" "}
            open ports · {Math.round(scan.elapsedMs / 1000)}s elapsed
          </p>
        </div>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={mgr.isScanning}
          onClick={() => {
            mgr.setConfig(structuredClone(scan.config));
            onUseTargets();
          }}
        >
          Use scan configuration
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words font-mono text-xs">
        {scan.config.ipRange}
      </p>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Saved snapshot, not a current reachability check. Loading its
        configuration does not start a scan.
      </p>
      <DiscoveryHostsTable
        mgr={viewManager}
        readOnly
        onExportDocument={() =>
          onExportDocument({ scan, filteredHosts, filterText: filter })
        }
      />
      {scan.hosts.length === 0 && (
        <p className="text-sm">No live hosts were recorded.</p>
      )}
    </section>
  );
}

const EmptyState: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isScanning || mgr.discoveredHosts.length > 0) return null;
  return (
    <div className="text-center py-12">
      <Search
        size={48}
        className="mx-auto text-[var(--color-textMuted)] mb-4"
      />
      <p className="text-[var(--color-textSecondary)]">
        {mgr.t("networkDiscovery.noHosts")}
      </p>
    </div>
  );
};

/* ── Root component ──────────────────────────────────────────────── */

export const NetworkDiscovery: React.FC<NetworkDiscoveryProps> = ({
  isOpen,
  onClose,
  embedded = false,
  allowCreateConnections = true,
  onActivateSession,
}) => {
  const mgr = useNetworkDiscovery({
    onClose,
    native: embedded,
    allowCreateConnections,
  });
  const [tab, setTab] = useState<"current" | "history" | "saved">("current");
  const tabId = useId();
  const [savedScanId, setSavedScanId] = useState<string | null>(null);
  const [exportRequest, setExportRequest] =
    useState<DiscoverySpreadsheetRequest | null>(null);
  const exportDocument = (request: DiscoverySpreadsheetRequest) =>
    setExportRequest(structuredClone(request));
  const savedScan = mgr.scanHistory.scans.find(
    (scan) => scan.id === savedScanId,
  );

  useEffect(() => {
    if (!isOpen) setExportRequest(null);
  }, [isOpen]);

  useEffect(() => {
    if (!savedScan && !mgr.scanHistory.loading) {
      setSavedScanId(null);
      setTab((current) => (current === "saved" ? "history" : current));
    }
  }, [savedScanId, savedScan, tab, mgr.scanHistory.loading]);

  if (!isOpen) return null;

  const content = (
    <div
      className={
        embedded
          ? "h-full min-h-0 flex flex-col bg-[var(--color-surface)]"
          : "flex min-h-0 flex-col overflow-hidden"
      }
    >
      <DiscoveryHeader mgr={mgr} onClose={embedded ? undefined : onClose} />
      <div
        role="tablist"
        aria-label="Scanner views"
        className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-4"
      >
        {(["current", "history", ...(savedScan ? ["saved"] : [])] as const).map(
          (key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${tabId}-${key}-tab`}
              aria-controls={`${tabId}-${key}-panel`}
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              className={`flex items-center gap-2 border-b-2 px-3 py-3 text-xs ${tab === key ? "border-primary text-primary" : "border-transparent text-[var(--color-textSecondary)]"}`}
              onClick={() => setTab(key as typeof tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const siblings = Array.from(
                  event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  ),
                );
                const index = siblings.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? siblings.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          siblings.length) %
                        siblings.length;
                siblings[next].click();
                siblings[next].focus();
              }}
            >
              {key === "current" ? (
                <>
                  <Radar size={14} />
                  Current scan
                  {mgr.isScanning
                    ? mgr.isPaused
                      ? " · paused"
                      : " · running"
                    : ""}
                </>
              ) : key === "history" ? (
                <>
                  <History size={14} />
                  History ({mgr.scanHistory.scans.length})
                </>
              ) : (
                "Saved scan"
              )}
            </button>
          ),
        )}
        {savedScan && (
          <button
            type="button"
            aria-label="Close saved scan"
            className="rounded p-1 hover:bg-[var(--color-surfaceHover)]"
            onClick={() => {
              setSavedScanId(null);
              if (tab === "saved") setTab("history");
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div
        className={
          embedded
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
            : "flex min-h-0 max-h-[calc(90vh-100px)] flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
        }
      >
        <main
          aria-label="Discovery results"
          className="min-w-0 flex-1 space-y-5 p-4 lg:overflow-y-auto lg:p-6"
        >
          {mgr.scanHistory.error && (
            <p
              role="alert"
              className="rounded-lg border border-warning/30 p-3 text-xs text-warning"
            >
              {mgr.scanHistory.error}
            </p>
          )}
          {tab === "history" && (
            <div
              role="tabpanel"
              id={`${tabId}-history-panel`}
              aria-labelledby={`${tabId}-history-tab`}
            >
              <DiscoveryScanHistory
                scanHistory={mgr.scanHistory}
                onOpen={(scan) => {
                  setSavedScanId(scan.id);
                  setTab("saved");
                }}
                onDelete={(id) => {
                  setSavedScanId((selected) =>
                    selected === id ? null : selected,
                  );
                }}
                onClear={() => setSavedScanId(null)}
                onExportDocument={(scan) => exportDocument({ scan })}
              />
            </div>
          )}
          {tab === "saved" && savedScan && (
            <div
              role="tabpanel"
              id={`${tabId}-saved-panel`}
              aria-labelledby={`${tabId}-saved-tab`}
            >
              <SavedScanView
                key={savedScan.id}
                scan={savedScan}
                mgr={mgr}
                onUseTargets={() => setTab("current")}
                onExportDocument={exportDocument}
              />
            </div>
          )}
          {tab === "current" && (
            <div
              role="tabpanel"
              id={`${tabId}-current-panel`}
              aria-labelledby={`${tabId}-current-tab`}
              className="space-y-5"
            >
              <ScanControls mgr={mgr} />
              <DiscoveryScanProgress mgr={mgr} />
              {mgr.scanError && (
                <p
                  role="alert"
                  className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error"
                >
                  {mgr.scanError}
                </p>
              )}
              <DiscoveryHostsTable
                mgr={mgr}
                onExportDocument={() => {
                  const scan = mgr.getDocumentExportScan();
                  if (scan)
                    exportDocument({
                      scan,
                      filteredHosts: mgr.filteredHosts,
                      filterText: mgr.filterText,
                    });
                }}
              />
              <EmptyState mgr={mgr} />
            </div>
          )}
        </main>
        {tab === "current" && <DiscoveryConfigSidebar mgr={mgr} />}
      </div>
      {exportRequest && (
        <DiscoverySpreadsheetDialog
          request={exportRequest}
          onClose={() => setExportRequest(null)}
          onActivateSession={onActivateSession}
        />
      )}
    </div>
  );

  if (embedded)
    return (
      <section
        aria-label="Network Scanner"
        className="h-full min-h-0"
        data-testid="network-scanner-tab"
      >
        {content}
      </section>
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 max-h-[90vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl"
      dataTestId="network-discovery"
    >
      {content}
    </Modal>
  );
};
