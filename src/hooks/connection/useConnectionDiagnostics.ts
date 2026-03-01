import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Connection } from "../../types/connection";
import { useToastContext } from "../../contexts/ToastContext";
import {
  PingResult,
  TracerouteHop,
  PortCheckResult,
  DnsResult,
  IpClassification,
  TcpTimingResult,
  IcmpBlockadeResult,
  ServiceFingerprint,
  TlsCheckResult,
  MtuCheckResult,
  AsymmetricRoutingResult,
  UdpProbeResult,
  IpGeoInfo,
  LeakageDetectionResult,
  DiagnosticResults,
  ProtocolDiagnosticReport,
  initialDiagnosticResults,
  DEFAULT_PROTOCOL_PORTS,
} from "../../types/diagnostics";

/* ── Hook ──────────────────────────────────────────────────────── */

export function useConnectionDiagnostics(connection: Connection) {
  const { t } = useTranslation();
  const { toast } = useToastContext();

  /* ── state ── */
  const [results, setResults] =
    useState<DiagnosticResults>(initialDiagnosticResults);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [protocolReport, setProtocolReport] =
    useState<ProtocolDiagnosticReport | null>(null);
  const [protocolDiagRunning, setProtocolDiagRunning] = useState(false);
  const [protocolDiagError, setProtocolDiagError] = useState<string | null>(
    null,
  );
  const [expandedProtoStep, setExpandedProtoStep] = useState<number | null>(
    null,
  );

  /* ── computed ── */
  const avgPingTime =
    results.pings.length > 0
      ? results.pings
          .filter((p) => p.success && p.time_ms)
          .reduce((sum, p) => sum + (p.time_ms || 0), 0) /
          results.pings.filter((p) => p.success).length || 0
      : 0;

  const pingSuccessRate =
    results.pings.length > 0
      ? (results.pings.filter((p) => p.success).length / results.pings.length) *
        100
      : 0;

  const successfulPings = results.pings.filter((p) => p.success && p.time_ms);

  const jitter =
    successfulPings.length > 1
      ? Math.sqrt(
          successfulPings.reduce(
            (sum, p) => sum + Math.pow((p.time_ms || 0) - avgPingTime, 2),
            0,
          ) /
            (successfulPings.length - 1),
        )
      : 0;

  const pingTimes = successfulPings.map((p) => p.time_ms || 0);
  const maxPing = pingTimes.length > 0 ? Math.max(...pingTimes) : 0;
  const minPing = pingTimes.length > 0 ? Math.min(...pingTimes) : 0;

  /* ── copy to clipboard ── */
  const copyDiagnosticsToClipboard = useCallback(() => {
    const lines: string[] = [
      `=== Connection Diagnostics ===\n`,
      `Connection: ${connection.name}`,
      `Host: ${connection.hostname}`,
      `Protocol: ${connection.protocol}`,
      `Port: ${connection.port || "default"}`,
      ``,
      `--- Network Checks ---`,
      `Internet: ${results.internetCheck}`,
      `Gateway: ${results.gatewayCheck}`,
      `Target Host: ${results.subnetCheck}`,
      ``,
    ];

    if (results.dnsResult) {
      lines.push(`--- DNS Resolution ---`);
      lines.push(
        `Status: ${results.dnsResult.success ? "Success" : "Failed"}`,
      );
      if (results.dnsResult.success) {
        lines.push(
          `Resolved IPs: ${results.dnsResult.resolved_ips.join(", ")}`,
        );
        if (results.dnsResult.reverse_dns) {
          lines.push(`Reverse DNS: ${results.dnsResult.reverse_dns}`);
        }
        lines.push(
          `Resolution Time: ${results.dnsResult.resolution_time_ms}ms`,
        );
      } else if (results.dnsResult.error) {
        lines.push(`Error: ${results.dnsResult.error}`);
      }
      lines.push(``);
    }

    if (results.ipClassification) {
      lines.push(`--- IP Classification ---`);
      lines.push(`IP: ${results.ipClassification.ip}`);
      lines.push(`Type: ${results.ipClassification.ip_type}`);
      if (results.ipClassification.ip_class)
        lines.push(`Class: ${results.ipClassification.ip_class}`);
      if (results.ipClassification.network_info)
        lines.push(`Network: ${results.ipClassification.network_info}`);
      lines.push(``);
    }

    if (results.pings.length > 0) {
      const sp = results.pings.filter((p) => p.success && p.time_ms);
      const avg =
        sp.length > 0
          ? sp.reduce((s, p) => s + (p.time_ms || 0), 0) / sp.length
          : 0;
      const sr =
        (results.pings.filter((p) => p.success).length / results.pings.length) *
        100;
      lines.push(`--- Ping Results ---`);
      lines.push(`Tests: ${results.pings.length}`);
      lines.push(`Success Rate: ${sr.toFixed(0)}%`);
      lines.push(`Average: ${avg > 0 ? avg.toFixed(1) + "ms" : "N/A"}`);
      lines.push(
        `Individual: ${results.pings.map((p) => (p.success ? p.time_ms + "ms" : "timeout")).join(", ")}`,
      );
      lines.push(``);
    }

    if (results.portCheck) {
      lines.push(`--- Port Check ---`);
      lines.push(`Port: ${results.portCheck.port}`);
      lines.push(`Status: ${results.portCheck.open ? "Open" : "Closed"}`);
      if (results.portCheck.service)
        lines.push(`Service: ${results.portCheck.service}`);
      if (results.portCheck.time_ms)
        lines.push(`Response Time: ${results.portCheck.time_ms}ms`);
      if (results.portCheck.banner)
        lines.push(`Banner: ${results.portCheck.banner}`);
      lines.push(``);
    }

    if (results.traceroute.length > 0) {
      lines.push(`--- Traceroute ---`);
      results.traceroute.forEach((hop) => {
        if (hop.timeout) {
          lines.push(`${hop.hop}. * * * (timeout)`);
        } else {
          lines.push(
            `${hop.hop}. ${hop.ip || "unknown"}${hop.hostname ? ` (${hop.hostname})` : ""} - ${hop.time_ms}ms`,
          );
        }
      });
      lines.push(``);
    }

    if (results.tcpTiming) {
      lines.push(`--- TCP Timing ---`);
      lines.push(`Connect Time: ${results.tcpTiming.connect_time_ms}ms`);
      lines.push(
        `Slow Connection: ${results.tcpTiming.slow_connection ? "Yes" : "No"}`,
      );
      if (results.tcpTiming.error)
        lines.push(`Error: ${results.tcpTiming.error}`);
      lines.push(``);
    }

    if (results.icmpBlockade) {
      lines.push(`--- ICMP Status ---`);
      lines.push(
        `ICMP Allowed: ${results.icmpBlockade.icmp_allowed ? "Yes" : "No"}`,
      );
      lines.push(
        `TCP Reachable: ${results.icmpBlockade.tcp_reachable ? "Yes" : "No"}`,
      );
      lines.push(
        `ICMP Likely Blocked: ${results.icmpBlockade.likely_blocked ? "Yes" : "No"}`,
      );
      lines.push(`Diagnosis: ${results.icmpBlockade.diagnosis}`);
      lines.push(``);
    }

    if (results.serviceFingerprint) {
      lines.push(`--- Service Fingerprint ---`);
      lines.push(`Port: ${results.serviceFingerprint.port}`);
      lines.push(`Service: ${results.serviceFingerprint.service}`);
      if (results.serviceFingerprint.protocol_detected)
        lines.push(
          `Protocol Detected: ${results.serviceFingerprint.protocol_detected}`,
        );
      if (results.serviceFingerprint.version)
        lines.push(`Version: ${results.serviceFingerprint.version}`);
      if (results.serviceFingerprint.banner)
        lines.push(`Banner: ${results.serviceFingerprint.banner}`);
      lines.push(``);
    }

    if (results.mtuCheck) {
      lines.push(`--- MTU Check ---`);
      lines.push(`Path MTU: ${results.mtuCheck.path_mtu || "Unknown"}`);
      lines.push(`Recommended MTU: ${results.mtuCheck.recommended_mtu}`);
      lines.push(
        `Fragmentation Needed: ${results.mtuCheck.fragmentation_needed ? "Yes" : "No"}`,
      );
      lines.push(``);
    }

    if (results.tlsCheck) {
      lines.push(`--- TLS Check ---`);
      lines.push(
        `TLS Supported: ${results.tlsCheck.tls_supported ? "Yes" : "No"}`,
      );
      if (results.tlsCheck.tls_version)
        lines.push(`TLS Version: ${results.tlsCheck.tls_version}`);
      lines.push(
        `Certificate Valid: ${results.tlsCheck.certificate_valid ? "Yes" : "No"}`,
      );
      if (results.tlsCheck.certificate_subject)
        lines.push(
          `Certificate Subject: ${results.tlsCheck.certificate_subject}`,
        );
      if (results.tlsCheck.certificate_expiry)
        lines.push(
          `Certificate Expiry: ${results.tlsCheck.certificate_expiry}`,
        );
      lines.push(`Handshake Time: ${results.tlsCheck.handshake_time_ms}ms`);
      if (results.tlsCheck.error)
        lines.push(`Error: ${results.tlsCheck.error}`);
      lines.push(``);
    }

    if (results.asymmetricRouting) {
      lines.push(`--- Asymmetric Routing Detection ---`);
      lines.push(
        `Asymmetry Detected: ${results.asymmetricRouting.asymmetry_detected ? "Yes" : "No"}`,
      );
      lines.push(`Confidence: ${results.asymmetricRouting.confidence}`);
      lines.push(
        `Path Stability: ${results.asymmetricRouting.path_stability}`,
      );
      if (results.asymmetricRouting.latency_variance !== undefined)
        lines.push(
          `Latency Variance: ${results.asymmetricRouting.latency_variance.toFixed(2)}ms`,
        );
      if (results.asymmetricRouting.ttl_analysis.received_ttl)
        lines.push(
          `TTL: ${results.asymmetricRouting.ttl_analysis.received_ttl} (${results.asymmetricRouting.ttl_analysis.ttl_consistent ? "consistent" : "varies"})`,
        );
      if (results.asymmetricRouting.notes.length > 0)
        lines.push(`Notes: ${results.asymmetricRouting.notes.join("; ")}`);
      lines.push(``);
    }

    if (results.udpProbe) {
      lines.push(`--- UDP Probe ---`);
      lines.push(`Port: ${results.udpProbe.port}`);
      lines.push(
        `Response Received: ${results.udpProbe.response_received ? "Yes" : "No"}`,
      );
      if (results.udpProbe.response_type)
        lines.push(`Response Type: ${results.udpProbe.response_type}`);
      if (results.udpProbe.latency_ms)
        lines.push(`Latency: ${results.udpProbe.latency_ms}ms`);
      if (results.udpProbe.error)
        lines.push(`Error: ${results.udpProbe.error}`);
      lines.push(``);
    }

    if (results.ipGeoInfo) {
      lines.push(`--- IP Geolocation ---`);
      lines.push(`IP: ${results.ipGeoInfo.ip}`);
      if (results.ipGeoInfo.asn)
        lines.push(
          `ASN: AS${results.ipGeoInfo.asn}${results.ipGeoInfo.asn_org ? ` (${results.ipGeoInfo.asn_org})` : ""}`,
        );
      if (results.ipGeoInfo.country)
        lines.push(
          `Country: ${results.ipGeoInfo.country}${results.ipGeoInfo.country_code ? ` (${results.ipGeoInfo.country_code})` : ""}`,
        );
      if (results.ipGeoInfo.city)
        lines.push(
          `City: ${results.ipGeoInfo.city}${results.ipGeoInfo.region ? `, ${results.ipGeoInfo.region}` : ""}`,
        );
      if (results.ipGeoInfo.isp) lines.push(`ISP: ${results.ipGeoInfo.isp}`);
      if (results.ipGeoInfo.is_datacenter) lines.push(`Datacenter IP: Yes`);
      lines.push(`Source: ${results.ipGeoInfo.source}`);
      lines.push(``);
    }

    if (results.leakageDetection) {
      lines.push(`--- Proxy/VPN Leakage Detection ---`);
      lines.push(
        `Overall Status: ${results.leakageDetection.overall_status}`,
      );
      lines.push(
        `DNS Leak Detected: ${results.leakageDetection.dns_leak_detected ? "Yes" : "No"}`,
      );
      lines.push(
        `IP Mismatch: ${results.leakageDetection.ip_mismatch_detected ? "Yes" : "No"}`,
      );
      if (results.leakageDetection.detected_public_ip)
        lines.push(
          `Public IP: ${results.leakageDetection.detected_public_ip}`,
        );
      if (results.leakageDetection.dns_servers_detected.length > 0)
        lines.push(
          `DNS Servers: ${results.leakageDetection.dns_servers_detected.join(", ")}`,
        );
      if (results.leakageDetection.notes.length > 0)
        lines.push(`Notes: ${results.leakageDetection.notes.join("; ")}`);
      lines.push(``);
    }

    if (protocolReport) {
      lines.push(
        `--- ${protocolReport.protocol.toUpperCase()} Deep Diagnostics ---`,
      );
      lines.push(`Host: ${protocolReport.host}:${protocolReport.port}`);
      if (protocolReport.resolvedIp)
        lines.push(`Resolved IP: ${protocolReport.resolvedIp}`);
      lines.push(`Total Duration: ${protocolReport.totalDurationMs}ms`);
      protocolReport.steps.forEach((step) => {
        lines.push(
          `  [${step.status.toUpperCase()}] ${step.name}: ${step.message} (${step.durationMs}ms)`,
        );
        if (step.detail) lines.push(`    Detail: ${step.detail}`);
      });
      lines.push(`Summary: ${protocolReport.summary}`);
      if (protocolReport.rootCauseHint)
        lines.push(`Root Cause: ${protocolReport.rootCauseHint}`);
      lines.push(``);
    }

    lines.push(`Generated: ${new Date().toISOString()}`);

    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => {
        toast.success(
          t(
            "diagnostics.copiedToClipboard",
            "Diagnostics copied to clipboard",
          ),
        );
      })
      .catch(() => {
        toast.error(
          t("diagnostics.copyFailed", "Failed to copy to clipboard"),
        );
      });
  }, [connection, results, protocolReport, t, toast]);

  /* ── run diagnostics ── */
  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setResults(initialDiagnosticResults);
    setProtocolReport(null);
    setProtocolDiagError(null);
    setExpandedProtoStep(null);
    let resolvedDnsIp: string | undefined;

    const isTauri =
      typeof window !== "undefined" &&
      Boolean(
        (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
      );

    if (!isTauri) {
      setResults({
        ...initialDiagnosticResults,
        internetCheck: "failed",
        gatewayCheck: "failed",
        subnetCheck: "failed",
      });
      setIsRunning(false);
      return;
    }

    try {
      setCurrentStep(t("diagnostics.runningAll", "Running diagnostics..."));
      const port =
        connection.port ||
        DEFAULT_PROTOCOL_PORTS[connection.protocol.toLowerCase()] ||
        22;

      /* Group 1: Internet & Gateway (parallel) */
      const networkChecksPromise = Promise.allSettled([
        invoke<PingResult>("ping_host_detailed", {
          host: "8.8.8.8",
          count: 1,
          timeoutSecs: 5,
        }),
        invoke<PingResult>("ping_gateway", { timeout_secs: 5 }),
      ]).then(([internetRes, gatewayRes]) => {
        setResults((prev) => ({
          ...prev,
          internetCheck:
            internetRes.status === "fulfilled" && internetRes.value.success
              ? "success"
              : "failed",
          gatewayCheck:
            gatewayRes.status === "fulfilled" && gatewayRes.value.success
              ? "success"
              : "failed",
        }));
      });

      /* Group 2: DNS, target ping, port check (parallel) */
      const targetChecksPromise = Promise.allSettled([
        invoke<DnsResult>("dns_lookup", {
          host: connection.hostname,
          timeoutSecs: 5,
        }),
        invoke<PingResult>("ping_host_detailed", {
          host: connection.hostname,
          count: 1,
          timeoutSecs: 5,
        }),
        invoke<PortCheckResult>("check_port", {
          host: connection.hostname,
          port,
          timeoutSecs: 5,
        }),
      ]).then(async ([dnsRes, subnetRes, portRes]) => {
        if (dnsRes.status === "fulfilled") {
          const dnsResult = dnsRes.value;
          setResults((prev) => ({ ...prev, dnsResult }));
          resolvedDnsIp = dnsResult.resolved_ips[0];

          if (dnsResult.success && dnsResult.resolved_ips.length > 0) {
            try {
              const classification = await invoke<IpClassification>(
                "classify_ip",
                { ip: dnsResult.resolved_ips[0] },
              );
              setResults((prev) => ({
                ...prev,
                ipClassification: classification,
              }));
            } catch {
              /* IP classification is optional */
            }
          }
        } else {
          try {
            const classification = await invoke<IpClassification>(
              "classify_ip",
              { ip: connection.hostname },
            );
            setResults((prev) => ({
              ...prev,
              ipClassification: classification,
            }));
          } catch {
            /* Not a valid IP either */
          }
        }

        setResults((prev) => ({
          ...prev,
          subnetCheck:
            subnetRes.status === "fulfilled" && subnetRes.value.success
              ? "success"
              : "failed",
        }));

        if (portRes.status === "fulfilled") {
          setResults((prev) => ({ ...prev, portCheck: portRes.value }));
        } else {
          setResults((prev) => ({
            ...prev,
            portCheck: { port, open: false, time_ms: undefined },
          }));
        }
      });

      /* Group 3: Traceroute */
      const traceroutePromise = invoke<TracerouteHop[]>("traceroute", {
        host: connection.hostname,
        maxHops: 30,
        timeoutSecs: 3,
      })
        .then((tracerouteResult) => {
          setResults((prev) => ({ ...prev, traceroute: tracerouteResult }));
        })
        .catch((error) => {
          console.warn("Traceroute failed:", error);
        });

      await Promise.all([
        networkChecksPromise,
        targetChecksPromise,
        traceroutePromise,
      ]);

      /* Group 4: Advanced diagnostics (parallel) */
      setCurrentStep(
        t("diagnostics.runningAdvanced", "Running advanced diagnostics..."),
      );

      const advancedChecksPromise = Promise.allSettled([
        invoke<TcpTimingResult>("tcp_connection_timing", {
          host: connection.hostname,
          port,
          timeoutSecs: 10,
        }),
        invoke<IcmpBlockadeResult>("detect_icmp_blockade", {
          host: connection.hostname,
          port,
        }),
        invoke<ServiceFingerprint>("fingerprint_service", {
          host: connection.hostname,
          port,
        }),
        [443, 8443, 993, 995, 465, 636].includes(port) ||
        connection.protocol === "https"
          ? invoke<TlsCheckResult>("check_tls", {
              host: connection.hostname,
              port,
            })
          : Promise.resolve(null),
        invoke<MtuCheckResult>("check_mtu", { host: connection.hostname }),
      ]).then(([tcpRes, icmpRes, fingerprintRes, tlsRes, mtuRes]) => {
        setResults((prev) => ({
          ...prev,
          tcpTiming: tcpRes.status === "fulfilled" ? tcpRes.value : null,
          icmpBlockade: icmpRes.status === "fulfilled" ? icmpRes.value : null,
          serviceFingerprint:
            fingerprintRes.status === "fulfilled" ? fingerprintRes.value : null,
          tlsCheck: tlsRes.status === "fulfilled" ? tlsRes.value : null,
          mtuCheck: mtuRes.status === "fulfilled" ? mtuRes.value : null,
        }));
      });

      await advancedChecksPromise;

      /* Group 5: Extended diagnostics */
      setCurrentStep(
        t("diagnostics.runningExtended", "Running extended diagnostics..."),
      );

      const targetIp = resolvedDnsIp || connection.hostname;

      const udpPorts: Record<string, number> = {
        dns: 53,
        ntp: 123,
        snmp: 161,
        tftp: 69,
        dhcp: 67,
      };
      const udpPort =
        udpPorts[connection.protocol.toLowerCase()] ||
        ([53, 123, 161, 162, 69, 67, 68, 500].includes(port) ? port : null);
      const configuredProxyHost = connection.security?.proxy?.host;
      const usesProxyPath = Boolean(
        connection.security?.proxy?.enabled ||
          connection.proxyChainId ||
          connection.connectionChainId,
      );

      const extendedChecksPromise = Promise.allSettled([
        invoke<AsymmetricRoutingResult>("detect_asymmetric_routing", {
          host: connection.hostname,
          sampleCount: 5,
        }),
        invoke<IpGeoInfo>("lookup_ip_geo", { ip: targetIp }),
        udpPort
          ? invoke<UdpProbeResult>("probe_udp_port", {
              host: connection.hostname,
              port: udpPort,
              timeoutMs: 3000,
            })
          : Promise.resolve(null),
        usesProxyPath
          ? invoke<LeakageDetectionResult>("detect_proxy_leakage", {
              expectedExitIp: configuredProxyHost,
            })
          : Promise.resolve(null),
      ]).then(([asymmetricRes, geoRes, udpRes, leakageRes]) => {
        setResults((prev) => ({
          ...prev,
          asymmetricRouting:
            asymmetricRes.status === "fulfilled" ? asymmetricRes.value : null,
          ipGeoInfo: geoRes.status === "fulfilled" ? geoRes.value : null,
          udpProbe: udpRes.status === "fulfilled" ? udpRes.value : null,
          leakageDetection:
            leakageRes.status === "fulfilled" ? leakageRes.value : null,
        }));
      });

      await extendedChecksPromise;

      /* Group 6: Sequential pings */
      setCurrentStep(t("diagnostics.runningPings", "Running ping tests..."));
      const pings: PingResult[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const pingResult = await invoke<PingResult>("ping_host_detailed", {
            host: connection.hostname,
            count: 1,
            timeoutSecs: 5,
          });
          pings.push(pingResult);
          setResults((prev) => ({ ...prev, pings: [...pings] }));
        } catch (error) {
          pings.push({ success: false, error: String(error) });
          setResults((prev) => ({ ...prev, pings: [...pings] }));
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      /* Group 7: Protocol-specific deep diagnostics */
      const proto = connection.protocol.toLowerCase();
      if (["ssh", "http", "https", "rdp"].includes(proto)) {
        setCurrentStep(
          t(
            "diagnostics.runningProtocol",
            "Running {{protocol}} diagnostics...",
            { protocol: proto.toUpperCase() },
          ),
        );
        setProtocolDiagRunning(true);
        setProtocolDiagError(null);
        try {
          let report: ProtocolDiagnosticReport | null = null;
          if (proto === "ssh") {
            report = await invoke<ProtocolDiagnosticReport>(
              "diagnose_ssh_connection",
              {
                host: connection.hostname,
                port,
                username: connection.username || "",
                password: connection.password || null,
                privateKeyPath: connection.privateKey || null,
                privateKeyPassphrase: null,
                connectTimeoutSecs: 10,
              },
            );
          } else if (proto === "http" || proto === "https") {
            report = await invoke<ProtocolDiagnosticReport>(
              "diagnose_http_connection",
              {
                host: connection.hostname,
                port,
                useTls: proto === "https",
                path: "/",
                method: "GET",
                expectedStatus: null,
                connectTimeoutSecs: 15,
                verifySsl: true,
              },
            );
          } else if (proto === "rdp") {
            report = await invoke<ProtocolDiagnosticReport>(
              "diagnose_rdp_connection",
              {
                host: connection.hostname,
                port,
                username: connection.username || "",
                password: connection.password || "",
                domain: connection.domain || null,
                settings: null,
              },
            );
          }
          setProtocolReport(report);
        } catch (err) {
          setProtocolDiagError(String(err));
        } finally {
          setProtocolDiagRunning(false);
        }
      }
    } catch (error) {
      console.error("Diagnostics failed:", error);
    } finally {
      setIsRunning(false);
      setCurrentStep("");
    }
  }, [connection, t]);

  /* ── auto-run on mount ── */
  useEffect(() => {
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    /* state */
    results,
    isRunning,
    currentStep,
    protocolReport,
    protocolDiagRunning,
    protocolDiagError,
    expandedProtoStep,
    setExpandedProtoStep,
    /* computed */
    avgPingTime,
    pingSuccessRate,
    successfulPings,
    jitter,
    pingTimes,
    maxPing,
    minPing,
    /* actions */
    runDiagnostics,
    copyDiagnosticsToClipboard,
  };
}

export type DiagnosticsMgr = ReturnType<typeof useConnectionDiagnostics>;
