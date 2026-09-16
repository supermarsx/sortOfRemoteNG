import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialVault } from "../../types/security/databaseCredentialVault";
import type { DatabaseVaultArchive } from "../../types/security/vaultArchive";
import {
  normalizeConnectionCredentialSource,
  normalizeDatabaseCredentialVault,
} from "./databaseCredentialVault";
import { normalizeAdvancedProtocolConnection } from "../connection/normalizeAdvancedProtocolConnection";
import { normalizeImportedProtocol } from "../connection/normalizeImportedProtocol";
import {
  decryptWithPassword,
  encryptWithPassword,
} from "../crypto/webCryptoAes";
import { validateNewPassword } from "./passwordPolicy";

export const MAX_VAULT_ARCHIVE_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const MAX_VAULT_ARCHIVE_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_VAULT_ARCHIVE_CONNECTIONS = 1000;
export class VaultArchiveError extends Error {
  constructor(
    public readonly code: "format" | "dependencies" | "password" | "unlock",
  ) {
    super(
      {
        format:
          "This vault archive is malformed or exceeds the size limits. Select a valid encrypted vault archive; no records were imported.",
        dependencies:
          "A selected connection needs an external route, script library or missing linked connection. Export credentials alone, or include all supported linked connections and recreate external dependencies separately.",
        password:
          "Use and confirm an archive password of 12–1024 characters that meets the app password policy.",
        unlock:
          "Could not unlock this vault archive. Check the password and file. Nothing was imported.",
      }[code],
    );
    this.name = "VaultArchiveError";
  }
}
const invalid = (): never => {
  throw new VaultArchiveError("format");
};
const bytes = (value: string) => new TextEncoder().encode(value).length;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCAL_CREDENTIAL_FIELDS = [
  "username",
  "password",
  "domain",
  "privateKey",
  "passphrase",
  "totpSecret",
  "totpConfigs",
  "basicAuthUsername",
  "basicAuthPassword",
  "rustdeskPassword",
  "httpHeaders",
  "httpFormAutomation",
] as const;
const SIDECAR_KEYS = new Set([
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
  "defaultTabGroupId",
  "fallbackChainIds",
  "proxyProfileId",
  "vpnProfileId",
]);

/** Bounded JSON tree, no accessors/prototypes/executable values or parser gadgets. */
function plain(value: unknown): unknown {
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 32) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number")
      return Number.isFinite(item) ? item : invalid();
    if (typeof item === "string")
      return item.length <= MAX_VAULT_ARCHIVE_PLAINTEXT_BYTES
        ? item
        : invalid();
    if (Array.isArray(item))
      return item.map((entry) => visit(entry, depth + 1));
    if (
      !item ||
      typeof item !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(item))
    )
      return invalid();
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(item)) {
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!("value" in descriptor)) return invalid();
      // JS optional properties may be undefined; JSON archives cannot carry them.
      if (descriptor.value !== undefined)
        result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  };
  return visit(value, 0);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1024): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    value.length <= max &&
    !Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  );
}

/** Trusted-device tokens bypass OTP and stay bound to the enrolling computer's database. */
function withoutDeviceTrust(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const facets = (row as Record<string, unknown>).facets;
  if (
    !facets ||
    typeof facets !== "object" ||
    Array.isArray(facets) ||
    !Object.prototype.hasOwnProperty.call(facets, "deviceTrust")
  )
    return row;
  const kept = { ...(facets as Record<string, unknown>) };
  delete kept.deviceTrust;
  return { ...row, facets: kept };
}

/**
 * A NAS API authenticator reference names a connection-local `totpConfigs`
 * entry, which archives never carry; automatic codes need a fresh choice.
 */
function withoutLocalAuthenticatorReference<T>(row: T): T {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const settings = (row as Record<string, unknown>).synologySettings;
  if (
    !settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    !Object.prototype.hasOwnProperty.call(settings, "otpAuthenticatorId")
  )
    return row;
  const kept = { ...(settings as Record<string, unknown>) };
  delete kept.otpAuthenticatorId;
  return { ...row, synologySettings: kept };
}

