import type {
  NetworkToolId,
  ToolkitReport,
} from "../../types/network/networkToolkit";
import { NETWORK_TOOLKIT_CATALOG } from "./networkToolkitCatalog";

type Row = Record<string, unknown>;
export interface ToolkitSection {
  title: string;
  columns: string[];
  rows: Row[];
}
export interface ToolkitPresentation {
  title: string;
  summary: string;
  sections: ToolkitSection[];
  notes: string[];
}
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown) => (typeof value === "string" ? value : "");
export const toolkitLabel = (name: string) =>
  ({
    rcode: "Response code",
    rcodeName: "Response",
    ttl: "TTL (seconds)",
    elapsedMs: "Elapsed (ms)",
    durationMs: "Duration (ms)",
    estimatedOffsetMs: "Estimated clock offset (ms)",
    estimatedNetworkDelayMs: "Estimated network delay (ms)",
    sha256: "SHA-256 fingerprint",
    bytes: "Bytes",
    ip: "IP address",
    fps: "Frames per second",
    authenticatedDataClaim: "Resolver claims authenticated DNS data",
    dnssecLocallyValidated: "DNSSEC validated locally",
    bits_per_second: "Throughput (bits/second)",
    seconds: "Duration (seconds)",
    retransmits: "TCP retransmissions",
    roundTripMs: "Round trip (ms)",
    headersMs: "Response headers (ms)",
    notBeforeUnix: "Valid from (UTC)",
    notAfterUnix: "Valid until (UTC)",
  })[name] ??
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
export function toolkitCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length ? value.map(toolkitCell).join(", ") : "None reported";
  if (typeof value === "object")
    return Object.entries(record(value))
      .map(([key, item]) => `${toolkitLabel(key)}: ${toolkitCell(item)}`)
      .join(" · ");
  return String(value);
}

/** Parse only recognizable native utility formats. Unrecognized lines remain
 * visible as text; missing/partial output never means success or an empty route. */
