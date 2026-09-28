import { Fragment, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  Server,
} from "lucide-react";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import type { DiscoveredHost } from "../../types/connection/connection";
import { discoveryServiceKey } from "../../utils/discovery/discoverySelection";
import {
  discoveryCertificateWarning,
  discoveryIdentificationFailure,
} from "../../utils/discovery/serviceFingerprint";
import { getDiscoveredServiceLabel } from "../../utils/network/networkScanner";
import { Checkbox, TextInput } from "../ui/forms";

type Manager = ReturnType<typeof useNetworkDiscovery>;
const HOST_PAGE_SIZE = 50;
const SERVICE_PAGE_SIZE = 25;

function HostRows({
  host,
  mgr,
  readOnly,
}: {
  host: DiscoveredHost;
  mgr: Manager;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [servicePage, setServicePage] = useState(0);
  const selectable = !readOnly && mgr.allowCreateConnections;
  const services = [
    ...new Map(
      host.services.map((service) => [
        discoveryServiceKey(host.ip, service),
        service,
      ]),
    ).values(),
  ];
  const selected = services.filter((service) =>
    mgr.selectedServices.has(discoveryServiceKey(host.ip, service)),
  ).length;
  const pages = Math.max(1, Math.ceil(services.length / SERVICE_PAGE_SIZE));
  const page = Math.min(servicePage, pages - 1);
  const names = [
    ...new Set(
      services.map(
        (service) => service.product || getDiscoveredServiceLabel(service),
      ),
    ),
  ];
  const columns = selectable ? 5 : 4;
  return (
    <>
      <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surfaceHover)]">
        {selectable && (
          <td className="w-10 px-3 py-3 align-top">
            <Checkbox
              aria-label={`Select all services on ${host.ip}`}
              aria-checked={
                selected > 0 && selected < services.length
                  ? "mixed"
                  : selected === services.length && services.length > 0
              }
              checked={services.length > 0 && selected === services.length}
              disabled={services.length === 0}
              onChange={() => mgr.toggleHostSelection(host.ip)}
            />
          </td>
        )}
        <th
          scope="row"
          className="min-w-48 px-3 py-3 text-left align-top font-normal"
        >
          <button
            type="button"
            className="flex items-start gap-2 text-left"
            aria-label={`${expanded ? "Hide" : "Show"} services for ${host.ip}`}
            aria-expanded={expanded}
            disabled={services.length === 0}
            onClick={() => setExpanded(!expanded)}
          >
            {services.length > 0 ? (
              expanded ? (
                <ChevronDown size={15} className="mt-0.5 shrink-0" />
              ) : (
                <ChevronRight size={15} className="mt-0.5 shrink-0" />
              )
            ) : (
              <Server size={15} className="mt-0.5 shrink-0" />
            )}
            <span>
              <span className="block font-medium" role="heading" aria-level={4}>
                {host.hostname || host.ip}
              </span>
              {host.hostname && (
                <span className="block font-mono text-xs text-[var(--color-textSecondary)]">
                  {host.ip}
                </span>
              )}
              {host.macAddress && (
                <span className="block font-mono text-[10px] text-[var(--color-textMuted)]">
                  {host.macAddress}
                </span>
              )}
            </span>
          </button>
        </th>
        <td className="min-w-36 px-3 py-3 align-top">
          <span className="font-medium">
            {host.openPorts.length} open{" "}
            {host.openPorts.length === 1 ? "port" : "ports"}
          </span>
          <span className="mt-1 block max-w-56 text-xs text-[var(--color-textSecondary)]">
            {names.slice(0, 3).join(" · ")}
            {names.length > 3 ? ` +${names.length - 3}` : ""}
          </span>
          {selectable && selected > 0 && (
            <span className="block text-xs text-primary">
              {selected} selected
            </span>
          )}
          {services.some((service) =>
            discoveryCertificateWarning(service.identificationError),
          ) && (
            <span className="mt-1 block font-medium text-warning">
              TLS certificate warning
            </span>
          )}
        </td>
        <td className="px-3 py-3 align-top text-xs text-[var(--color-textSecondary)]">
          <span className="block tabular-nums">
            {mgr.t("networkDiscovery.responseTime", { ms: host.responseTime })}
          </span>
          <span className="mt-1 block">
            {host.reachability === "responsive"
              ? "Reachability evidence found"
              : host.reachability === "unresponsive"
                ? host.openPorts.length > 0
                  ? "No ping reply · TCP scanned"
                  : "No ping reply"
                : host.reachability === "unavailable"
                  ? "Reachability probes unavailable"
                  : "Ping not required"}
          </span>
          {!!host.discoveryProbes?.length && (
            <details className="mt-2">
              <summary
                aria-label={`Probe details for ${host.ip}`}
                className="cursor-pointer select-none"
              >
                {
                  host.discoveryProbes.filter(
                    (probe) => probe.status === "responsive",
                  ).length
                }{" "}
                responsive
                {host.discoveryProbes.some(
                  (probe) => probe.status === "unavailable",
                ) && (
                  <span className="ml-1 text-warning">
                    · probes unavailable
                  </span>
                )}
              </summary>
              <ul
                className="mt-1 space-y-1"
                aria-label={`Discovery probes for ${host.ip}`}
              >
                {host.discoveryProbes.map((probe, index) => (
                  <li
                    key={`${probe.method}-${index}`}
                    className={
                      probe.status === "unavailable"
                        ? "text-warning"
                        : probe.status === "responsive"
                          ? "text-success"
                          : undefined
                    }
                  >
                    <span className="font-medium">
                      {probe.method.toUpperCase()}
                    </span>
                    {" · "}
                    {probe.status}
                    {" · "}
                    {probe.elapsedMs} ms
                    {probe.error && (
                      <span className="block max-w-sm break-words text-warning">
                        {probe.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </td>
        <td className="px-3 py-3 align-top text-xs text-[var(--color-textMuted)]">
          {services.length === 0
            ? "No service found"
            : `${services.length} ${services.length === 1 ? "service" : "services"}`}
        </td>
      </tr>
      {expanded &&
        services
          .slice(page * SERVICE_PAGE_SIZE, (page + 1) * SERVICE_PAGE_SIZE)
          .map((service) => {
            const key = discoveryServiceKey(host.ip, service);
            const certificateWarning = discoveryCertificateWarning(
              service.identificationError,
            );
            const identificationFailure = discoveryIdentificationFailure(
              service.identificationError,
            );
            const endpoint = `${host.ip} port ${service.port} ${getDiscoveredServiceLabel(service)}`;
            return (
              <tr
                key={key}
                className="border-t border-[var(--color-border)] bg-[var(--color-background)]/40 text-xs"
              >
                {selectable && (
                  <td className="px-3 py-2 align-top">
                    <Checkbox
                      aria-label={`Select ${endpoint}`}
                      checked={mgr.selectedServices.has(key)}
                      onChange={() =>
                        mgr.toggleServiceSelection(host.ip, service)
                      }
                    />
                  </td>
                )}
                <td className="py-2 pl-10 pr-3 align-top">
                  <span className="block font-medium">
                    {service.product || getDiscoveredServiceLabel(service)}
                  </span>
                  {service.product && (
                    <span className="block text-[var(--color-textSecondary)]">
                      {getDiscoveredServiceLabel(service)}
                    </span>
                  )}
                  {service.version && (
                    <span className="block max-w-64 break-words text-[var(--color-textMuted)]">
                      {service.version}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top font-mono">
                  {mgr.t("networkDiscovery.port", { port: service.port })} / TCP
                </td>
                <td className="max-w-sm px-3 py-2 align-top">
                  <span
                    className={
                      service.detection === "identified"
                        ? "text-success"
                        : "text-[var(--color-textSecondary)]"
                    }
                  >
                    {service.detection === "identified"
                      ? "Identified from response"
                      : service.detection === "port-hint"
                        ? "Port-based hint"
                        : "Type unconfirmed"}
                  </span>
                  {certificateWarning && (
                    <p className="mt-1 font-medium text-warning">
                      TLS certificate warning: validation failed. Discovery
                      retried without certificate verification; identity is
                      unverified.
                    </p>
                  )}
                  {(service.banner ||
                    service.evidence ||
                    service.identificationError) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-[var(--color-textMuted)]">
                        Response details
                      </summary>
                      {service.banner && (
                        <p className="mt-1 whitespace-pre-wrap break-all font-mono">
                          {service.banner}
                        </p>
                      )}
                      {service.evidence && (
                        <p className="mt-1 break-words">{service.evidence}</p>
                      )}
                      {identificationFailure && (
                        <p className="mt-1 break-words text-warning">
                          {service.detection === "identified"
                            ? "Identification incomplete: "
                            : "Identification unavailable: "}
                          {identificationFailure}. The TCP port is open.
                        </p>
                      )}
                    </details>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {selectable && (
                    <button
                      type="button"
                      className="sor-btn-secondary-sm"
                      aria-label={`Create connection for ${endpoint}`}
                      onClick={() =>
                        mgr.handleCreateServiceConnection(host, service)
                      }
                    >
                      <Plus size={13} aria-hidden="true" /> Create
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
      {expanded && pages > 1 && (
        <tr className="border-t border-[var(--color-border)]">
          <td colSpan={columns} className="px-3 py-2">
            <div className="flex items-center justify-end gap-3 text-xs">
              <button
                type="button"
                className="sor-btn-secondary-sm"
                disabled={page === 0}
                onClick={() => setServicePage(page - 1)}
                aria-label={`Previous services for ${host.ip}`}
              >
                Previous services
              </button>
              <span>
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                className="sor-btn-secondary-sm"
                disabled={page === pages - 1}
                onClick={() => setServicePage(page + 1)}
                aria-label={`Next services for ${host.ip}`}
              >
                Next services
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function DiscoveryHostsTable({
  mgr,
  readOnly = false,
}: {
  mgr: Manager;
  readOnly?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(
    1,
    Math.ceil(mgr.filteredHosts.length / HOST_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pages - 1);
  if (mgr.discoveredHosts.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Discovered host list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {mgr.t("networkDiscovery.discoveredHosts", {
            count: mgr.filteredHosts.length,
          })}
        </h3>
        <div className="flex items-center gap-2">
          <TextInput
            aria-label="Filter discovered hosts and services"
            value={mgr.filterText}
            onChange={(value) => {
              mgr.setFilterText(value);
              setPage(0);
            }}
            placeholder={mgr.t("networkDiscovery.filterPlaceholder")}
            variant="form"
          />
          <button
            type="button"
            onClick={mgr.handleExportCSV}
            className="sor-btn-secondary-sm"
          >
            <Download size={14} aria-hidden="true" />
            {mgr.t("networkDiscovery.exportCsv")}
          </button>
        </div>
      </div>
      {!readOnly && mgr.allowCreateConnections && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Expand a host to select or create a connection for an individual
          service and port. The host checkbox selects all its services.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table
          aria-label="Discovered hosts and services"
          className="w-full text-left text-sm"
        >
          <thead className="bg-[var(--color-surfaceHover)] text-xs text-[var(--color-textSecondary)]">
            <tr>
              {!readOnly && mgr.allowCreateConnections && (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Select services</span>
                </th>
              )}
              <th scope="col" className="px-3 py-2">
                Host / service
              </th>
              <th scope="col" className="px-3 py-2">
                Ports
              </th>
              <th scope="col" className="px-3 py-2">
                Details
              </th>
              <th scope="col" className="px-3 py-2">
                Services
              </th>
            </tr>
          </thead>
          <tbody>
            {mgr.filteredHosts
              .slice(
                currentPage * HOST_PAGE_SIZE,
                (currentPage + 1) * HOST_PAGE_SIZE,
              )
              .map((host) => (
                <Fragment key={host.ip}>
                  <HostRows host={host} mgr={mgr} readOnly={readOnly} />
                </Fragment>
              ))}
          </tbody>
        </table>
        {mgr.filteredHosts.length === 0 && (
          <p className="p-4 text-sm text-[var(--color-textSecondary)]">
            No matching hosts or services.
          </p>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous hosts
          </button>
          <span>
            Page {currentPage + 1} of {pages} · {mgr.filteredHosts.length} hosts
          </span>
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next hosts
          </button>
        </div>
      )}
    </section>
  );
}
