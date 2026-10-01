import type {
  Connection,
  ConnectionDatabase,
} from "../../types/connection/connection";
import type { StorageData } from "../storage/storage";
import type {
  TrustExportDocument,
  TrustExportRecord,
} from "../auth/trustStore";
import {
  inferLegacyTrustRecordTimestamps,
  isValidTrustRecordTimestamps,
} from "../auth/trustRecordTimestamps";
import type { DocumentReference } from "../../types/documents/document";
import { prepareConnectionForExport } from "../../components/ImportExport/advancedProtocolPortability";
import {
  normalizeDatabaseCredentialVault,
  normalizeConnectionCredentialSource,
} from "../security/databaseCredentialVault";
import { normalizeDatabaseAutomationLibrary } from "../recording/automationLibraryValidation";
import { normalizeDatabaseDocuments } from "../documents/validation";
import { normalizeDatabaseSettings } from "../documents/documentTypePolicy";
import { verifyDocumentAttachments } from "../documents/documentAttachments";
import { normalizeRecycleBin } from "./recycleBin";
import {
  ArchiveDependencyCollector,
  archiveDependencyPath,
  formatArchiveDependencyDiagnostics,
  type ArchiveDependencyDiagnostics,
} from "./archiveDependencyDiagnostics";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
} from "../storage/recordLedger";
import {
  normalizeHttpAutomation,
  normalizeSshQuickActions,
} from "./sessionQuickActions";
import { validateNewPassword } from "../security/passwordPolicy";
import {
  encryptWithPassword,
  type PasswordEncryptionOptions,
} from "../crypto/webCryptoAes";

export const FULL_DATABASE_ARCHIVE_FORMAT = "sorng-full-database" as const;
export const MAX_FULL_DATABASE_ARCHIVE_BYTES = 48 * 1024 * 1024;
export interface FullDatabaseArchive extends Required<
  Omit<StorageData, "recordMetadata">
> {
  recordMetadata?: StorageData["recordMetadata"];
  format: typeof FULL_DATABASE_ARCHIVE_FORMAT;
  version: 1;
  collection: Pick<
    ConnectionDatabase,
    "id" | "name" | "description" | "isEncrypted"
  > & { exportDate: string };
  trustRecords: TrustExportDocument;
}
export class FullDatabaseRestoreIncompleteError extends Error {
  constructor(public readonly databaseId: string) {
    super(
      `The protected database was created (${databaseId}), but trust restoration did not complete. Inspect this database before retrying; this is not a complete restore.`,
    );
    this.name = "FullDatabaseRestoreIncompleteError";
  }
}
export class FullDatabaseArchiveError extends Error {
  constructor(
    public readonly code:
      | "format"
      | "dependencies"
      | "file-credential"
      | "password"
      | "protection"
      | "trust",
    public readonly diagnostics?: ArchiveDependencyDiagnostics,
  ) {
    super(
      diagnostics
        ? formatArchiveDependencyDiagnostics(diagnostics)
        : {
            format:
              "Invalid, unsupported or oversized full database archive. No archive data was applied.",
            dependencies:
              "The full database archive has missing or external connection, credential, document or script dependencies. Include the owning database library and repair unresolved references before exporting or importing.",
            "file-credential":
              "A connection uses a device-local private-key file. Move the key material into this database's credential vault and select that credential before creating a portable full database archive.",
            password:
              "Full database archives require a password of 12–1024 characters that meets the export password policy.",
            protection:
              "Full database archives require a password-encrypted source and a new managed protected database. Connection-only append cannot restore a full database.",
            trust:
              "Full database trust records could not be read or restored. The operation is not a complete database backup or restore.",
          }[code],
    );
    this.name = "FullDatabaseArchiveError";
  }
}

