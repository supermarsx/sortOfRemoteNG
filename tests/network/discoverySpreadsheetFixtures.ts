import type { SavedDiscoveryScan } from "../../src/utils/discovery/scanHistory";

export const spreadsheetScan = (): SavedDiscoveryScan => ({
  id: "scan-office",
  name: "Office scan",
  startedAt: 1700000000000,
  elapsedMs: 1200,
  outcome: "complete",
  config: {
    enabled: true,
    ipRange: "192.0.2.0/24",
    portRanges: [],
    protocols: ["ssh"],
    timeout: 500,
    maxConcurrent: 2,
    maxPortConcurrent: 2,
    customPorts: {},
    probeStrategies: {},
    cacheTTL: 0,
    hostnameTtl: 0,
    macTtl: 0,
  },
  hosts: [
    {
      ip: "192.0.2.10",
      hostname: '=HYPERLINK("https://remote.invalid")',
      openPorts: [22, 443],
      responseTime: 5,
      macAddress: "00:11:22:33:44:55",
      reachability: "responsive",
      services: [
        {
          port: 22,
          protocol: "ssh",
          service: "SSH",
          product: "OpenSSH",
          version: "9.0",
          detection: "identified",
          banner: "+cmd|' /C calc'!A0",
          evidence: "@SUM(A1:A2)",
          identificationError: "-not a formula",
        },
      ],
      discoveryProbes: [{ method: "icmp", status: "responsive", elapsedMs: 3 }],
    },
    {
      ip: "192.0.2.11",
      hostname: "router",
      openPorts: [],
      services: [],
      responseTime: 0,
      reachability: "unavailable",
      discoveryProbes: [
        {
          method: "arp",
          status: "unavailable",
          elapsedMs: 0,
          error: "Permission denied",
        },
      ],
    },
  ],
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
