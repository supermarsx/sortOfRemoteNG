import React, { useState, useEffect, useCallback } from "react";
import {
  Search, RefreshCw, Play, Square, RotateCw, Loader2,
  ChevronDown, ChevronRight, AlertCircle,
} from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type { WindowsService, ServiceState, ServiceStartMode } from "../../../types/windows/winmgmt";

const STATE_COLORS: Record<ServiceState, string> = {
  running: "text-green-400",
  stopped: "text-[var(--color-textMuted)]",
  startPending: "text-yellow-400",
  stopPending: "text-yellow-400",
  continuePending: "text-yellow-400",
  pausePending: "text-yellow-400",
  paused: "text-orange-400",
  unknown: "text-[var(--color-textMuted)]",
};

const STATE_DOTS: Record<ServiceState, string> = {
  running: "bg-green-400",
  stopped: "bg-[var(--color-textMuted)]",
  startPending: "bg-yellow-400",
  stopPending: "bg-yellow-400",
  continuePending: "bg-yellow-400",
  pausePending: "bg-yellow-400",
  paused: "bg-orange-400",
  unknown: "bg-[var(--color-textMuted)]",
};

type FilterMode = "all" | "running" | "stopped" | "auto" | "disabled";
type ServiceAction = "start" | "stop" | "restart";

interface ServicesPanelProps {
  ctx: WinmgmtContext;
}

