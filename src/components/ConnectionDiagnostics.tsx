import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Globe, Router, Network, Activity, CheckCircle, XCircle, Clock, Loader2, Stethoscope, Server, Tags, Copy, MapPin, GitBranch, Radio, Shield, AlertCircle, ChevronDown, ChevronUp, Info, Microscope } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Connection } from '../types/connection';
import { useToastContext } from '../contexts/ToastContext';

interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}

interface PingResult {
  success: boolean;
  time_ms?: number;
  error?: string;
}

interface TracerouteHop {
  hop: number;
  ip?: string;
  hostname?: string;
  time_ms?: number;
  timeout: boolean;
}

interface PortCheckResult {
  port: number;
  open: boolean;
  service?: string;
  time_ms?: number;
  banner?: string;
}

interface DnsResult {
  success: boolean;
  resolved_ips: string[];
  reverse_dns?: string;
  resolution_time_ms: number;
  dns_server?: string;
  error?: string;
}

interface IpClassification {
  ip: string;
  ip_type: string;
  ip_class?: string;
  is_ipv6: boolean;
  network_info?: string;
}

interface TcpTimingResult {
  connect_time_ms: number;
  syn_ack_time_ms?: number;
  total_time_ms: number;
  success: boolean;
  slow_connection: boolean;
  error?: string;
}

interface MtuTestPoint {
  size: number;
  success: boolean;
}

interface MtuCheckResult {
  path_mtu?: number;
  fragmentation_needed: boolean;
  recommended_mtu: number;
  test_results: MtuTestPoint[];
  error?: string;
}

interface IcmpBlockadeResult {
  icmp_allowed: boolean;
  tcp_reachable: boolean;
  likely_blocked: boolean;
  diagnosis: string;
}

interface TlsCheckResult {
  tls_supported: boolean;
  tls_version?: string;
  certificate_valid: boolean;
  certificate_subject?: string;
  certificate_issuer?: string;
  certificate_expiry?: string;
  handshake_time_ms: number;
  error?: string;
}

interface ServiceFingerprint {
  port: number;
  service: string;
  version?: string;
  banner?: string;
  protocol_detected?: string;
  response_preview?: string;
}

interface TtlAnalysis {
  expected_ttl?: number;
  received_ttl?: number;
  estimated_hops?: number;
  ttl_consistent: boolean;
}

interface AsymmetricRoutingResult {
  asymmetry_detected: boolean;
  confidence: string;
  outbound_hops: string[];
  ttl_analysis: TtlAnalysis;
  latency_variance?: number;
  path_stability: string;
  notes: string[];
}

interface UdpProbeResult {
  port: number;
  reachable?: boolean;
  response_received: boolean;
  response_type?: string;
  response_data?: string;
  latency_ms?: number;
  error?: string;
}

interface IpGeoInfo {
  ip: string;
  asn?: number;
  asn_org?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  isp?: string;
  is_proxy?: boolean;
  is_vpn?: boolean;
  is_tor?: boolean;
  is_datacenter?: boolean;
  source: string;
  error?: string;
}

interface LeakageDetectionResult {
  dns_leak_detected: boolean;
  webrtc_leak_possible: boolean;
  ip_mismatch_detected: boolean;
  detected_public_ip?: string;
  expected_proxy_ip?: string;
  dns_servers_detected: string[];
  notes: string[];
  overall_status: string;
}

interface DiagnosticResults {
  internetCheck: 'pending' | 'success' | 'failed';
  gatewayCheck: 'pending' | 'success' | 'failed';
  subnetCheck: 'pending' | 'success' | 'failed';
  pings: PingResult[];
  traceroute: TracerouteHop[];
  portCheck: PortCheckResult | null;
  dnsResult: DnsResult | null;
  ipClassification: IpClassification | null;
  tcpTiming: TcpTimingResult | null;
  mtuCheck: MtuCheckResult | null;
  icmpBlockade: IcmpBlockadeResult | null;
  tlsCheck: TlsCheckResult | null;
  serviceFingerprint: ServiceFingerprint | null;
  asymmetricRouting: AsymmetricRoutingResult | null;
  udpProbe: UdpProbeResult | null;
  ipGeoInfo: IpGeoInfo | null;
  leakageDetection: LeakageDetectionResult | null;
}

/* ── Protocol-specific deep diagnostic types (match Rust DiagnosticStep/Report) ── */

interface ProtocolDiagnosticStep {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn' | 'info';
  message: string;
  durationMs: number;
  detail: string | null;
}

interface ProtocolDiagnosticReport {
  host: string;
  port: number;
  protocol: string;
  resolvedIp: string | null;
  steps: ProtocolDiagnosticStep[];
  summary: string;
  rootCauseHint: string | null;
  totalDurationMs: number;
}

const initialResults: DiagnosticResults = {
  internetCheck: 'pending',
  gatewayCheck: 'pending',
  subnetCheck: 'pending',
  pings: [],
  traceroute: [],
  portCheck: null,
  dnsResult: null,
  ipClassification: null,
  tcpTiming: null,
  mtuCheck: null,
  icmpBlockade: null,
  tlsCheck: null,
  serviceFingerprint: null,
  asymmetricRouting: null,
  udpProbe: null,
  ipGeoInfo: null,
  leakageDetection: null,
};

