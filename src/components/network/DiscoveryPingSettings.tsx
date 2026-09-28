import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import {
  DEFAULT_DISCOVERY_PING_METHODS,
  DISCOVERY_PROBE_METHODS,
  DISCOVERY_PING_METHODS,
  effectiveDiscoveryPingMethod,
} from "../../utils/discovery/discoveryPing";
import { Checkbox, NumberInput, Select } from "../ui/forms";

type Manager = Pick<
  ReturnType<typeof useNetworkDiscovery>,
  "config" | "setConfig" | "native" | "isScanning"
>;
type PingMethod = (typeof DISCOVERY_PING_METHODS)[number];

const METHOD_LABELS: Record<PingMethod, string> = {
  none: "Ignore ping — probe every address",
  icmp: "ICMP echo",
  icmp4: "ICMP echo (IPv4)",
  icmp6: "ICMP echo (IPv6)",
  "icmp-native": "Windows native ICMPv4",
  arp: "ARP — LAN IPv4",
  tcp: "TCP connection",
  udp: "UDP probe",
  adaptive: "Adaptive — stop on response",
  combined: "Combined — try all selected",
};

interface ProbeCapabilities {
  platform: string;
  methods: Array<{ id: string; available: boolean; description: string }>;
}

// An older native build may not expose this command yet.
function isProbeCapabilities(value: unknown): value is ProbeCapabilities {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ProbeCapabilities>;
  return (
    typeof result.platform === "string" &&
    Array.isArray(result.methods) &&
    result.methods.every(
      (method) =>
        method &&
        typeof method.id === "string" &&
        typeof method.available === "boolean" &&
        typeof method.description === "string",
    )
  );
}