/** Only archive-authored diagnostics may enter sync status; never raw causes. */
export function fullDatabaseArchiveErrorDetail(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof FullDatabaseArchiveError)
      return ` ${current.message}`;
    if (!(current instanceof Error)) break;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return "";
}
const fail = (code: FullDatabaseArchiveError["code"] = "format"): never => {
  throw new FullDatabaseArchiveError(code);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
};
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

/** A bounded data-only copy before calling normalizers. Never execute getters. */
function plain(value: unknown): unknown {
  let nodes = 0,
    bytes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 1_000_000 || depth > 64) return fail();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : fail();
    if (typeof item === "string") {
      bytes += new TextEncoder().encode(item).length;
      if (bytes > MAX_FULL_DATABASE_ARCHIVE_BYTES) return fail();
      return item;
    }
    if (Array.isArray(item)) {
      if (
        item.length > 1_000_000 ||
        Reflect.ownKeys(item).length !== item.length + 1
      )
        return fail();
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, index);
        if (!descriptor || !("value" in descriptor)) return fail();
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    const record = object(item);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(record)))
      return fail();
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(record)) {
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        return fail();
      const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
      if (!("value" in descriptor)) return fail();
      if (descriptor.value !== undefined)
        result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  };
  return copy(value, 0);
}

/** Detection is deliberately not validation; malformed claimed archives must not fall through. */
export function isFullDatabaseArchive(
  value: unknown,
): value is FullDatabaseArchive {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { format?: unknown }).format === FULL_DATABASE_ARCHIVE_FORMAT
  );
}

function normalizeTrust(value: unknown): TrustExportDocument {
  const raw = object(value);
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.records) ||
    raw.records.length > 100_000 ||
    Object.keys(raw).some(
      (key) => !["version", "records", "policy", "policyConfig"].includes(key),
    )
  )
    return fail();
  const keys = new Set<string>();
  for (const value of raw.records) {
    const row = object(value);
    if (
      typeof row.host !== "string" ||
      !row.host ||
      row.host.length > 2048 ||
      typeof row.record_type !== "string" ||
      !row.record_type ||
      typeof row.user_approved !== "boolean"
    )
      return fail();
    const identity = object(row.identity);
    if (
      !["ssh", "tls"].includes(String(identity.kind)) ||
      typeof identity.fingerprint !== "string" ||
      !identity.fingerprint
    )
      return fail();
    if (row.timestamps != null && !isValidTrustRecordTimestamps(row.timestamps))
      return fail();
    const key = JSON.stringify([row.record_type, row.host]);
    if (keys.has(key)) return fail();
    keys.add(key);
    if (row.timestamps == null)
      row.timestamps = inferLegacyTrustRecordTimestamps(
        row as unknown as TrustExportRecord,
      );
  }
  return raw as unknown as TrustExportDocument;
}

// These IDs name app/OS stores, not StorageData. Keeping them would silently
// bind the archive to whatever happens to have that ID on another computer.
const EXTERNAL_REFERENCES = new Set([
  // The restore format cannot rebind app-local SSH source database ownership.
  "sshConnectionId",
  "sshConnectionDatabaseId",
  "ownerDatabaseId",
  "proxyChainId",
  "connectionChainId",
  "tunnelChainId",
  "configId",
  "credentialRef",
  "vaultRef",
  "savedCredentialId",
  "privateKeyCredentialRef",
  "clientCertificateRef",
  "tunnelProfileId",
  "credentialRefId",
  "credentialRefIds",
  "fallbackChainIds",
  "proxyProfileId",
  "vpnProfileId",
  "privateKeyPath",
  "agentSocket",
]);
const present = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== "" &&
  !(Array.isArray(value) && !value.length) &&
  !(typeof value === "object" && value !== null && !Object.keys(value).length);