/** IDs in supported inline routes must resolve inside the selected bundle. */
function mapReferences(
  value: unknown,
  ids: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => mapReferences(item, ids));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      SIDECAR_KEYS.has(key) &&
      item !== undefined &&
      item !== null &&
      item !== "" &&
      !(Array.isArray(item) && item.length === 0) &&
      !(
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item).length === 0
      )
    )
      throw new VaultArchiveError("dependencies");
    if (
      key === "connectionId" &&
      item !== undefined &&
      item !== null &&
      item !== ""
    ) {
      if (typeof item !== "string" || !ids.has(item))
        throw new VaultArchiveError("dependencies");
      result[key] = ids.get(item);
    } else result[key] = mapReferences(item, ids);
  }
  return result;
}

export function normalizeDatabaseVaultArchive(
  value: unknown,
): DatabaseVaultArchive {
  const raw = object(plain(value));
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "format",
          "version",
          "createdAt",
          "credentials",
          "connections",
        ].includes(key),
    ) ||
    raw.format !== "sorng-vault-archive" ||
    raw.version !== 1 ||
    !text(raw.createdAt, 32) ||
    !Number.isFinite(Date.parse(raw.createdAt)) ||
    new Date(raw.createdAt).toISOString() !== raw.createdAt
  )
    return invalid();
  if (
    !Array.isArray(raw.credentials) ||
    !Array.isArray(raw.connections) ||
    raw.connections.length > MAX_VAULT_ARCHIVE_CONNECTIONS
  )
    return invalid();
  // Dropped before validation: exports never write them and imports never keep them.
  const credentials = normalizeDatabaseCredentialVault({
    version: 1,
    revision: 0,
    entries: raw.credentials.map(withoutDeviceTrust),
  }).entries;
  const credentialIds = new Set(credentials.map((entry) => entry.id));
  const connections = raw.connections.map((value) => {
    const row = object(withoutLocalAuthenticatorReference(value));
    if (
      !text(row.id, 128) ||
      !ID.test(row.id) ||
      !text(row.name, 256) ||
      !text(row.protocol, 128) ||
      !text(row.hostname, 2048) ||
      row.isGroup !== false ||
      !Number.isInteger(row.port) ||
      Number(row.port) < 1 ||
      Number(row.port) > 65535 ||
      !text(row.createdAt, 32) ||
      !text(row.updatedAt, 32)
    )
      return invalid();
    const protocol = normalizeImportedProtocol({ raw: row.protocol });
    if (protocol.protocol !== row.protocol) return invalid();
    const source = normalizeConnectionCredentialSource(row.credentialSource);
    if (source?.kind !== "vault" || !credentialIds.has(source.credentialId))
      return invalid();
    if (LOCAL_CREDENTIAL_FIELDS.some((key) => row[key] !== undefined))
      return invalid();
    const normalized = normalizeAdvancedProtocolConnection({
      ...row,
      credentialSource: source,
    } as unknown as Connection);
    if (
      normalized.httpAutomation?.items.length ||
      normalized.sshQuickActions?.items.length ||
      (normalized.scripts &&
        Object.values(normalized.scripts).some((items) => items?.length)) ||
      normalized.behaviorAutomation?.rules?.some((rule) =>
        rule.actions.some((action) => action.type === "runCustomScript"),
      )
    )
      throw new VaultArchiveError("dependencies");
    return normalized;
  });
  if (new Set(connections.map((row) => row.id)).size !== connections.length)
    return invalid();
  const refs = new Map(connections.map((row) => [row.id, row.id]));
  connections.forEach((row) => mapReferences(row, refs));
  const result: DatabaseVaultArchive = {
    format: "sorng-vault-archive",
    version: 1,
    createdAt: raw.createdAt,
    credentials,
    connections,
  };
  if (bytes(JSON.stringify(result)) > MAX_VAULT_ARCHIVE_PLAINTEXT_BYTES)
    return invalid();
  return result;
}

/** Source vault selection remains authoritative; ignored local secrets never copy. */
export function prepareVaultArchiveConnection(
  connection: Connection,
): Connection {
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(connection),
  )) {
    if (!("value" in descriptor)) return invalid();
  }
  const dates: Record<string, string> = {};
  for (const key of ["createdAt", "updatedAt", "lastConnected"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(connection, key);
    if (descriptor && !("value" in descriptor)) return invalid();
    if (descriptor?.value instanceof Date) {
      if (!Number.isFinite(descriptor.value.getTime())) return invalid();
      dates[key] = descriptor.value.toISOString();
    }
  }
  const result = withoutLocalAuthenticatorReference(
    plain({ ...connection, ...dates }) as Connection,
  );
  for (const key of LOCAL_CREDENTIAL_FIELDS) delete result[key];
  return result;
}

