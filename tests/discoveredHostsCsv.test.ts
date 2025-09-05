import { describe, it, expect } from "vitest";
import { discoveredHostsToCsv } from "../src/utils/discoveredHostsCsv";
import { DiscoveredHost } from "../src/types/connection";

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
      "IP,Hostname,ResponseTime,MAC,OpenPorts,Services\n" +
        "192.168.1.10,server,42,AA:BB:CC:DD:EE:FF,22;80,ssh:22;http:80",
    );
  });
});