function validateClosure(archive: FullDatabaseArchive): void {
  const collector = new ArchiveDependencyCollector(archive.collection.id);
  const rows = [
    ...archive.connections.map((row, index) => ({
      row,
      path: `connections[${index}]`,
    })),
    ...archive.recycleBin.entries.map((entry, index) => ({
      row: entry.connection,
      path: `recycleBin.entries[${index}].connection`,
    })),
  ];
  const all = [
    ...archive.connections,
    ...archive.recycleBin.entries.map((entry) => entry.connection),
  ];
  const connections = new Map(all.map((row) => [row.id, row]));
  const credentials = new Map(
    archive.credentialVault.entries.map((row) => [row.id, row]),
  );
  const library = archive.automationLibrary;
  const terminalScripts = new Set(
    [
      ...library.terminalScripts.customScripts,
      ...library.terminalScripts.modifiedDefaults,
    ].map((row) => row.id),
  );
  const terminalMacros = new Set(library.terminalMacros.map((row) => row.id));
  const websiteScripts = new Set(library.website.scripts.map((row) => row.id));
  const websiteMacros = new Set(library.website.macros.map((row) => row.id));
  const groups = new Set(archive.tabGroups.map((row) => row.id));
  const visitRoute = (
    value: unknown,
    recordId: string,
    path: string,
    relativePath = "",
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visitRoute(
          item,
          recordId,
          `${path}[${index}]`,
          `${relativePath}[${index}]`,
        ),
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    // These exact schema fields are scalar request/metadata dictionaries, not
    // reference containers. A header called connectionId is just a header.
    if (
      (relativePath === "httpHeaders" &&
        Object.values(value).every((item) => typeof item === "string")) ||
      (relativePath === "integration.providerFields" &&
        Object.values(value).every(
          (item) =>
            item === null ||
            ["string", "number", "boolean"].includes(typeof item),
        ))
    )
      return;
    for (const [index, [key, item]] of Object.entries(value).entries()) {
      // This format carries no profile catalog; even malformed declarations
      // must not be treated as absent and later become an unconfigured route.
      if (
        (key === "proxyProfileId" || key === "tunnelProfileId") &&
        item !== undefined
      )
        collector.add(recordId, `${path}.${key}`, "external-route");
      // Connection/inline-route privateKey is a file path, while vault facet
      // privateKey is material (and is outside this route traversal). Keep an
      // ignored local value only when an explicit vault reference remains.
      if (
        key === "privateKey" &&
        present(item) &&
        (value as { credentialSource?: { kind?: string } }).credentialSource
          ?.kind !== "vault"
      )
        collector.add(recordId, `${path}.${key}`, "file-credential");
      if (
        EXTERNAL_REFERENCES.has(key) &&
        present(item) &&
        key !== "proxyProfileId" &&
        key !== "tunnelProfileId"
      )
        collector.add(
          recordId,
          `${path}.${key}`,
          /credential|vault|certificate|privateKey|agentSocket/i.test(key)
            ? "external-credential"
            : "external-route",
        );
      if (
        key === "connectionId" &&
        present(item) &&
        (typeof item !== "string" || !connections.has(item))
      )
        collector.add(recordId, `${path}.${key}`, "connection", item);
      if (
        key === "defaultTabGroupId" &&
        present(item) &&
        (typeof item !== "string" || !groups.has(item))
      )
        collector.add(recordId, `${path}.${key}`, "tab-group", item);
      visitRoute(
        item,
        recordId,
        archiveDependencyPath(path, key, index),
        relativePath ? `${relativePath}.${key}` : key,
      );
    }
  };
  for (const { row, path } of rows) {
    if (row.parentId && !connections.get(row.parentId)?.isGroup)
      collector.add(row.id, `${path}.parentId`, "folder", row.parentId);
    const source = normalizeConnectionCredentialSource(row.credentialSource);
    if (source?.kind === "vault") {
      const credential = credentials.get(source.credentialId);
      if (!credential)
        collector.add(
          row.id,
          `${path}.credentialSource.credentialId`,
          "credential",
          source.credentialId,
        );
      else if (
        source.totpId &&
        !credential.facets.totp?.some((item) => item.id === source.totpId)
      )
        collector.add(
          row.id,
          `${path}.credentialSource.totpId`,
          "totp",
          source.totpId,
        );
    }
    for (const [field, config, scriptIds, macroIds] of [
      [
        "sshQuickActions",
        normalizeSshQuickActions(row.sshQuickActions),
        terminalScripts,
        terminalMacros,
      ],
      [
        "httpAutomation",
        normalizeHttpAutomation(row.httpAutomation),
        websiteScripts,
        websiteMacros,
      ],
    ] as const) {
      for (const [index, ref] of config.items.entries()) {
        if (
          ref.scope?.kind !== "database" ||
          ref.scope.databaseId !== archive.collection.id
        )
          collector.add(
            row.id,
            `${path}.${field}.items[${index}]`,
            "external-script",
            ref.id,
          );
        else if (!(ref.kind === "script" ? scriptIds : macroIds).has(ref.id))
          collector.add(
            row.id,
            `${path}.${field}.items[${index}]`,
            "script",
            ref.id,
          );
      }
    }
    // These legacy lifecycle actions resolve against SettingsManager's app
    // custom-script store, never the database automation library.
    if (Object.values(row.scripts ?? {}).some((items) => items?.length))
      collector.add(row.id, `${path}.scripts`, "legacy-script");
    row.behaviorAutomation?.rules?.forEach((rule, ruleIndex) =>
      rule.actions.forEach((action, actionIndex) => {
        if (action.type === "runCustomScript")
          collector.add(
            row.id,
            `${path}.behaviorAutomation.rules[${ruleIndex}].actions[${actionIndex}]`,
            "legacy-script",
          );
      }),
    );
    visitRoute(row, row.id, path);
  }
  // Folder cycles otherwise survive a nominally complete archive as an unusable tree.
  const done = new Set<string>();
  for (const { row, path } of rows) {
    const ancestors = new Set<string>();
    let current: Connection | undefined = row;
    while (current && !done.has(current.id)) {
      if (ancestors.has(current.id)) {
        collector.add(row.id, `${path}.parentId`, "cycle", current.id);
        break;
      }
      ancestors.add(current.id);
      current = current.parentId
        ? connections.get(current.parentId)
        : undefined;
    }
    ancestors.forEach((id) => done.add(id));
  }
  const documents = archive.documents;
  const refs = {
    connection: new Set(connections.keys()),
    document: new Set(documents.documents.map((row) => row.id)),
    person: new Set(documents.people.map((row) => row.id)),
    ticket: new Set(documents.tickets.map((row) => row.id)),
  };
  const checkRef = (ref: DocumentReference, recordId: string, path: string) => {
    if (ref.scope === "app" || ref.databaseId !== archive.collection.id) {
      collector.add(recordId, path, "external-document", ref.id);
      return;
    }
    if (!refs[ref.kind === "cell" ? "document" : ref.kind].has(ref.id)) {
      collector.add(recordId, path, "document", ref.id);
      return;
    }
    if (ref.kind === "cell") {
      const block = documents.documents
        .find((row) => row.id === ref.id)
        ?.blocks.find((block) => block.id === ref.blockId);
      if (
        block?.type !== "spreadsheet" ||
        !block.workbook.sheets.some((sheet) => sheet.id === ref.sheetId)
      )
        collector.add(recordId, path, "cell", ref.id);
    }
  };
  const visitDocument = (
    value: unknown,
    recordId: string,
    path: string,
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visitDocument(item, recordId, `${path}[${index}]`),
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if ("databaseId" in row && "kind" in row && "id" in row)
      checkRef(row as unknown as DocumentReference, recordId, path);
    Object.entries(row).forEach(([key, item], index) =>
      visitDocument(item, recordId, archiveDependencyPath(path, key, index)),
    );
  };
  for (const [index, doc] of documents.documents.entries()) {
    if (doc.parentFolderId && !connections.get(doc.parentFolderId)?.isGroup)
      collector.add(
        doc.id,
        `documents.documents[${index}].parentFolderId`,
        "folder",
        doc.parentFolderId,
      );
  }
  for (const category of ["documents", "people", "tickets"] as const)
    documents[category].forEach((row, index) =>
      visitDocument(row, row.id, `documents.${category}[${index}]`),
    );
  if (collector.diagnostics.totalIssues)
    throw new FullDatabaseArchiveError(
      collector.diagnostics.issues[0].reason === "file-credential"
        ? "file-credential"
        : "dependencies",
      collector.diagnostics,
    );
}