/** Append only. Fresh IDs for credentials, facets and connections; no overwrite. */
export function prepareVaultArchiveImport(
  currentConnections: readonly Connection[],
  currentVault: DatabaseCredentialVault,
  archive: DatabaseVaultArchive,
) {
  const source = normalizeDatabaseVaultArchive(archive);
  const current = normalizeDatabaseCredentialVault(currentVault);
  const occupied = new Set([
    ...currentConnections.map((row) => row.id),
    ...current.entries.map((row) => row.id),
  ]);
  const fresh = () => {
    let next: string;
    do {
      next = crypto.randomUUID();
    } while (occupied.has(next));
    occupied.add(next);
    return next;
  };
  const vaultIds = new Map(source.credentials.map((row) => [row.id, fresh()]));
  const connectionIds = new Map(
    source.connections.map((row) => [row.id, fresh()]),
  );
  const now = new Date().toISOString();
  const totpIds = new Map(
    source.credentials.flatMap((row) =>
      (row.facets.totp ?? []).map(
        (item) => [`${row.id}:${item.id}`, fresh()] as const,
      ),
    ),
  );
  const credentials = source.credentials.map((row) => ({
    ...row,
    id: vaultIds.get(row.id)!,
    createdAt: now,
    updatedAt: now,
    facets: {
      ...row.facets,
      ...(row.facets.totp
        ? {
            totp: row.facets.totp.map((item) => ({
              ...item,
              id: totpIds.get(`${row.id}:${item.id}`)!,
            })),
          }
        : {}),
      ...(row.facets.social
        ? {
            social: row.facets.social.map((item) => ({
              ...item,
              id: fresh(),
              portable: false as const,
            })),
          }
        : {}),
      ...(row.facets.passkey
        ? {
            passkey: row.facets.passkey.map((item) => ({
              ...item,
              id: fresh(),
              portable: false as const,
            })),
          }
        : {}),
    },
  }));
  const importedConnections = source.connections.map((row) => {
    const result = mapReferences(row, connectionIds) as Connection;
    result.id = connectionIds.get(row.id)!;
    result.createdAt = now;
    result.updatedAt = now;
    const originalSource = row.credentialSource as {
      credentialId: string;
      totpId?: string;
    };
    const remappedTotp = originalSource.totpId
      ? totpIds.get(`${originalSource.credentialId}:${originalSource.totpId}`)
      : undefined;
    if (originalSource.totpId && !remappedTotp) return invalid();
    result.credentialSource = {
      kind: "vault",
      credentialId: vaultIds.get(originalSource.credentialId)!,
      ...(remappedTotp ? { totpId: remappedTotp } : {}),
    };
    // The archive is not an authorization grant or a copy of separate libraries.
    delete result.parentId;
    if (
      result.scripts &&
      Object.values(result.scripts).some((items) => items?.length)
    )
      return invalid();
    if (result.behaviorAutomation)
      result.behaviorAutomation = {
        ...result.behaviorAutomation,
        rules: result.behaviorAutomation.rules.map((rule) => ({
          ...rule,
          enabled: false,
        })),
      };
    if (result.httpTrustedRedirectDestinations)
      result.httpTrustedRedirectDestinations = { version: 1, origins: [] };
    if (result.httpRedirectAuthentication)
      result.httpRedirectAuthentication = {
        ...result.httpRedirectAuthentication,
        mode: "none",
        allowInsecureHttp: false,
      };
    if (result.httpAutoMfa)
      result.httpAutoMfa = { ...result.httpAutoMfa, enabled: false };
    if (result.httpAutoMfa?.totpConfigId) {
      const next = totpIds.get(
        `${originalSource.credentialId}:${result.httpAutoMfa.totpConfigId}`,
      );
      if (!next) return invalid();
      result.httpAutoMfa.totpConfigId = next;
    }
    if (result.httpAutomation)
      result.httpAutomation = {
        ...result.httpAutomation,
        interactionMacrosEnabled: false,
        scriptInjectionEnabled: false,
        forceDark: false,
        items: [],
      };
    if (result.sshQuickActions)
      result.sshQuickActions = { ...result.sshQuickActions, items: [] };
    result.httpAutoLogin = false;
    result.ignoreSshSecurityErrors = false;
    if (result.httpApplication)
      result.httpApplication = {
        ...result.httpApplication,
        loginMode: "manual",
      };
    if (result.httpFormAutomation)
      result.httpFormAutomation = {
        ...result.httpFormAutomation,
        submit: false,
      };
    result.httpsTrustPolicy = "always-ask";
    result.certificateTrustPolicy = "always-ask";
    result.sshTrustPolicy = "always-ask";
    result.rdpTrustPolicy = "always-ask";
    delete result.tlsTrustPolicy;
    result.httpVerifySsl = true;
    return result;
  });
  return {
    connections: [...currentConnections, ...importedConnections],
    credentialVault: normalizeDatabaseCredentialVault({
      version: 1,
      revision: current.revision + 1,
      entries: [...current.entries, ...credentials],
    }),
    credentialCount: credentials.length,
    connectionCount: importedConnections.length,
  };
}