export function DiscoveryPingSettings({ mgr }: { mgr: Manager }) {
  const [capabilities, setCapabilities] = useState<ProbeCapabilities | null>(
    null,
  );
  const [capabilityStatus, setCapabilityStatus] = useState(
    "Checking probe capabilities…",
  );
  const disabled = !mgr.native || mgr.isScanning;
  const effectiveMethod = effectiveDiscoveryPingMethod(mgr.config);
  const method =
    mgr.config.hostDiscoveryEnabled === false
      ? (mgr.config.pingMethod ?? "none")
      : effectiveMethod;
  const hostDiscoveryEnabled = effectiveMethod !== "none";
  const multiple = method === "adaptive" || method === "combined";
  const selected = mgr.config.pingMethods ?? DEFAULT_DISCOVERY_PING_METHODS;
  const activeMethods = multiple ? selected : [method];
  const capability = (id: string) =>
    capabilities?.methods.find((item) => item.id === id);
  const unavailable = (id: string) => capability(id)?.available === false;

  useEffect(() => {
    if (!mgr.native) return;
    let active = true;
    const fetchCapabilities = async () => {
      try {
        const result = await invoke<unknown>(
          "get_discovery_probe_capabilities",
        );
        if (!active) return;
        if (isProbeCapabilities(result)) {
          setCapabilities(result);
          setCapabilityStatus(`Probe capabilities: ${result.platform}`);
        } else {
          setCapabilityStatus("Probe capabilities unknown.");
        }
      } catch {
        if (active) setCapabilityStatus("Probe capabilities unknown.");
      }
    };
    void fetchCapabilities();
    return () => {
      active = false;
    };
  }, [mgr.native]);

  const sweep = (pingMethod: "arp" | "adaptive") => {
    if (disabled || (pingMethod === "arp" && unavailable("arp"))) return;
    mgr.setConfig((current) => ({
      ...current,
      hostDiscoveryEnabled: true,
      serviceScanEnabled: false,
      pingMethod,
      scanUnresponsiveHosts: false,
    }));
  };

  return (
    <section
      aria-label="Host discovery"
      className="space-y-3 border-t border-[var(--color-border)] pt-4"
    >
      <h4 className="text-sm font-semibold">Host discovery</h4>
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-70">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={hostDiscoveryEnabled}
            disabled={disabled}
            onChange={(hostDiscoveryEnabled) => {
              if (disabled) return;
              mgr.setConfig((current) => ({
                ...current,
                hostDiscoveryEnabled,
                pingMethod:
                  hostDiscoveryEnabled &&
                  (current.pingMethod ?? "none") === "none"
                    ? "adaptive"
                    : current.pingMethod,
              }));
            }}
          />
          <span>Discover hosts with ping / ARP</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={disabled || unavailable("arp")}
            onClick={() => sweep("arp")}
            title={capability("arp")?.description}
          >
            ARP sweep only
          </button>
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={disabled}
            onClick={() => sweep("adaptive")}
          >
            Ping sweep only
          </button>
        </div>
        <p className="text-xs text-[var(--color-textMuted)]">
          Sweeps enable host discovery and turn off service scanning. Service
          selections and extra TCP ports are retained.
        </p>
        <label className="block text-xs text-[var(--color-textSecondary)]">
          Ping method
          <Select
            label="Ping method"
            variant="form"
            className="mt-1 w-full"
            value={method}
            disabled={disabled}
            onChange={(value) => {
              if (disabled || unavailable(value)) return;
              mgr.setConfig((current) => ({
                ...current,
                pingMethod: value as PingMethod,
                hostDiscoveryEnabled:
                  value === "none" ? false : current.hostDiscoveryEnabled,
              }));
            }}
            options={DISCOVERY_PING_METHODS.map((id) => ({
              value: id,
              label: METHOD_LABELS[id],
              disabled: unavailable(id),
              description: capability(id)?.description,
            }))}
          />
        </label>
        {method !== "none" && (
          <>
            {multiple && (
              <>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  {method === "adaptive"
                    ? "Tries suitable selected methods sequentially until a response, using one per-host timeout budget."
                    : "Tries all selected methods sequentially using one shared per-host timeout budget."}{" "}
                  No later method starts after the total deadline. No parallel
                  probes within a host.
                </p>
                <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                    Probe methods · {selected.length} selected
                  </summary>
                  <div className="space-y-2 px-3 pb-3">
                    {DISCOVERY_PROBE_METHODS.map((id) => (
                      <label
                        key={id}
                        className="flex items-start gap-2 text-xs"
                      >
                        <Checkbox
                          aria-label={METHOD_LABELS[id]}
                          checked={selected.includes(id)}
                          disabled={
                            disabled ||
                            (unavailable(id) && !selected.includes(id))
                          }
                          onChange={(checked) => {
                            if (disabled || (checked && unavailable(id)))
                              return;
                            mgr.setConfig((current) => {
                              const methods =
                                current.pingMethods ??
                                DEFAULT_DISCOVERY_PING_METHODS;
                              return {
                                ...current,
                                pingMethods: checked
                                  ? [...new Set([...methods, id])]
                                  : methods.filter((item) => item !== id),
                              };
                            });
                          }}
                        />
                        <span>
                          {METHOD_LABELS[id]}
                          {unavailable(id) && (
                            <span className="mt-1 block text-warning">
                              Unavailable: {capability(id)?.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
                {selected.length === 0 && (
                  <p role="alert" className="text-xs text-warning">
                    Select at least one probe method.
                  </p>
                )}
              </>
            )}
            {activeMethods.includes("arp") && (
              <p className="text-xs text-[var(--color-textMuted)]">
                ARP discovers IPv4 neighbors on the local LAN. Windows may use
                cached neighbor information; a responsive result does not
                necessarily mean a fresh reply. Unix requires arping and
                appropriate privileges.
              </p>
            )}
            {activeMethods.filter(unavailable).map((id) => (
              <p key={id} className="text-xs text-warning">
                {METHOD_LABELS[id]} unavailable: {capability(id)?.description}.
                Selection retained.
              </p>
            ))}
            <label className="block text-xs">
              Ping timeout (ms)
              <NumberInput
                aria-label="Ping timeout (ms)"
                variant="form"
                className="mt-1 w-full"
                min={100}
                max={30000}
                value={mgr.config.pingTimeout ?? 1000}
                disabled={disabled}
                onChange={(pingTimeout) => {
                  if (!disabled)
                    mgr.setConfig((current) => ({ ...current, pingTimeout }));
                }}
              />
            </label>
            <p className="text-xs text-[var(--color-textMuted)]">
              Total requested reachability probe budget per host.
            </p>
            {(activeMethods.includes("arp") ||
              activeMethods.includes("icmp-native")) && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Windows native ARP/ICMP calls wait for OS completion before
                releasing their probe slot. They can exceed the requested
                timeout, so this budget is not a hard limit on elapsed time.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {activeMethods.includes("tcp") && (
                <label className="block text-xs">
                  TCP ping port
                  <NumberInput
                    aria-label="TCP ping port"
                    variant="form"
                    className="mt-1 w-full"
                    min={1}
                    max={65535}
                    value={mgr.config.pingPort ?? 443}
                    disabled={disabled}
                    onChange={(pingPort) => {
                      if (!disabled)
                        mgr.setConfig((current) => ({ ...current, pingPort }));
                    }}
                  />
                </label>
              )}
              {activeMethods.includes("udp") && (
                <label className="block text-xs">
                  UDP ping port
                  <NumberInput
                    aria-label="UDP ping port"
                    variant="form"
                    className="mt-1 w-full"
                    min={1}
                    max={65535}
                    value={mgr.config.pingUdpPort ?? 53}
                    disabled={disabled}
                    onChange={(pingUdpPort) => {
                      if (!disabled)
                        mgr.setConfig((current) => ({
                          ...current,
                          pingUdpPort,
                        }));
                    }}
                  />
                </label>
              )}
            </div>
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={mgr.config.scanUnresponsiveHosts !== false}
                disabled={disabled}
                onChange={(scanUnresponsiveHosts) => {
                  if (!disabled)
                    mgr.setConfig((current) => ({
                      ...current,
                      scanUnresponsiveHosts,
                    }));
                }}
              />
              <span>Scan hosts that do not reply to ping</span>
            </label>
          </>
        )}
      </fieldset>
      {mgr.native ? (
        <p role="status" className="text-xs text-[var(--color-textMuted)]">
          {capabilityStatus}
        </p>
      ) : (
        <p className="text-xs text-[var(--color-textSecondary)]">
          These host-discovery controls require the native Network Scanner tab.
        </p>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        No ping reply does not prove a host is down. Firewalls may block probes.
      </p>
    </section>
  );
}
