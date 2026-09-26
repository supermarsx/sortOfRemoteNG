import { useState } from "react";
import {
  CheckCheck,
  ListChecks,
  ListX,
  Settings2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Checkbox, NumberInput, TextInput } from "../ui/forms";
import { getConnectionIconDefinition } from "../../utils/icons/connectionIconCatalog";
import {
  getProtocolDefaultIcon,
  getProtocolDefaultIconKey,
} from "../../utils/icons/resolveConnectionIcon";
import {
  DISCOVERY_SERVICE_PRESETS,
  DEFAULT_DISCOVERY_PROTOCOLS,
  configuredDiscoveryPorts,
  type DiscoveryServicePreset,
} from "../../utils/discovery/discoveryPresets";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";

type Manager = ReturnType<typeof useNetworkDiscovery>;

// Reuse the connection tree's service/vendor artwork, including HTTP variants.
const SERVICE_ICONS = Object.fromEntries(
  DISCOVERY_SERVICE_PRESETS.map((preset) => [
    preset.id,
    getConnectionIconDefinition(preset.id.replace(/-(?:http|tls)$/, ""))
      ?.icon ??
      getProtocolDefaultIcon(
        getProtocolDefaultIconKey(preset.id) ? preset.id : preset.protocol,
      ),
  ]),
);

function ServicePorts({
  preset,
  mgr,
}: {
  preset: DiscoveryServicePreset;
  mgr: Manager;
}) {
  const [draft, setDraft] = useState(
    (mgr.config.customPorts[preset.id] ?? preset.ports).join(", "),
  );
  const invalid =
    !draft.trim() ||
    draft
      .split(",")
      .some(
        (part) =>
          !/^\d+$/.test(part.trim()) ||
          Number(part) < 1 ||
          Number(part) > 65535,
      );
  return (
    <div className="mt-2 pl-6">
      <TextInput
        aria-label={`${preset.label} ports`}
        value={draft}
        variant="form"
        aria-invalid={invalid}
        onChange={(value) => {
          setDraft(value);
          mgr.setConfig((current) => ({
            ...current,
            customPorts: {
              ...current.customPorts,
              [preset.id]: value
                .split(",")
                .map((part) =>
                  /^\d+$/.test(part.trim()) ? Number(part) : NaN,
                ),
            },
          }));
        }}
      />
      {invalid && (
        <p className="mt-1 text-xs text-error">
          Enter TCP ports from 1 to 65535, separated by commas.
        </p>
      )}
    </div>
  );
}

