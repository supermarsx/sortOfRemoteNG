import type { DiscoveredHost } from "../../types/connection/connection";
import type { SavedDiscoveryScan } from "./scanHistory";
import { discoveredHostsToCsv } from "./discoveredHostsCsv";

/** Export the selected snapshot, independent of the active scan or its filter. */
export function exportDiscoveryScanCsv(
  scan: SavedDiscoveryScan,
  hosts: DiscoveredHost[] = scan.hosts,
): void {
  const label =
    (scan.name || scan.id)
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 100) || "saved";
  const url = URL.createObjectURL(
    new Blob([discoveredHostsToCsv(hosts)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `network-scan-${label}.csv`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
