import { DiscoveredHost } from "../types/connection";

const escapeCsv = (str: string): string => {
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const discoveredHostsToCsv = (hosts: DiscoveredHost[]): string => {
  const headers = [
    "IP",
    "Hostname",
    "ResponseTime",
    "MAC",
    "OpenPorts",
    "Services",
  ];

  const rows = hosts.map((host) => [
    host.ip,
    host.hostname || "",
    host.responseTime.toString(),
    host.macAddress || "",
    host.openPorts.join(";"),
    host.services.map((s) => `${s.service}:${s.port}`).join(";"),
  ]);

  return [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
};