export function DiscoveryConfigSidebar({ mgr }: { mgr: Manager }) {
  const [filter, setFilter] = useState("");
  const presets = DISCOVERY_SERVICE_PRESETS.filter((preset) =>
    `${preset.label} ${preset.group} ${preset.ports.join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const groups = [...new Set(presets.map((preset) => preset.group))];
  const ports = configuredDiscoveryPorts(mgr.config);
  const pingMethod = mgr.config.pingMethod ?? "none";
  return (
    <aside
      aria-label="Discovery configuration"
      data-testid="discovery-config-sidebar"
      className="min-h-0 w-full shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 lg:w-80 xl:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <Settings2 size={17} className="text-primary" />
        <h3 className="font-semibold">Scan configuration</h3>
      </div>
      <fieldset
        disabled={mgr.isScanning}
        className="space-y-5 p-4 disabled:opacity-70"
      >
        <section className="space-y-2">
          <label
            className="block text-sm font-medium"
            htmlFor="discovery-subnet"
          >
            {mgr.t("networkDiscovery.ipRange")}
          </label>
          <TextInput
            id="discovery-subnet"
            aria-label={mgr.t("networkDiscovery.ipRange")}
            value={mgr.config.ipRange}
            onChange={(ipRange) =>
              mgr.setConfig((current) => ({ ...current, ipRange }))
            }
            variant="form"
            placeholder="192.168.1.0/24"
          />
          <p className="text-xs text-[var(--color-textSecondary)]">
            One IP or subnet; up to 256 addresses. Only scans when you press
            Start Scan.
          </p>
        </section>

        <section
          aria-label="Host discovery"
          className="space-y-3 border-t border-[var(--color-border)] pt-4"
        >
          <h4 className="text-sm font-semibold">Host discovery</h4>
          <label className="block text-xs text-[var(--color-textSecondary)]">
            Ping method
            <select
              aria-label="Ping method"
              className="sor-form-select mt-1 w-full"
              value={pingMethod}
              disabled={!mgr.native}
              onChange={(event) =>
                mgr.setConfig((current) => ({
                  ...current,
                  pingMethod: event.target.value as "none" | "icmp" | "tcp",
                }))
              }
            >
              <option value="none">Ignore ping — probe every address</option>
              <option value="icmp">ICMP echo</option>
              <option value="tcp">TCP connection</option>
            </select>
          </label>
          {!mgr.native && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              These host-discovery controls require the native Network Scanner
              tab.
            </p>
          )}
          {pingMethod !== "none" && (
            <>
              <label className="block text-xs">
                Ping timeout (ms)
                <NumberInput
                  aria-label="Ping timeout (ms)"
                  variant="form"
                  className="mt-1 w-full"
                  min={100}
                  max={30000}
                  value={mgr.config.pingTimeout ?? 1000}
                  onChange={(pingTimeout) =>
                    mgr.setConfig((current) => ({ ...current, pingTimeout }))
                  }
                />
              </label>
              {pingMethod === "tcp" && (
                <label className="block text-xs">
                  TCP ping port
                  <NumberInput
                    aria-label="TCP ping port"
                    variant="form"
                    className="mt-1 w-full"
                    min={1}
                    max={65535}
                    value={mgr.config.pingPort ?? 443}
                    onChange={(pingPort) =>
                      mgr.setConfig((current) => ({ ...current, pingPort }))
                    }
                  />
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={mgr.config.scanUnresponsiveHosts !== false}
                  onChange={(scanUnresponsiveHosts) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      scanUnresponsiveHosts,
                    }))
                  }
                />
                <span>Scan hosts that do not reply to ping</span>
              </label>
            </>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            No ping reply does not prove a host is down. Firewalls may block
            ICMP or the selected TCP port.
          </p>
        </section>

        <section
          aria-label="Service discovery"
          className="space-y-3 border-t border-[var(--color-border)] pt-4"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Services to discover</h4>
            <span className="text-xs text-[var(--color-textSecondary)]">
              {mgr.config.protocols.length} selected
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={() =>
                mgr.setConfig((current) => ({
                  ...current,
                  protocols: [...DEFAULT_DISCOVERY_PROTOCOLS],
                }))
              }
            >
              <ListChecks size={14} aria-hidden="true" className="shrink-0" />
              Common
            </button>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={() =>
                mgr.setConfig((current) => ({
                  ...current,
                  protocols: DISCOVERY_SERVICE_PRESETS.map(
                    (preset) => preset.id,
                  ),
                }))
              }
            >
              <CheckCheck size={14} aria-hidden="true" className="shrink-0" />
              Select all services
            </button>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={() =>
                mgr.setConfig((current) => ({ ...current, protocols: [] }))
              }
            >
              <ListX size={14} aria-hidden="true" className="shrink-0" />
              Clear services
            </button>
          </div>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            />
            <TextInput
              aria-label="Filter service presets"
              variant="form"
              className="sor-form-input-icon-left w-full"
              value={filter}
              onChange={setFilter}
              placeholder="Find SSH, Synology, iLO…"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={mgr.config.identifyServices !== false}
              disabled={!mgr.native}
              onChange={(identifyServices) =>
                mgr.setConfig((current) => ({ ...current, identifyServices }))
              }
            />
            <span>HTTP product identification</span>
          </label>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {mgr.native
              ? "Banners identify services automatically. For selected web ports, this adds a bounded public-page request: no login, scripts, redirects or certificate bypass. Product names require response evidence."
              : "Banners may identify services. Additional HTTP product identification is available in the native Network Scanner tab; browser-mode requests follow browser routing behavior."}
          </p>
          {groups.map((group) => (
            <details
              key={group}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
                {group}
              </summary>
              <div className="space-y-3 px-3 pb-3">
                {presets
                  .filter((preset) => preset.group === group)
                  .map((preset) => {
                    const selected = mgr.config.protocols.includes(preset.id);
                    const ServiceIcon = SERVICE_ICONS[preset.id];
                    return (
                      <div key={preset.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <Checkbox
                            checked={selected}
                            onChange={(checked) =>
                              mgr.setConfig((current) => ({
                                ...current,
                                protocols: checked
                                  ? [...current.protocols, preset.id]
                                  : current.protocols.filter(
                                      (id) => id !== preset.id,
                                    ),
                              }))
                            }
                          />
                          <ServiceIcon
                            size={16}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]"
                          />
                          <span className="min-w-0 flex-1">
                            {preset.label}{" "}
                            <span className="block text-[10px] text-[var(--color-textMuted)]">
                              TCP {preset.ports.join(", ")}
                            </span>
                          </span>
                        </label>
                        {selected && <ServicePorts preset={preset} mgr={mgr} />}
                        {selected && preset.note && (
                          <p className="mt-1 pl-6 text-[11px] text-[var(--color-textSecondary)]">
                            {preset.note}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </details>
          ))}
          {presets.length === 0 && (
            <p className="text-xs">No matching service presets.</p>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            TCP discovery only. Cloud accounts, local serial devices, UDP-only
            discovery and remote-access IDs are not identifiable by a subnet
            port scan.
          </p>
        </section>

        <details className="border-t border-[var(--color-border)] pt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold">
            <SlidersHorizontal size={15} className="mr-2 inline" />
            {mgr.t("networkDiscovery.advanced", "Advanced")}
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block text-xs">
              Additional TCP ports / ranges
              <TextInput
                aria-label="Additional TCP ports / ranges"
                variant="form"
                className="mt-1 w-full"
                value={mgr.config.portRanges.join(", ")}
                onChange={(value) =>
                  mgr.setConfig((current) => ({
                    ...current,
                    portRanges: value.trim()
                      ? value.split(",").map((part) => part.trim())
                      : [],
                  }))
                }
                placeholder="22, 443, 8000-8010"
              />
            </label>
            <label className="block text-xs">
              Connection timeout (ms)
              <NumberInput
                aria-label="Connection timeout (ms)"
                variant="form"
                className="mt-1 w-full"
                value={mgr.config.timeout}
                min={1000}
                max={30000}
                onChange={(timeout) =>
                  mgr.setConfig((current) => ({ ...current, timeout }))
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                Concurrent hosts
                <NumberInput
                  aria-label="Concurrent hosts"
                  variant="form"
                  className="mt-1 w-full"
                  value={mgr.config.maxConcurrent}
                  min={1}
                  max={100}
                  onChange={(maxConcurrent) =>
                    mgr.setConfig((current) => ({ ...current, maxConcurrent }))
                  }
                />
              </label>
              <label className="block text-xs">
                Concurrent probes
                <NumberInput
                  aria-label="Concurrent probes"
                  variant="form"
                  className="mt-1 w-full"
                  value={mgr.config.maxPortConcurrent}
                  min={1}
                  max={100}
                  onChange={(maxPortConcurrent) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      maxPortConcurrent,
                    }))
                  }
                />
              </label>
            </div>
            <p className="text-xs text-[var(--color-textSecondary)]">
              Probe concurrency is shared across hosts and capped by both
              limits. Service identification adds a bounded response read.
            </p>
          </div>
        </details>
        <p
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs"
          role="status"
        >
          {ports.length} unique TCP ports selected · maximum 1024.
          <br />
          Overlapping service presets are probed once per port.
        </p>
      </fieldset>
    </aside>
  );
}
