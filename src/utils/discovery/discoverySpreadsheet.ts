import type { DiscoveredHost } from "../../types/connection/connection";
import type {
  DatabaseDocument,
  DatabaseDocumentStore,
  DocumentScope,
  DocumentSpreadsheetCell,
  DocumentSpreadsheetSheet,
} from "../../types/documents/document";
import { generateId } from "../core/id";
import {
  createDocumentService,
  createEmptyDocument,
} from "../documents/documentService";
import { hasPendingDocumentDraft } from "../documents/documentDrafts";
import { spreadsheetAddress } from "../documents/spreadsheetModel";
import {
  DOCUMENT_LIMITS,
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../documents/validation";
import { normalizeDiscoveryScan, type SavedDiscoveryScan } from "./scanHistory";

export const DISCOVERY_SPREADSHEET_LIMIT_NOTICE =
  "Exports are limited to 9,999 data rows per sheet, 50,000 cells across the document library, 32,768 characters per cell and 32 MiB per library. If a limit is exceeded, nothing is truncated: narrow the host filter or use CSV.";
export const DISCOVERY_DRAFT_NOTICE =
  "Documents has unsaved changes or a save in progress in this storage. Open Documents, save or discard the draft, then return here and retry.";

export function sameDiscoveryDocumentScope(
  a: DocumentScope | null | undefined,
  b: DocumentScope | null | undefined,
) {
  return (
    !!a &&
    !!b &&
    (a.kind ?? "database") === (b.kind ?? "database") &&
    a.databaseId === b.databaseId &&
    a.generation === b.generation
  );
}

/** All remote fields are literal values. Never feed scanned text into a formula parser. */
export function createDiscoverySpreadsheet(input: {
  scan: SavedDiscoveryScan;
  hosts?: DiscoveredHost[];
  filtered?: boolean;
  filterText?: string;
  name: string;
  parentFolderId?: string | null;
}): DatabaseDocument {
  const name = input.name.trim();
  if (!name || name.length > 256)
    throw Error("Enter a document name of 1–256 characters.");
  const totalHosts = input.scan.hosts.length;
  // Validate only the selected snapshot so a deliberate filtered export can fit.
  const scan = normalizeDiscoveryScan({
    ...input.scan,
    hosts: input.hosts ?? input.scan.hosts,
  });
  let cells = 0;
  const tooLarge = () =>
    Error(
      `This scan cannot fit in a Documents spreadsheet. ${DISCOVERY_SPREADSHEET_LIMIT_NOTICE}`,
    );
  type Value = DocumentSpreadsheetCell["value"] | undefined;
  const sheet = (id: string, name: string, headers: string[]) => {
    const result: DocumentSpreadsheetSheet = {
      id,
      name,
      rows: 1,
      columns: headers.length,
      cells: {},
      merges: [],
      rowMetadata: {},
      columnMetadata: Object.fromEntries(
        headers.map((_, index) => [index, { size: 180 }]),
      ),
      freeze: { rows: 1, columns: 0 },
    };
    let row = 0;
    const append = (values: Value[]) => {
      if (row >= DOCUMENT_LIMITS.rows) throw tooLarge();
      values.forEach((value, column) => {
        if (
          ++cells > DOCUMENT_LIMITS.cells ||
          (typeof value === "string" && value.length > 32768)
        )
          throw tooLarge();
        result.cells[spreadsheetAddress(row, column)] = {
          value: value ?? null,
          ...(row === 0 ? { styleId: "heading" } : {}),
        };
      });
      result.rows = ++row;
    };
    append(headers);
    return { result, append };
  };
  const metadata = sheet("scan", "Scan", ["Property", "Value"]);
  const hosts = sheet("hosts", "Hosts", [
    "Address",
    "Hostname",
    "Status",
    "MAC address",
    "Response time (ms)",
    "Open ports",
    "Service count",
  ]);
  const services = sheet("services", "Services", [
    "Address",
    "Hostname",
    "Port",
    "Protocol",
    "Service",
    "Product",
    "Version",
    "Detection",
    "Banner",
    "Evidence",
    "Identification error",
  ]);
  const probes = sheet("probes", "Probes", [
    "Address",
    "Hostname",
    "Method",
    "Status",
    "Elapsed (ms)",
    "Error",
  ]);
  for (const row of [
    ["Scan ID", scan.id],
    ["Scan name", scan.name],
    ["Started at (UTC)", new Date(scan.startedAt).toISOString()],
    ["Elapsed (ms)", scan.elapsedMs],
    ["Outcome", scan.outcome],
    [
      "Results",
      input.filtered
        ? "Filtered hosts (all services for each matching host)"
        : "All hosts",
    ],
    ["Host filter", input.filtered ? (input.filterText ?? "") : ""],
    ["Total scan hosts", totalHosts],
    ["Exported hosts", scan.hosts.length],
    ["Exported at (UTC)", new Date().toISOString()],
    [
      "Observation",
      "Scan snapshot; not a current reachability check. Port hints are not verified service identities.",
    ],
  ] as Value[][])
    metadata.append(row);
  for (const [key, value] of Object.entries(scan.config)) {
    if (value !== undefined)
      metadata.append([
        `Configuration: ${key}`,
        typeof value === "object" ? JSON.stringify(value) : value,
      ]);
  }
  for (const host of scan.hosts) {
    hosts.append([
      host.ip,
      host.hostname,
      host.reachability ?? "not-checked",
      host.macAddress,
      host.responseTime,
      host.openPorts.join(", "),
      host.services.length,
    ]);
    for (const service of host.services)
      services.append([
        host.ip,
        host.hostname,
        service.port,
        service.protocol,
        service.service,
        service.product,
        service.version,
        service.detection,
        service.banner,
        service.evidence,
        service.identificationError,
      ]);
    for (const probe of host.discoveryProbes ?? [])
      probes.append([
        host.ip,
        host.hostname,
        probe.method,
        probe.status,
        probe.elapsedMs,
        probe.error,
      ]);
  }
  const document = createEmptyDocument(name, input.parentFolderId ?? null);
  document.icon = "file-spreadsheet";
  document.blocks = [
    {
      id: generateId(),
      type: "spreadsheet",
      workbook: {
        version: 1,
        sheets: [metadata.result, hosts.result, services.result, probes.result],
        styles: { heading: { bold: true, wrap: true } },
        validations: {},
      },
    },
  ];
  return normalizeDatabaseDocuments({
    ...emptyDatabaseDocuments(),
    documents: [document],
  }).documents[0];
}

/** Fresh receipt, one CAS, no automatic rebase/retry. Stores verify durable persistence. */
export async function saveDiscoverySpreadsheet(options: {
  document: DatabaseDocument;
  scope: DocumentScope;
  getStore: () => DatabaseDocumentStore | undefined;
  assertCurrent: () => void;
  verifyPolicy: () => Promise<void>;
}): Promise<void> {
  const scope = { ...options.scope };
  const assertAccess = () => {
    options.assertCurrent();
    if (!sameDiscoveryDocumentScope(options.getStore()?.scope, scope))
      throw Error(
        "Document storage changed or locked. Close this export and reopen it.",
      );
  };
  const assertDraft = () => {
    if (hasPendingDocumentDraft(scope.databaseId, scope.kind ?? "database"))
      throw Error(DISCOVERY_DRAFT_NOTICE);
  };
  const service = createDocumentService(options.getStore);
  try {
    assertAccess();
    assertDraft();
    const review = await service.read(scope);
    assertAccess();
    assertDraft();
    await options.verifyPolicy();
    assertAccess();
    assertDraft();
    const replacement = normalizeDatabaseDocuments({
      ...review.data,
      revision: review.data.revision + 1,
      documents: [...review.data.documents, options.document],
    });
    await service.apply(review, replacement);
    assertAccess();
  } finally {
    service.clear();
  }
}
