// DrayTek — "Status" sub-tab (t68 D3): model / firmware / build / uptime and
// the WAN table from `draytek_get_status`. Every field is optional on the wire
// (firmware/model dependent), so each row renders an em-dash when absent.

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DraytekStatus } from "../../../types/draytek";
import { useDraytek } from "../../../hooks/integration/draytek/useDraytek";
import type { DraytekTabProps } from "./registry";

const EMPTY = "—";

function show(value: string | null | undefined): string {
  return value && value.trim() ? value : EMPTY;
}

const DrayTekStatusTab: React.FC<DraytekTabProps> = ({
  connectionId,
  device,
}) => {
  const { t } = useTranslation();
  const { api, loading, error, run } = useDraytek();
  const [status, setStatus] = useState<DraytekStatus | null>(null);

  const load = useCallback(async () => {
    const result = await run(() => api.getStatus(connectionId));
    if (result) setStatus(result);
  }, [api, connectionId, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const facts: Array<[string, string, string]> = [
    [
      "vendor",
      t("integrations.draytek.status.vendor", "Vendor"),
      show(device.vendor),
    ],
    ["host", t("integrations.draytek.status.host", "Host"), show(device.host)],
    [
      "model",
      t("integrations.draytek.status.model", "Model"),
      show(status?.model),
    ],
    [
      "firmware",
      t("integrations.draytek.status.firmware", "Firmware"),
      show(status?.firmware),
    ],
    [
      "build",
      t("integrations.draytek.status.build", "Build"),
      show(status?.build),
    ],
    [
      "uptime",
      t("integrations.draytek.status.uptime", "Uptime"),
      show(status?.uptime),
    ],
  ];

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="draytek-status">
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold text-[var(--color-text)]"
          data-testid="draytek-status-title"
        >
          {t("integrations.draytek.status.title", "Device status")}
        </h3>
        <button
          onClick={() => void load()}
          data-testid="draytek-status-refresh"
          disabled={loading}
          className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {t("integrations.draytek.status.refresh", "Refresh")}
        </button>
      </div>

      {error && (
        <div
          className="rounded border border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]"
          data-testid="draytek-status-error"
        >
          {error}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([key, label, value]) => (
          <React.Fragment key={key}>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              {label}
            </dt>
            <dd
              className="text-[var(--color-text)]"
              data-testid={`draytek-status-${key}`}
            >
              {value}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
          {t("integrations.draytek.status.wan", "WAN")}
        </h4>
        {status && status.wan.length > 0 ? (
          <table
            className="w-full text-left text-xs"
            data-testid="draytek-wan-table"
          >
            <thead className="text-[var(--color-textSecondary)]">
              <tr>
                <th className="py-1 pr-3 font-medium">
                  {t("integrations.draytek.status.wanName", "Interface")}
                </th>
                <th className="py-1 pr-3 font-medium">
                  {t("integrations.draytek.status.wanStatus", "Status")}
                </th>
                <th className="py-1 pr-3 font-medium">
                  {t("integrations.draytek.status.wanIp", "IP")}
                </th>
                <th className="py-1 pr-3 font-medium">
                  {t("integrations.draytek.status.wanGateway", "Gateway")}
                </th>
                <th className="py-1 pr-3 font-medium">
                  {t("integrations.draytek.status.wanMode", "Mode")}
                </th>
                <th className="py-1 font-medium">
                  {t("integrations.draytek.status.wanUptime", "Uptime")}
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-text)]">
              {status.wan.map((wan) => (
                <tr
                  key={wan.name}
                  className="border-t border-[var(--color-border)]"
                  data-testid="draytek-wan-row"
                >
                  <td className="py-1 pr-3">{show(wan.name)}</td>
                  <td className="py-1 pr-3">{show(wan.status)}</td>
                  <td className="py-1 pr-3">{show(wan.ip)}</td>
                  <td className="py-1 pr-3">{show(wan.gateway)}</td>
                  <td className="py-1 pr-3">{show(wan.mode)}</td>
                  <td className="py-1">{show(wan.uptime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {loading
              ? t("integrations.draytek.status.loading", "Loading…")
              : t(
                  "integrations.draytek.status.noWan",
                  "No WAN information reported by this device.",
                )}
          </p>
        )}
      </div>
    </div>
  );
};

export default DrayTekStatusTab;
