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
import { InfoTooltip } from "../../ui/InfoTooltip";

interface DiagnosticsSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

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
        icon={<Activity className="w-5 h-5" />}
        title="Diagnostics"
        description="Configure connection diagnostic checks: ping, traceroute, port scanning, TLS inspection, and more."
      />

      {/* ── Network Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Wifi className="w-4 h-4 text-primary" />
          Network
        </h4>

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

      {/* ── Advanced Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Layers className="w-4 h-4 text-accent" />
          Advanced Checks
        </h4>

        <div className="sor-settings-card space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              TCP Timing Timeout (s)
              <InfoTooltip text="Timeout for the TCP connection timing measurement, which measures how long it takes to establish a full TCP handshake." />
            </label>
            <NumberInput
              value={diag.tcpTimingTimeoutSecs}
              onChange={(v: number) => update({ tcpTimingTimeoutSecs: v })}
              className="w-full"
              min={1}
              max={60}
            />
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.mtuCheckEnabled}
              onChange={(v: boolean) => update({ mtuCheckEnabled: v })}
            />
            <Network className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              MTU Path Discovery
              <InfoTooltip text="Detect the maximum transmission unit along the network path. Helps identify fragmentation issues that can cause slow or failed connections." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.icmpBlockadeEnabled}
              onChange={(v: boolean) => update({ icmpBlockadeEnabled: v })}
            />
            <Shield className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              ICMP Blockade Detection
              <InfoTooltip text="Determine if ICMP packets are being blocked by a firewall. Compares ICMP reachability with TCP reachability to detect filtering." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.serviceFingerprintEnabled}
              onChange={(v: boolean) =>
                update({ serviceFingerprintEnabled: v })
              }
            />
            <Fingerprint className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Service Fingerprinting
              <InfoTooltip text="Attempt to identify the service and version running on the target port by analyzing the banner and protocol responses." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.asymmetricRoutingEnabled}
              onChange={(v: boolean) =>
                update({ asymmetricRoutingEnabled: v })
              }
            />
            <ArrowLeftRight className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Asymmetric Routing Detection
              <InfoTooltip text="Detect if packets take different paths to and from the target, which can cause connection instability, packet loss, or firewall issues." />
            </span>
          </label>

          <div
            className={`ml-7 space-y-2 ${!diag.asymmetricRoutingEnabled ? "opacity-50 pointer-events-none" : ""}`}
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

      {/* ── TLS Section ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Lock className="w-4 h-4 text-success" />
          TLS / Certificate
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.tlsCheckEnabled}
              onChange={(v: boolean) => update({ tlsCheckEnabled: v })}
            />
            <Lock className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              TLS Certificate Check
              <InfoTooltip text="For HTTPS and TLS-enabled ports, verify the server certificate, report the TLS version, cipher suite, and certificate expiry date." />
            </span>
          </label>
        </div>
      </div>

      {/* ── Extended Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Globe className="w-4 h-4 text-warning" />
          Extended Checks
        </h4>

        <div className="sor-settings-card space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.ipGeoEnabled}
              onChange={(v: boolean) => update({ ipGeoEnabled: v })}
            />
            <Globe className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              IP Geolocation Lookup
              <InfoTooltip text="Look up the geographic location, ISP, and ASN information for the target IP address." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.udpProbeEnabled}
              onChange={(v: boolean) => update({ udpProbeEnabled: v })}
            />
            <Radio className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              UDP Port Probing
              <InfoTooltip text="Send UDP probes to detect services on UDP-based protocols like DNS, NTP, SNMP, and TFTP." />
            </span>
          </label>

          <div
            className={`ml-7 space-y-2 ${!diag.udpProbeEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              UDP Probe Timeout (ms)
              <InfoTooltip text="Maximum time in milliseconds to wait for a UDP response before considering the port as not responding." />
            </label>
            <NumberInput
              value={diag.udpProbeTimeoutMs}
              onChange={(v: number) => update({ udpProbeTimeoutMs: v })}
              className="w-full"
              min={500}
              max={10000}
              step={500}
            />
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.leakageDetectionEnabled}
              onChange={(v: boolean) =>
                update({ leakageDetectionEnabled: v })
              }
            />
            <AlertTriangle className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Proxy/VPN Leakage Detection
              <InfoTooltip text="When a proxy or VPN is configured, check for DNS leaks and IP mismatches that could expose your real network identity." />
            </span>
          </label>
        </div>
      </div>

      {/* ── Protocol Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Search className="w-4 h-4 text-primary" />
          Protocol Diagnostics
        </h4>

        <div className="sor-settings-card space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.protocolDiagEnabled}
              onChange={(v: boolean) => update({ protocolDiagEnabled: v })}
            />
            <Search className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Protocol-Specific Deep Diagnostics
              <InfoTooltip text="Run detailed protocol-level tests for SSH, HTTP/HTTPS, and RDP connections including authentication probes, handshake analysis, and version detection." />
            </span>
          </label>

          <div
            className={`ml-7 space-y-2 ${!diag.protocolDiagEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              Protocol Diagnostic Timeout (s)
              <InfoTooltip text="Maximum time in seconds for the entire protocol-specific diagnostic sequence to complete." />
            </label>
            <NumberInput
              value={diag.protocolDiagTimeoutSecs}
              onChange={(v: number) => update({ protocolDiagTimeoutSecs: v })}
              className="w-full"
              min={5}
              max={60}
            />
          </div>
        </div>
      </div>

      {/* ── Behavior Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Eye className="w-4 h-4 text-accent" />
          Behavior & Display
        </h4>

        <div className="sor-settings-card space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.autoRunOnOpen}
              onChange={(v: boolean) => update({ autoRunOnOpen: v })}
            />
            <Play className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Auto-Run on Open
              <InfoTooltip text="Automatically start running all diagnostic checks when the diagnostics tab or panel is opened, without requiring a manual click." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.showDetailedResults}
              onChange={(v: boolean) => update({ showDetailedResults: v })}
            />
            <Eye className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Show Detailed Results
              <InfoTooltip text="Display verbose diagnostic output including raw values, timing breakdowns, and technical details for each check." />
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={diag.expandFailedSteps}
              onChange={(v: boolean) => update({ expandFailedSteps: v })}
            />
            <AlertTriangle className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-accent" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Auto-Expand Failed Steps
              <InfoTooltip text="Automatically expand the detail panel for diagnostic steps that failed, making it easier to spot problems at a glance." />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsSettings;