export const ConnectionDiagnostics: React.FC<ConnectionDiagnosticsProps> = ({
  connection,
  onClose,
}) => {
  const { t } = useTranslation();
  const { toast } = useToastContext();
  const [results, setResults] = useState<DiagnosticResults>(initialResults);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [protocolReport, setProtocolReport] = useState<ProtocolDiagnosticReport | null>(null);
  const [protocolDiagRunning, setProtocolDiagRunning] = useState(false);
  const [protocolDiagError, setProtocolDiagError] = useState<string | null>(null);
  const [expandedProtoStep, setExpandedProtoStep] = useState<number | null>(null);

  const copyDiagnosticsToClipboard = useCallback(() => {
    const lines: string[] = [
      `=== Connection Diagnostics ===${''}
`,
      `Connection: ${connection.name}`,
      `Host: ${connection.hostname}`,
      `Protocol: ${connection.protocol}`,
      `Port: ${connection.port || 'default'}`,
      ``,
      `--- Network Checks ---`,
      `Internet: ${results.internetCheck}`,
      `Gateway: ${results.gatewayCheck}`,
      `Target Host: ${results.subnetCheck}`,
      ``,
    ];

    if (results.dnsResult) {
      lines.push(`--- DNS Resolution ---`);
      lines.push(`Status: ${results.dnsResult.success ? 'Success' : 'Failed'}`);
      if (results.dnsResult.success) {
        lines.push(`Resolved IPs: ${results.dnsResult.resolved_ips.join(', ')}`);
        if (results.dnsResult.reverse_dns) {
          lines.push(`Reverse DNS: ${results.dnsResult.reverse_dns}`);
        }
        lines.push(`Resolution Time: ${results.dnsResult.resolution_time_ms}ms`);
      } else if (results.dnsResult.error) {
        lines.push(`Error: ${results.dnsResult.error}`);
      }
      lines.push(``);
    }

    if (results.ipClassification) {
      lines.push(`--- IP Classification ---`);
      lines.push(`IP: ${results.ipClassification.ip}`);
      lines.push(`Type: ${results.ipClassification.ip_type}`);
      if (results.ipClassification.ip_class) {
        lines.push(`Class: ${results.ipClassification.ip_class}`);
      }
      if (results.ipClassification.network_info) {
        lines.push(`Network: ${results.ipClassification.network_info}`);
      }
      lines.push(``);
    }

    if (results.pings.length > 0) {
      const successfulPings = results.pings.filter(p => p.success && p.time_ms);
      const avgPing = successfulPings.length > 0
        ? successfulPings.reduce((sum, p) => sum + (p.time_ms || 0), 0) / successfulPings.length
        : 0;
      const successRate = (results.pings.filter(p => p.success).length / results.pings.length) * 100;
      
      lines.push(`--- Ping Results ---`);
      lines.push(`Tests: ${results.pings.length}`);
      lines.push(`Success Rate: ${successRate.toFixed(0)}%`);
      lines.push(`Average: ${avgPing > 0 ? avgPing.toFixed(1) + 'ms' : 'N/A'}`);
      lines.push(`Individual: ${results.pings.map(p => p.success ? p.time_ms + 'ms' : 'timeout').join(', ')}`);
      lines.push(``);
    }

    if (results.portCheck) {
      lines.push(`--- Port Check ---`);
      lines.push(`Port: ${results.portCheck.port}`);
      lines.push(`Status: ${results.portCheck.open ? 'Open' : 'Closed'}`);
      if (results.portCheck.service) {
        lines.push(`Service: ${results.portCheck.service}`);
      }
      if (results.portCheck.time_ms) {
        lines.push(`Response Time: ${results.portCheck.time_ms}ms`);
      }
      if (results.portCheck.banner) {
        lines.push(`Banner: ${results.portCheck.banner}`);
      }
      lines.push(``);
    }

    if (results.traceroute.length > 0) {
      lines.push(`--- Traceroute ---`);
      results.traceroute.forEach(hop => {
        if (hop.timeout) {
          lines.push(`${hop.hop}. * * * (timeout)`);
        } else {
          lines.push(`${hop.hop}. ${hop.ip || 'unknown'}${hop.hostname ? ` (${hop.hostname})` : ''} - ${hop.time_ms}ms`);
        }
      });
      lines.push(``);
    }

    // Advanced Diagnostics
    if (results.tcpTiming) {
      lines.push(`--- TCP Timing ---`);
      lines.push(`Connect Time: ${results.tcpTiming.connect_time_ms}ms`);
      lines.push(`Slow Connection: ${results.tcpTiming.slow_connection ? 'Yes' : 'No'}`);
      if (results.tcpTiming.error) {
        lines.push(`Error: ${results.tcpTiming.error}`);
      }
      lines.push(``);
    }

    if (results.icmpBlockade) {
      lines.push(`--- ICMP Status ---`);
      lines.push(`ICMP Allowed: ${results.icmpBlockade.icmp_allowed ? 'Yes' : 'No'}`);
      lines.push(`TCP Reachable: ${results.icmpBlockade.tcp_reachable ? 'Yes' : 'No'}`);
      lines.push(`ICMP Likely Blocked: ${results.icmpBlockade.likely_blocked ? 'Yes' : 'No'}`);
      lines.push(`Diagnosis: ${results.icmpBlockade.diagnosis}`);
      lines.push(``);
    }

    if (results.serviceFingerprint) {
      lines.push(`--- Service Fingerprint ---`);
      lines.push(`Port: ${results.serviceFingerprint.port}`);
      lines.push(`Service: ${results.serviceFingerprint.service}`);
      if (results.serviceFingerprint.protocol_detected) {
        lines.push(`Protocol Detected: ${results.serviceFingerprint.protocol_detected}`);
      }
      if (results.serviceFingerprint.version) {
        lines.push(`Version: ${results.serviceFingerprint.version}`);
      }
      if (results.serviceFingerprint.banner) {
        lines.push(`Banner: ${results.serviceFingerprint.banner}`);
      }
      lines.push(``);
    }

    if (results.mtuCheck) {
      lines.push(`--- MTU Check ---`);
      lines.push(`Path MTU: ${results.mtuCheck.path_mtu || 'Unknown'}`);
      lines.push(`Recommended MTU: ${results.mtuCheck.recommended_mtu}`);
      lines.push(`Fragmentation Needed: ${results.mtuCheck.fragmentation_needed ? 'Yes' : 'No'}`);
      lines.push(``);
    }

    if (results.tlsCheck) {
      lines.push(`--- TLS Check ---`);
      lines.push(`TLS Supported: ${results.tlsCheck.tls_supported ? 'Yes' : 'No'}`);
      if (results.tlsCheck.tls_version) {
        lines.push(`TLS Version: ${results.tlsCheck.tls_version}`);
      }
      lines.push(`Certificate Valid: ${results.tlsCheck.certificate_valid ? 'Yes' : 'No'}`);
      if (results.tlsCheck.certificate_subject) {
        lines.push(`Certificate Subject: ${results.tlsCheck.certificate_subject}`);
      }
      if (results.tlsCheck.certificate_expiry) {
        lines.push(`Certificate Expiry: ${results.tlsCheck.certificate_expiry}`);
      }
      lines.push(`Handshake Time: ${results.tlsCheck.handshake_time_ms}ms`);
      if (results.tlsCheck.error) {
        lines.push(`Error: ${results.tlsCheck.error}`);
      }
      lines.push(``);
    }

    if (results.asymmetricRouting) {
      lines.push(`--- Asymmetric Routing Detection ---`);
      lines.push(`Asymmetry Detected: ${results.asymmetricRouting.asymmetry_detected ? 'Yes' : 'No'}`);
      lines.push(`Confidence: ${results.asymmetricRouting.confidence}`);
      lines.push(`Path Stability: ${results.asymmetricRouting.path_stability}`);
      if (results.asymmetricRouting.latency_variance !== undefined) {
        lines.push(`Latency Variance: ${results.asymmetricRouting.latency_variance.toFixed(2)}ms`);
      }
      if (results.asymmetricRouting.ttl_analysis.received_ttl) {
        lines.push(`TTL: ${results.asymmetricRouting.ttl_analysis.received_ttl} (${results.asymmetricRouting.ttl_analysis.ttl_consistent ? 'consistent' : 'varies'})`);
      }
      if (results.asymmetricRouting.notes.length > 0) {
        lines.push(`Notes: ${results.asymmetricRouting.notes.join('; ')}`);
      }
      lines.push(``);
    }

    if (results.udpProbe) {
      lines.push(`--- UDP Probe ---`);
      lines.push(`Port: ${results.udpProbe.port}`);
      lines.push(`Response Received: ${results.udpProbe.response_received ? 'Yes' : 'No'}`);
      if (results.udpProbe.response_type) {
        lines.push(`Response Type: ${results.udpProbe.response_type}`);
      }
      if (results.udpProbe.latency_ms) {
        lines.push(`Latency: ${results.udpProbe.latency_ms}ms`);
      }
      if (results.udpProbe.error) {
        lines.push(`Error: ${results.udpProbe.error}`);
      }
      lines.push(``);
    }

    if (results.ipGeoInfo) {
      lines.push(`--- IP Geolocation ---`);
      lines.push(`IP: ${results.ipGeoInfo.ip}`);
      if (results.ipGeoInfo.asn) {
        lines.push(`ASN: AS${results.ipGeoInfo.asn}${results.ipGeoInfo.asn_org ? ` (${results.ipGeoInfo.asn_org})` : ''}`);
      }
      if (results.ipGeoInfo.country) {
        lines.push(`Country: ${results.ipGeoInfo.country}${results.ipGeoInfo.country_code ? ` (${results.ipGeoInfo.country_code})` : ''}`);
      }
      if (results.ipGeoInfo.city) {
        lines.push(`City: ${results.ipGeoInfo.city}${results.ipGeoInfo.region ? `, ${results.ipGeoInfo.region}` : ''}`);
      }
      if (results.ipGeoInfo.isp) {
        lines.push(`ISP: ${results.ipGeoInfo.isp}`);
      }
      if (results.ipGeoInfo.is_datacenter) {
        lines.push(`Datacenter IP: Yes`);
      }
      lines.push(`Source: ${results.ipGeoInfo.source}`);
      lines.push(``);
    }

    if (results.leakageDetection) {
      lines.push(`--- Proxy/VPN Leakage Detection ---`);
      lines.push(`Overall Status: ${results.leakageDetection.overall_status}`);
      lines.push(`DNS Leak Detected: ${results.leakageDetection.dns_leak_detected ? 'Yes' : 'No'}`);
      lines.push(`IP Mismatch: ${results.leakageDetection.ip_mismatch_detected ? 'Yes' : 'No'}`);
      if (results.leakageDetection.detected_public_ip) {
        lines.push(`Public IP: ${results.leakageDetection.detected_public_ip}`);
      }
      if (results.leakageDetection.dns_servers_detected.length > 0) {
        lines.push(`DNS Servers: ${results.leakageDetection.dns_servers_detected.join(', ')}`);
      }
      if (results.leakageDetection.notes.length > 0) {
        lines.push(`Notes: ${results.leakageDetection.notes.join('; ')}`);
      }
      lines.push(``);
    }

    if (protocolReport) {
      lines.push(`--- ${protocolReport.protocol.toUpperCase()} Deep Diagnostics ---`);
      lines.push(`Host: ${protocolReport.host}:${protocolReport.port}`);
      if (protocolReport.resolvedIp) {
        lines.push(`Resolved IP: ${protocolReport.resolvedIp}`);
      }
      lines.push(`Total Duration: ${protocolReport.totalDurationMs}ms`);
      protocolReport.steps.forEach(step => {
        lines.push(`  [${step.status.toUpperCase()}] ${step.name}: ${step.message} (${step.durationMs}ms)`);
        if (step.detail) {
          lines.push(`    Detail: ${step.detail}`);
        }
      });
      lines.push(`Summary: ${protocolReport.summary}`);
      if (protocolReport.rootCauseHint) {
        lines.push(`Root Cause: ${protocolReport.rootCauseHint}`);
      }
      lines.push(``);
    }

    lines.push(`Generated: ${new Date().toISOString()}`);

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      toast.success(t('diagnostics.copiedToClipboard', 'Diagnostics copied to clipboard'));
    }).catch(() => {
      toast.error(t('diagnostics.copyFailed', 'Failed to copy to clipboard'));
    });
  }, [connection, results, protocolReport, t, toast]);

  const getDefaultPort = (protocol: string): number => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      vnc: 5900,
      telnet: 23,
      http: 80,
      https: 443,
      ftp: 21,
      smb: 445,
      mysql: 3306,
      postgresql: 5432,
      anydesk: 7070,
      rustdesk: 21116,
    };
    return ports[protocol.toLowerCase()] || 22;
  };

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setResults(initialResults);
    setProtocolReport(null);
    setProtocolDiagError(null);
    setExpandedProtoStep(null);
    let resolvedDnsIp: string | undefined;

    const isTauri = typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);

    if (!isTauri) {
      setResults({
        ...initialResults,
        internetCheck: 'failed',
        gatewayCheck: 'failed',
        subnetCheck: 'failed',
      });
      setIsRunning(false);
      return;
    }

    try {
      // Run all diagnostic groups in parallel
      setCurrentStep(t('diagnostics.runningAll', 'Running diagnostics...'));

      const port = connection.port || getDefaultPort(connection.protocol);

      // Group 1: Internet & Gateway checks (parallel)
      const networkChecksPromise = Promise.allSettled([
        invoke<PingResult>('ping_host_detailed', { host: '8.8.8.8', count: 1, timeoutSecs: 5 }),
        invoke<PingResult>('ping_gateway', { timeout_secs: 5 }),
      ]).then(([internetRes, gatewayRes]) => {
        setResults(prev => ({
          ...prev,
          internetCheck: internetRes.status === 'fulfilled' && internetRes.value.success ? 'success' : 'failed',
          gatewayCheck: gatewayRes.status === 'fulfilled' && gatewayRes.value.success ? 'success' : 'failed',
        }));
      });

      // Group 2: DNS, target ping, port check (parallel)
      const targetChecksPromise = Promise.allSettled([
        invoke<DnsResult>('dns_lookup', { host: connection.hostname, timeoutSecs: 5 }),
        invoke<PingResult>('ping_host_detailed', { host: connection.hostname, count: 1, timeoutSecs: 5 }),
        invoke<PortCheckResult>('check_port', { host: connection.hostname, port, timeoutSecs: 5 }),
      ]).then(async ([dnsRes, subnetRes, portRes]) => {
        // Handle DNS result
        if (dnsRes.status === 'fulfilled') {
          const dnsResult = dnsRes.value;
          setResults(prev => ({ ...prev, dnsResult }));
          resolvedDnsIp = dnsResult.resolved_ips[0];
          
          // Classify the resolved IP if DNS succeeded
          if (dnsResult.success && dnsResult.resolved_ips.length > 0) {
            try {
              const classification = await invoke<IpClassification>('classify_ip', { 
                ip: dnsResult.resolved_ips[0]
              });
              setResults(prev => ({ ...prev, ipClassification: classification }));
            } catch {
              // IP classification is optional
            }
          }
        } else {
          // DNS failed - might be an IP address, try to classify directly
          try {
            const classification = await invoke<IpClassification>('classify_ip', { 
              ip: connection.hostname
            });
            setResults(prev => ({ ...prev, ipClassification: classification }));
          } catch {
            // Not a valid IP either
          }
        }

        // Handle subnet/target check
        setResults(prev => ({
          ...prev,
          subnetCheck: subnetRes.status === 'fulfilled' && subnetRes.value.success ? 'success' : 'failed',
        }));

        // Handle port check
        if (portRes.status === 'fulfilled') {
          setResults(prev => ({ ...prev, portCheck: portRes.value }));
        } else {
          setResults(prev => ({ ...prev, portCheck: { port, open: false, time_ms: undefined } }));
        }
      });

      // Group 3: Traceroute (runs in parallel with others)
      const traceroutePromise = invoke<TracerouteHop[]>('traceroute', { 
        host: connection.hostname,
        maxHops: 30,
        timeoutSecs: 3
      }).then(tracerouteResult => {
        setResults(prev => ({ ...prev, traceroute: tracerouteResult }));
      }).catch(error => {
        console.warn('Traceroute failed:', error);
      });

      // Wait for initial checks to complete
      await Promise.all([networkChecksPromise, targetChecksPromise, traceroutePromise]);

      // Group 4: Advanced diagnostics (parallel)
      setCurrentStep(t('diagnostics.runningAdvanced', 'Running advanced diagnostics...'));
      
      const advancedChecksPromise = Promise.allSettled([
        // TCP timing
        invoke<TcpTimingResult>('tcp_connection_timing', { 
          host: connection.hostname, 
          port,
          timeoutSecs: 10 
        }),
        // ICMP blockade detection
        invoke<IcmpBlockadeResult>('detect_icmp_blockade', { 
          host: connection.hostname,
          port
        }),
        // Service fingerprint
        invoke<ServiceFingerprint>('fingerprint_service', { 
          host: connection.hostname,
          port
        }),
        // TLS check (only for TLS-capable ports)
        [443, 8443, 993, 995, 465, 636].includes(port) || connection.protocol === 'https'
          ? invoke<TlsCheckResult>('check_tls', { host: connection.hostname, port })
          : Promise.resolve(null),
        // MTU check
        invoke<MtuCheckResult>('check_mtu', { host: connection.hostname }),
      ]).then(([tcpRes, icmpRes, fingerprintRes, tlsRes, mtuRes]) => {
        setResults(prev => ({
          ...prev,
          tcpTiming: tcpRes.status === 'fulfilled' ? tcpRes.value : null,
          icmpBlockade: icmpRes.status === 'fulfilled' ? icmpRes.value : null,
          serviceFingerprint: fingerprintRes.status === 'fulfilled' ? fingerprintRes.value : null,
          tlsCheck: tlsRes.status === 'fulfilled' ? tlsRes.value : null,
          mtuCheck: mtuRes.status === 'fulfilled' ? mtuRes.value : null,
        }));
      });

      await advancedChecksPromise;

      // Group 5: Extended diagnostics (parallel) - ASN/Geo, Asymmetric routing, UDP probe, Leakage
      setCurrentStep(t('diagnostics.runningExtended', 'Running extended diagnostics...'));
      
      // Get target IP for geo lookup
      const targetIp = resolvedDnsIp || connection.hostname;
      
      // Determine if UDP probe is applicable based on protocol
      const udpPorts: Record<string, number> = {
        dns: 53,
        ntp: 123,
        snmp: 161,
        tftp: 69,
        dhcp: 67,
      };
      const udpPort = udpPorts[connection.protocol.toLowerCase()] || 
        ([53, 123, 161, 162, 69, 67, 68, 500].includes(port) ? port : null);
      const configuredProxyHost = connection.security?.proxy?.host;
      const usesProxyPath = Boolean(
        connection.security?.proxy?.enabled ||
          connection.proxyChainId ||
          connection.connectionChainId,
      );
      
      const extendedChecksPromise = Promise.allSettled([
        // Asymmetric routing detection
        invoke<AsymmetricRoutingResult>('detect_asymmetric_routing', { 
          host: connection.hostname,
          sampleCount: 5 
        }),
        // IP Geolocation lookup
        invoke<IpGeoInfo>('lookup_ip_geo', { ip: targetIp }),
        // UDP probe (only for applicable ports)
        udpPort 
          ? invoke<UdpProbeResult>('probe_udp_port', { 
              host: connection.hostname, 
              port: udpPort,
              timeoutMs: 3000 
            })
          : Promise.resolve(null),
        // Leakage detection (only if connection uses proxy)
        usesProxyPath
          ? invoke<LeakageDetectionResult>('detect_proxy_leakage', { 
              expectedExitIp: configuredProxyHost 
            })
          : Promise.resolve(null),
      ]).then(([asymmetricRes, geoRes, udpRes, leakageRes]) => {
        setResults(prev => ({
          ...prev,
          asymmetricRouting: asymmetricRes.status === 'fulfilled' ? asymmetricRes.value : null,
          ipGeoInfo: geoRes.status === 'fulfilled' ? geoRes.value : null,
          udpProbe: udpRes.status === 'fulfilled' ? udpRes.value : null,
          leakageDetection: leakageRes.status === 'fulfilled' ? leakageRes.value : null,
        }));
      });

      await extendedChecksPromise;

      // Group 6: Run 10 pings sequentially (needs to be sequential for timing accuracy)
      setCurrentStep(t('diagnostics.runningPings', 'Running ping tests...'));
      const pings: PingResult[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const pingResult = await invoke<PingResult>('ping_host_detailed', { 
            host: connection.hostname, 
            count: 1,
            timeoutSecs: 5 
          });
          pings.push(pingResult);
          setResults(prev => ({ ...prev, pings: [...pings] }));
        } catch (error) {
          pings.push({ success: false, error: String(error) });
          setResults(prev => ({ ...prev, pings: [...pings] }));
        }
        // Small delay between pings
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Group 7: Protocol-specific deep diagnostics
      const proto = connection.protocol.toLowerCase();
      if (['ssh', 'http', 'https', 'rdp'].includes(proto)) {
        setCurrentStep(t('diagnostics.runningProtocol', 'Running {{protocol}} diagnostics...', { protocol: proto.toUpperCase() }));
        setProtocolDiagRunning(true);
        setProtocolDiagError(null);
        try {
          let report: ProtocolDiagnosticReport | null = null;
          if (proto === 'ssh') {
            report = await invoke<ProtocolDiagnosticReport>('diagnose_ssh_connection', {
              host: connection.hostname,
              port,
              username: connection.username || '',
              password: connection.password || null,
              privateKeyPath: connection.privateKey || null,
              privateKeyPassphrase: null,
              connectTimeoutSecs: 10,
            });
          } else if (proto === 'http' || proto === 'https') {
            report = await invoke<ProtocolDiagnosticReport>('diagnose_http_connection', {
              host: connection.hostname,
              port,
              useTls: proto === 'https',
              path: '/',
              method: 'GET',
              expectedStatus: null,
              connectTimeoutSecs: 15,
              verifySsl: true,
            });
          } else if (proto === 'rdp') {
            report = await invoke<ProtocolDiagnosticReport>('diagnose_rdp_connection', {
              host: connection.hostname,
              port,
              username: connection.username || '',
              password: connection.password || '',
              domain: connection.domain || null,
              settings: null,
            });
          }
          setProtocolReport(report);
        } catch (err) {
          setProtocolDiagError(String(err));
        } finally {
          setProtocolDiagRunning(false);
        }
      }

    } catch (error) {
      console.error('Diagnostics failed:', error);
    } finally {
      setIsRunning(false);
      setCurrentStep('');
    }
  }, [connection, t]);

  useEffect(() => {
    // Run diagnostics on mount
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const StatusIcon = ({ status }: { status: 'pending' | 'success' | 'failed' }) => {
    switch (status) {
      case 'pending':
        return <Loader2 size={16} className="text-[var(--color-textMuted)] animate-spin" />;
      case 'success':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <XCircle size={16} className="text-red-500" />;
    }
  };

  const avgPingTime = results.pings.length > 0
    ? results.pings
        .filter(p => p.success && p.time_ms)
        .reduce((sum, p) => sum + (p.time_ms || 0), 0) / 
        results.pings.filter(p => p.success).length || 0
    : 0;

  const pingSuccessRate = results.pings.length > 0
    ? (results.pings.filter(p => p.success).length / results.pings.length) * 100
    : 0;

  // Calculate jitter (standard deviation of ping times)
  const successfulPings = results.pings.filter(p => p.success && p.time_ms);
  const jitter = successfulPings.length > 1
    ? Math.sqrt(
        successfulPings.reduce((sum, p) => sum + Math.pow((p.time_ms || 0) - avgPingTime, 2), 0) / 
        (successfulPings.length - 1)
      )
    : 0;

  // Get min/max for graph scaling
  const pingTimes = successfulPings.map(p => p.time_ms || 0);
  const maxPing = pingTimes.length > 0 ? Math.max(...pingTimes) : 0;
  const minPing = pingTimes.length > 0 ? Math.min(...pingTimes) : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Stethoscope size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t('diagnostics.title', 'Connection Diagnostics')}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {connection.name} • {connection.hostname}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyDiagnosticsToClipboard}
              disabled={isRunning}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
              title={t('diagnostics.copyToClipboard', 'Copy to Clipboard')}
            >
              <Copy size={16} />
            </button>
            <button
              onClick={runDiagnostics}
              disabled={isRunning}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
              title={t('diagnostics.rerun', 'Run Again')}
            >
              <RefreshCw size={16} className={isRunning ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors"
              title={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Current Step Indicator */}
          {isRunning && currentStep && (
            <div className="flex items-center gap-2 text-sm text-blue-500 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
              <Loader2 size={14} className="animate-spin" />
              {currentStep}
            </div>
          )}

          {/* Network Checks */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Network size={12} />
              {t('diagnostics.networkChecks', 'Network Checks')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Globe size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.internet', 'Internet')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">8.8.8.8</div>
                </div>
                <StatusIcon status={results.internetCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Router size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.gateway', 'Gateway')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">{t('diagnostics.defaultGateway', 'Default gateway')}</div>
                </div>
                <StatusIcon status={results.gatewayCheck} />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Network size={18} className="text-[var(--color-textMuted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {t('diagnostics.subnet', 'Target Host')}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">{connection.hostname}</div>
                </div>
                <StatusIcon status={results.subnetCheck} />
              </div>
            </div>
          </div>

          {/* DNS Resolution & IP Classification */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Server size={12} />
              {t('diagnostics.dnsResolution', 'DNS & IP Info')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* DNS Result */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="flex items-center gap-2 mb-2">
                  <Globe size={14} className="text-[var(--color-textMuted)]" />
                  <span className="text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                    {t('diagnostics.dnsLookup', 'DNS Lookup')}
                  </span>
                </div>
                {results.dnsResult ? (
                  results.dnsResult.success ? (
                    <div className="space-y-1">
                      <div className="text-sm text-[var(--color-text)] font-mono">
                        {results.dnsResult.resolved_ips.slice(0, 3).join(', ')}
                        {results.dnsResult.resolved_ips.length > 3 && (
                          <span className="text-[var(--color-textMuted)]"> +{results.dnsResult.resolved_ips.length - 3}</span>
                        )}
                      </div>
                      {results.dnsResult.reverse_dns && (
                        <div className="text-xs text-[var(--color-textMuted)] truncate">
                          PTR: {results.dnsResult.reverse_dns}
                        </div>
                      )}
                      <div className="text-[10px] text-[var(--color-textMuted)]">
                        {results.dnsResult.resolution_time_ms}ms
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-red-500">
                      {results.dnsResult.error || t('diagnostics.dnsFailedShort', 'Resolution failed')}
                    </div>
                  )
                ) : isRunning ? (
                  <Loader2 size={16} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <div className="text-xs text-[var(--color-textMuted)]">
                    {t('diagnostics.directIp', 'Direct IP address')}
                  </div>
                )}
              </div>
              
              {/* IP Classification */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="flex items-center gap-2 mb-2">
                  <Tags size={14} className="text-[var(--color-textMuted)]" />
                  <span className="text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                    {t('diagnostics.ipClassification', 'IP Classification')}
                  </span>
                </div>
                {results.ipClassification ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                        results.ipClassification.ip_type === 'public' 
                          ? 'bg-blue-500/20 text-blue-400' 
                          : results.ipClassification.ip_type === 'private'
                          ? 'bg-green-500/20 text-green-400'
                          : results.ipClassification.ip_type === 'loopback'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-purple-500/20 text-purple-400'
                      }`}>
                        {results.ipClassification.ip_type.toUpperCase()}
                      </span>
                      {results.ipClassification.ip_class && (
                        <span className="text-xs text-[var(--color-textMuted)]">
                          Class {results.ipClassification.ip_class}
                        </span>
                      )}
                      {results.ipClassification.is_ipv6 && (
                        <span className="text-xs text-[var(--color-textMuted)]">IPv6</span>
                      )}
                    </div>
                    {results.ipClassification.network_info && (
                      <div className="text-[10px] text-[var(--color-textMuted)]">
                        {results.ipClassification.network_info}
                      </div>
                    )}
                  </div>
                ) : isRunning ? (
                  <Loader2 size={16} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <div className="text-xs text-[var(--color-textMuted)]">-</div>
                )}
              </div>
            </div>
          </div>

          {/* Ping Results */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Activity size={12} />
              {t('diagnostics.pingResults', 'Ping Results')} ({results.pings.length}/10)
            </h3>
            
            {results.pings.length > 0 && (
              <>
                {/* Ping Line Graph */}
                <div className="mb-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  {(() => {
                    // Calculate graph bounds with padding
                    const graphMin = Math.max(0, minPing - 10);
                    const graphMax = maxPing + 10;
                    const range = graphMax - graphMin || 1;
                    const graphHeight = 64;
                    const graphWidth = 300;
                    const pointSpacing = graphWidth / 9; // 10 points = 9 gaps
                    
                    // Build SVG path for the line
                    const points: { x: number; y: number; ping: PingResult }[] = results.pings.map((ping, i) => {
                      const x = i * pointSpacing;
                      const y = ping.success && ping.time_ms
                        ? graphHeight - ((ping.time_ms - graphMin) / range) * graphHeight
                        : graphHeight; // Failed pings at bottom
                      return { x, y, ping };
                    });
                    
                    const linePath = points
                      .filter(p => p.ping.success)
                      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                      .join(' ');
                    
                    // Calculate avg line position
                    const avgY = avgPingTime > 0 
                      ? graphHeight - ((avgPingTime - graphMin) / range) * graphHeight 
                      : graphHeight / 2;

                    return (
                      <div className="relative pl-8">
                        <svg 
                          viewBox={`0 0 ${graphWidth} ${graphHeight}`} 
                          className="w-full h-16"
                          preserveAspectRatio="xMidYMid meet"
                          style={{ overflow: 'visible' }}
                        >
                          {/* Grid lines */}
                          <line x1="0" y1="0" x2={graphWidth} y2="0" stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                          <line x1="0" y1={graphHeight/2} x2={graphWidth} y2={graphHeight/2} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                          <line x1="0" y1={graphHeight} x2={graphWidth} y2={graphHeight} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                          
                          {/* Average line */}
                          {avgPingTime > 0 && (
                            <line 
                              x1="0" 
                              y1={avgY} 
                              x2={graphWidth} 
                              y2={avgY} 
                              stroke="#3b82f6" 
                              strokeWidth="2" 
                              strokeDasharray="6,3" 
                              opacity="0.6"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          
                          {/* Line path */}
                          {linePath && (
                            <path 
                              d={linePath} 
                              fill="none" 
                              stroke="#22c55e" 
                              strokeWidth="2" 
                              strokeLinecap="round" 
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          
                          {/* Points */}
                          {points.map((p, i) => (
                            <circle
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r="5"
                              fill={!p.ping.success ? '#ef4444' : p.ping.time_ms && p.ping.time_ms > avgPingTime * 1.5 ? '#eab308' : '#22c55e'}
                              stroke="var(--color-surface)"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            >
                              <title>{p.ping.success ? `${p.ping.time_ms}ms` : 'Timeout'}</title>
                            </circle>
                          ))}
                          
                          {/* Placeholder points for pending pings */}
                          {Array(Math.max(0, 10 - results.pings.length)).fill(0).map((_, i) => (
                            <circle
                              key={`empty-${i}`}
                              cx={(results.pings.length + i) * pointSpacing}
                              cy={graphHeight / 2}
                              r="4"
                              fill="var(--color-border)"
                              opacity="0.3"
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                        </svg>
                        
                        {/* Y-axis labels */}
                        <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col justify-between text-[9px] text-[var(--color-textMuted)] pointer-events-none text-right pr-1">
                          <span>{graphMax}ms</span>
                          <span>{Math.round((graphMax + graphMin) / 2)}ms</span>
                          <span>{graphMin}ms</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {pingSuccessRate.toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.successRate', 'Success Rate')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {avgPingTime > 0 ? `${avgPingTime.toFixed(0)}ms` : '-'}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.avgLatency', 'Avg Latency')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-[var(--color-text)]">
                      {jitter > 0 ? `±${jitter.toFixed(0)}ms` : '-'}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.jitter', 'Jitter')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-green-500">
                      {results.pings.filter(p => p.success).length}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.successful', 'Successful')}</div>
                  </div>
                  <div className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-xl font-bold text-red-500">
                      {results.pings.filter(p => !p.success).length}
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">{t('diagnostics.failed', 'Failed')}</div>
                  </div>
                </div>
              </>
            )}
            
            <div className="flex gap-1.5">
              {results.pings.map((ping, i) => (
                <div
                  key={i}
                  className={`flex-1 p-2 rounded text-center text-xs font-medium ${
                    ping.success 
                      ? 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30' 
                      : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                  }`}
                >
                  {ping.success && ping.time_ms ? `${ping.time_ms}ms` : 'Timeout'}
                </div>
              ))}
              {Array(Math.max(0, 10 - results.pings.length)).fill(0).map((_, i) => (
                <div key={`empty-${i}`} className="flex-1 p-2 rounded text-center text-xs bg-[var(--color-surface)] text-[var(--color-textMuted)] border border-[var(--color-border)]">
                  -
                </div>
              ))}
            </div>
          </div>

          {/* Port Check */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Network size={12} />
              {t('diagnostics.portCheck', 'Port Check')}
            </h3>
            
            {results.portCheck ? (
              <div className={`p-4 rounded-lg ${
                results.portCheck.open 
                  ? 'bg-green-500/10 border border-green-500/30' 
                  : 'bg-red-500/10 border border-red-500/30'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-medium text-[var(--color-text)]">
                      {t('diagnostics.port', 'Port')} {results.portCheck.port} ({connection.protocol.toUpperCase()})
                    </div>
                    <div className="text-sm text-[var(--color-textSecondary)]">
                      {results.portCheck.open 
                        ? t('diagnostics.portOpen', 'Port is open and accepting connections')
                        : t('diagnostics.portClosed', 'Port is closed or filtered')}
                    </div>
                  </div>
                  <StatusIcon status={results.portCheck.open ? 'success' : 'failed'} />
                </div>
                {results.portCheck.banner && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">Banner / Fingerprint</div>
                    <code className="text-xs font-mono bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text)] block truncate">
                      {results.portCheck.banner}
                    </code>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Loader2 size={20} className="text-[var(--color-textMuted)] animate-spin" />
              </div>
            )}
          </div>

          {/* Traceroute */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Router size={12} />
              {t('diagnostics.traceroute', 'Traceroute')}
              {results.traceroute.length > 0 && (
                <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
                  {results.traceroute.length} {results.traceroute.length === 1 ? t('diagnostics.hop', 'hop') : t('diagnostics.hops', 'hops')}
                </span>
              )}
            </h3>
            
            {results.traceroute.length > 0 ? (
              <div className="space-y-0.5 max-h-52 overflow-y-auto font-mono text-xs">
                {results.traceroute.map((hop, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-2 rounded ${
                      hop.timeout 
                        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' 
                        : 'bg-[var(--color-surface)] text-[var(--color-text)]'
                    }`}
                  >
                    <span className="w-5 text-[var(--color-textMuted)] text-right">{hop.hop}</span>
                    <span className="flex-1 truncate">
                      {hop.timeout 
                        ? '* * *' 
                        : `${hop.hostname || hop.ip || 'Unknown'}`}
                    </span>
                    {hop.ip && hop.ip !== hop.hostname && (
                      <span className="text-[var(--color-textMuted)]">({hop.ip})</span>
                    )}
                    <span className="w-14 text-right text-[var(--color-textSecondary)]">
                      {hop.time_ms ? `${hop.time_ms}ms` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            ) : isRunning ? (
              <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <Loader2 size={20} className="text-[var(--color-textMuted)] animate-spin" />
                <span className="ml-2 text-[var(--color-textSecondary)]">{t('diagnostics.runningTraceroute', 'Running traceroute...')}</span>
              </div>
            ) : (
              <div className="text-center text-[var(--color-textSecondary)] py-4">
                {t('diagnostics.tracerouteUnavailable', 'Traceroute not available or no results')}
              </div>
            )}
          </div>

          {/* Advanced Diagnostics Section */}
          <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
              <Stethoscope size={12} />
              {t('diagnostics.advancedDiagnostics', 'Advanced Diagnostics')}
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
              {/* TCP Timing */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                  {t('diagnostics.tcpTiming', 'TCP Timing')}
                </div>
                {results.tcpTiming ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-textSecondary)]">Connect</span>
                      <span className={`text-xs font-medium ${
                        results.tcpTiming.slow_connection ? 'text-yellow-500' : 'text-green-500'
                      }`}>
                        {results.tcpTiming.connect_time_ms}ms
                      </span>
                    </div>
                    {results.tcpTiming.slow_connection && (
                      <div className="text-[10px] text-yellow-500">
                        ⚠ {t('diagnostics.slowConnection', 'Slow connection detected')}
                      </div>
                    )}
                    {!results.tcpTiming.success && results.tcpTiming.error && (
                      <div className="text-[10px] text-red-500 truncate" title={results.tcpTiming.error}>
                        {results.tcpTiming.error}
                      </div>
                    )}
                  </div>
                ) : isRunning ? (
                  <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <span className="text-xs text-[var(--color-textMuted)]">-</span>
                )}
              </div>

              {/* ICMP Blockade */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                  {t('diagnostics.icmpStatus', 'ICMP Status')}
                </div>
                {results.icmpBlockade ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {results.icmpBlockade.likely_blocked ? (
                        <XCircle size={12} className="text-yellow-500" />
                      ) : results.icmpBlockade.icmp_allowed ? (
                        <CheckCircle size={12} className="text-green-500" />
                      ) : (
                        <XCircle size={12} className="text-red-500" />
                      )}
                      <span className={`text-xs ${
                        results.icmpBlockade.likely_blocked 
                          ? 'text-yellow-500' 
                          : results.icmpBlockade.icmp_allowed 
                            ? 'text-green-500' 
                            : 'text-red-500'
                      }`}>
                        {results.icmpBlockade.likely_blocked 
                          ? t('diagnostics.icmpBlocked', 'ICMP Blocked')
                          : results.icmpBlockade.icmp_allowed 
                            ? t('diagnostics.icmpAllowed', 'ICMP Allowed')
                            : t('diagnostics.unreachable', 'Unreachable')}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-textMuted)] truncate" title={results.icmpBlockade.diagnosis}>
                      {results.icmpBlockade.diagnosis}
                    </div>
                  </div>
                ) : isRunning ? (
                  <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <span className="text-xs text-[var(--color-textMuted)]">-</span>
                )}
              </div>

              {/* Service Fingerprint */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                  {t('diagnostics.serviceFingerprint', 'Service Fingerprint')}
                </div>
                {results.serviceFingerprint ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Server size={12} className="text-[var(--color-accent)]" />
                      <span className="text-xs font-medium text-[var(--color-text)]">
                        {results.serviceFingerprint.protocol_detected || results.serviceFingerprint.service}
                      </span>
                    </div>
                    {results.serviceFingerprint.version && (
                      <div className="text-[10px] text-[var(--color-textSecondary)] truncate" title={results.serviceFingerprint.version}>
                        {results.serviceFingerprint.version}
                      </div>
                    )}
                    {results.serviceFingerprint.response_preview && (
                      <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
                        {results.serviceFingerprint.response_preview}
                      </code>
                    )}
                  </div>
                ) : isRunning ? (
                  <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <span className="text-xs text-[var(--color-textMuted)]">-</span>
                )}
              </div>

              {/* MTU Check */}
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                  {t('diagnostics.mtuCheck', 'MTU Check')}
                </div>
                {results.mtuCheck ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-textSecondary)]">Path MTU</span>
                      <span className="text-xs font-medium text-[var(--color-text)]">
                        {results.mtuCheck.path_mtu ? `${results.mtuCheck.path_mtu}` : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-textSecondary)]">Recommended</span>
                      <span className="text-xs font-medium text-[var(--color-text)]">
                        {results.mtuCheck.recommended_mtu}
                      </span>
                    </div>
                    {results.mtuCheck.fragmentation_needed && (
                      <div className="text-[10px] text-yellow-500">
                        ⚠ {t('diagnostics.fragmentationNeeded', 'Fragmentation detected')}
                      </div>
                    )}
                  </div>
                ) : isRunning ? (
                  <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                ) : (
                  <span className="text-xs text-[var(--color-textMuted)]">-</span>
                )}
              </div>
            </div>

            {/* TLS Check (if applicable) */}
            {results.tlsCheck && (
              <div className="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-2">
                  {t('diagnostics.tlsCheck', 'TLS / SSL Check')}
                </div>
                {results.tlsCheck.tls_supported ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle size={12} className="text-green-500" />
                      <span className="text-xs text-green-500">
                        {results.tlsCheck.tls_version || 'TLS Supported'}
                      </span>
                      <span className="text-xs text-[var(--color-textMuted)]">
                        ({results.tlsCheck.handshake_time_ms}ms)
                      </span>
                    </div>
                    {results.tlsCheck.certificate_valid !== undefined && (
                      <div className="flex items-center gap-2">
                        {results.tlsCheck.certificate_valid ? (
                          <CheckCircle size={10} className="text-green-500" />
                        ) : (
                          <XCircle size={10} className="text-yellow-500" />
                        )}
                        <span className={`text-[10px] ${
                          results.tlsCheck.certificate_valid ? 'text-green-500' : 'text-yellow-500'
                        }`}>
                          {results.tlsCheck.certificate_valid 
                            ? t('diagnostics.certValid', 'Certificate Valid')
                            : t('diagnostics.certInvalid', 'Certificate Invalid/Expired')}
                        </span>
                      </div>
                    )}
                    {results.tlsCheck.certificate_subject && (
                      <div className="text-[10px] text-[var(--color-textSecondary)] truncate" title={results.tlsCheck.certificate_subject}>
                        <span className="text-[var(--color-textMuted)]">Subject:</span> {results.tlsCheck.certificate_subject}
                      </div>
                    )}
                    {results.tlsCheck.certificate_expiry && (
                      <div className="text-[10px] text-[var(--color-textSecondary)]">
                        <span className="text-[var(--color-textMuted)]">Expires:</span> {new Date(results.tlsCheck.certificate_expiry).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircle size={12} className="text-red-500" />
                    <span className="text-xs text-red-500">
                      {results.tlsCheck.error || t('diagnostics.tlsNotSupported', 'TLS not supported')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Extended Diagnostics Section */}
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3 text-xs text-[var(--color-textSecondary)] uppercase font-medium">
                <Stethoscope size={14} />
                {t('diagnostics.extendedDiagnostics', 'Extended Diagnostics')}
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                {/* IP Geolocation */}
                <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                    {t('diagnostics.ipGeo', 'IP Geolocation')}
                  </div>
                  {results.ipGeoInfo ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <MapPin size={12} className="text-[var(--color-accent)]" />
                        <span className="text-xs font-medium text-[var(--color-text)]">
                          {results.ipGeoInfo.city || results.ipGeoInfo.country || 'Unknown'}
                          {results.ipGeoInfo.country_code && ` (${results.ipGeoInfo.country_code})`}
                        </span>
                      </div>
                      {results.ipGeoInfo.asn && (
                        <div className="text-[10px] text-[var(--color-textSecondary)]">
                          AS{results.ipGeoInfo.asn} {results.ipGeoInfo.asn_org && `- ${results.ipGeoInfo.asn_org}`}
                        </div>
                      )}
                      {results.ipGeoInfo.isp && (
                        <div className="text-[10px] text-[var(--color-textMuted)] truncate" title={results.ipGeoInfo.isp}>
                          ISP: {results.ipGeoInfo.isp}
                        </div>
                      )}
                      {results.ipGeoInfo.is_datacenter && (
                        <div className="text-[10px] text-yellow-500">
                          ⚠ {t('diagnostics.datacenterIp', 'Datacenter IP')}
                        </div>
                      )}
                    </div>
                  ) : isRunning ? (
                    <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                  ) : (
                    <span className="text-xs text-[var(--color-textMuted)]">-</span>
                  )}
                </div>

                {/* Asymmetric Routing */}
                <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                    {t('diagnostics.asymmetricRouting', 'Routing Analysis')}
                  </div>
                  {results.asymmetricRouting ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <GitBranch size={12} className={results.asymmetricRouting.asymmetry_detected ? 'text-yellow-500' : 'text-green-500'} />
                        <span className={`text-xs font-medium ${
                          results.asymmetricRouting.asymmetry_detected ? 'text-yellow-500' : 'text-green-500'
                        }`}>
                          {results.asymmetricRouting.asymmetry_detected 
                            ? t('diagnostics.asymmetryDetected', 'Asymmetry Detected')
                            : t('diagnostics.symmetricPath', 'Symmetric Path')}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--color-textSecondary)]">
                        {t('diagnostics.confidence', 'Confidence')}: {results.asymmetricRouting.confidence}
                      </div>
                      <div className="text-[10px] text-[var(--color-textMuted)]">
                        {t('diagnostics.pathStability', 'Stability')}: {results.asymmetricRouting.path_stability}
                        {results.asymmetricRouting.latency_variance !== undefined && 
                          ` (±${results.asymmetricRouting.latency_variance.toFixed(1)}ms)`}
                      </div>
                      {results.asymmetricRouting.ttl_analysis.received_ttl && (
                        <div className="text-[10px] text-[var(--color-textMuted)]">
                          TTL: {results.asymmetricRouting.ttl_analysis.received_ttl}
                          {results.asymmetricRouting.ttl_analysis.estimated_hops && 
                            ` (~${results.asymmetricRouting.ttl_analysis.estimated_hops} hops)`}
                        </div>
                      )}
                    </div>
                  ) : isRunning ? (
                    <Loader2 size={14} className="text-[var(--color-textMuted)] animate-spin" />
                  ) : (
                    <span className="text-xs text-[var(--color-textMuted)]">-</span>
                  )}
                </div>

                {/* UDP Probe */}
                {results.udpProbe && (
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                      {t('diagnostics.udpProbe', 'UDP Probe')}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Radio size={12} className={results.udpProbe.response_received ? 'text-green-500' : 'text-yellow-500'} />
                        <span className={`text-xs font-medium ${
                          results.udpProbe.response_received ? 'text-green-500' : 'text-yellow-500'
                        }`}>
                          {results.udpProbe.response_received 
                            ? t('diagnostics.responseReceived', 'Response Received')
                            : results.udpProbe.response_type === 'icmp_unreachable'
                              ? t('diagnostics.portClosed', 'Port Closed')
                              : t('diagnostics.noResponse', 'No Response (Filtered?)')}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--color-textSecondary)]">
                        Port: {results.udpProbe.port}
                      </div>
                      {results.udpProbe.latency_ms && (
                        <div className="text-[10px] text-[var(--color-textMuted)]">
                          Latency: {results.udpProbe.latency_ms}ms
                        </div>
                      )}
                      {results.udpProbe.response_data && (
                        <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
                          {results.udpProbe.response_data.substring(0, 32)}...
                        </code>
                      )}
                    </div>
                  </div>
                )}

                {/* Leakage Detection */}
                {results.leakageDetection && (
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
                      {t('diagnostics.leakageDetection', 'Proxy/VPN Leak Check')}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Shield size={12} className={
                          results.leakageDetection.overall_status === 'secure' ? 'text-green-500' :
                          results.leakageDetection.overall_status === 'leak_detected' ? 'text-red-500' :
                          'text-yellow-500'
                        } />
                        <span className={`text-xs font-medium ${
                          results.leakageDetection.overall_status === 'secure' ? 'text-green-500' :
                          results.leakageDetection.overall_status === 'leak_detected' ? 'text-red-500' :
                          'text-yellow-500'
                        }`}>
                          {results.leakageDetection.overall_status === 'secure' 
                            ? t('diagnostics.noLeaks', 'No Leaks Detected')
                            : results.leakageDetection.overall_status === 'leak_detected'
                              ? t('diagnostics.leakDetected', 'Leak Detected!')
                              : t('diagnostics.potentialLeak', 'Potential Leak')}
                        </span>
                      </div>
                      {results.leakageDetection.detected_public_ip && (
                        <div className="text-[10px] text-[var(--color-textSecondary)]">
                          Public IP: {results.leakageDetection.detected_public_ip}
                        </div>
                      )}
                      {results.leakageDetection.dns_leak_detected && (
                        <div className="text-[10px] text-red-500">
                          ⚠ {t('diagnostics.dnsLeak', 'DNS Leak Detected')}
                        </div>
                      )}
                      {results.leakageDetection.ip_mismatch_detected && (
                        <div className="text-[10px] text-red-500">
                          ⚠ {t('diagnostics.ipMismatch', 'IP Mismatch')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Protocol-Specific Deep Diagnostics ──────────────────── */}
          {(protocolReport || protocolDiagRunning || protocolDiagError) && (
            <div className="bg-[var(--color-surfaceHover)]/50 border border-purple-500/30 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-purple-950/20 border-b border-purple-500/20">
                <Microscope size={14} className="text-purple-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-purple-300">
                  {connection.protocol.toUpperCase()} Deep Diagnostics
                </h3>
                {protocolReport && (
                  <span className="ml-auto text-[10px] text-[var(--color-textSecondary)]">
                    {protocolReport.protocol.toUpperCase()}{' '}
                    {protocolReport.resolvedIp && `${protocolReport.host} → ${protocolReport.resolvedIp}:${protocolReport.port}`}
                    {protocolReport.totalDurationMs > 0 && ` (${protocolReport.totalDurationMs}ms)`}
                  </span>
                )}
              </div>

              {protocolDiagRunning && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-purple-400">
                  <Loader2 size={14} className="animate-spin" />
                  Running {connection.protocol.toUpperCase()} diagnostics…
                </div>
              )}

              {protocolDiagError && (
                <div className="px-4 py-3 text-sm text-red-400">
                  Diagnostics failed: {protocolDiagError}
                </div>
              )}

              {protocolReport && (
                <div className="divide-y divide-[var(--color-border)]/40">
                  {protocolReport.steps.map((step, idx) => {
                    const isExpanded = expandedProtoStep === idx;
                    const stepIcon = step.status === 'pass'
                      ? <CheckCircle size={14} className="text-green-400" />
                      : step.status === 'fail'
                        ? <XCircle size={14} className="text-red-400" />
                        : step.status === 'warn'
                          ? <AlertCircle size={14} className="text-yellow-400" />
                          : step.status === 'info'
                            ? <Info size={14} className="text-blue-400" />
                            : <Activity size={14} className="text-gray-500" />;
                    return (
                      <div key={idx}>
                        <button
                          onClick={() => setExpandedProtoStep(p => p === idx ? null : idx)}
                          className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-surfaceHover)] transition-colors"
                        >
                          {stepIcon}
                          <span className="flex-1 text-xs text-[var(--color-text)]">{step.name}</span>
                          <span className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
                            <Clock size={10} />
                            {step.durationMs}ms
                          </span>
                          {step.detail && (
                            isExpanded
                              ? <ChevronUp size={12} className="text-[var(--color-textMuted)]" />
                              : <ChevronDown size={12} className="text-[var(--color-textMuted)]" />
                          )}
                        </button>
                        <div className="px-4 pb-1 -mt-0.5 pl-10">
                          <p className={`text-[10px] ${
                            step.status === 'fail' ? 'text-red-400' :
                            step.status === 'warn' ? 'text-yellow-400' :
                            step.status === 'info' ? 'text-blue-400' :
                            'text-[var(--color-textSecondary)]'
                          }`}>
                            {step.message}
                          </p>
                        </div>
                        {isExpanded && step.detail && (
                          <div className="px-4 pb-2 pl-10">
                            <pre className="text-[10px] text-[var(--color-textSecondary)] whitespace-pre-wrap bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-2 mt-1">
                              {step.detail}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Summary */}
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-xs text-[var(--color-text)]">
                      <span className="font-semibold text-[var(--color-textSecondary)]">Summary: </span>
                      {protocolReport.summary}
                    </p>
                    {protocolReport.rootCauseHint && (
                      <div className="rounded-lg border border-yellow-500/30 bg-yellow-950/20 p-3">
                        <h4 className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <AlertCircle size={10} />
                          Root Cause Analysis
                        </h4>
                        <pre className="text-[10px] text-yellow-200/80 whitespace-pre-wrap leading-relaxed">
                          {protocolReport.rootCauseHint}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
