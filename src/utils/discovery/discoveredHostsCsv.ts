import { DiscoveredHost } from "../../types/connection/connection";

const escapeCsv = (str: string): string => {
  // Discovered titles/banners are untrusted spreadsheet input, not formulas.
  const safe = /^[\s]*[=+@-]/.test(str) ? `'${str}` : str;
  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
};

export const discoveredHostsToCsv = (hosts: DiscoveredHost[]): string => {
  const headers = [
    "IP",
    "Hostname",
    "ResponseTime",
    "MAC",
    "OpenPorts",
    "Services",
    "Products",
    "Identification",
    "Reachability",
  ];

  const rows = hosts.map((host) => [
    host.ip,
    host.hostname || "",
    host.responseTime.toString(),
    host.macAddress || "",
    host.openPorts.join(";"),
    host.services.map((s) => `${s.service}:${s.port}`).join(";"),
    host.services
      .filter((s) => s.product)
      .map((s) => `${s.product}${s.version ? ` ${s.version}` : ""}:${s.port}`)
      .join(";"),
    host.services.map((s) => `${s.port}:${s.detection ?? "unknown"}`).join(";"),
    host.reachability ?? "not-checked",
  ]);

  return [
    headers.join(","),
    ...rows.map((r) => r.map(escapeCsv).join(",")),
  ].join("\n");
};
