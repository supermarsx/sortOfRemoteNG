import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InternalProxySettings } from "../../../types/settings/webBrowser";
import { BrowserNumberRow, BrowserSelectRow } from "../BrowserSettingsFields";

export default function InternalProxyDnsSettings({
  config,
  update,
  disabled,
}: {
  config: InternalProxySettings;
  update: (value: Partial<InternalProxySettings>) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const command = async (clear: boolean) => {
    setBusy(true);
    setStatus("");
    try {
      if (clear) await invoke("clear_proxy_dns_caches");
      const stats = await invoke<{
        hits: number;
        misses: number;
        generation: number;
      }>("get_proxy_dns_stats");
      if (
        !stats ||
        ![stats.hits, stats.misses, stats.generation].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        )
      )
        throw Error();
      setStatus(
        `${clear ? "Proxy DNS caches invalidated for subsequent lookups. " : ""}${stats.hits} cache hits · ${stats.misses} lookups since app start.`,
      );
    } catch {
      setStatus(
        "DNS controls are unavailable. Restart the updated desktop backend and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Use the operating system resolver for the locally connected host or
        first proxy hop. Destination DNS inside CONNECT, SOCKS or SSH stays with
        that route. These controls do not change the system DNS server.
      </p>
      <BrowserSelectRow
        settingKey="internalProxy.addressFamily"
        label="Address selection"
        description="Prefer an address family, or require it. Preferences preserve the resolver’s order within each family."
        value={config.addressFamily}
        disabled={disabled}
        options={[
          { value: "system", label: "System order" },
          { value: "ipv4-first", label: "Prefer IPv4" },
          { value: "ipv6-first", label: "Prefer IPv6" },
          { value: "ipv4-only", label: "IPv4 only" },
          { value: "ipv6-only", label: "IPv6 only" },
        ]}
        onChange={(value) =>
          update({
            addressFamily: value as InternalProxySettings["addressFamily"],
          })
        }
      />
      {(
        [
          [
            "dnsTimeoutSeconds",
            "DNS lookup timeout",
            "Maximum wait for local resolution (seconds). Still bounded by the connection deadline.",
            1,
            60,
          ],
          [
            "dnsCacheTtlSeconds",
            "DNS cache lifetime",
            "Seconds to reuse a successful local result. Zero disables the app cache; the OS may still cache DNS. This is a configured reuse period, not an authoritative DNS TTL.",
            0,
            3600,
          ],
          [
            "dnsCacheMaxEntries",
            "DNS cache entries per session",
            "Bounded in-memory cache, private to each browser attempt. Reconnecting starts a fresh cache.",
            16,
            4096,
          ],
        ] as const
      ).map(([key, label, description, min, max]) => (
        <BrowserNumberRow
          key={key}
          settingKey={`internalProxy.${key}`}
          label={label}
          description={description}
          min={min}
          max={max}
          value={config[key]}
          disabled={disabled}
          onChange={(value) => update({ [key]: value })}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={disabled || busy}
          onClick={() => void command(true)}
        >
          Clear proxy DNS caches
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={disabled || busy}
          onClick={() => void command(false)}
        >
          Refresh DNS counters
        </button>
      </div>
      {status && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          {status}
        </p>
      )}
    </div>
  );
}
