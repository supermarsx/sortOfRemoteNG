import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Link2,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../../../types/connection/connection";
import type { SavedTunnelChain } from "../../../types/settings/vpnSettings";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

type AssignmentFilter = "all" | "configured" | "unconfigured";
type SortDirection = "asc" | "desc";

const DEFAULT_PAGE_SIZE = 50;

function hasAssociation(connection: Connection): boolean {
  return Boolean(
    connection.connectionChainId ||
    connection.proxyChainId ||
    connection.tunnelChainId ||
    connection.security?.tunnelChain?.length,
  );
}

interface AssociationSearchCatalog {
  connectionChains: ReadonlyMap<string, string>;
  proxyChains: ReadonlyMap<string, string>;
  tunnelChains: ReadonlyMap<string, string>;
}

function connectionSearchText(
  connection: Connection,
  catalog: AssociationSearchCatalog,
): string {
  const referencedTunnelChain = connection.tunnelChainId
    ? catalog.tunnelChains.get(connection.tunnelChainId)
    : undefined;
  const visibleInlineLayers = referencedTunnelChain
    ? []
    : (connection.security?.tunnelChain ?? []).flatMap((layer) => [
        layer.name,
        layer.type,
      ]);

  return [
    connection.id,
    connection.name,
    connection.hostname,
    connection.protocol,
    connection.username,
    connection.connectionChainId,
    connection.connectionChainId
      ? catalog.connectionChains.get(connection.connectionChainId)
      : undefined,
    connection.proxyChainId,
    connection.proxyChainId
      ? catalog.proxyChains.get(connection.proxyChainId)
      : undefined,
    connection.tunnelChainId,
    referencedTunnelChain,
    ...visibleInlineLayers,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function TunnelPathSummary({
  connection,
  onClear,
}: {
  connection: Connection;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const referencedChain = connection.tunnelChainId
    ? proxyCollectionManager.getTunnelChain(connection.tunnelChainId)
    : null;
  const layers =
    referencedChain?.layers ?? connection.security?.tunnelChain ?? [];
  const hasPath = layers.length > 0 || Boolean(connection.tunnelChainId);
  const visibleLayers = layers.slice(0, 2);
  const hiddenLayerCount = Math.max(0, layers.length - visibleLayers.length);

  if (!hasPath) {
    return (
      <span
        className="text-xs text-[var(--color-textMuted)]"
        aria-label="No tunnel path"
      >
        —
      </span>
    );
  }

  const pathTitle = layers
    .map((layer) => layer.name || layer.type)
    .filter(Boolean)
    .join(" → ");

  return (
    <div
      className="flex items-center gap-1.5 min-w-0"
      aria-label={`${connection.name} tunnel path`}
      title={pathTitle || referencedChain?.name || connection.tunnelChainId}
    >
      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
        {referencedChain && (
          <span className="max-w-28 truncate rounded bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[10px] text-[var(--color-primary)]">
            {referencedChain.name}
          </span>
        )}
        {!referencedChain && layers.length > 0 && (
          <span className="rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]">
            {t("proxyChainMenu.associations.inline", "Inline")}
          </span>
        )}
        {visibleLayers.map((layer) => (
          <span
            key={layer.id}
            className={`max-w-24 truncate rounded border px-1.5 py-0.5 text-[10px] ${
              layer.enabled
                ? "border-[var(--color-accent)]/30 text-[var(--color-textSecondary)]"
                : "border-[var(--color-border)] text-[var(--color-textMuted)] line-through"
            }`}
          >
            {layer.name || layer.type}
          </span>
        ))}
        {hiddenLayerCount > 0 && (
          <span className="text-[10px] text-[var(--color-textMuted)]">
            +{hiddenLayerCount}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="sor-icon-btn-xs flex-shrink-0 text-error hover:text-error"
        title={t(
          "proxyChainMenu.associations.clearTunnelPath",
          "Clear tunnel path",
        )}
        aria-label={t(
          "proxyChainMenu.associations.clearTunnelPathFor",
          "Clear tunnel path for {{name}}",
          { name: connection.name },
        )}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

function AssociationsTab({ mgr }: { mgr: Mgr }) {
  const { t } = useTranslation();
  const [savedTunnelChains, setSavedTunnelChains] = useState<
    SavedTunnelChain[]
  >([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [assignmentFilter, setAssignmentFilter] =
    useState<AssignmentFilter>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setSavedTunnelChains(proxyCollectionManager.getTunnelChains());
    return proxyCollectionManager.subscribe(() => {
      setSavedTunnelChains(proxyCollectionManager.getTunnelChains());
    });
  }, []);

  const connectionChainOptions = useMemo(
    () => [
      { value: "", label: t("proxyChainMenu.associations.none", "None") },
      ...mgr.connectionChains.map((chain) => ({
        value: chain.id,
        label: chain.name,
      })),
    ],
    [mgr.connectionChains, t],
  );
  const proxyChainOptions = useMemo(
    () => [
      { value: "", label: t("proxyChainMenu.associations.none", "None") },
      ...mgr.proxyChains.map((chain) => ({
        value: chain.id,
        label: chain.name,
      })),
    ],
    [mgr.proxyChains, t],
  );
  const tunnelChainOptions = useMemo(
    () => [
      { value: "", label: t("proxyChainMenu.associations.none", "None") },
      ...savedTunnelChains.map((chain) => ({
        value: chain.id,
        label: `${chain.name} (${chain.layers.length})`,
      })),
    ],
    [savedTunnelChains, t],
  );

  const associationSearchCatalog = useMemo<AssociationSearchCatalog>(
    () => ({
      connectionChains: new Map(
        mgr.connectionChains.map((chain) => [chain.id, chain.name]),
      ),
      proxyChains: new Map(
        mgr.proxyChains.map((chain) => [chain.id, chain.name]),
      ),
      tunnelChains: new Map(
        savedTunnelChains.map((chain) => [
          chain.id,
          [
            chain.name,
            ...chain.layers.flatMap((layer) => [layer.name, layer.type]),
          ]
            .filter(Boolean)
            .join(" "),
        ]),
      ),
    }),
    [mgr.connectionChains, mgr.proxyChains, savedTunnelChains],
  );

  const associationSearchIndex = useMemo(
    () =>
      new Map(
        mgr.connectionOptions.map((connection) => [
          connection.id,
          connectionSearchText(connection, associationSearchCatalog),
        ]),
      ),
    [associationSearchCatalog, mgr.connectionOptions],
  );

  const configuredCount = useMemo(
    () => mgr.connectionOptions.filter(hasAssociation).length,
    [mgr.connectionOptions],
  );

  const filteredConnections = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return mgr.connectionOptions
      .filter((connection) => {
        const configured = hasAssociation(connection);
        if (assignmentFilter === "configured" && !configured) return false;
        if (assignmentFilter === "unconfigured" && configured) return false;
        return (
          !query || associationSearchIndex.get(connection.id)?.includes(query)
        );
      })
      .sort((left, right) => {
        const result = left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sortDirection === "asc" ? result : -result;
      });
  }, [
    assignmentFilter,
    associationSearchIndex,
    mgr.connectionOptions,
    searchTerm,
    sortDirection,
  ]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredConnections.length / pageSize),
  );
  const currentPage = Math.min(page, pageCount);
  const pageConnections = filteredConnections.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const resetToFirstPage = () => setPage(1);
  const clearTunnelPath = (connectionId: string) => {
    mgr.updateTunnelChainRef(connectionId, "");
    mgr.clearTunnelChain(connectionId);
  };

  const firstResult =
    filteredConnections.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastResult = Math.min(
    currentPage * pageSize,
    filteredConnections.length,
  );

  return (
    <div className="space-y-4" data-testid="associations-tab">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <Link2 size={15} aria-hidden="true" />
            {t("proxyChainMenu.associations.title", "Connection Associations")}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            {t(
              "proxyChainMenu.associations.description",
              "Associate reusable connection, proxy, and tunnel chains with individual connections. These choices are used when launching sessions.",
            )}
          </p>
        </div>
        <div
          className="text-xs text-[var(--color-textMuted)]"
          aria-live="polite"
        >
          {t(
            "proxyChainMenu.associations.configuredSummary",
            "{{configured}} of {{total}} configured",
            {
              configured: configuredCount,
              total: mgr.connectionOptions.length,
            },
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/40 p-2.5">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">
            {t("proxyChainMenu.associations.searchLabel", "Search connections")}
          </span>
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              resetToFirstPage();
            }}
            placeholder={t(
              "proxyChainMenu.associations.searchPlaceholder",
              "Search name, host, protocol, or chain…",
            )}
            className="sor-form-input w-full pl-8"
            data-testid="associations-search"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <span>{t("proxyChainMenu.associations.show", "Show")}</span>
          <select
            value={assignmentFilter}
            onChange={(event) => {
              setAssignmentFilter(event.target.value as AssignmentFilter);
              resetToFirstPage();
            }}
            className="sor-form-input min-w-32"
            aria-label={t(
              "proxyChainMenu.associations.assignmentFilter",
              "Filter by association status",
            )}
            data-testid="associations-filter"
          >
            <option value="all">
              {t("proxyChainMenu.associations.filterAll", "All connections")}
            </option>
            <option value="configured">
              {t("proxyChainMenu.associations.filterConfigured", "Configured")}
            </option>
            <option value="unconfigured">
              {t(
                "proxyChainMenu.associations.filterUnconfigured",
                "Unconfigured",
              )}
            </option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
            resetToFirstPage();
          }}
          className="sor-option-chip text-xs"
          title={
            sortDirection === "asc"
              ? t("proxyChainMenu.associations.sortDescending", "Sort Z to A")
              : t("proxyChainMenu.associations.sortAscending", "Sort A to Z")
          }
          aria-label={
            sortDirection === "asc"
              ? t("proxyChainMenu.associations.sortDescending", "Sort Z to A")
              : t("proxyChainMenu.associations.sortAscending", "Sort A to Z")
          }
          data-testid="associations-sort"
        >
          {sortDirection === "asc" ? (
            <ArrowDownAZ size={13} aria-hidden="true" />
          ) : (
            <ArrowUpAZ size={13} aria-hidden="true" />
          )}
          {sortDirection === "asc" ? "A–Z" : "Z–A"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table
          className="w-full min-w-[980px] border-collapse text-left text-xs"
          data-testid="associations-table"
        >
          <caption className="sr-only">
            {t(
              "proxyChainMenu.associations.tableCaption",
              "Connection-to-chain associations",
            )}
          </caption>
          <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
            <tr>
              <th scope="col" className="w-64 px-3 py-2 font-medium">
                {t("proxyChainMenu.associations.connection", "Connection")}
              </th>
              <th scope="col" className="w-52 px-3 py-2 font-medium">
                {t(
                  "proxyChainMenu.associations.connectionChain",
                  "Connection Chain",
                )}
              </th>
              <th scope="col" className="w-52 px-3 py-2 font-medium">
                {t("proxyChainMenu.associations.proxyChain", "Proxy Chain")}
              </th>
              <th scope="col" className="w-52 px-3 py-2 font-medium">
                {t("proxyChainMenu.associations.tunnelChain", "Tunnel Chain")}
              </th>
              <th scope="col" className="min-w-56 px-3 py-2 font-medium">
                {t("proxyChainMenu.associations.path", "Tunnel Path")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {pageConnections.map((connection) => (
              <tr
                key={connection.id}
                className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                data-testid={`association-row-${connection.id}`}
              >
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <div
                    className="max-w-60 truncate font-medium text-[var(--color-text)]"
                    title={connection.name}
                  >
                    {connection.name}
                  </div>
                  <div className="mt-0.5 max-w-60 truncate font-mono text-[10px] text-[var(--color-textMuted)]">
                    {[connection.protocol?.toUpperCase(), connection.hostname]
                      .filter(Boolean)
                      .join(" · ") || connection.id}
                  </div>
                </th>
                <td className="px-3 py-2.5">
                  <Select
                    value={connection.connectionChainId || ""}
                    onChange={(value) =>
                      mgr.updateConnectionChain(connection.id, value)
                    }
                    options={connectionChainOptions}
                    variant="form-sm"
                    searchable
                    searchPlaceholder={t(
                      "proxyChainMenu.associations.searchConnectionChains",
                      "Search connection chains…",
                    )}
                    label={t(
                      "proxyChainMenu.associations.connectionChainFor",
                      "Connection chain for {{name}}",
                      { name: connection.name },
                    )}
                    className="w-full"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Select
                    value={connection.proxyChainId || ""}
                    onChange={(value) =>
                      mgr.updateProxyChain(connection.id, value)
                    }
                    options={proxyChainOptions}
                    variant="form-sm"
                    searchable
                    searchPlaceholder={t(
                      "proxyChainMenu.associations.searchProxyChains",
                      "Search proxy chains…",
                    )}
                    label={t(
                      "proxyChainMenu.associations.proxyChainFor",
                      "Proxy chain for {{name}}",
                      { name: connection.name },
                    )}
                    className="w-full"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Select
                    value={connection.tunnelChainId || ""}
                    onChange={(value) =>
                      mgr.updateTunnelChainRef(connection.id, value)
                    }
                    options={tunnelChainOptions}
                    variant="form-sm"
                    searchable
                    searchPlaceholder={t(
                      "proxyChainMenu.associations.searchTunnelChains",
                      "Search tunnel chains…",
                    )}
                    label={t(
                      "proxyChainMenu.associations.tunnelChainFor",
                      "Tunnel chain for {{name}}",
                      { name: connection.name },
                    )}
                    className="w-full"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <TunnelPathSummary
                    connection={connection}
                    onClear={() => clearTunnelPath(connection.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pageConnections.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-[var(--color-textMuted)]">
            {mgr.connectionOptions.length === 0
              ? t(
                  "proxyChainMenu.associations.noConnections",
                  "No connections available.",
                )
              : t(
                  "proxyChainMenu.associations.noMatches",
                  "No connections match the current search and filter.",
                )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-textSecondary)]">
        <div aria-live="polite">
          {t(
            "proxyChainMenu.associations.resultRange",
            "Showing {{first}}–{{last}} of {{total}}",
            {
              first: firstResult,
              last: lastResult,
              total: filteredConnections.length,
            },
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span>{t("proxyChainMenu.associations.rowsPerPage", "Rows")}</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                resetToFirstPage();
              }}
              className="sor-form-input py-1"
              aria-label={t(
                "proxyChainMenu.associations.rowsPerPageLabel",
                "Rows per page",
              )}
              data-testid="associations-page-size"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>
            {t(
              "proxyChainMenu.associations.pageSummary",
              "Page {{page}} of {{pages}}",
              { page: currentPage, pages: pageCount },
            )}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title={t(
              "proxyChainMenu.associations.previousPage",
              "Previous page",
            )}
            aria-label={t(
              "proxyChainMenu.associations.previousPage",
              "Previous page",
            )}
            data-testid="associations-previous-page"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            disabled={currentPage >= pageCount}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title={t("proxyChainMenu.associations.nextPage", "Next page")}
            aria-label={t("proxyChainMenu.associations.nextPage", "Next page")}
            data-testid="associations-next-page"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/50 p-3 text-xs text-[var(--color-textSecondary)]">
        <strong>
          {t("proxyChainMenu.associations.infoTitle", "Tunnel Chains")}
        </strong>{" "}
        {t(
          "proxyChainMenu.associations.infoBody",
          "define an ordered sequence of tunnels (VPN, SSH jump hosts, proxies) that traffic traverses before reaching the target host. Chains are linked by reference, so updates apply to every associated connection.",
        )}
      </div>
    </div>
  );
}

export default AssociationsTab;
