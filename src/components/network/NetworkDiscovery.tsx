import React from "react";
import {
  Search,
  Wifi,
  Monitor,
  Database,
  HardDrive,
  Globe,
  Plus,
  Download,
  Radar,
} from "lucide-react";
import {
  DiscoveredHost,
  DiscoveredService,
} from "../../types/connection/connection";
import { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import { getDiscoveredServiceLabel } from "../../utils/network/networkScanner";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { Checkbox, TextInput } from "../ui/forms";
import { DiscoveryConfigSidebar } from "./DiscoveryConfigSidebar";
import { DiscoveryScanProgress } from "./DiscoveryScanProgress";
import { configuredDiscoveryPorts } from "../../utils/discovery/discoveryPresets";

interface NetworkDiscoveryProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  allowCreateConnections?: boolean;
}

type Mgr = ReturnType<typeof useNetworkDiscovery>;

/* ── Helpers ─────────────────────────────────────────────────────── */

const getServiceIcon = (service: DiscoveredService) => {
  switch ((service.protocol || service.service).toLowerCase()) {
    case "ssh":
      return Monitor;
    case "http":
    case "https":
      return Globe;
    case "rdp":
      return Monitor;
    case "vnc":
      return Monitor;
    case "mysql":
      return Database;
    case "ftp":
    case "sftp":
      return HardDrive;
    default:
      return Wifi;
  }
};

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
          !mgr.config.ipRange.trim() ||
          configuredDiscoveryPorts(mgr.config).length === 0
        }
        className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
      >
        <Search size={16} />
        <span>{mgr.t("networkDiscovery.startScan")}</span>
      </button>
      {mgr.isScanning && (
        <button
          onClick={mgr.handleStop}
          disabled={mgr.isStopping}
          className="px-4 py-2 bg-danger hover:bg-danger/90 text-[var(--color-text)] rounded-md transition-colors"
        >
          {mgr.isStopping ? "Stopping…" : mgr.t("networkDiscovery.stop")}
        </button>
      )}
      {mgr.allowCreateConnections && mgr.selectedHosts.size > 0 && (
        <button
          onClick={mgr.handleCreateConnections}
          className="px-4 py-2 bg-success hover:bg-success/90 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
        >
          <Plus size={16} />
          <span>
            {mgr.t("networkDiscovery.createConnections", {
              count: mgr.selectedHosts.size,
            })}
          </span>
        </button>
      )}
    </div>
  </>
);

const HostCard: React.FC<{ mgr: Mgr; host: DiscoveredHost }> = ({
  mgr,
  host,
}) => (
  <div
    role="button"
    tabIndex={0}
    className={`bg-[var(--color-border)] rounded-lg p-4 border-2 transition-colors cursor-pointer ${mgr.selectedHosts.has(host.ip) ? "border-primary bg-primary/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"}`}
    onClick={() => mgr.toggleHostSelection(host.ip)}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        mgr.toggleHostSelection(host.ip);
      }
    }}
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            aria-label={`Select ${host.hostname || host.ip}`}
            checked={mgr.selectedHosts.has(host.ip)}
            onChange={() => mgr.toggleHostSelection(host.ip)}
            className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
          />
        </span>
        <div>
          <h4 className="text-[var(--color-text)] font-medium">
            {host.hostname || host.ip}
          </h4>
          {host.hostname && (
            <p className="text-[var(--color-textSecondary)] text-sm">
              {host.ip}
            </p>
          )}
          {host.reachability && (
            <p className="text-xs text-[var(--color-textMuted)]">
              {host.reachability === "responsive"
                ? "Reachability probe replied"
                : host.reachability === "unresponsive"
                  ? "No ping reply · service scan continued"
                  : "Ping not required"}
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-[var(--color-textSecondary)] text-sm">
          {mgr.t("networkDiscovery.responseTime", { ms: host.responseTime })}
        </p>
        {host.macAddress && (
          <p className="text-[var(--color-textMuted)] text-xs">
            {mgr.t("networkDiscovery.macAddress", { mac: host.macAddress })}
          </p>
        )}
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {host.services.map((service, index) => {
        const ServiceIcon = getServiceIcon(service);
        return (
          <div
            key={index}
            className="bg-[var(--color-surfaceHover)] rounded-lg p-3 flex items-center space-x-3"
          >
            <ServiceIcon size={20} className="text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-text)] font-medium">
                {service.product || getDiscoveredServiceLabel(service)}
              </p>
              {service.product && (
                <p className="text-xs text-[var(--color-textSecondary)]">
                  {getDiscoveredServiceLabel(service)}
                </p>
              )}
              <span
                className={`my-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${service.detection === "identified" ? "bg-success/10 text-success" : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"}`}
              >
                {service.detection === "identified"
                  ? "Identified from response"
                  : service.detection === "port-hint"
                    ? "Port-based hint"
                    : "Type unconfirmed"}
              </span>
              <p className="text-[var(--color-textSecondary)] text-sm">
                {mgr.t("networkDiscovery.port", { port: service.port })}
              </p>
              {service.version && (
                <p className="text-[var(--color-textMuted)] text-xs truncate">
                  {service.version}
                </p>
              )}
              {service.banner && (
                <p className="text-[var(--color-textSecondary)] text-xs break-all font-mono">
                  {service.banner}
                </p>
              )}
              {service.evidence && (
                <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                  {service.evidence}
                </p>
              )}
              {service.identificationError && (
                <p className="mt-1 text-xs text-warning">
                  Identification unavailable: {service.identificationError}. The
                  TCP port is open.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const HostsList: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.discoveredHosts.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          {mgr.t("networkDiscovery.discoveredHosts", {
            count: mgr.filteredHosts.length,
          })}
        </h3>
        <div className="flex items-center space-x-2">
          <TextInput
            value={mgr.filterText}
            onChange={(v) => mgr.setFilterText(v)}
            placeholder={mgr.t("networkDiscovery.filterPlaceholder")}
            variant="form"
          />
          <button
            onClick={mgr.handleExportCSV}
            className="px-3 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
          >
            <Download size={14} />
            <span>{mgr.t("networkDiscovery.exportCsv")}</span>
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {mgr.filteredHosts.map((host) => (
          <HostCard key={host.ip} mgr={mgr} host={host} />
        ))}
      </div>
    </div>
  );
};

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
}) => {
  const mgr = useNetworkDiscovery({
    onClose,
    native: embedded,
    allowCreateConnections,
  });

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
          <HostsList mgr={mgr} />
          <EmptyState mgr={mgr} />
        </main>
        <DiscoveryConfigSidebar mgr={mgr} />
      </div>
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
