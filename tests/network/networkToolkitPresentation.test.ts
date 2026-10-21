import { describe, expect, it } from "vitest";
import {
  NETWORK_TOOL_IDS,
  type NetworkToolId,
  type ToolkitReport,
} from "../../src/types/network/networkToolkit";
import {
  parseToolkitCommand,
  presentToolkitReport,
  toolkitCell,
} from "../../src/utils/network/networkToolkitPresentation";

const output = (stdout: string) => ({
  program: "fixture",
  stdout,
  stderr: "",
  exitCode: 0,
  timedOut: false,
});
const response = {
  rcodeName: "NoError",
  answers: [
    {
      name: "example.test",
      type: "A",
      ttl: 60,
      data: { address: "192.0.2.1" },
    },
  ],
};
const cases: Record<NetworkToolId, [unknown, string]> = {
  ping: [
    {
      address: "192.0.2.1",
      status: "responsive",
      responsiveProbes: 1,
      probes: [{ reachable: true }],
    },
    "192.0.2.1",
  ],
  pingSweep: [
    {
      network: "192.0.2.0/30",
      results: [{ address: "192.0.2.1", probe: { reachable: true } }],
    },
    "192.0.2.1",
  ],
  interfaces: [
    { interfaces: [{ name: "Ethernet", address: "192.0.2.1" }] },
    "Ethernet",
  ],
  traceroute: [{ probe: output(" 1  2.3 ms 192.0.2.1") }, "192.0.2.1"],
  netstat: [
    { output: output("TCP 127.0.0.1:22 127.0.0.1:2200 ESTABLISHED 1234") },
    "ESTABLISHED",
  ],
  routes: [
    {
      ipv4: output('[{"dst":"default","gateway":"192.0.2.254","dev":"eth0"}]'),
      ipv6: output("[]"),
    },
    "192.0.2.254",
  ],
  arp: [
    { output: output("192.0.2.1 00-11-22-33-44-55 dynamic") },
    "00-11-22-33-44-55",
  ],
  bonjour: [
    {
      output: output(
        "=;eth0;IPv4;Printer;_ipp._tcp;local;printer.local;192.0.2.5;631;",
      ),
    },
    "Printer",
  ],
  iperf: [
    {
      iperf: { end: { sum_received: { bits_per_second: 10000000 } } },
      output: output(""),
    },
    "10000000",
  ],
  portCheck: [
    {
      port: 22,
      openCount: 0,
      results: [{ address: "192.0.2.1:22", status: "refused" }],
    },
    "refused",
  ],
  dns: [{ query: "example.test", recordType: "A", response }, "192.0.2.1"],
  reverseIp: [
    {
      response: {
        answers: [{ type: "PTR", data: { target: "host.example.test" } }],
      },
    },
    "host.example.test",
  ],
  dnsPropagation: [
    { results: [{ resolver: "192.0.2.53:53", ok: true, response }] },
    "192.0.2.53:53",
  ],
  rbl: [
    {
      target: "example.test",
      resolvedAddresses: ["192.0.2.1"],
      results: [
        {
          ip: "192.0.2.1",
          zone: "rbl.test",
          status: "error",
          error: "Resolver timed out",
        },
      ],
    },
    "Lookup failed",
  ],
  dnsBlocklist: [
    {
      results: [
        {
          zone: "dbl.test",
          query: "example.test.dbl.test",
          status: "notListed",
        },
      ],
    },
    "Not listed",
  ],
  http: [
    {
      url: "https://example.test",
      status: 503,
      hops: [{ status: 503, headers: [{ name: "retry-after", value: "60" }] }],
    },
    "retry-after",
  ],
  website: [
    { status: 200, bodyText: "<script>untrusted()</script>" },
    "<script>untrusted()</script>",
  ],
  tls: [
    {
      http: {
        status: 200,
        hops: [
          {
            certificate: {
              subject: "CN=example.test",
              issuer: "CN=Test CA",
              subjectAlternativeNames: [{ type: "DNS", value: "example.test" }],
            },
          },
        ],
      },
    },
    "CN=Test CA",
  ],
  publicIp: [{ ip: "192.0.2.80", http: { status: 200 } }, "192.0.2.80"],
  whois: [
    {
      replies: [
        {
          server: "whois.test",
          text: "Domain Name: EXAMPLE.TEST\n% informational text",
        },
      ],
    },
    "EXAMPLE.TEST",
  ],
  rdap: [
    {
      registration: {
        ldhName: "example.test",
        events: [{ eventAction: "registration", eventDate: "2020-01-01" }],
      },
    },
    "2020-01-01",
  ],
  smtp: [
    {
      status: "completed",
      greeting: { code: 220, lines: ["mail.example.test ESMTP"] },
    },
    "mail.example.test ESMTP",
  ],
  ntp: [{ status: "reply-validated", estimatedOffsetMs: -2.5 }, "-2.5"],
  dhcp: [
    {
      status: "inform-acknowledged",
      serverIdentifier: "192.0.2.254",
      dnsServers: ["192.0.2.53"],
    },
    "192.0.2.53",
  ],
  hash: [{ algorithm: "SHA256", bytes: 3, digest: "abcdef" }, "abcdef"],
  ipCalculator: [
    { network: "2001:db8::/64", totalAddresses: "18446744073709551616" },
    "18446744073709551616",
  ],
};
const report = (tool: NetworkToolId, data: unknown): ToolkitReport => ({
  tool,
  data,
  jobId: "fixture",
  startedAt: "2026-10-21T12:00:00Z",
  durationMs: 12,
  route: "direct",
});

