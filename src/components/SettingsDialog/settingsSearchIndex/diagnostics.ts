import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `diagnostics` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const DIAGNOSTICS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Network ──────────────────────────────────────────────────
  {
    key: "diagnostics.pingCount",
    label: "Ping Count",
    description:
      "Number of ICMP echo requests to send during the sequential ping test. Higher values give more accurate latency and jitter statistics.",
    tags: [
      "ping",
      "count",
      "icmp",
      "echo",
      "network",
      "latency",
      "jitter",
      "packets",
    ],
    synonyms: ["echo request", "number of pings", "pings"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.pingTimeoutSecs",
    label: "Ping Timeout",
    description:
      "Maximum time in seconds to wait for each ping reply before marking it as timed out.",
    tags: ["ping", "timeout", "icmp", "seconds", "reply", "wait"],
    synonyms: ["timed out", "no reply"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.pingIntervalMs",
    label: "Ping Interval",
    description:
      "Delay in milliseconds between consecutive pings. Lower values complete faster but may be rate-limited by firewalls.",
    tags: [
      "ping",
      "interval",
      "delay",
      "milliseconds",
      "ms",
      "rate limit",
      "firewall",
    ],
    synonyms: ["ping rate", "ping delay"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.tracerouteMaxHops",
    label: "Traceroute Max Hops",
    description:
      "Maximum number of network hops (routers) to traverse before stopping the traceroute. Increase for distant hosts.",
    tags: [
      "traceroute",
      "hops",
      "route",
      "path",
      "router",
      "ttl",
      "network",
      "max",
    ],
    synonyms: ["tracert", "trace route", "hop limit", "max ttl"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.tracerouteTimeoutSecs",
    label: "Traceroute Timeout",
    description:
      "Per-hop timeout in seconds. Hops that don't respond within this window are shown as timeouts.",
    tags: ["traceroute", "timeout", "hop", "seconds", "per hop"],
    synonyms: ["tracert", "trace route"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.portCheckTimeoutSecs",
    label: "Port Check Timeout",
    description:
      "Maximum time in seconds to wait for a TCP connection to the target port before declaring it closed or filtered.",
    tags: [
      "port",
      "check",
      "timeout",
      "tcp",
      "scan",
      "closed",
      "filtered",
      "open",
    ],
    synonyms: ["port scan", "portscan", "connect timeout"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },

  // ─── Advanced Checks ──────────────────────────────────────────
  {
    key: "diagnostics.tcpTimingTimeoutSecs",
    label: "TCP Timing Timeout",
    description:
      "Timeout for the TCP connection timing measurement, which measures how long it takes to establish a full TCP handshake.",
    tags: [
      "tcp",
      "timing",
      "handshake",
      "timeout",
      "connect",
      "three way",
      "syn",
    ],
    synonyms: ["3-way handshake", "connect time"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.mtuCheckEnabled",
    label: "MTU Path Discovery",
    description:
      "Detect the maximum transmission unit along the network path. Helps identify fragmentation issues that can cause slow or failed connections.",
    tags: [
      "mtu",
      "fragmentation",
      "path",
      "discovery",
      "packet size",
      "pmtud",
      "network",
    ],
    synonyms: [
      "maximum transmission unit",
      "path mtu",
      "pmtu",
      "packet too big",
      "1500",
    ],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.icmpBlockadeEnabled",
    label: "ICMP Blockade Detection",
    description:
      "Determine if ICMP packets are being blocked by a firewall. Compares ICMP reachability with TCP reachability to detect filtering.",
    tags: [
      "icmp",
      "firewall",
      "block",
      "filter",
      "blockade",
      "reachability",
      "ping",
    ],
    synonyms: ["ping blocked", "icmp blocked", "firewall filtering"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.serviceFingerprintEnabled",
    label: "Service Fingerprinting",
    description:
      "Attempt to identify the service and version running on the target port by analyzing the banner and protocol responses.",
    tags: [
      "fingerprint",
      "service",
      "banner",
      "version",
      "detection",
      "port",
      "identify",
    ],
    synonyms: ["banner grab", "service detection", "version detection"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.asymmetricRoutingEnabled",
    label: "Asymmetric Routing Detection",
    description:
      "Detect if packets take different paths to and from the target, which can cause connection instability, packet loss, or firewall issues.",
    tags: [
      "asymmetric",
      "routing",
      "path",
      "ttl",
      "packet loss",
      "instability",
      "route",
    ],
    synonyms: ["return path", "different route", "route asymmetry"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.asymmetricRoutingSamples",
    label: "Sample Count",
    description:
      "Number of probe samples used to analyze routing symmetry. More samples improve detection accuracy but take longer.",
    tags: ["asymmetric", "routing", "samples", "probes", "accuracy", "count"],
    synonyms: ["sample size", "number of probes"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },

  // ─── TLS / Certificate ────────────────────────────────────────
  {
    key: "diagnostics.tlsCheckEnabled",
    label: "TLS Certificate Check",
    description:
      "For HTTPS and TLS-enabled ports, verify the server certificate, report the TLS version, cipher suite, and certificate expiry date.",
    tags: [
      "tls",
      "ssl",
      "certificate",
      "https",
      "cipher",
      "expiry",
      "chain",
      "handshake",
    ],
    synonyms: [
      "cert",
      "x509",
      "certificate expiry",
      "cipher suite",
      "tls 1.2",
      "tls 1.3",
    ],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },

  // ─── Extended Checks ──────────────────────────────────────────
  {
    key: "diagnostics.ipGeoEnabled",
    label: "IP Geolocation Lookup",
    description:
      "Look up the geographic location, ISP, and ASN information for the target IP address.",
    tags: [
      "geo",
      "geolocation",
      "location",
      "ip",
      "country",
      "asn",
      "isp",
      "lookup",
    ],
    synonyms: ["geoip", "whois", "autonomous system"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.udpProbeEnabled",
    label: "UDP Port Probing",
    description:
      "Send UDP probes to detect services on UDP-based protocols like DNS, NTP, SNMP, and TFTP.",
    tags: ["udp", "probe", "dns", "ntp", "snmp", "tftp", "port", "datagram"],
    synonyms: ["udp scan", "udp port scan"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.udpProbeTimeoutMs",
    label: "UDP Probe Timeout",
    description:
      "Maximum time in milliseconds to wait for a UDP response before considering the port as not responding.",
    tags: ["udp", "timeout", "probe", "milliseconds", "ms", "response"],
    synonyms: ["udp scan timeout"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.leakageDetectionEnabled",
    label: "Proxy/VPN Leakage Detection",
    description:
      "When a proxy or VPN is configured, check for DNS leaks and IP mismatches that could expose your real network identity.",
    tags: [
      "leak",
      "leakage",
      "vpn",
      "proxy",
      "dns",
      "privacy",
      "mismatch",
      "tunnel",
    ],
    synonyms: ["dns leak", "ip leak", "webrtc leak", "privacy leak"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },

  // ─── Protocol Diagnostics ─────────────────────────────────────
  {
    key: "diagnostics.protocolDiagEnabled",
    label: "Protocol-Specific Deep Diagnostics",
    description:
      "Run detailed protocol-level tests for SSH, HTTP/HTTPS, and RDP connections including authentication probes, handshake analysis, and version detection.",
    tags: [
      "protocol",
      "ssh",
      "rdp",
      "http",
      "https",
      "deep",
      "handshake",
      "authentication",
    ],
    synonyms: ["deep diagnostics", "protocol probe", "handshake analysis"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.protocolDiagTimeoutSecs",
    label: "Protocol Diagnostic Timeout",
    description:
      "Maximum time in seconds for the entire protocol-specific diagnostic sequence to complete.",
    tags: ["protocol", "timeout", "diagnostic", "seconds", "deep"],
    synonyms: ["deep diagnostics timeout"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },

  // ─── Behavior & Display ───────────────────────────────────────
  {
    key: "diagnostics.autoRunOnOpen",
    label: "Auto-Run on Open",
    description:
      "Automatically start running all diagnostic checks when the diagnostics tab or panel is opened, without requiring a manual click.",
    tags: ["auto", "run", "start", "open", "automatic", "panel"],
    synonyms: ["autorun", "run automatically", "start on open"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.showDetailedResults",
    label: "Show Detailed Results",
    description:
      "Display verbose diagnostic output including raw values, timing breakdowns, and technical details for each check.",
    tags: ["detail", "detailed", "verbose", "results", "raw", "output"],
    synonyms: ["verbose output", "show details", "raw values"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
  {
    key: "diagnostics.expandFailedSteps",
    label: "Auto-Expand Failed Steps",
    description:
      "Automatically expand the detail panel for diagnostic steps that failed, making it easier to spot problems at a glance.",
    tags: ["expand", "failed", "error", "collapse", "steps", "automatic"],
    synonyms: ["auto expand", "open failures"],
    section: "diagnostics",
    sectionLabel: "Diagnostics",
  },
];