export async function encryptVaultArchive(
  archive: DatabaseVaultArchive,
  password: string,
): Promise<string> {
  if ([...password].length < 12 || password.length > 1024)
    throw new VaultArchiveError("password");
  try {
    await validateNewPassword(password, "export");
  } catch {
    throw new VaultArchiveError("password");
  }
  const payload = await encryptWithPassword(
    JSON.stringify(normalizeDatabaseVaultArchive(archive)),
    password,
    { iterations: 600_000 },
  );
  const result = JSON.stringify({
    format: "sorng-vault-encrypted",
    version: 1,
    payload,
  });
  if (bytes(result) > MAX_VAULT_ARCHIVE_FILE_BYTES) return invalid();
  return result;
}

export async function decryptVaultArchive(
  file: string,
  password: string,
): Promise<DatabaseVaultArchive> {
  try {
    if (bytes(file) > MAX_VAULT_ARCHIVE_FILE_BYTES || password.length > 1024)
      return invalid();
    const outer = object(JSON.parse(file));
    if (
      outer.format !== "sorng-vault-encrypted" ||
      outer.version !== 1 ||
      typeof outer.payload !== "string" ||
      Object.keys(outer).some(
        (key) => !["format", "version", "payload"].includes(key),
      )
    )
      return invalid();
    // This archive format accepts only authenticated current envelopes, not legacy/plain JSON.
    const envelope = object(JSON.parse(outer.payload));
    const kdf = object(envelope.kdf);
    if (
      envelope.version !== 2 ||
      envelope.algorithm !== "AES-256-GCM" ||
      Object.keys(envelope).some(
        (key) =>
          !["version", "algorithm", "kdf", "iv", "ciphertext"].includes(key),
      ) ||
      Object.keys(kdf).some(
        (key) => !["name", "hash", "iterations", "salt"].includes(key),
      ) ||
      kdf.name !== "PBKDF2" ||
      kdf.hash !== "SHA-256" ||
      !Number.isInteger(kdf.iterations) ||
      Number(kdf.iterations) < 600_000 ||
      Number(kdf.iterations) > 2_000_000 ||
      typeof kdf.salt !== "string" ||
      !/^[A-Za-z0-9+/]{22}==$/.test(kdf.salt) ||
      typeof envelope.iv !== "string" ||
      !/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) ||
      typeof envelope.ciphertext !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext) ||
      envelope.ciphertext.length > MAX_VAULT_ARCHIVE_FILE_BYTES
    )
      return invalid();
    const decrypted = await decryptWithPassword(outer.payload, password);
    if (bytes(decrypted) > MAX_VAULT_ARCHIVE_PLAINTEXT_BYTES) return invalid();
    return normalizeDatabaseVaultArchive(JSON.parse(decrypted));
  } catch (error) {
    if (error instanceof VaultArchiveError) throw error;
    throw new VaultArchiveError("unlock");
  }
}
