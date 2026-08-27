// Portainer — Environments (endpoints) tab (t64-e4).
import React, { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { btn, quiet, Toolbar, type PortainerTabProps } from "./shared";

const ENDPOINT_TYPES: Record<number, string> = {
  1: "Docker",
  2: "Docker (agent)",
  3: "Azure ACI",
  4: "Edge agent",
  5: "Kubernetes",
  6: "Kubernetes (agent)",
  7: "Kubernetes (edge)",
};

export const PortainerEndpointsTab: React.FC<
  PortainerTabProps & { onSelectEndpoint?: (endpointId: number) => void }
> = ({ mgr, onSelectEndpoint }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (mgr.endpoints.length === 0) void quiet(() => mgr.loadEndpoints());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="portainer-endpoints-tab">
      <Toolbar>
        <button
          className={btn}
          onClick={() => void quiet(() => mgr.loadEndpoints())}
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
                {t("integrations.portainer.url", "URL")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.status", "Status")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.containers", "Containers")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.portainer.actions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {mgr.endpoints.map((ep) => {
              const snap = ep.snapshots?.[0];
              const up = ep.status === 1;
              return (
                <tr
                  key={ep.id}
                  className="border-t border-[var(--color-border)]"
                  data-testid="portainer-endpoint-row"
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {ep.name}
                  </td>
                  <td className="px-2 py-1">
                    {ep.type != null
                      ? (ENDPOINT_TYPES[ep.type] ?? String(ep.type))
                      : "—"}
                  </td>
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                    {ep.url ?? "—"}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={
                        up
                          ? "text-green-500"
                          : "text-[var(--color-textSecondary)]"
                      }
                    >
                      {up
                        ? t("integrations.portainer.endpointUp", "Up")
                        : t("integrations.portainer.endpointDown", "Down")}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    {snap
                      ? `${snap.runningContainerCount ?? 0} / ${
                          (snap.runningContainerCount ?? 0) +
                          (snap.stoppedContainerCount ?? 0)
                        }`
                      : "—"}
                  </td>
                  <td className="px-2 py-1">
                    <button
                      className={btn}
                      onClick={() => onSelectEndpoint?.(ep.id)}
                    >
                      {t(
                        "integrations.portainer.browseContainers",
                        "Browse containers",
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
            {mgr.endpoints.length === 0 && (
              <tr>
                <td
                  className="px-2 py-3 text-[var(--color-textMuted)]"
                  colSpan={6}
                >
                  {t("integrations.portainer.noEndpoints", "No environments")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PortainerEndpointsTab;