/** Normalize and verify the entire closure; credentials never pass generic redaction. */
export async function normalizeFullDatabaseArchive(
  value: unknown,
): Promise<FullDatabaseArchive> {
  try {
    const raw = object(plain(value));
    const collection = object(raw.collection);
    if (
      !isFullDatabaseArchive(raw) ||
      raw.version !== 1 ||
      Object.keys(raw).some(
        (key) =>
          ![
            "format",
            "version",
            "collection",
            "connections",
            "settings",
            "timestamp",
            "databaseSettings",
            "tabGroups",
            "colorTags",
            "recycleBin",
            "automationLibrary",
            "documents",
            "credentialVault",
            "trustRecords",
            "recordMetadata",
          ].includes(key),
      ) ||
      !identifier(collection.id) ||
      typeof collection.name !== "string" ||
      !collection.name.trim() ||
      collection.name.length > 256 ||
      typeof collection.isEncrypted !== "boolean" ||
      typeof collection.exportDate !== "string" ||
      !Number.isFinite(Date.parse(collection.exportDate)) ||
      (collection.description !== undefined &&
        typeof collection.description !== "string") ||
      Object.keys(collection).some(
        (key) =>
          !["id", "name", "description", "isEncrypted", "exportDate"].includes(
            key,
          ),
      ) ||
      !Array.isArray(raw.connections) ||
      raw.connections.length > 100_000 ||
      !Number.isSafeInteger(raw.timestamp) ||
      Number(raw.timestamp) < 0 ||
      !Array.isArray(raw.tabGroups)
    )
      return fail();
    // Full archives explicitly carry every section, even when it is empty.
    for (const key of [
      "settings",
      "databaseSettings",
      "colorTags",
      "recycleBin",
      "automationLibrary",
      "documents",
      "credentialVault",
      "trustRecords",
    ])
      object(raw[key]);
    const connection = (value: unknown): Connection => {
      const row = object(value);
      if (
        !identifier(row.id) ||
        typeof row.name !== "string" ||
        typeof row.protocol !== "string" ||
        !row.protocol ||
        typeof row.isGroup !== "boolean"
      )
        return fail();
      const credentialSource = normalizeConnectionCredentialSource(
        row.credentialSource,
      );
      // Literal credentials in a full backup are not generic-export sentinels.
      // Do not expose them to the generic importer's placeholder normalization.
      const { password, basicAuthPassword, ...portable } = row;
      if (
        (password !== undefined && typeof password !== "string") ||
        (basicAuthPassword !== undefined &&
          typeof basicAuthPassword !== "string")
      )
        return fail();
      const prepared = prepareConnectionForExport(
        {
          ...portable,
          ...(credentialSource ? { credentialSource } : {}),
        } as unknown as Connection,
        true,
      );
      if (password !== undefined) prepared.password = password;
      if (basicAuthPassword !== undefined)
        prepared.basicAuthPassword = basicAuthPassword;
      if (prepared.rdpSettings?.gateway) {
        // This is a session bearer, not a saved gateway password. The receiver
        // must obtain its own token; preserve the portable gateway credentials.
        delete prepared.rdpSettings.gateway.accessToken;
      }
      return prepared;
    };
    const connections = raw.connections.map(connection);
    if (new Set(connections.map((row) => row.id)).size !== connections.length)
      return fail();
    const recycleBin = normalizeRecycleBin(raw.recycleBin);
    recycleBin.entries = recycleBin.entries.map((entry) => ({
      ...entry,
      connection: connection(entry.connection),
    }));
    const vault = object(raw.credentialVault);
    if (!Array.isArray(vault.entries)) return fail();
    // Drop only device bearer trust, including on import. Descriptive passkey
    // and social bindings remain portable:false and contain no authenticator.
    const credentialVault = normalizeDatabaseCredentialVault({
      ...vault,
      entries: vault.entries.map((value) => {
        const row = object(value),
          facets = { ...object(row.facets) };
        delete facets.deviceTrust;
        return { ...row, facets };
      }),
    });
    const result: FullDatabaseArchive = {
      format: FULL_DATABASE_ARCHIVE_FORMAT,
      version: 1,
      collection: collection as unknown as FullDatabaseArchive["collection"],
      connections,
      settings: object(raw.settings),
      timestamp: Number(raw.timestamp),
      databaseSettings: normalizeDatabaseSettings(raw.databaseSettings),
      tabGroups: raw.tabGroups as FullDatabaseArchive["tabGroups"],
      colorTags: object(raw.colorTags) as FullDatabaseArchive["colorTags"],
      recycleBin,
      automationLibrary: normalizeDatabaseAutomationLibrary(
        raw.automationLibrary,
      ),
      documents: normalizeDatabaseDocuments(raw.documents),
      credentialVault,
      trustRecords: normalizeTrust(raw.trustRecords),
      ...(raw.recordMetadata === undefined
        ? {}
        : { recordMetadata: normalizeRecordLedger(raw.recordMetadata) }),
    };
    validateClosure(result);
    // Archive normalizers materialize default sections and strip device-only
    // credentials. Reconcile against that portable body, not the source blob.
    result.recordMetadata = await reconcileRecordLedger(
      fullDatabaseArchiveData(result),
      result.recordMetadata,
      { mode: "migrate" },
    );
    if (
      new TextEncoder().encode(JSON.stringify(result)).length >
      MAX_FULL_DATABASE_ARCHIVE_BYTES
    )
      return fail();
    await verifyDocumentAttachments(result.documents);
    return result;
  } catch (error) {
    if (error instanceof FullDatabaseArchiveError) throw error;
    return fail();
  }
}