const ServicesPanel: React.FC<ServicesPanelProps> = ({ ctx }) => {
  const [services, setServices] = useState<WindowsService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{
    name: string;
    action: ServiceAction;
  } | null>(null);
  const [deps, setDeps] = useState<string[] | null>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ctx.cmd<WindowsService[]>("winmgmt_list_services");
      setServices(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const doAction = useCallback(
    async (action: ServiceAction, name: string) => {
      setActionLoading({ name, action });
      try {
        await ctx.cmd<number>(`winmgmt_${action}_service`, { name });
        await fetchServices();
      } catch (err) {
        setError(String(err));
      } finally {
        setActionLoading(null);
      }
    },
    [ctx, fetchServices],
  );

  const fetchDeps = useCallback(
    async (name: string) => {
      try {
        const d = await ctx.cmd<string[]>("winmgmt_get_service_dependencies", {
          name,
        });
        setDeps(d);
      } catch {
        setDeps([]);
      }
    },
    [ctx],
  );

  const filtered = services.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !s.name.toLowerCase().includes(q) &&
        !s.displayName.toLowerCase().includes(q)
      )
        return false;
    }
    if (filter === "running") return s.state === "running";
    if (filter === "stopped") return s.state === "stopped";
    if (filter === "auto")
      return s.startMode === "auto" || s.startMode === "delayedAuto";
    if (filter === "disabled") return s.startMode === "disabled";
    return true;
  });

  const selectedSvc = selected
    ? services.find((s) => s.name === selected)
    : null;
  const statusSummary = `Showing ${filtered.length} of ${services.length} services`;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services…"
            aria-label="Search services"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          aria-label="Filter services"
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="auto">Auto Start</option>
          <option value="disabled">Disabled</option>
        </select>
        <button
          onClick={fetchServices}
          disabled={loading}
          aria-label="Refresh services"
          aria-busy={loading}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <span
          className="text-xs text-[var(--color-textMuted)] ml-auto"
          id="services-filter-summary"
        >
          {statusSummary}
        </span>
        <div
          id="services-filter-summary-live"
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {statusSummary}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Service List */}
        <div className="flex-1 overflow-auto">
          {loading && services.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2
                size={24}
                className="animate-spin text-[var(--color-textMuted)]"
              />
            </div>
          ) : (
            <table
              className="w-full text-xs"
              aria-label="Windows services list"
              aria-describedby="services-filter-summary"
            >
              <caption className="sr-only">
                Windows services and their current state
              </caption>
              <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
                <tr className="text-left text-[var(--color-textSecondary)]">
                  <th scope="col" className="px-3 py-2 font-medium w-8"></th>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Startup</th>
                  <th scope="col" className="px-3 py-2 font-medium">Account</th>
                  <th scope="col" className="px-3 py-2 font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((svc) => {
                  const serviceBusy = actionLoading?.name === svc.name;
                  const startBusy = serviceBusy && actionLoading?.action === "start";
                  const stopBusy = serviceBusy && actionLoading?.action === "stop";
                  const restartBusy =
                    serviceBusy && actionLoading?.action === "restart";

                  return (
                    <tr
                      key={svc.name}
                      aria-selected={selected === svc.name}
                      onClick={() => {
                        setSelected(svc.name);
                        setDeps(null);
                      }}
                      className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                        selected === svc.name
                          ? "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                          : "hover:bg-[var(--color-surfaceHover)]"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <div
                          className={`w-2 h-2 rounded-full ${STATE_DOTS[svc.state] || STATE_DOTS.unknown}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="text-[var(--color-text)] font-medium">
                          {svc.displayName}
                        </div>
                        <div className="text-[var(--color-textMuted)]">
                          {svc.name}
                        </div>
                      </td>
                      <td
                        className={`px-3 py-1.5 capitalize ${STATE_COLORS[svc.state] || ""}`}
                      >
                        {svc.state}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-textSecondary)] capitalize">
                        {svc.startMode}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono truncate max-w-[120px]">
                        {svc.startName || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          {svc.state === "stopped" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                doAction("start", svc.name);
                              }}
                              disabled={serviceBusy}
                              aria-busy={startBusy}
                              aria-label={`Start service ${svc.displayName}`}
                              className="p-1 rounded hover:bg-green-500/20 text-green-400"
                              title="Start"
                            >
                              {startBusy ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                            </button>
                          )}
                          {svc.state === "running" && svc.acceptStop && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  doAction("stop", svc.name);
                                }}
                                disabled={serviceBusy}
                                aria-busy={stopBusy}
                                aria-label={`Stop service ${svc.displayName}`}
                                className="p-1 rounded hover:bg-red-500/20 text-red-400"
                                title="Stop"
                              >
                                {stopBusy ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Square size={12} />
                                )}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  doAction("restart", svc.name);
                                }}
                                disabled={serviceBusy}
                                aria-busy={restartBusy}
                                aria-label={`Restart service ${svc.displayName}`}
                                className="p-1 rounded hover:bg-blue-500/20 text-blue-400"
                                title="Restart"
                              >
                                {restartBusy ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <RotateCw size={12} />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Pane */}
        {selectedSvc && (
          <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-auto p-3 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {selectedSvc.displayName}
            </h3>
            <dl className="text-xs space-y-2">
              <DetailRow label="Service Name" value={selectedSvc.name} />
              <DetailRow label="State" value={selectedSvc.state} />
              <DetailRow label="Start Mode" value={selectedSvc.startMode} />
              <DetailRow
                label="Account"
                value={selectedSvc.startName || "N/A"}
              />
              <DetailRow
                label="PID"
                value={
                  selectedSvc.processId != null
                    ? String(selectedSvc.processId)
                    : "—"
                }
              />
              {selectedSvc.description && (
                <DetailRow label="Description" value={selectedSvc.description} />
              )}
              {selectedSvc.pathName && (
                <DetailRow label="Path" value={selectedSvc.pathName} mono />
              )}
            </dl>

            {/* Dependencies */}
            <div>
              <button
                onClick={() => fetchDeps(selectedSvc.name)}
                className="text-xs text-[var(--color-accent)] hover:underline flex items-center gap-1"
              >
                {deps !== null ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Dependencies
              </button>
              {deps !== null && (
                <ul className="mt-1 ml-4 text-xs text-[var(--color-textSecondary)] space-y-0.5">
                  {deps.length === 0 ? (
                    <li className="text-[var(--color-textMuted)]">None</li>
                  ) : (
                    deps.map((d) => <li key={d}>{d}</li>)
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <div>
    <dt className="text-[var(--color-textMuted)]">{label}</dt>
    <dd
      className={`text-[var(--color-text)] mt-0.5 ${mono ? "font-mono break-all" : ""}`}
    >
      {value}
    </dd>
  </div>
);

export default ServicesPanel;
