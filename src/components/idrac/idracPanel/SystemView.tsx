import React from "react";
import { useTranslation } from "react-i18next";
import { Server, Tag, Lightbulb, Loader2 } from "lucide-react";
import type { SubProps } from "./types";

const SystemView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const sys = mgr.systemInfo;
  const idr = mgr.idracInfo;

  if (mgr.loading && !sys) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-textSecondary)]" />
      </div>
    );
  }

  if (!sys || !idr) {
    return (
      <div className="flex items-center justify-center flex-1 text-xs text-[var(--color-textSecondary)]">
        {t("idrac.no_data", "No data available")}
      </div>
    );
  }

  const sysFields = [
    ["ID", sys.id],
    ["Manufacturer", sys.manufacturer],
    ["Model", sys.model],
    ["Serial Number", sys.serialNumber],
    ["Service Tag", sys.serviceTag],
    ["SKU", sys.sku],
    ["BIOS Version", sys.biosVersion],
    ["Hostname", sys.hostname],
    ["Power State", sys.powerState],
    ["Indicator LED", sys.indicatorLed],
    ["Asset Tag", sys.assetTag],
    ["Memory", `${sys.memoryGib} GiB`],
    ["Processors", `${sys.processorCount}× ${sys.processorModel}`],
  ];

  const idracFields = [
    ["Firmware Version", idr.firmwareVersion],
    ["iDRAC Type", idr.idracType],
    ["IP Address", idr.ipAddress],
    ["MAC Address", idr.macAddress],
    ["Model", idr.model],
    ["Generation", idr.generation],
    ["License Type", idr.licenseType],
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-warning" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">
            {t("idrac.system.server_info", "Server Information")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {sysFields.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="text-[10px] text-[var(--color-textSecondary)] w-28 shrink-0">
                {label}:
              </span>
              <span className="text-[10px] text-[var(--color-text)] truncate">
                {value ?? "N/A"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">
            {t("idrac.system.idrac_info", "iDRAC Information")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {idracFields.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="text-[10px] text-[var(--color-textSecondary)] w-28 shrink-0">
                {label}:
              </span>
              <span className="text-[10px] text-[var(--color-text)] truncate">
                {value ?? "N/A"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SystemView;