export function parseToolkitCommand(
  tool: NetworkToolId,
  stdout: string,
): { rows: Row[]; remainder: string[] } {
  const rows: Row[] = [],
    remainder: string[] = [];
  // Native command output can contain ANSI color escapes.
  // eslint-disable-next-line no-control-regex
  const lines = stdout.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/);
  if ((tool === "routes" || tool === "arp") && stdout.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (Array.isArray(parsed))
        return { rows: parsed.map(record), remainder: [] };
    } catch {
      /* Preserve malformed output. */
    }
  }
  for (const line of lines.slice(0, 4096)) {
    if (!line.trim()) continue;
    let row: Row | undefined;
    if (tool === "traceroute") {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        const body = match[2];
        const samples = [
          ...body.matchAll(/(<?\s*\d+(?:[.,]\d+)?)\s*ms\b/g),
        ].map((x) => `${x[1].trim()} ms`);
        const address = body
          .split(/\s+/)
          .find(
            (x) =>
              /^(?:\d{1,3}\.){3}\d{1,3}$/.test(x) ||
              /^[a-f\d]*:[a-f\d:]+$/i.test(x),
          );
        row = {
          hop: Number(match[1]),
          address: address ?? "—",
          timings: samples,
          status: address ? "Reply received" : "No identified reply",
          observation: body,
        };
      }
    } else if (tool === "netstat") {
      const fields = line.trim().split(/\s+/);
      if (/^(tcp|udp)\d?$/i.test(fields[0])) {
        if (
          /^(ESTAB|LISTEN|UNCONN|TIME-WAIT|CLOSE-WAIT|SYN-SENT)$/.test(
            fields[1],
          ) &&
          fields.length >= 6
        )
          row = {
            protocol: fields[0],
            state: fields[1],
            receiveQueue: fields[2],
            sendQueue: fields[3],
            localEndpoint: fields[4],
            remoteEndpoint: fields[5],
            extra: fields.slice(6).join(" "),
          };
        else if (/^\d+$/.test(fields[1]) && /^\d+$/.test(fields[2]))
          row = {
            protocol: fields[0],
            receiveQueue: fields[1],
            sendQueue: fields[2],
            localEndpoint: fields[3],
            remoteEndpoint: fields[4],
            state: fields[5] ?? "—",
            extra: fields.slice(6).join(" "),
          };
        else if (fields[1] && fields[2])
          row = {
            protocol: fields[0],
            localEndpoint: fields[1],
            remoteEndpoint: fields[2],
            state: fields[0].toLowerCase() === "udp" ? "—" : fields[3],
            processId:
              fields[0].toLowerCase() === "udp" ? fields[3] : fields[4],
          };
      } else if (
        /^(ESTAB|LISTEN|UNCONN|TIME-WAIT|CLOSE-WAIT|SYN-SENT)\s/.test(
          line.trim(),
        )
      )
        row = {
          state: fields[0],
          receiveQueue: fields[1],
          sendQueue: fields[2],
          localEndpoint: fields[3],
          remoteEndpoint: fields[4],
          extra: fields.slice(5).join(" "),
        };
    } else if (tool === "routes") {
      const fields = line.trim().split(/\s+/);
      if (fields.length === 5 && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(fields[0]))
        row = {
          destination: fields[0],
          netmask: fields[1],
          gateway: fields[2],
          interface: fields[3],
          metric: fields[4],
        };
      else if (
        fields.length >= 4 &&
        (fields[0] === "default" ||
          fields[0].includes(":") ||
          /^\d/.test(fields[0])) &&
        !/^\d+$/.test(fields[0])
      )
        row = {
          destination: fields[0],
          gateway: fields[1],
          flags: fields[2],
          interface: fields[fields.length - 1],
          observation: line.trim(),
        };
      else if (
        fields.length >= 4 &&
        /^\d+$/.test(fields[0]) &&
        /^\d+$/.test(fields[1]) &&
        fields[2].includes(":")
      )
        row = {
          interface: fields[0],
          metric: fields[1],
          destination: fields[2],
          gateway: fields.slice(3).join(" "),
        };
    } else if (tool === "arp") {
      const match = line.match(
        /^\s*((?:\d{1,3}\.){3}\d{1,3})\s+([\da-f]{2}(?:[-:][\da-f]{2}){5})\s+(\S+)/i,
      );
      const bsd = line.match(/\(([^)]+)\) at (\S+) on (\S+)(.*)$/);
      if (match)
        row = { address: match[1], macAddress: match[2], type: match[3] };
      else if (bsd)
        row = {
          address: bsd[1],
          macAddress: bsd[2],
          interface: bsd[3],
          flags: bsd[4].trim(),
        };
    } else if (tool === "bonjour") {
      const fields = line.split(";");
      if (fields.length >= 6 && /^[=+\-]$/.test(fields[0]))
        row = {
          event:
            fields[0] === "="
              ? "Resolved"
              : fields[0] === "+"
                ? "Added"
                : "Removed",
          interface: fields[1],
          protocol: fields[2],
          name: fields[3],
          service: fields[4],
          domain: fields[5],
          hostname: fields[6],
          address: fields[7],
          port: fields[8],
          attributes: fields.slice(9).join(";"),
        };
      else {
        const match = line.match(
          /^\s*(\S+)\s+(Add|Rmv)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/,
        );
        if (match)
          row = {
            time: match[1],
            event: match[2] === "Add" ? "Added" : "Removed",
            flags: match[3],
            interface: match[4],
            domain: match[5],
            service: match[6],
            name: match[7],
          };
      }
    } else if (tool === "whois") {
      const match = line.match(/^\s*([^%#\s][^:]{0,120}):\s*(.+)$/);
      if (match) row = { field: match[1].trim(), value: match[2] };
    }
    if (row) rows.push(row);
    else remainder.push(line);
  }
  if (lines.length > 4096)
    remainder.push(
      "Output preview limited to 4,096 lines; export the report for full output.",
    );
  return { rows, remainder };
}

export function presentToolkitReport(
  report: ToolkitReport,
): ToolkitPresentation {
  const data = record(report.data);
  const result: ToolkitPresentation = {
    title:
      NETWORK_TOOLKIT_CATALOG.find((t) => t.id === report.tool)?.label ??
      report.tool,
    summary: "",
    sections: [],
    notes: [],
  };
  const table = (title: string, rows: Row[]) => {
    if (rows.length)
      result.sections.push({
        title,
        columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
        rows,
      });
  };
  const fields = (title: string, source: Row, keys?: string[]) =>
    table(
      title,
      (keys ?? Object.keys(source))
        .filter((key) => source[key] !== undefined && source[key] !== null)
        .map((key) => ({ field: toolkitLabel(key), value: source[key] })),
    );
  const rows = (title: string, value: unknown) =>
    table(
      title,
      list(value).map((item) =>
        typeof item === "object" && item !== null
          ? record(item)
          : { value: item },
      ),
    );
  const note = (value: unknown) => {
    if (typeof value === "string" && value) result.notes.push(value);
  };
  const dns = (source: unknown, title = "DNS response") => {
    const response = record(source);
    fields(title, response, [
      "resolver",
      "transport",
      "durationMs",
      "rcodeName",
      "rcode",
      "authoritative",
      "authenticatedDataClaim",
      "dnssecLocallyValidated",
      "recursionAvailable",
      "truncated",
    ]);
    for (const key of ["answers", "authority", "additional"])
      rows(`${title} · ${toolkitLabel(key)}`, response[key]);
    if (Array.isArray(response.answers) && response.answers.length === 0)
      note(`${title}: no answer records returned.`);
  };
  const command = (value: unknown, title = "Command") => {
    const output = record(value);
    fields(`${title} execution`, output, [
      "program",
      "exitCode",
      "timedOut",
      "truncated",
    ]);
    const parsed = parseToolkitCommand(report.tool, string(output.stdout));
    table(`${title} results`, parsed.rows);
    if (!(report.tool === "iperf" && data.iperf && !record(data.iperf).error))
      rows(`${title} unparsed output`, parsed.remainder);
    if (string(output.stderr))
      rows(
        `${title} messages`,
        string(output.stderr).split(/\r?\n/).filter(Boolean),
      );
    if (output.timedOut === true)
      note(
        "The command timed out. These are partial observations, not a complete result.",
      );
    if (typeof output.exitCode === "number" && output.exitCode !== 0)
      note(
        `The command exited with code ${output.exitCode}. Review its messages.`,
      );
  };
  for (const key of ["note", "scope", "providerWarning", "referralWarning"])
    note(data[key]);
  if (
    data.complete === false ||
    data.truncated === true ||
    data.partial === true
  )
    note(
      "This report is partial. Missing observations do not establish success or absence.",
    );
  switch (report.tool) {
    case "ping":
      result.summary =
        data.status === "responsive" || data.reachable === true
          ? "At least one probe received a reply."
          : "No successful probe is confirmed.";
      fields("Probe summary", data, [
        "address",
        "status",
        "requestedCount",
        "completedProbes",
        "responsiveProbes",
        "unavailableProbes",
        "complete",
      ]);
      rows("Probe results", data.probes);
      break;
    case "pingSweep":
      fields("Sweep summary", data, [
        "network",
        "hostCount",
        "completedHosts",
        "responsiveHosts",
        "concurrency",
        "complete",
      ]);
      table(
        "Hosts",
        list(data.results).map((item) => {
          const row = record(item);
          return { address: row.address, ...record(row.probe) };
        }),
      );
      break;
    case "interfaces":
      rows("Network interfaces", data.interfaces);
      break;
    case "traceroute":
      fields("Trace", data, [
        "address",
        "maxHops",
        "requestedHopTimeoutMs",
        "effectiveHopTimeoutMs",
      ]);
      command(data.probe ?? data.output, "Route trace");
      break;
    case "netstat":
    case "routes":
    case "arp":
      if (data.ipv4 || data.ipv6) {
        command(data.ipv4, "IPv4");
        command(data.ipv6, "IPv6");
      } else command(data.output);
      break;
    case "bonjour":
      fields("Discovery", data, ["scope", "observationWindowMs"]);
      command(data.output, "Services");
      break;
    case "iperf": {
      fields("Traffic test", data, ["address", "mode"]);
      const iperf = record(data.iperf);
      const end = record(iperf.end);
      fields("Sent", record(end.sum_sent));
      fields("Received", record(end.sum_received));
      table(
        "Intervals",
        list(iperf.intervals).map((item) => record(record(item).sum)),
      );
      if (iperf.error) note(iperf.error);
      command(data.output, "iPerf");
      break;
    }
    case "portCheck":
      fields("TCP check", data, ["transport", "port", "openCount"]);
      rows("Endpoints", data.results);
      result.summary =
        "A TCP handshake checks port reachability; it does not confirm application health.";
      break;
    case "dns":
    case "reverseIp":
      fields("Question", data, ["query", "recordType"]);
      dns(data.response);
      break;
    case "dnsPropagation":
      fields("Question", data, ["query", "recordType"]);
      for (const item of list(data.results)) {
        const row = record(item);
        fields("Resolver response", row, ["resolver", "ok", "error"]);
        if (row.response)
          dns(row.response, `Resolver ${toolkitCell(row.resolver)}`);
      }
      break;
    case "rbl":
    case "dnsBlocklist":
      fields("Lookup", data, [
        "target",
        "inputKind",
        "resolvedAddresses",
        "partial",
      ]);
      table(
        "Blocklist results",
        list(data.results).map((item) => {
          const row = record(item);
          const response = record(row.response);
          return {
            address: row.ip,
            provider: row.zone,
            status:
              {
                listed: "Listed",
                notListed: "Not listed",
                error: "Lookup failed",
                indeterminate: "Indeterminate",
              }[string(row.status)] ?? row.status,
            query: row.query,
            reply: list(response.answers).map((answer) => record(answer).data),
            error: row.error,
          };
        }),
      );
      for (const item of list(data.resolution)) {
        const row = record(item);
        fields("Hostname resolution", row, [
          "query",
          "recordType",
          "status",
          "error",
        ]);
        if (row.response) dns(row.response, "Resolution response");
      }
      result.summary =
        "Results apply only to the selected providers and resolved addresses. Failed or indeterminate lookups are not a clean verdict.";
      break;
    case "http":
    case "website": {
      fields("HTTP response", data, [
        "url",
        "method",
        "status",
        "route",
        "redirectsFollowed",
        "bodyBytes",
        "durationMs",
      ]);
      for (const item of list(data.hops)) {
        const hop = record(item);
        fields("HTTP hop", hop, ["url", "status", "headersMs"]);
        rows("Response headers", hop.headers);
      }
      for (const key of [
        "title",
        "contentType",
        "bodyPreview",
        "textPreview",
        "bodyText",
      ])
        if (data[key] !== undefined) fields("Website content", data, [key]);
      fields("Request behavior", record(data.limits));
      break;
    }
    case "tls":
      fields("TLS response", record(data.http), [
        "url",
        "status",
        "durationMs",
      ]);
      {
        const certificate = {
          ...record(
            record(list(record(data.http).hops)[0]).certificate ??
              data.certificate ??
              data.leafCertificate,
          ),
        };
        for (const key of ["notBeforeUnix", "notAfterUnix"]) {
          if (
            typeof certificate[key] === "number" &&
            Number.isFinite(certificate[key]) &&
            Math.abs(certificate[key]) < 8.64e12
          )
            certificate[key] = new Date(certificate[key] * 1000).toISOString();
        }
        fields(
          "Certificate",
          certificate,
          Object.keys(certificate).filter(
            (k) => k !== "subjectAlternativeNames",
          ),
        );
        rows("Certificate names", certificate.subjectAlternativeNames);
      }
      break;
    case "publicIp":
      fields("Observed public address", data, [
        "ip",
        "address",
        "route",
        "endpoint",
      ]);
      fields("HTTP response", record(data.http), [
        "url",
        "status",
        "durationMs",
      ]);
      break;
    case "whois":
      fields("Registration query", data, ["query"]);
      for (const item of list(data.replies)) {
        const reply = record(item);
        fields("WHOIS server", reply, ["server", "port"]);
        const parsed = parseToolkitCommand("whois", string(reply.text));
        table("Registration fields", parsed.rows);
        rows("Provider text", parsed.remainder);
      }
      break;
    case "rdap": {
      const registration = record(data.registration);
      fields("Registration", registration, [
        "objectClassName",
        "handle",
        "ldhName",
        "unicodeName",
        "name",
        "type",
        "startAddress",
        "endAddress",
        "ipVersion",
        "country",
        "status",
        "port43",
      ]);
      for (const key of [
        "events",
        "nameservers",
        "entities",
        "notices",
        "remarks",
        "links",
      ])
        rows(toolkitLabel(key), registration[key]);
      fields("HTTP response", record(data.http), [
        "url",
        "status",
        "durationMs",
      ]);
      break;
    }
    case "smtp":
      fields("SMTP server", data, [
        "address",
        "localAddress",
        "status",
        "startTlsAdvertised",
        "commandsSent",
      ]);
      for (const key of ["greeting", "ehlo", "quit"]) {
        const reply = record(data[key]);
        fields(toolkitLabel(key), reply, ["code"]);
        rows(`${toolkitLabel(key)} lines`, reply.lines);
      }
      rows("Connection attempts", data.connectionAttempts);
      break;
    case "ntp":
      fields("Time sample", data);
      result.summary =
        "One unauthenticated time sample; the local clock was not changed.";
      break;
    case "dhcp":
      fields("DHCP information", data);
      result.summary =
        "DHCPINFORM reads server configuration without requesting a lease or applying settings.";
      break;
    case "hash":
      fields("Checksum", data, ["algorithm", "encoding", "bytes", "digest"]);
      break;
    case "ipCalculator":
      fields("Address range", data);
      break;
    default: {
      const exhaustive: never = report.tool;
      void exhaustive;
    }
  }
  if (!result.sections.length) {
    result.summary ||=
      "No recognizable result fields were returned. Inspect the original report for details.";
    fields("Returned fields", data);
  }
  return result;
}
