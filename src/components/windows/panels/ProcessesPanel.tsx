import React, { useState, useEffect, useCallback } from "react";
import {
  Search, RefreshCw, Loader2, XCircle, AlertCircle,
  ArrowUpDown,
} from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type { WindowsProcess } from "../../../types/windows/winmgmt";

type SortKey = "name" | "pid" | "memory" | "cpu" | "threads";
type SortDir = "asc" | "desc";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface ProcessesPanelProps {
  ctx: WinmgmtContext;
}

const ProcessesPanel: React.FC<ProcessesPanelProps> = ({ ctx }) => {
  const [processes, setProcesses] = useState<WindowsProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("memory");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<number | null>(null);
  const [terminating, setTerminating] = useState<number | null>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ctx.cmd<WindowsProcess[]>("winmgmt_list_processes");
      setProcesses(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  const terminateProcess = useCallback(
    async (pid: number) => {
      setTerminating(pid);
      try {
        await ctx.cmd<number>("winmgmt_terminate_process", { pid });
        await fetchProcesses();
      } catch (err) {
        setError(String(err));
      } finally {
        setTerminating(null);
      }
    },
    [ctx, fetchProcesses],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = processes
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        String(p.processId).includes(q) ||
        (p.owner?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "pid":
          cmp = a.processId - b.processId;
          break;
        case "memory":
          cmp = a.workingSetSize - b.workingSetSize;
          break;
        case "cpu":
          cmp =
            a.kernelModeTime +
            a.userModeTime -
            (b.kernelModeTime + b.userModeTime);
          break;
        case "threads":
          cmp = a.threadCount - b.threadCount;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const selectedProc = selected
    ? processes.find((p) => p.processId === selected)
    : null;
  const processSummary = `${filtered.length} processes`;

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
            placeholder="Search processes…"
            aria-label="Search processes"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={fetchProcesses}
          disabled={loading}
          aria-label="Refresh processes"
          aria-busy={loading}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-xs text-[var(--color-textMuted)] ml-auto" id="processes-summary">
          {processSummary}
        </span>
        <div className="sr-only" role="status" aria-live="polite">
          {processSummary}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Process List */}
        <div className="flex-1 overflow-auto">
          {loading && processes.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2
                size={24}
                className="animate-spin text-[var(--color-textMuted)]"
              />
            </div>
          ) : (
            <table
              className="w-full text-xs"
              aria-label="Windows processes list"
              aria-describedby="processes-summary"
            >
              <caption className="sr-only">
                Running processes with memory and owner information
              </caption>
              <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
                <tr className="text-left text-[var(--color-textSecondary)]">
                  <SortHeader
                    label="Name"
                    sortKey="name"
                    current={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="PID"
                    sortKey="pid"
                    current={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="w-16"
                  />
                  <SortHeader
                    label="Memory"
                    sortKey="memory"
                    current={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="w-20"
                  />
                  <SortHeader
                    label="Threads"
                    sortKey="threads"
                    current={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="w-16"
                  />
                  <th scope="col" className="px-3 py-2 font-medium w-20">Owner</th>
                  <th scope="col" className="px-3 py-2 font-medium w-10">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((proc) => (
                  <tr
                    key={proc.processId}
                    aria-selected={selected === proc.processId}
                    onClick={() => setSelected(proc.processId)}
                    className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                      selected === proc.processId
                        ? "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                        : "hover:bg-[var(--color-surfaceHover)]"
                    }`}
                  >
                    <td className="px-3 py-1.5 text-[var(--color-text)]">
                      {proc.name}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono">
                      {proc.processId}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono">
                      {formatBytes(proc.workingSetSize)}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)]">
                      {proc.threadCount}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textMuted)] truncate max-w-[80px]">
                      {proc.owner || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {proc.processId > 4 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            terminateProcess(proc.processId);
                          }}
                          disabled={terminating === proc.processId}
                          aria-label={`Terminate process ${proc.name} (${proc.processId})`}
                          aria-busy={terminating === proc.processId}
                          className="p-1 rounded hover:bg-red-500/20 text-red-400"
                          title="Terminate"
                        >
                          {terminating === proc.processId ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <XCircle size={12} />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Pane */}
        {selectedProc && (
          <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-auto p-3 space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {selectedProc.name}
            </h3>
            <dl className="text-xs space-y-2">
              <DetailRow label="PID" value={String(selectedProc.processId)} />
              <DetailRow
                label="Parent PID"
                value={String(selectedProc.parentProcessId)}
              />
              <DetailRow
                label="Memory"
                value={formatBytes(selectedProc.workingSetSize)}
              />
              <DetailRow
                label="Virtual"
                value={formatBytes(selectedProc.virtualSize)}
              />
              <DetailRow
                label="Peak Memory"
                value={formatBytes(selectedProc.peakWorkingSetSize)}
              />
              <DetailRow
                label="Threads"
                value={String(selectedProc.threadCount)}
              />
              <DetailRow
                label="Handles"
                value={String(selectedProc.handleCount)}
              />
              <DetailRow
                label="Priority"
                value={String(selectedProc.priority)}
              />
              <DetailRow
                label="Owner"
                value={selectedProc.owner || "N/A"}
              />
              {selectedProc.executablePath && (
                <DetailRow
                  label="Path"
                  value={selectedProc.executablePath}
                  mono
                />
              )}
              {selectedProc.commandLine && (
                <DetailRow
                  label="Command Line"
                  value={selectedProc.commandLine}
                  mono
                />
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
};

const SortHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}> = ({ label, sortKey: sk, current, dir, onSort, className }) => (
  <th
    scope="col"
    aria-sort={
      current === sk
        ? dir === "asc"
          ? "ascending"
          : "descending"
        : "none"
    }
    className={`px-3 py-2 font-medium select-none ${className || ""}`}
  >
    <button
      type="button"
      onClick={() => onSort(sk)}
      aria-label={`Sort by ${label}`}
      className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
    >
      {label}
      {current === sk && (
        <ArrowUpDown size={10} className="text-[var(--color-accent)]" />
      )}
    </button>
  </th>
);

const DetailRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <div>
    <dt className="text-[var(--color-textMuted)]">{label}</dt>
    <dd
      className={`text-[var(--color-text)] mt-0.5 ${mono ? "font-mono break-all text-[10px]" : ""}`}
    >
      {value}
    </dd>
  </div>
);

export default ProcessesPanel;