export async function buildFullDatabaseArchive(
  collection: ConnectionDatabase,
  data: StorageData,
  trustRecords: TrustExportDocument,
): Promise<FullDatabaseArchive> {
  return normalizeFullDatabaseArchive({
    ...data,
    format: FULL_DATABASE_ARCHIVE_FORMAT,
    version: 1,
    collection: {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      isEncrypted: collection.isEncrypted,
      exportDate: new Date().toISOString(),
    },
    settings: data.settings ?? {},
    tabGroups: data.tabGroups ?? [],
    colorTags: data.colorTags ?? {},
    databaseSettings: normalizeDatabaseSettings(data.databaseSettings),
    recycleBin: normalizeRecycleBin(data.recycleBin),
    automationLibrary: normalizeDatabaseAutomationLibrary(
      data.automationLibrary,
    ),
    documents: normalizeDatabaseDocuments(data.documents),
    credentialVault:
      data.credentialVault ?? normalizeDatabaseCredentialVault(undefined),
    trustRecords,
  });
}

export async function encryptFullDatabaseArchive(
  archive: FullDatabaseArchive,
  password: string,
  options?: PasswordEncryptionOptions,
): Promise<string> {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    return fail("password");
  await validateNewPassword(password, "export");
  const normalized = await normalizeFullDatabaseArchive(archive);
  return encryptWithPassword(JSON.stringify(normalized), password, options);
}

/** No metadata or imported source protection slots enter the destination payload. */
export function fullDatabaseArchiveData(
  archive: FullDatabaseArchive,
): StorageData {
  const {
    format: _format,
    version: _version,
    collection: _collection,
    trustRecords: _trust,
    ...data
  } = archive;
  return data;
}
