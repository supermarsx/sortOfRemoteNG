import React from "react";
import {
  GlobalSettings,
  DiagnosticsConfig,
} from "../../../types/settings/settings";
import {
  Activity,
  Wifi,
  Route,
  Timer,
  Shield,
  Globe,
  Layers,
  Play,
  Eye,
  Lock,
  Radio,
  Fingerprint,
  ArrowLeftRight,
  Network,
  Search,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { Checkbox, NumberInput } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface DiagnosticsSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Shared row primitive ────────────────────────────── */

const ToggleRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}> = ({ icon, label, description, checked, onChange, tooltip }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer">
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[var(--color-text)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

/* ── Main Component ──────────────────────────────────── */

export const DiagnosticsSettings: React.FC<DiagnosticsSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const diag = settings.diagnostics;

  const update = (patch: Partial<DiagnosticsConfig>) => {
    updateSettings({ diagnostics: { ...diag, ...patch } });
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Activity className="w-5 h-5 text-primary" />}
        title="Diagnostics"
        description="Configure connection diagnostic checks: ping, traceroute, port scanning, TLS inspection, and more."
      />

      {/* Network */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Wifi className="w-4 h-4 text-primary" />}
          title="Network"
        />
        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Radio className="w-4 h-4" />
                Ping Count
                <InfoTooltip text="Number of ICMP echo requests to send during the sequential ping test. Higher values give more accurate latency and jitter statistics." />
              </label>
              <input
                type="range"
                min={1}
                max={50}
                value={diag.pingCount}
                onChange={(e) => update({ pingCount: Number(e.target.value) })}
                className="w-full accent-[var(--color-primary)]"
              />
              <div className="text-xs text-[var(--color-textMuted)] text-right">
                {diag.pingCount} pings
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Timer className="w-4 h-4" />
                Ping Timeout (s)
                <InfoTooltip text="Maximum time in seconds to wait for each ping reply before marking it as timed out." />
              </label>
              <NumberInput
                value={diag.pingTimeoutSecs}
                onChange={(v: number) => update({ pingTimeoutSecs: v })}
                className="w-full"
                min={1}
                max={30}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Timer className="w-4 h-4" />
                Ping Interval (ms)
                <InfoTooltip text="Delay in milliseconds between consecutive pings. Lower values complete faster but may be rate-limited by firewalls." />
              </label>
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={diag.pingIntervalMs}
                onChange={(e) =>
                  update({ pingIntervalMs: Number(e.target.value) })
                }
                className="w-full accent-[var(--color-primary)]"
              />
              <div className="text-xs text-[var(--color-textMuted)] text-right">
                {diag.pingIntervalMs}ms
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Route className="w-4 h-4" />
                Traceroute Max Hops
                <InfoTooltip text="Maximum number of network hops (routers) to traverse before stopping the traceroute. Increase for distant hosts." />
              </label>
              <input
                type="range"
                min={5}
                max={64}
                value={diag.tracerouteMaxHops}
                onChange={(e) =>
                  update({ tracerouteMaxHops: Number(e.target.value) })
                }
                className="w-full accent-[var(--color-primary)]"
              />
              <div className="text-xs text-[var(--color-textMuted)] text-right">
                {diag.tracerouteMaxHops} hops
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Timer className="w-4 h-4" />
                Traceroute Timeout (s)
                <InfoTooltip text="Per-hop timeout in seconds. Hops that don't respond within this window are shown as timeouts." />
              </label>
              <NumberInput
                value={diag.tracerouteTimeoutSecs}
                onChange={(v: number) => update({ tracerouteTimeoutSecs: v })}
                className="w-full"
                min={1}
                max={10}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Zap className="w-4 h-4" />
                Port Check Timeout (s)
                <InfoTooltip text="Maximum time in seconds to wait for a TCP connection to the target port before declaring it closed or filtered." />
              </label>
              <NumberInput
                value={diag.portCheckTimeoutSecs}
                onChange={(v: number) => update({ portCheckTimeoutSecs: v })}
                className="w-full"
                min={1}
                max={30}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Checks */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title="Advanced Checks"
        />
        <div className="sor-settings-card">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              TCP Timing Timeout (s)
              <InfoTooltip text="Timeout for the TCP connection timing measurement, which measures how long it takes to establish a full TCP handshake." />
            </label>
            <NumberInput
              value={diag.tcpTimingTimeoutSecs}
              onChange={(v: number) => update({ tcpTimingTimeoutSecs: v })}
              className="w-full md:w-48"
              min={1}
              max={60}
            />
          </div>

          <ToggleRow
            icon={<Network className="w-4 h-4" />}
            label="MTU Path Discovery"
            checked={diag.mtuCheckEnabled}
            onChange={(v) => update({ mtuCheckEnabled: v })}
            tooltip="Detect the maximum transmission unit along the network path. Helps identify fragmentation issues that can cause slow or failed connections."
          />

          <ToggleRow
            icon={<Shield className="w-4 h-4" />}
            label="ICMP Blockade Detection"
            checked={diag.icmpBlockadeEnabled}
            onChange={(v) => update({ icmpBlockadeEnabled: v })}
            tooltip="Determine if ICMP packets are being blocked by a firewall. Compares ICMP reachability with TCP reachability to detect filtering."
          />

          <ToggleRow
            icon={<Fingerprint className="w-4 h-4" />}
            label="Service Fingerprinting"
            checked={diag.serviceFingerprintEnabled}
            onChange={(v) => update({ serviceFingerprintEnabled: v })}
            tooltip="Attempt to identify the service and version running on the target port by analyzing the banner and protocol responses."
          />

          <ToggleRow
            icon={<ArrowLeftRight className="w-4 h-4" />}
            label="Asymmetric Routing Detection"
            checked={diag.asymmetricRoutingEnabled}
            onChange={(v) => update({ asymmetricRoutingEnabled: v })}
            tooltip="Detect if packets take different paths to and from the target, which can cause connection instability, packet loss, or firewall issues."
          />

          <div
            className={`pl-7 space-y-2 ${!diag.asymmetricRoutingEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              Sample Count
              <InfoTooltip text="Number of probe samples used to analyze routing symmetry. More samples improve detection accuracy but take longer." />
            </label>
            <input
              type="range"
              min={2}
              max={20}
              value={diag.asymmetricRoutingSamples}
              onChange={(e) =>
                update({ asymmetricRoutingSamples: Number(e.target.value) })
              }
              className="w-full accent-[var(--color-primary)]"
            />
            <div className="text-xs text-[var(--color-textMuted)] text-right">
              {diag.asymmetricRoutingSamples} samples
            </div>
          </div>
        </div>
      </div>

      {/* TLS / Certificate */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Lock className="w-4 h-4 text-primary" />}
          title="TLS / Certificate"
        />
        <div className="sor-settings-card">
          <ToggleRow
            icon={<Lock className="w-4 h-4" />}
            label="TLS Certificate Check"
            checked={diag.tlsCheckEnabled}
            onChange={(v) => update({ tlsCheckEnabled: v })}
            tooltip="For HTTPS and TLS-enabled ports, verify the server certificate, report the TLS version, cipher suite, and certificate expiry date."
          />
        </div>
      </div>

      {/* Extended Checks */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Extended Checks"
        />
        <div className="sor-settings-card">
          <ToggleRow
            icon={<Globe className="w-4 h-4" />}
            label="IP Geolocation Lookup"
            checked={diag.ipGeoEnabled}
            onChange={(v) => update({ ipGeoEnabled: v })}
            tooltip="Look up the geographic location, ISP, and ASN information for the target IP address."
          />

          <ToggleRow
            icon={<Radio className="w-4 h-4" />}
            label="UDP Port Probing"
            checked={diag.udpProbeEnabled}
            onChange={(v) => update({ udpProbeEnabled: v })}
            tooltip="Send UDP probes to detect services on UDP-based protocols like DNS, NTP, SNMP, and TFTP."
          />

          <div
            className={`pl-7 space-y-2 ${!diag.udpProbeEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              UDP Probe Timeout (ms)
              <InfoTooltip text="Maximum time in milliseconds to wait for a UDP response before considering the port as not responding." />
            </label>
            <NumberInput
              value={diag.udpProbeTimeoutMs}
              onChange={(v: number) => update({ udpProbeTimeoutMs: v })}
              className="w-full md:w-48"
              min={500}
              max={10000}
              step={500}
            />
          </div>

          <ToggleRow
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Proxy/VPN Leakage Detection"
            checked={diag.leakageDetectionEnabled}
            onChange={(v) => update({ leakageDetectionEnabled: v })}
            tooltip="When a proxy or VPN is configured, check for DNS leaks and IP mismatches that could expose your real network identity."
          />
        </div>
      </div>

      {/* Protocol Diagnostics */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Search className="w-4 h-4 text-primary" />}
          title="Protocol Diagnostics"
        />
        <div className="sor-settings-card">
          <ToggleRow
            icon={<Search className="w-4 h-4" />}
            label="Protocol-Specific Deep Diagnostics"
            checked={diag.protocolDiagEnabled}
            onChange={(v) => update({ protocolDiagEnabled: v })}
            tooltip="Run detailed protocol-level tests for SSH, HTTP/HTTPS, and RDP connections including authentication probes, handshake analysis, and version detection."
          />

          <div
            className={`pl-7 space-y-2 ${!diag.protocolDiagEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              Protocol Diagnostic Timeout (s)
              <InfoTooltip text="Maximum time in seconds for the entire protocol-specific diagnostic sequence to complete." />
            </label>
            <NumberInput
              value={diag.protocolDiagTimeoutSecs}
              onChange={(v: number) => update({ protocolDiagTimeoutSecs: v })}
              className="w-full md:w-48"
              min={5}
              max={60}
            />
          </div>
        </div>
      </div>

      {/* Behavior & Display */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Eye className="w-4 h-4 text-primary" />}
          title="Behavior & Display"
        />
        <div className="sor-settings-card">
          <ToggleRow
            icon={<Play className="w-4 h-4" />}
            label="Auto-Run on Open"
            checked={diag.autoRunOnOpen}
            onChange={(v) => update({ autoRunOnOpen: v })}
            tooltip="Automatically start running all diagnostic checks when the diagnostics tab or panel is opened, without requiring a manual click."
          />

          <ToggleRow
            icon={<Eye className="w-4 h-4" />}
            label="Show Detailed Results"
            checked={diag.showDetailedResults}
            onChange={(v) => update({ showDetailedResults: v })}
            tooltip="Display verbose diagnostic output including raw values, timing breakdowns, and technical details for each check."
          />

          <ToggleRow
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Auto-Expand Failed Steps"
            checked={diag.expandFailedSteps}
            onChange={(v) => update({ expandFailedSteps: v })}
            tooltip="Automatically expand the detail panel for diagnostic steps that failed, making it easier to spot problems at a glance."
          />
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsSettings;
