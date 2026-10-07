import * as ipaddr from "ipaddr.js";
import type {
  NetworkToolId,
  ToolkitRequest,
  ToolkitRoute,
} from "../../types/network/networkToolkit";

export type ToolkitOption = {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  defaultValue?: string;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  help?: string;
  required?: boolean;
};
export type ToolkitTool = {
  id: NetworkToolId;
  label: string;
  group: "Connectivity" | "DNS" | "Web & Mail" | "Local & Discovery";
  description: string;
  target: "host" | "dnsName" | "url" | "tls" | "ip" | "cidr" | "text" | "none";
  targetLabel?: string;
  optionalTarget?: boolean;
  placeholder?: string;
  route: "local" | "direct" | "proxy";
  trafficConfirmation?: boolean;
  fields: ToolkitOption[];
};

const dnsTransport: ToolkitOption = {
  key: "transport",
  label: "DNS transport",
  kind: "select",
  defaultValue: "udp",
  choices: [
    { value: "udp", label: "UDP" },
    { value: "tcp", label: "TCP" },
  ],
};
const dnsRecord: ToolkitOption = {
  key: "recordType",
  label: "Record type",
  kind: "select",
  defaultValue: "A",
  choices: [
    "A",
    "AAAA",
    "CNAME",
    "MX",
    "TXT",
    "SRV",
    "PTR",
    "NS",
    "SOA",
    "CAA",
    "NAPTR",
    "SSHFP",
    "TLSA",
    "HTTPS",
    "SVCB",
    "DNSKEY",
    "DS",
    "RRSIG",
    "NSEC",
    "NSEC3",
    "ANY",
  ].map((value) => ({ value, label: value })),
};
const dnsResolver: ToolkitOption = {
  key: "resolver",
  label: "Resolver IP[:port]",
  kind: "text",
  required: true,
  help: "Enter an explicit resolver; no public resolver is selected automatically. Use [IPv6]:port for a custom IPv6 port.",
};
const dnsZones: ToolkitOption = {
  key: "zones",
  label: "DNS blocklist zones",
  kind: "text",
  required: true,
  help: "1–32 comma- or space-separated zones. Choose providers you are authorized to query; no default blocklist is contacted.",
};

const numberField = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
): ToolkitOption => ({
  key,
  label,
  kind: "number",
  defaultValue: String(value),
  min,
  max,
});
const packetTimeout = numberField(
  "packetTimeoutMs",
  "Per-probe timeout (ms)",
  1000,
  100,
  5000,
);
const localAddress: ToolkitOption = {
  key: "localAddress",
  label: "Local source IP (optional)",
  kind: "text",
  help: "Bind to an IP assigned to this computer. Leave empty for OS selection; interface names are not accepted.",
};
const httpMethod: ToolkitOption = {
  key: "method",
  label: "HTTP method",
  kind: "select",
  defaultValue: "GET",
  choices: ["GET", "HEAD"].map((value) => ({ value, label: value })),
  help: "Read-only diagnostics: no request body, authentication or custom headers.",
};
const maxRedirects = numberField("maxRedirects", "Maximum redirects", 5, 0, 5);
const maxBytes: ToolkitOption = {
  ...numberField("maxBytes", "Maximum response bytes", 1048576, 1, 1048576),
  help: "Oversized responses fail instead of being silently truncated. The native report also has an overall size limit. HEAD does not read the body.",
};