describe("readable native network tool reports", () => {
  it("states when a DNS answer section or address list is empty", () => {
    expect(toolkitCell([])).toBe("None reported");
    expect(
      presentToolkitReport(
        report("dns", { response: { rcode: 0, answers: [] } }),
      ).notes,
    ).toContain("DNS response: no answer records returned.");
  });
  it.each(NETWORK_TOOL_IDS)("interprets actual %s fields", (tool) => {
    const [data, expected] = cases[tool];
    const result = presentToolkitReport(report(tool, data));
    expect(result.sections.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.sections)).toContain(expected);
  });
  it.each(NETWORK_TOOL_IDS)(
    "handles absent or malformed %s data without claiming success",
    (tool) => {
      for (const value of [null, [], "unexpected", { output: null }])
        expect(() => presentToolkitReport(report(tool, value))).not.toThrow();
    },
  );
  it("keeps unknown/localized output and command failures visible", () => {
    const result = presentToolkitReport(
      report("traceroute", {
        output: {
          ...output("unrecognized localized header\n 1 * * *"),
          timedOut: true,
          exitCode: 1,
          stderr: "Permission denied",
        },
      }),
    );
    expect(JSON.stringify(result)).toContain("unrecognized localized header");
    expect(JSON.stringify(result)).toContain("Permission denied");
    expect(JSON.stringify(result)).toContain("No identified reply");
    expect(result.notes.join(" ")).toMatch(/partial observations/);
  });
  it("parses Windows and Unix trace timings without inventing latency for timeouts", () => {
    const parsed = parseToolkitCommand(
      "traceroute",
      " 1 <1 ms 2 ms 3 ms 192.0.2.1\n 2 * * * Request timed out.\n 3 2001:db8::1 1.234 ms",
    );
    expect(parsed.rows[0]).toMatchObject({
      hop: 1,
      address: "192.0.2.1",
      timings: ["<1 ms", "2 ms", "3 ms"],
    });
    expect(parsed.rows[1]).toMatchObject({
      timings: [],
      status: "No identified reply",
    });
    expect(parsed.rows[2]).toMatchObject({ address: "2001:db8::1" });
  });
  it("parses native platform sockets, routes and neighbour formats", () => {
    expect(
      parseToolkitCommand("netstat", "tcp LISTEN 0 128 127.0.0.1:22 0.0.0.0:*")
        .rows[0],
    ).toMatchObject({
      state: "LISTEN",
      localEndpoint: "127.0.0.1:22",
      remoteEndpoint: "0.0.0.0:*",
    });
    expect(
      parseToolkitCommand("netstat", "tcp 0 0 127.0.0.1:22 0.0.0.0:* LISTEN")
        .rows[0],
    ).toMatchObject({ localEndpoint: "127.0.0.1:22", state: "LISTEN" });
    expect(
      parseToolkitCommand("netstat", "UNCONN 0 0 [::]:5353 [::]:*").rows[0],
    ).toMatchObject({ localEndpoint: "[::]:5353" });
    expect(
      parseToolkitCommand("routes", "0.0.0.0 0.0.0.0 192.0.2.1 192.0.2.10 25")
        .rows[0],
    ).toMatchObject({ gateway: "192.0.2.1", metric: "25" });
    expect(
      parseToolkitCommand(
        "arp",
        "? (192.0.2.1) at aa:bb:cc:dd:ee:ff on en0 ifscope",
      ).rows[0],
    ).toMatchObject({ interface: "en0" });
    expect(
      parseToolkitCommand(
        "arp",
        '[{"dst":"192.0.2.1","lladdr":"aa:bb:cc:dd:ee:ff","state":["REACHABLE"]}]',
      ).rows[0],
    ).toMatchObject({ dst: "192.0.2.1" });
    expect(parseToolkitCommand("routes", "[invalid").remainder).toContain(
      "[invalid",
    );
  });
  it("labels DNSSEC resolver claims and preserves provider errors separately from not listed", () => {
    const dns = presentToolkitReport(
      report("dns", {
        response: {
          authenticatedDataClaim: true,
          dnssecLocallyValidated: false,
        },
      }),
    );
    expect(toolkitCell(dns.sections)).toContain("DNSSEC");
    const rbl = presentToolkitReport(report("rbl", cases.rbl[0]));
    expect(JSON.stringify(rbl)).toContain("Lookup failed");
    expect(JSON.stringify(rbl.sections)).not.toContain("Not listed");
  });
  it("shows certificate dates without mutating the original export", () => {
    const data = {
      http: {
        hops: [{ certificate: { notBeforeUnix: 0, notAfterUnix: 1893456000 } }],
      },
    };
    const original = JSON.stringify(data);
    const result = presentToolkitReport(report("tls", data));
    expect(JSON.stringify(result)).toContain("2030-01-01T00:00:00.000Z");
    expect(JSON.stringify(data)).toBe(original);
  });
});
