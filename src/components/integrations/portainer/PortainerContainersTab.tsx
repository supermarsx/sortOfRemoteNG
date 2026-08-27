// Portainer — Containers tab (t64-e4): endpoint select, "all" toggle,
// start/stop/restart, logs drawer with tail select.
import React, { useCallback, useEffect, useState } from "react";
import { FileText, Play, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortainerContainer } from "../../../types/portainer";
import {
  btn,
  field,
  Labeled,
  quiet,
  Toolbar,
  type PortainerTabProps,
} from "./shared";

const TAIL_OPTIONS = [50, 100, 200, 500, 1000] as const;

export const containerDisplayName = (c: PortainerContainer): string =>
  c.names?.[0]?.replace(/^\//, "") || c.id.slice(0, 12);

export const PortainerContainersTab: React.FC<
  PortainerTabProps & {
    endpointId: number | null;
    onEndpointChange: (endpointId: number | null) => void;
  }
> = ({ mgr, endpointId, onEndpointChange }) => {
  const { t } = useTranslation();
  const [all, setAll] = useState(true);
  const [tail, setTail] = useState<number>(100);
  const [logsFor, setLogsFor] = useState<PortainerContainer | null>(null);

  // Load endpoints once so the select can be populated; pick the first one.
  useEffect(() => {
    if (mgr.endpoints.length === 0) {
      void quiet(async () => {
        const eps = await mgr.loadEndpoints();
        if (endpointId == null && eps.length > 0) onEndpointChange(eps[0].id);
      });
    } else if (endpointId == null) {
      onEndpointChange(mgr.endpoints[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (endpointId == null) return;
    await quiet(() => mgr.loadContainers(endpointId, all));
  }, [mgr, endpointId, all]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointId, all]);

  const act = useCallback(
    async (op: () => Promise<void>) => {
      await quiet(op);
      await refresh();
    },
    [refresh],
  );

  const openLogs = useCallback(
    async (c: PortainerContainer, n = tail) => {
      if (endpointId == null) return;
      setLogsFor(c);
      await quiet(() => mgr.loadLogs(endpointId, c.id, n));
    },
    [mgr, endpointId, tail],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="portainer-containers-tab">
      <Toolbar>
        <Labeled label={t("integrations.portainer.environment", "Environment")}>
          <select
            className={field}
            style={{ width: 220 }}
            value={endpointId ?? ""}
            onChange={(e) =>
              onEndpointChange(e.target.value ? Number(e.target.value) : null)
            }
            data-testid="portainer-endpoint-select"
          >
            {mgr.endpoints.length === 0 && <option value="">—</option>}
            {mgr.endpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name}
              </option>
            ))}
          </select>
        </Labeled>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
            data-testid="portainer-containers-all"
          />
          {t("integrations.portainer.showAll", "Show stopped containers")}
        </label>
        <button
          className={btn}
          onClick={() => void refresh()}
          disabled={mgr.busy || endpointId == null}
        >
          <RefreshCw size={12} />
          {t("integrations.portainer.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.portainer.name", "Name")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.image", "Image")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.state", "State")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.status", "Status")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.actions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {mgr.containers.map((c) => {
              const running = c.state === "running";
              return (
                <tr
                  key={c.id}
                  className="border-t border-[var(--color-border)]"
                  data-testid="portainer-container-row"
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {containerDisplayName(c)}
                  </td>
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                    {c.image ?? "—"}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={
                        running
                          ? "text-green-500"
                          : "text-[var(--color-textSecondary)]"
                      }
                    >
                      {c.state ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {c.status ?? "—"}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <button
                        className={btn}
                        disabled={mgr.busy || running || endpointId == null}
                        onClick={() =>
                          void act(() => mgr.startContainer(endpointId!, c.id))
                        }
                        title={t("integrations.portainer.start", "Start")}
                        data-testid="portainer-container-start"
                      >
                        <Play size={12} />
                        {t("integrations.portainer.start", "Start")}
                      </button>
                      <button
                        className={btn}
                        disabled={mgr.busy || !running || endpointId == null}
                        onClick={() =>
                          void act(() => mgr.stopContainer(endpointId!, c.id))
                        }
                        title={t("integrations.portainer.stop", "Stop")}
                        data-testid="portainer-container-stop"
                      >
                        <Square size={12} />
                        {t("integrations.portainer.stop", "Stop")}
                      </button>
                      <button
                        className={btn}
                        disabled={mgr.busy || endpointId == null}
                        onClick={() =>
                          void act(() =>
                            mgr.restartContainer(endpointId!, c.id),
                          )
                        }
                        title={t("integrations.portainer.restart", "Restart")}
                        data-testid="portainer-container-restart"
                      >
                        <RotateCcw size={12} />
                        {t("integrations.portainer.restart", "Restart")}
                      </button>
                      <button
                        className={btn}
                        disabled={mgr.busy || endpointId == null}
                        onClick={() => void openLogs(c)}
                        data-testid="portainer-container-logs"
                      >
                        <FileText size={12} />
                        {t("integrations.portainer.logs", "Logs")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {mgr.containers.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.portainer.noContainers", "No containers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {logsFor && (
        <div
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3"
          data-testid="portainer-logs-drawer"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[var(--color-text)]">
              {t("integrations.portainer.logsFor", "Logs")}:{" "}
              {containerDisplayName(logsFor)}
            </span>
            <select
              className={field}
              style={{ width: 110 }}
              value={tail}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTail(n);
                void openLogs(logsFor, n);
              }}
              data-testid="portainer-logs-tail"
            >
              {TAIL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t("integrations.portainer.tailN", "Last {{n}} lines", {
                    n,
                  })}
                </option>
              ))}
            </select>
            <button
              className={btn}
              onClick={() => void openLogs(logsFor)}
              disabled={mgr.busy}
            >
              <RefreshCw size={12} />
              {t("integrations.portainer.refresh", "Refresh")}
            </button>
            <button
              className={`${btn} ml-auto`}
              onClick={() => {
                setLogsFor(null);
                mgr.clearLogs();
              }}
              data-testid="portainer-logs-close"
            >
              <X size={12} />
              {t("integrations.portainer.close", "Close")}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
            {mgr.logs.length === 0
              ? t("integrations.portainer.noLogs", "No log output")
              : mgr.logs.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.stream === "stderr" ? "text-red-400" : undefined
                    }
                  >
                    {line.text}
                  </div>
                ))}
          </pre>
        </div>
      )}
    </div>
  );
};

export default PortainerContainersTab;