export const NETWORK_TOOLKIT_CATALOG: readonly ToolkitTool[] = [
  {
    id: "ping",
    label: "Ping",
    group: "Connectivity",
    description:
      "Send bounded reachability probes. Native platform support is required.",
    target: "host",
    route: "direct",
    fields: [numberField("count", "Probe count", 4, 1, 10), packetTimeout],
  },
  {
    id: "traceroute",
    label: "Traceroute",
    group: "Connectivity",
    description:
      "Inspect the path to a host using the native traceroute utility.",
    target: "host",
    route: "direct",
    fields: [
      numberField("maxHops", "Maximum hops", 16, 1, 30),
      numberField("hopTimeoutMs", "Per-hop timeout (ms)", 1000, 100, 3000),
    ],
  },
  {
    id: "pingSweep",
    label: "Ping sweep",
    group: "Connectivity",
    description:
      "Probe hosts in a bounded IPv4 subnet. Run only on networks you are authorized to inspect.",
    target: "cidr",
    targetLabel: "IPv4 subnet (CIDR)",
    placeholder: "192.168.1.0/28",
    route: "direct",
    fields: [
      numberField("concurrency", "Concurrent probes", 16, 1, 16),
      packetTimeout,
    ],
  },
  {
    id: "portCheck",
    label: "Port check",
    group: "Connectivity",
    description: "Check TCP reachability without attempting to sign in.",
    target: "host",
    route: "direct",
    fields: [
      {
        key: "port",
        label: "TCP port",
        kind: "number",
        min: 1,
        max: 65535,
        required: true,
      },
      localAddress,
    ],
  },
  {
    id: "iperf",
    label: "iPerf",
    group: "Connectivity",
    description:
      "Generate test traffic to an authorized iPerf server. Requires the native utility; no automatic installation.",
    target: "host",
    route: "direct",
    trafficConfirmation: true,
    fields: [
      numberField("port", "Server port", 5201, 1, 65535),
      numberField("durationSeconds", "Traffic duration (seconds)", 5, 1, 30),
      numberField("bandwidthMbps", "Maximum bandwidth (Mbps)", 10, 1, 100),
      localAddress,
    ],
  },
  {
    id: "ntp",
    label: "NTP",
    group: "Connectivity",
    description:
      "Query one unauthenticated NTP time sample without changing this computer's clock.",
    target: "host",
    route: "direct",
    fields: [
      numberField("port", "NTP server port", 123, 1, 65535),
      localAddress,
    ],
  },
  {
    id: "dns",
    label: "DNS lookup",
    group: "DNS",
    description:
      "Query DNS records at an explicit resolver. AD is a resolver claim, not local DNSSEC validation.",
    target: "dnsName",
    targetLabel: "DNS name",
    route: "direct",
    fields: [dnsResolver, dnsRecord, dnsTransport],
  },
  {
    id: "reverseIp",
    label: "Reverse IP / PTR",
    group: "DNS",
    description:
      "Look up reverse DNS (PTR). This is not an inventory of all websites hosted on an IP address.",
    target: "ip",
    targetLabel: "IP address",
    route: "direct",
    fields: [dnsResolver, dnsTransport],
  },
  {
    id: "dnsPropagation",
    label: "DNS propagation",
    group: "DNS",
    description:
      "Compare DNS answers across resolvers. A comparison does not prove worldwide propagation or validate DNSSEC locally.",
    target: "dnsName",
    targetLabel: "DNS name",
    route: "direct",
    fields: [
      {
        key: "resolvers",
        label: "Resolvers to compare",
        kind: "text",
        required: true,
        help: "1–8 explicit resolver IP[:port] endpoints, comma- or space-separated.",
      },
      dnsRecord,
      dnsTransport,
    ],
  },
  {
    id: "rbl",
    label: "IP blocklist (RBL)",
    group: "DNS",
    description:
      "Check an IP address against DNS-based blocklists. Replies are not a guarantee of abuse or safety.",
    target: "ip",
    targetLabel: "IP address",
    route: "direct",
    fields: [dnsResolver, dnsZones, dnsTransport],
  },
  {
    id: "dnsBlocklist",
    label: "Domain / DNS blocklist",
    group: "DNS",
    description:
      "“dnl bl” is interpreted as a domain/DNS blocklist lookup. Provider responses are informational, not a security verdict.",
    target: "dnsName",
    targetLabel: "Domain name",
    route: "direct",
    fields: [dnsResolver, dnsZones, dnsTransport],
  },
  {
    id: "http",
    label: "HTTP request",
    group: "Web & Mail",
    description:
      "Inspect an explicit HTTP(S) endpoint. No saved browser session or credentials are attached.",
    target: "url",
    targetLabel: "HTTP(S) URL",
    placeholder: "https://example.org/",
    route: "proxy",
    fields: [httpMethod, maxRedirects, maxBytes],
  },
  {
    id: "website",
    label: "Website check",
    group: "Web & Mail",
    description:
      "Inspect a website response as data, without rendering its HTML or running its scripts.",
    target: "url",
    targetLabel: "Website URL",
    placeholder: "https://example.org/",
    route: "proxy",
    fields: [httpMethod, maxRedirects, maxBytes],
  },
  {
    id: "tls",
    label: "TLS certificate",
    group: "Web & Mail",
    description:
      "Inspect the leaf certificate using HTTPS HEAD with strict certificate validation. No redirects, protocol/cipher scan or ignore-certificate-errors mode.",
    target: "tls",
    targetLabel: "TLS hostname, IP or HTTPS URL",
    placeholder: "https://example.org/",
    route: "proxy",
    fields: [
      {
        key: "port",
        label: "TLS port (optional)",
        kind: "number",
        min: 1,
        max: 65535,
        help: "Defaults to the HTTPS URL port or 443. A conflicting URL and port is rejected.",
      },
    ],
  },
  {
    id: "smtp",
    label: "SMTP check",
    group: "Web & Mail",
    description:
      "Read the plaintext SMTP greeting and EHLO capabilities, then QUIT. No STARTTLS, implicit TLS, authentication or mail sending.",
    target: "host",
    route: "direct",
    fields: [
      numberField("port", "SMTP server port", 25, 1, 65535),
      {
        key: "ehloName",
        label: "EHLO hostname",
        kind: "text",
        defaultValue: "localhost",
      },
      localAddress,
    ],
  },
  {
    id: "whois",
    label: "WHOIS",
    group: "Web & Mail",
    description:
      "Query provider-supplied registration information over unencrypted WHOIS port 43. At most one referral is followed; not proof of ownership or security.",
    target: "host",
    targetLabel: "Domain or IP address",
    route: "direct",
    fields: [
      {
        key: "server",
        label: "WHOIS server",
        kind: "text",
        defaultValue: "whois.iana.org",
        help: "The selected server receives your query. Enter a hostname or IP, without a port or URL.",
      },
      {
        key: "followReferral",
        label: "WHOIS referral",
        kind: "select",
        defaultValue: "true",
        choices: [
          { value: "true", label: "Follow at most one validated referral" },
          { value: "false", label: "Do not follow referrals" },
        ],
      },
    ],
  },
  {
    id: "rdap",
    label: "RDAP",
    group: "Web & Mail",
    description:
      "Query provider-supplied registration data. The default third-party provider rdap.org receives the query and may redirect to a registry; not an ownership or security attestation.",
    target: "host",
    targetLabel: "Domain or IP address",
    route: "proxy",
    fields: [
      {
        key: "endpoint",
        label: "RDAP provider base URL",
        kind: "text",
        defaultValue: "https://rdap.org",
        help: "Credential-free HTTP(S) base URL without query parameters. HTTPS is recommended.",
      },
      maxRedirects,
      maxBytes,
    ],
  },
  {
    id: "publicIp",
    label: "Public IP",
    group: "Web & Mail",
    description:
      "Ask an external service for the public IP observed through your chosen route. Default third-party provider: api.ipify.org. This is not a DNS or proxy leak audit.",
    target: "none",
    route: "proxy",
    fields: [
      {
        key: "endpoint",
        label: "Public IP provider URL",
        kind: "text",
        defaultValue: "https://api.ipify.org?format=json",
        help: "Provider must return a single plain IP or JSON with an ip field. Response body is limited to 16 KiB.",
      },
      maxRedirects,
    ],
  },
  {
    id: "interfaces",
    label: "Network interfaces",
    group: "Local & Discovery",
    description:
      "Read local interface information; no network configuration is changed.",
    target: "none",
    route: "direct",
    fields: [],
  },
  {
    id: "netstat",
    label: "Netstat",
    group: "Local & Discovery",
    description:
      "Read local socket information. Results may contain sensitive endpoint information.",
    target: "none",
    route: "direct",
    fields: [],
  },
  {
    id: "routes",
    label: "Routing table",
    group: "Local & Discovery",
    description:
      "Read the local routing table without adding or deleting routes.",
    target: "none",
    route: "direct",
    fields: [],
  },
  {
    id: "arp",
    label: "ARP / neighbors",
    group: "Local & Discovery",
    description: "Read the local neighbor cache without changing entries.",
    target: "none",
    route: "direct",
    fields: [],
  },
  {
    id: "bonjour",
    label: "Bonjour / mDNS",
    group: "Local & Discovery",
    description:
      "Discover local multicast services. HTTP proxies cannot carry this local-network protocol.",
    target: "none",
    route: "direct",
    fields: [
      {
        key: "serviceType",
        label: "DNS-SD service type",
        kind: "text",
        defaultValue: "_services._dns-sd._udp",
        help: "For example _http._tcp; the default browses available service types. Requires dns-sd or avahi-browse.",
      },
    ],
  },
  {
    id: "dhcp",
    label: "DHCP INFORM",
    group: "Local & Discovery",
    description:
      "Send an explicitly authorized DHCP INFORM request to a specific server; this does not acquire or change a lease. Platform support and appropriate privileges may be required.",
    target: "ip",
    targetLabel: "DHCP server IPv4 address",
    route: "direct",
    trafficConfirmation: true,
    fields: [
      {
        ...localAddress,
        label: "Existing local IPv4 address",
        required: true,
        help: "Required: an IPv4 address already assigned to an active interface. Sends one unicast INFORM from UDP 68 to the server's UDP 67; no broadcast discovery or lease changes. Port 68 may be unavailable or require privileges.",
      },
    ],
  },
  {
    id: "ipCalculator",
    label: "IP calculator",
    group: "Local & Discovery",
    description:
      "Calculate IPv4 or IPv6 CIDR information locally. No network request.",
    target: "cidr",
    targetLabel: "IP address / prefix (CIDR)",
    placeholder: "2001:db8::/64",
    route: "local",
    fields: [],
  },
  {
    id: "hash",
    label: "Hash calculator",
    group: "Local & Discovery",
    description:
      "Hash exact UTF-8 text locally, including whitespace. Nothing is sent over the network. MD5 and SHA-1 are legacy checksums, not secure hashes.",
    target: "text",
    targetLabel: "Text to hash",
    route: "local",
    fields: [
      {
        key: "algorithm",
        label: "Hash algorithm",
        kind: "select",
        defaultValue: "SHA256",
        choices: ["SHA256", "MD5", "SHA1", "SHA384", "SHA512"].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
  },
];

export interface ToolkitDraft {
  target: string;
  timeoutMs: number;
  route: ToolkitRoute | "";
  proxyUrl: string;
  proxyProfileId: string;
  options: Record<string, string>;
  confirmTraffic: boolean;
}

export function createToolkitDraft(tool: ToolkitTool): ToolkitDraft {
  return {
    target: "",
    timeoutMs: 5000,
    route: "",
    proxyUrl: "",
    proxyProfileId: "",
    confirmTraffic: false,
    options: Object.fromEntries(
      tool.fields
        .filter((field) => field.defaultValue !== undefined)
        .map((field) => [field.key, field.defaultValue!]),
    ),
  };
}

function isHost(value: string): boolean {
  if (ipaddr.isValid(value)) return true;
  return (
    value.length <= 253 &&
    value
      .replace(/\.$/, "")
      .split(".")
      .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  );
}

function isIp(value: string): boolean {
  return (
    ipaddr.isValid(value) &&
    !value.includes("%") &&
    (value.includes(":") ||
      /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))
  );
}

function unicastV4(value: string): boolean {
  if (!isIp(value) || value.includes(":")) return false;
  const firstOctet = Number(value.split(".")[0]);
  return firstOctet > 0 && firstOctet < 224;
}

function webUrl(value: string, proxy = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      proxy
        ? "Enter an explicit HTTP(S) proxy URL."
        : "Enter a complete HTTP(S) URL.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port === "0" ||
    /[\s\\]/.test(value) ||
    value.split("://")[1]?.split(/[/?#]/)[0].includes("@")
  )
    throw new Error(
      "Use HTTP(S) without embedded usernames or passwords; saved credentials are never used.",
    );
  if (proxy && (url.pathname !== "/" || url.search || value.includes("#")))
    throw new Error(
      "Proxy URL must contain only a scheme, host and optional port.",
    );
  return url;
}

/** Validation creates an allowlisted request, never performs networking or selects a fallback. */
export function buildToolkitRequest(
  tool: ToolkitTool,
  draft: ToolkitDraft,
): Omit<ToolkitRequest, "jobId"> {
  if (
    !Number.isInteger(draft.timeoutMs) ||
    draft.timeoutMs < 500 ||
    draft.timeoutMs > 60000
  )
    throw new Error("Timeout must be a whole number between 500 and 60000 ms.");
  const target = tool.target === "text" ? draft.target : draft.target.trim();
  if (target.length > (tool.target === "text" ? 65536 : 2048))
    throw new Error("Target is too long; narrow the input.");
  if (
    tool.target !== "none" &&
    tool.target !== "text" &&
    !tool.optionalTarget &&
    !target
  )
    throw new Error(
      `Enter ${tool.targetLabel?.toLowerCase() ?? "a target hostname or IP address"}.`,
    );
  if (target && tool.target === "host" && !isHost(target))
    throw new Error(
      "Enter a hostname or IP address without a URL, credentials or command flags.",
    );
  if (
    target &&
    tool.target === "dnsName" &&
    (target.length > 253 ||
      !target
        .replace(/\.$/, "")
        .split(".")
        .every((label) =>
          /^[a-z\d_](?:[a-z\d_-]{0,61}[a-z\d_])?$/i.test(label),
        ))
  )
    throw new Error(
      "Enter an ASCII DNS name; use punycode for international domain names.",
    );
  if (target && tool.target === "ip" && !isIp(target))
    throw new Error("Enter a valid IPv4 or IPv6 address.");
  if (target && tool.id === "dhcp" && !unicastV4(target))
    throw new Error(
      "DHCP INFORM requires an explicit unicast IPv4 server address.",
    );
  if (target && tool.target === "cidr") {
    try {
      const [address, prefix] = ipaddr.parseCIDR(target);
      if (tool.id === "pingSweep" && address.kind() !== "ipv4")
        throw new Error();
      if (tool.id === "pingSweep" && prefix < 24)
        throw new Error(
          "Sweep is limited to 256 IPv4 addresses (/24 or smaller).",
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("256")) throw error;
      throw new Error(
        tool.id === "pingSweep"
          ? "Enter a valid IPv4 CIDR subnet."
          : "Enter a valid IPv4 or IPv6 CIDR address.",
      );
    }
  }
  if (target && tool.target === "url") webUrl(target);
  if (target && tool.target === "tls") {
    if (target.includes("://")) {
      if (webUrl(target).protocol !== "https:")
        throw new Error("TLS certificate inspection requires HTTPS.");
    } else if (!isHost(target)) {
      throw new Error("Enter a hostname, IP address or complete HTTPS URL.");
    }
  }
  const route = tool.route === "local" ? "direct" : draft.route;
  if (!route)
    throw new Error(
      "Choose Direct or HTTP proxy explicitly before running a network tool.",
    );
  if (route !== "direct" && route !== "httpProxy")
    throw new Error("Choose a supported route.");
  if (route === "httpProxy" && tool.route !== "proxy")
    throw new Error("This tool is direct-only; no proxy fallback is allowed.");
  const proxyUrl = draft.proxyUrl.trim();
  if (route === "httpProxy") {
    if (proxyUrl.length > 2048) throw new Error("Proxy URL is too long.");
    webUrl(proxyUrl, true);
  }
  if (tool.trafficConfirmation && !draft.confirmTraffic)
    throw new Error(
      "Confirm that you authorize this tool to generate network traffic.",
    );
  const options: Record<string, string> = {};
  for (const field of tool.fields) {
    const value = (draft.options[field.key] ?? field.defaultValue ?? "").trim();
    if (field.required && !value.trim())
      throw new Error(`Enter ${field.label.toLowerCase()}.`);
    if (!value) continue;
    if (value.length > 4096) throw new Error(`${field.label} is too long.`);
    if (field.key === "localAddress") {
      if (!isIp(value))
        throw new Error(
          "Local source IP must be an IP address, not an interface name.",
        );
      if (
        ["unspecified", "multicast", "broadcast"].includes(
          ipaddr.parse(value).range(),
        )
      )
        throw new Error(
          "Local source IP must be a specific unicast address assigned to this computer.",
        );
      if (tool.id === "dhcp" && !unicastV4(value))
        throw new Error(
          "DHCP INFORM requires an existing unicast local IPv4 address.",
        );
    }
    if (field.key === "endpoint") {
      const endpoint = webUrl(value);
      if (tool.id === "rdap" && endpoint.search)
        throw new Error(
          "RDAP provider must be a base URL without query parameters.",
        );
    }
    if (
      ["server", "ehloName"].includes(field.key) &&
      (!isHost(value) || (field.key === "ehloName" && value.includes(":")))
    )
      throw new Error(
        `Enter a valid ${field.label.toLowerCase()} without a URL, port or commands.`,
      );
    if (
      field.kind === "select" &&
      !field.choices?.some((choice) => choice.value === value)
    )
      throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
    if (
      field.kind === "number" &&
      (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < (field.min ?? 0) ||
        Number(value) > (field.max ?? Number.MAX_SAFE_INTEGER))
    )
      throw new Error(
        `${field.label} must be a whole number from ${field.min ?? 0} to ${field.max}.`,
      );
    options[field.key] = value;
  }
  if (tool.id === "tls" && options.port && target.includes("://")) {
    const port = webUrl(target).port;
    if (port && Number(port) !== Number(options.port))
      throw new Error("TLS URL port conflicts with the selected port option.");
  }
  if (tool.trafficConfirmation) options.confirmTraffic = "true";
  return {
    tool: tool.id,
    target: tool.target === "none" ? "" : target,
    timeoutMs: draft.timeoutMs,
    route,
    ...(route === "httpProxy" ? { proxyUrl } : {}),
    options,
  };
}
