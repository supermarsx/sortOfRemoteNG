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
  Hash,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
  SettingsSliderRow,
} from "../../ui/settings/SettingsPrimitives";

interface DiagnosticsSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

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
        <Card>
          <SettingsSliderRow
            icon={<Radio size={16} />}
            label="Ping Count"
            value={diag.pingCount}
            min={1}
            max={50}
            unit=" pings"
            onChange={(v) => update({ pingCount: v })}
            infoTooltip="Number of ICMP echo requests to send during the sequential ping test. Higher values give more accurate latency and jitter statistics."
          />
          <SettingsNumberRow
            icon={<Timer size={16} />}
            label="Ping Timeout"
            value={diag.pingTimeoutSecs}
            min={1}
            max={30}
            unit="s"
            onChange={(v) => update({ pingTimeoutSecs: v })}
            infoTooltip="Maximum time in seconds to wait for each ping reply before marking it as timed out."
          />
          <SettingsSliderRow
            icon={<Timer size={16} />}
            label="Ping Interval"
            value={diag.pingIntervalMs}
            min={100}
            max={2000}
            step={100}
            unit="ms"
            onChange={(v) => update({ pingIntervalMs: v })}
            infoTooltip="Delay in milliseconds between consecutive pings. Lower values complete faster but may be rate-limited by firewalls."
          />
          <SettingsSliderRow
            icon={<Route size={16} />}
            label="Traceroute Max Hops"
            value={diag.tracerouteMaxHops}
            min={5}
            max={64}
            unit=" hops"
            onChange={(v) => update({ tracerouteMaxHops: v })}
            infoTooltip="Maximum number of network hops (routers) to traverse before stopping the traceroute. Increase for distant hosts."
          />
          <SettingsNumberRow
            icon={<Timer size={16} />}
            label="Traceroute Timeout"
            value={diag.tracerouteTimeoutSecs}
            min={1}
            max={10}
            unit="s"
            onChange={(v) => update({ tracerouteTimeoutSecs: v })}
            infoTooltip="Per-hop timeout in seconds. Hops that don't respond within this window are shown as timeouts."
          />
          <SettingsNumberRow
            icon={<Zap size={16} />}
            label="Port Check Timeout"
            value={diag.portCheckTimeoutSecs}
            min={1}
            max={30}
            unit="s"
            onChange={(v) => update({ portCheckTimeoutSecs: v })}
            infoTooltip="Maximum time in seconds to wait for a TCP connection to the target port before declaring it closed or filtered."
          />
        </Card>
      </div>

      {/* Advanced Checks */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title="Advanced Checks"
        />
        <Card>
          <SettingsNumberRow
            icon={<Timer size={16} />}
            label="TCP Timing Timeout"
            value={diag.tcpTimingTimeoutSecs}
            min={1}
            max={60}
            unit="s"
            onChange={(v) => update({ tcpTimingTimeoutSecs: v })}
            infoTooltip="Timeout for the TCP connection timing measurement, which measures how long it takes to establish a full TCP handshake."
          />

          <Toggle
            icon={<Network size={16} />}
            label="MTU Path Discovery"
            description="Detect the maximum transmission unit along the network path"
            checked={diag.mtuCheckEnabled}
            onChange={(v) => update({ mtuCheckEnabled: v })}
            infoTooltip="Detect the maximum transmission unit along the network path. Helps identify fragmentation issues that can cause slow or failed connections."
          />

          <Toggle
            icon={<Shield size={16} />}
            label="ICMP Blockade Detection"
            description="Compare ICMP vs TCP reachability to detect firewall filtering"
            checked={diag.icmpBlockadeEnabled}
            onChange={(v) => update({ icmpBlockadeEnabled: v })}
            infoTooltip="Determine if ICMP packets are being blocked by a firewall. Compares ICMP reachability with TCP reachability to detect filtering."
          />

          <Toggle
            icon={<Fingerprint size={16} />}
            label="Service Fingerprinting"
            description="Identify the service and version on the target port"
            checked={diag.serviceFingerprintEnabled}
            onChange={(v) => update({ serviceFingerprintEnabled: v })}
            infoTooltip="Attempt to identify the service and version running on the target port by analyzing the banner and protocol responses."
          />

          <Toggle
            icon={<ArrowLeftRight size={16} />}
            label="Asymmetric Routing Detection"
            description="Detect when packets take different paths to and from the target"
            checked={diag.asymmetricRoutingEnabled}
            onChange={(v) => update({ asymmetricRoutingEnabled: v })}
            infoTooltip="Detect if packets take different paths to and from the target, which can cause connection instability, packet loss, or firewall issues."
          />

          <div
            className={
              diag.asymmetricRoutingEnabled
                ? undefined
                : "opacity-50 pointer-events-none"
            }
          >
            <SettingsSliderRow
              icon={<Hash size={16} />}
              label="Sample Count"
              value={diag.asymmetricRoutingSamples}
              min={2}
              max={20}
              unit=" samples"
              onChange={(v) => update({ asymmetricRoutingSamples: v })}
              infoTooltip="Number of probe samples used to analyze routing symmetry. More samples improve detection accuracy but take longer."
            />
          </div>
        </Card>
      </div>

      {/* TLS / Certificate */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Lock className="w-4 h-4 text-primary" />}
          title="TLS / Certificate"
        />
        <Card>
          <Toggle
            icon={<Lock size={16} />}
            label="TLS Certificate Check"
            description="Verify server certificate, TLS version, cipher, and expiry"
            checked={diag.tlsCheckEnabled}
            onChange={(v) => update({ tlsCheckEnabled: v })}
            infoTooltip="For HTTPS and TLS-enabled ports, verify the server certificate, report the TLS version, cipher suite, and certificate expiry date."
          />
        </Card>
      </div>

      {/* Extended Checks */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Extended Checks"
        />
        <Card>
          <Toggle
            icon={<Globe size={16} />}
            label="IP Geolocation Lookup"
            description="Look up location, ISP, and ASN for the target IP"
            checked={diag.ipGeoEnabled}
            onChange={(v) => update({ ipGeoEnabled: v })}
            infoTooltip="Look up the geographic location, ISP, and ASN information for the target IP address."
          />

          <Toggle
            icon={<Radio size={16} />}
            label="UDP Port Probing"
            description="Probe UDP services like DNS, NTP, SNMP, and TFTP"
            checked={diag.udpProbeEnabled}
            onChange={(v) => update({ udpProbeEnabled: v })}
            infoTooltip="Send UDP probes to detect services on UDP-based protocols like DNS, NTP, SNMP, and TFTP."
          />

          <div
            className={
              diag.udpProbeEnabled
                ? undefined
                : "opacity-50 pointer-events-none"
            }
          >
            <SettingsNumberRow
              icon={<Timer size={16} />}
              label="UDP Probe Timeout"
              value={diag.udpProbeTimeoutMs}
              min={500}
              max={10000}
              step={500}
              unit="ms"
              onChange={(v) => update({ udpProbeTimeoutMs: v })}
              infoTooltip="Maximum time in milliseconds to wait for a UDP response before considering the port as not responding."
            />
          </div>

          <Toggle
            icon={<AlertTriangle size={16} />}
            label="Proxy/VPN Leakage Detection"
            description="Check for DNS leaks and IP mismatches when a proxy/VPN is active"
            checked={diag.leakageDetectionEnabled}
            onChange={(v) => update({ leakageDetectionEnabled: v })}
            infoTooltip="When a proxy or VPN is configured, check for DNS leaks and IP mismatches that could expose your real network identity."
          />
        </Card>
      </div>

      {/* Protocol Diagnostics */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Search className="w-4 h-4 text-primary" />}
          title="Protocol Diagnostics"
        />
        <Card>
          <Toggle
            icon={<Search size={16} />}
            label="Protocol-Specific Deep Diagnostics"
            description="Detailed SSH / HTTP(S) / RDP handshake and version probes"
            checked={diag.protocolDiagEnabled}
            onChange={(v) => update({ protocolDiagEnabled: v })}
            infoTooltip="Run detailed protocol-level tests for SSH, HTTP/HTTPS, and RDP connections including authentication probes, handshake analysis, and version detection."
          />

          <div
            className={
              diag.protocolDiagEnabled
                ? undefined
                : "opacity-50 pointer-events-none"
            }
          >
            <SettingsNumberRow
              icon={<Timer size={16} />}
              label="Protocol Diagnostic Timeout"
              value={diag.protocolDiagTimeoutSecs}
              min={5}
              max={60}
              unit="s"
              onChange={(v) => update({ protocolDiagTimeoutSecs: v })}
              infoTooltip="Maximum time in seconds for the entire protocol-specific diagnostic sequence to complete."
            />
          </div>
        </Card>
      </div>

      {/* Behavior & Display */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Eye className="w-4 h-4 text-primary" />}
          title="Behavior & Display"
        />
        <Card>
          <Toggle
            icon={<Play size={16} />}
            label="Auto-Run on Open"
            description="Start all diagnostic checks automatically when the panel opens"
            checked={diag.autoRunOnOpen}
            onChange={(v) => update({ autoRunOnOpen: v })}
            infoTooltip="Automatically start running all diagnostic checks when the diagnostics tab or panel is opened, without requiring a manual click."
          />

          <Toggle
            icon={<Eye size={16} />}
            label="Show Detailed Results"
            description="Display verbose output, raw values, and timing breakdowns"
            checked={diag.showDetailedResults}
            onChange={(v) => update({ showDetailedResults: v })}
            infoTooltip="Display verbose diagnostic output including raw values, timing breakdowns, and technical details for each check."
          />

          <Toggle
            icon={<AlertTriangle size={16} />}
            label="Auto-Expand Failed Steps"
            description="Expand the detail panel for steps that failed"
            checked={diag.expandFailedSteps}
            onChange={(v) => update({ expandFailedSteps: v })}
            infoTooltip="Automatically expand the detail panel for diagnostic steps that failed, making it easier to spot problems at a glance."
          />
        </Card>
      </div>
    </div>
  );
};

export default DiagnosticsSettings;
