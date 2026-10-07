export const NETWORK_TOOL_IDS = [
  "ping",
  "traceroute",
  "dns",
  "pingSweep",
  "interfaces",
  "iperf",
  "whois",
  "rdap",
  "tls",
  "ipCalculator",
  "portCheck",
  "bonjour",
  "smtp",
  "reverseIp",
  "rbl",
  "http",
  "publicIp",
  "hash",
  "dnsPropagation",
  "dnsBlocklist",
  "ntp",
  "website",
  "netstat",
  "routes",
  "arp",
  "dhcp",
] as const;

export type NetworkToolId = (typeof NETWORK_TOOL_IDS)[number];
export type ToolkitRoute = "direct" | "httpProxy";

export interface ToolkitRequest {
  jobId: string;
  tool: NetworkToolId;
  target: string;
  timeoutMs: number;
  route: ToolkitRoute;
  proxyUrl?: string;
  options: Record<string, string>;
}

export interface ToolkitReport {
  jobId: string;
  tool: NetworkToolId;
  startedAt: string;
  durationMs: number;
  route: ToolkitRoute;
  data: unknown;
}
