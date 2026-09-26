import { describe, it, expect } from "vitest";
import { discoveredHostsToCsv } from "../../src/utils/discovery/discoveredHostsCsv";
import { DiscoveredHost } from "../../src/types/connection/connection";

describe("discoveredHostsToCsv", () => {
  it("converts hosts to CSV", () => {
    const hosts: DiscoveredHost[] = [
      {
        ip: "192.168.1.10",
        hostname: "server",
        openPorts: [22, 80],
        services: [
          { port: 22, protocol: "tcp", service: "ssh" },
          { port: 80, protocol: "tcp", service: "http" },
        ],
        responseTime: 42,
        macAddress: "AA:BB:CC:DD:EE:FF",
      },
    ];

    const csv = discoveredHostsToCsv(hosts);

    expect(csv).toBe(
      "IP,Hostname,ResponseTime,MAC,OpenPorts,Services,Products,Identification,Reachability\n" +
        "192.168.1.10,server,42,AA:BB:CC:DD:EE:FF,22;80,ssh:22;http:80,,22:unknown;80:unknown,not-checked",
    );
  });

  it("exports product evidence and neutralizes untrusted spreadsheet formulas", () => {
    const csv = discoveredHostsToCsv([
      {
        ip: "192.0.2.10",
        hostname: "=HYPERLINK(1)",
        openPorts: [22],
        responseTime: 5,
        reachability: "responsive",
        services: [
          {
            port: 22,
            protocol: "ssh",
            service: "ssh",
            product: "OpenSSH",
            version: "9.6",
            detection: "identified",
          },
        ],
      },
    ]);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("OpenSSH 9.6:22,22:identified,responsive");
  });
});
