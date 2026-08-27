// Portainer — Stacks tab (t64-e4): list, start/stop.
import React, { useCallback, useEffect } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { btn, quiet, Toolbar, type PortainerTabProps } from "./shared";

const STACK_TYPES: Record<number, string> = {
  1: "Swarm",
  2: "Compose",
  3: "Kubernetes",
};

export const PortainerStacksTab: React.FC<PortainerTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const refresh = useCallback(() => quiet(() => mgr.loadStacks()), [mgr]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endpointName = (id?: number | null) =>
    mgr.endpoints.find((e) => e.id === id)?.name ??
    (id != null ? `#${id}` : "—");

  return (
    <div className="flex flex-col gap-3" data-testid="portainer-stacks-tab">
      <Toolbar>
        <button
          className={btn}
          onClick={() => void refresh()}
          disabled={mgr.busy}
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
                {t("integrations.portainer.type", "Type")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.environment", "Environment")}
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
            {mgr.stacks.map((s) => {
              const active = s.status === 1;
              const eid = s.endpointId;
              return (
                <tr
                  key={s.id}
                  className="border-t border-[var(--color-border)]"
                  data-testid="portainer-stack-row"
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {s.name}
                  </td>
                  <td className="px-2 py-1">
                    {s.type != null
                      ? (STACK_TYPES[s.type] ?? String(s.type))
                      : "—"}
                  </td>
                  <td className="px-2 py-1">{endpointName(eid)}</td>
                  <td className="px-2 py-1">
                    <span
                      className={
                        active
                          ? "text-green-500"
                          : "text-[var(--color-textSecondary)]"
                      }
                    >
                      {active
                        ? t("integrations.portainer.stackActive", "Active")
                        : t("integrations.portainer.stackInactive", "Inactive")}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <button
                        className={btn}
                        disabled={mgr.busy || active || eid == null}
                        onClick={() =>
                          void quiet(async () => {
                            await mgr.startStack(s.id, eid!);
                            await mgr.loadStacks();
                          })
                        }
                        data-testid="portainer-stack-start"
                      >
                        <Play size={12} />
                        {t("integrations.portainer.start", "Start")}
                      </button>
                      <button
                        className={btn}
                        disabled={mgr.busy || !active || eid == null}
                        onClick={() =>
                          void quiet(async () => {
                            await mgr.stopStack(s.id, eid!);
                            await mgr.loadStacks();
                          })
                        }
                        data-testid="portainer-stack-stop"
                      >
                        <Square size={12} />
                        {t("integrations.portainer.stop", "Stop")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {mgr.stacks.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.portainer.noStacks", "No stacks")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PortainerStacksTab;
