import React, { useMemo, useState } from "react";
import { RefreshCw, Clock, Usb, Search, ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import { InterfaceBadge } from "./helpers";
import type { Mgr } from "./types";

export const DevicesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"serial" | "device_name">("serial");
  const [descending, setDescending] = useState(false);
  const rows = useMemo(
    () =>
      mgr.devices
        .filter((device) =>
          [
            device.device_name,
            device.serial,
            device.firmware_version,
            device.form_factor,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .slice()
        .sort((a, b) => {
          const order =
            sort === "serial"
              ? a.serial - b.serial
              : a.device_name.localeCompare(b.device_name);
          return descending ? -order : order;
        }),
    [mgr.devices, search, sort, descending],
  );
  const changeSort = (field: typeof sort) => {
    if (sort === field) setDescending(!descending);
    else {
      setSort(field);
      setDescending(false);
    }
  };
  return (
    <div className="sor-yk-devices space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {t("yubikey.devices.detected", "Detected Devices")} (
          {mgr.devices.length})
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void mgr.listDevices()}
            disabled={mgr.loading}
            className="sor-btn sor-btn-secondary text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("yubikey.devices.refresh", "Refresh")}
          </button>
          <button
            type="button"
            onClick={() => void mgr.waitForDevice(30_000)}
            disabled={mgr.loading}
            className="sor-btn sor-btn-secondary text-xs"
          >
            <Clock className="h-3.5 w-3.5" />
            {t("yubikey.devices.waitFor", "Wait for Device")}
          </button>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-textSecondary)]" />
        <input
          aria-label="Search hardware keys"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search model, serial or firmware…"
          className="sor-form-input w-full pl-9"
        />
      </div>
      {mgr.devices.length === 0 ? (
        <EmptyState
          icon={Usb}
          message={t("yubikey.devices.empty", "Insert a YubiKey")}
          hint={t(
            "yubikey.devices.emptyDesc",
            "YubiKey Manager is ready, but no keys are connected. Insert a key and refresh devices.",
          )}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
              <tr>
                <th
                  className="px-3 py-2"
                  aria-sort={
                    sort === "device_name"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => changeSort("device_name")}
                  >
                    Device
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  className="px-3 py-2"
                  aria-sort={
                    sort === "serial"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => changeSort("serial")}
                  >
                    Serial
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2">Firmware / form factor</th>
                <th className="px-3 py-2">Interfaces</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((dev) => (
                <tr
                  key={dev.serial}
                  className={
                    mgr.selectedDevice?.serial === dev.serial
                      ? "bg-primary/10"
                      : "hover:bg-[var(--color-surfaceHover)]"
                  }
                >
                  <td className="px-3 py-3 font-medium">
                    {dev.device_name || "YubiKey"}
                  </td>
                  <td className="px-3 py-3 font-mono">{dev.serial}</td>
                  <td className="px-3 py-3">
                    {dev.firmware_version}
                    <span className="block text-[var(--color-textSecondary)]">
                      {dev.form_factor}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      <span>USB</span>
                      {["Otp", "Fido", "Ccid"].map((iface) => (
                        <InterfaceBadge
                          key={iface}
                          label={iface.toUpperCase()}
                          active={
                            dev.usb_interfaces_enabled?.some(
                              (value) => value === iface,
                            ) ?? false
                          }
                        />
                      ))}
                    </div>
                    {dev.has_nfc && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span>NFC</span>
                        {dev.nfc_interfaces_enabled?.map((iface) => (
                          <InterfaceBadge
                            key={iface}
                            label={iface.toUpperCase()}
                            active
                          />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {mgr.selectedDevice?.serial === dev.serial && (
                      <span className="mr-2 text-primary">Active</span>
                    )}
                    {dev.is_fips && <span className="mr-2">FIPS</span>}
                    {dev.config_locked && <span>Config Locked</span>}
                    {dev.auto_eject_timeout > 0 && (
                      <span className="block">
                        Auto-eject: {dev.auto_eject_timeout}s
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={mgr.loading}
                      className="sor-btn sor-btn-secondary text-xs"
                      aria-label={`Select YubiKey ${dev.serial}`}
                      onClick={() => void mgr.getDeviceInfo(dev.serial)}
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-6 text-center text-[var(--color-textSecondary)]"
                  >
                    No hardware keys match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
