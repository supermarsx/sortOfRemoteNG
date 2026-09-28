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
import { DiscoveryTargetInput } from "./DiscoveryTargetInput";
import { DiscoveryPresetPanel } from "./DiscoveryPresetPanel";
import { DiscoveryPingSettings } from "./DiscoveryPingSettings";

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
  const [serviceEditorVersion, setServiceEditorVersion] = useState(0);
  const presets = DISCOVERY_SERVICE_PRESETS.filter((preset) =>
    `${preset.label} ${preset.group} ${preset.ports.join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const groups = [...new Set(presets.map((preset) => preset.group))];
  const ports = configuredDiscoveryPorts(mgr.config);
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
        <DiscoveryTargetInput mgr={mgr} />

        <DiscoveryPresetPanel
          config={mgr.config}
          setConfig={mgr.setConfig}
          disabled={mgr.isScanning}
          onApplied={() => setServiceEditorVersion((version) => version + 1)}
        />

        <DiscoveryPingSettings mgr={mgr} />

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
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={mgr.config.serviceScanEnabled !== false}
              disabled={!mgr.native || mgr.isScanning}
              onChange={(serviceScanEnabled) => {
                if (!mgr.native || mgr.isScanning) return;
                mgr.setConfig((current) => ({
                  ...current,
                  serviceScanEnabled,
                }));
              }}
            />
            <span>Scan services / ports</span>
          </label>
          {mgr.config.serviceScanEnabled === false && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              Service scanning is off. Selected services and ports are retained.
            </p>
          )}
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
            <span>Service and web product identification</span>
          </label>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {mgr.native
              ? "Banners and bounded SMB, RDP and PostgreSQL negotiations identify services without credentials. Web probes follow up to five HTTP(S) redirects verified to stay on the scanned host. Invalid HTTPS certificates are allowed for identification only and flagged with a warning. No login or scripts; connection trust is unchanged. Product names require response evidence."
              : "Banners may identify services. Additional HTTP product identification is available in the native Network Scanner tab; browser-mode requests follow browser routing behavior."}
          </p>
          {groups.map((group) => (
            <details
              key={group}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
                <span>{group}</span>
                <span className="ml-2 text-[var(--color-textMuted)]">
                  {
                    DISCOVERY_SERVICE_PRESETS.filter(
                      (preset) =>
                        preset.group === group &&
                        mgr.config.protocols.includes(preset.id),
                    ).length
                  }
                  /
                  {
                    DISCOVERY_SERVICE_PRESETS.filter(
                      (preset) => preset.group === group,
                    ).length
                  }
                </span>
              </summary>
              <div className="space-y-3 px-3 pb-3">
                <div
                  className="flex flex-wrap gap-2"
                  aria-label={`${group} selection`}
                >
                  <button
                    type="button"
                    aria-label={`Select all ${group} services`}
                    title="Select every service in this category, including filtered services"
                    className="sor-btn-secondary-sm"
                    onClick={() =>
                      mgr.setConfig((current) => ({
                        ...current,
                        protocols: [
                          ...new Set([
                            ...current.protocols,
                            ...DISCOVERY_SERVICE_PRESETS.filter(
                              (preset) => preset.group === group,
                            ).map((preset) => preset.id),
                          ]),
                        ],
                      }))
                    }
                  >
                    <CheckCheck size={12} aria-hidden="true" /> Select all
                  </button>
                  <button
                    type="button"
                    aria-label={`Select no ${group} services`}
                    title="Clear every service in this category, including filtered services"
                    className="sor-btn-secondary-sm"
                    onClick={() =>
                      mgr.setConfig((current) => ({
                        ...current,
                        protocols: current.protocols.filter(
                          (id) =>
                            !DISCOVERY_SERVICE_PRESETS.some(
                              (preset) =>
                                preset.group === group && preset.id === id,
                            ),
                        ),
                      }))
                    }
                  >
                    <ListX size={12} aria-hidden="true" /> Select none
                  </button>
                </div>
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
                                  ? [
                                      ...new Set([
                                        ...current.protocols,
                                        preset.id,
                                      ]),
                                    ]
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
                        {selected && (
                          <ServicePorts
                            key={serviceEditorVersion}
                            preset={preset}
                            mgr={mgr}
                          />
                        )}
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
            <fieldset
              disabled={!mgr.native}
              className="space-y-3 disabled:opacity-60"
            >
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={mgr.config.nativeBatchProbes === true}
                  disabled={!mgr.native}
                  onChange={(nativeBatchProbes) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      nativeBatchProbes,
                    }))
                  }
                />
                <span>Fast Rust probe batches</span>
              </label>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Batches up to 32 probes per native call, sharing the same global
                limits. A nonzero probe launch interval spaces individual probes
                instead.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={mgr.config.resolveHostnames === true}
                  disabled={!mgr.native}
                  onChange={(resolveHostnames) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      resolveHostnames,
                    }))
                  }
                />
                <span>Resolve hostnames during scanning</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={mgr.config.adaptiveConcurrency === true}
                  disabled={!mgr.native}
                  onChange={(adaptiveConcurrency) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      adaptiveConcurrency,
                    }))
                  }
                />
                <span>Adapt workers and probes to computer / network load</span>
              </label>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Hard limits always apply. Adaptive mode adjusts new work using
                measured system CPU and available interface capacity. System CPU
                busy time uses a 0–100% scale across all logical processors.
                Utilization targets reduce concurrency while scanning continues
                by default; they do not cap system load. Unavailable
                measurements remain unknown.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={mgr.config.pauseOnHighLoad === true}
                  disabled={!mgr.native || mgr.isScanning}
                  onChange={(pauseOnHighLoad) => {
                    if (!mgr.native || mgr.isScanning) return;
                    mgr.setConfig((current) => ({
                      ...current,
                      pauseOnHighLoad,
                    }));
                  }}
                />
                <span>Pause new probes at utilization thresholds</span>
              </label>
              <p className="text-xs text-[var(--color-textSecondary)]">
                This option pauses new launches at the thresholds until load
                falls. Active probes can finish.
              </p>
              <label className="block text-xs">
                Absolute maximum active probes
                <NumberInput
                  aria-label="Absolute maximum active probes"
                  variant="form"
                  className="mt-1 w-full"
                  min={1}
                  max={1024}
                  value={mgr.config.absoluteMaxProbes ?? 256}
                  onChange={(absoluteMaxProbes) =>
                    mgr.setConfig((current) => ({
                      ...current,
                      absoluteMaxProbes,
                    }))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs">
                  System CPU target (%)
                  <NumberInput
                    aria-label="System CPU target (%)"
                    title="Requested system CPU busy-time target: 0–100% across all logical processors; not a hard cap"
                    variant="form"
                    className="mt-1 w-full"
                    min={1}
                    max={100}
                    value={mgr.config.maxCpuPercent ?? 80}
                    onChange={(maxCpuPercent) =>
                      mgr.setConfig((current) => ({
                        ...current,
                        maxCpuPercent,
                      }))
                    }
                  />
                </label>
                <label className="block text-xs">
                  Interface load target (%)
                  <NumberInput
                    aria-label="Interface load target (%)"
                    variant="form"
                    className="mt-1 w-full"
                    min={1}
                    max={100}
                    value={mgr.config.maxNetworkUtilizationPercent ?? 75}
                    onChange={(maxNetworkUtilizationPercent) =>
                      mgr.setConfig((current) => ({
                        ...current,
                        maxNetworkUtilizationPercent,
                      }))
                    }
                  />
                </label>
                <label className="block text-xs">
                  Worker launch interval (ms)
                  <NumberInput
                    aria-label="Worker launch interval (ms)"
                    variant="form"
                    className="mt-1 w-full"
                    min={0}
                    max={5000}
                    value={mgr.config.workerLaunchIntervalMs ?? 25}
                    onChange={(workerLaunchIntervalMs) =>
                      mgr.setConfig((current) => ({
                        ...current,
                        workerLaunchIntervalMs,
                      }))
                    }
                  />
                </label>
                <label className="block text-xs">
                  Probe launch interval (ms)
                  <NumberInput
                    aria-label="Probe launch interval (ms)"
                    variant="form"
                    className="mt-1 w-full"
                    min={0}
                    max={5000}
                    value={mgr.config.probeLaunchIntervalMs ?? 0}
                    onChange={(probeLaunchIntervalMs) =>
                      mgr.setConfig((current) => ({
                        ...current,
                        probeLaunchIntervalMs,
                      }))
                    }
                  />
                </label>
              </div>
            </fieldset>
            {!mgr.native && (
              <p className="text-xs text-[var(--color-textSecondary)]">
                Adaptive controls require the native Network Scanner tab.
              </p>
            )}
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
                  max={mgr.native ? 512 : 100}
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
                  max={mgr.native ? 1024 : 100}
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
