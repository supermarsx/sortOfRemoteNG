import type {
  ConnectionCredentialSource,
  DatabaseCredentialChange,
  DatabaseCredentialEntry,
  DatabaseCredentialFacet,
  DatabaseCredentialFacets,
  DatabaseCredentialMetadata,
  DatabaseCredentialVault,
  VaultDeviceTrustFacet,
  VaultPasskeyBinding,
  VaultSocialBinding,
  VaultTotpFacet,
} from "../../types/security/databaseCredentialVault";
import { normalizeHttpRedirectOrigin } from "../protocol/httpTrustedRedirectDestinations";

export const MAX_DATABASE_CREDENTIALS = 1000;
export const MAX_DATABASE_CREDENTIAL_VAULT_BYTES = 8 * 1024 * 1024;
export const DATABASE_CREDENTIAL_FACETS = [
  "username",
  "password",
  "domain",
  "privateKey",
  "passphrase",
  "totp",
  "social",
  "passkey",
  "deviceTrust",
] as const satisfies readonly DatabaseCredentialFacet[];
export const MAX_VAULT_DEVICE_TRUST_ROWS = 16;

function invalid(): never {
  // Invalid input may itself be a secret: never interpolate it in diagnostics.
  throw new Error(
    "Invalid database credential vault data. Preserve the database and review its format.",
  );
}
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
function object(
  value: unknown,
  required: string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== Object.keys(descriptors).length ||
    Object.entries(descriptors).some(
      ([key, descriptor]) =>
        !(required.includes(key) || optional.includes(key)) ||
        !("value" in descriptor),
    ) ||
    required.some((key) => !hasOwn(descriptors, key))
  )
    return invalid();
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  max: number,
  empty = false,
  multiline = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code === 0 || (!multiline && (code < 32 || code === 127));
    })
  )
    return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    return invalid();
  return result.toLowerCase();
}
function date(value: unknown): string {
  const result = text(value, 32);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    return invalid();
  return result;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return invalid();
  return value;
}
function rows<T extends { id: string }>(
  value: unknown,
  max: number,
  parse: (row: unknown) => T,
  empty = false,
): T[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    (!empty && value.length === 0)
  )
    return invalid();
  const result = Array.from(value, parse);
  if (new Set(result.map((row) => row.id)).size !== result.length)
    return invalid();
  return result;
}
function totp(value: unknown): VaultTotpFacet {
  const row = object(value, [
    "id",
    "label",
    "secret",
    "digits",
    "period",
    "algorithm",
  ]);
  const secret = text(row.secret, 256);
  if (
    !/^[A-Z2-7]{16,256}$/.test(secret) ||
    (row.digits !== 6 && row.digits !== 8) ||
    !["sha1", "sha256", "sha512"].includes(row.algorithm as string)
  )
    return invalid();
  return {
    id: id(row.id),
    label: text(row.label, 128),
    secret,
    digits: row.digits,
    period: integer(row.period, 15, 120),
    algorithm: row.algorithm as VaultTotpFacet["algorithm"],
  };
}
function binding(
  value: unknown,
  kind: "social" | "passkey",
): VaultSocialBinding | VaultPasskeyBinding {
  const target = kind === "social" ? "origin" : "rpId";
  const row = object(
    value,
    ["id", "provider", target, "portable"],
    ["accountHint"],
  );
  if (row.portable !== false) return invalid();
  const raw = text(row[target], 2048);
  let parsed: URL;
  try {
    parsed = new URL(kind === "social" ? raw : `https://${raw}`);
  } catch {
    return invalid();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (kind === "social"
      ? parsed.origin !== raw
      : parsed.hostname !== raw || !!parsed.port || parsed.pathname !== "/")
  )
    return invalid();
  const shared = {
    id: id(row.id),
    provider: text(row.provider, 128),
    portable: false as const,
    ...(row.accountHint === undefined
      ? {}
      : { accountHint: text(row.accountHint, 256) }),
  };
  return kind === "social"
    ? { ...shared, origin: raw }
    : { ...shared, rpId: raw };
}
function deviceTrust(value: unknown): VaultDeviceTrustFacet {
  const row = object(value, [
    "id",
    "surface",
    "target",
    "account",
    "deviceName",
    "deviceId",
    "createdAt",
    "portable",
  ]);
  if (row.portable !== false || row.surface !== "synology-api")
    return invalid();
  const target = text(row.target, 2048);
  try {
    if (normalizeHttpRedirectOrigin(target) !== target) return invalid();
  } catch {
    return invalid();
  }
  return {
    id: id(row.id),
    surface: "synology-api",
    target,
    account: text(row.account, 256),
    deviceName: text(row.deviceName, 64),
    deviceId: text(row.deviceId, 1024),
    createdAt: date(row.createdAt),
    portable: false,
  };
}
export function normalizeDatabaseCredentialEntry(
  value: unknown,
): DatabaseCredentialEntry {
  const row = object(value, ["id", "name", "createdAt", "updatedAt", "facets"]);
  const raw = object(row.facets, [], DATABASE_CREDENTIAL_FACETS);
  const facets: DatabaseCredentialFacets = {};
  for (const key of [
    "username",
    "password",
    "domain",
    "privateKey",
    "passphrase",
  ] as const) {
    if (hasOwn(raw, key))
      facets[key] = text(
        raw[key],
        key === "privateKey"
          ? 65536
          : key === "domain"
            ? 253
            : key === "username"
              ? 512
              : 8192,
        key === "password" || key === "passphrase",
        key === "privateKey" || key === "password" || key === "passphrase",
      );
  }
  if (hasOwn(raw, "totp")) facets.totp = rows(raw.totp, 16, totp);
  if (hasOwn(raw, "social"))
    facets.social = rows(
      raw.social,
      16,
      (item) => binding(item, "social") as VaultSocialBinding,
    );
  if (hasOwn(raw, "passkey"))
    facets.passkey = rows(
      raw.passkey,
      16,
      (item) => binding(item, "passkey") as VaultPasskeyBinding,
    );
  if (hasOwn(raw, "deviceTrust")) {
    const trusted = rows(
      raw.deviceTrust,
      MAX_VAULT_DEVICE_TRUST_ROWS,
      deviceTrust,
    );
    // One token per NAS address and account; reuse must never guess between two.
    if (
      new Set(
        trusted.map((item) => JSON.stringify([item.target, item.account])),
      ).size !== trusted.length
    )
      return invalid();
    facets.deviceTrust = trusted;
  }
  // A device token alone is not a credential: it cannot sign in without the account.
  if (!Object.keys(facets).some((key) => key !== "deviceTrust"))
    return invalid();
  const createdAt = date(row.createdAt),
    updatedAt = date(row.updatedAt);
  if (updatedAt < createdAt) return invalid();
  return {
    id: id(row.id),
    name: text(row.name, 128),
    createdAt,
    updatedAt,
    facets,
  };
}
export const emptyDatabaseCredentialVault = (): DatabaseCredentialVault => ({
  version: 1,
  revision: 0,
  entries: [],
});
export function normalizeDatabaseCredentialVault(
  value: unknown,
): DatabaseCredentialVault {
  if (value === undefined) return emptyDatabaseCredentialVault();
  const row = object(value, ["version", "revision", "entries"]);
  if (row.version !== 1) return invalid();
  const result: DatabaseCredentialVault = {
    version: 1,
    revision: integer(row.revision, 0, Number.MAX_SAFE_INTEGER),
    entries: rows(
      row.entries,
      MAX_DATABASE_CREDENTIALS,
      normalizeDatabaseCredentialEntry,
      true,
    ),
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    MAX_DATABASE_CREDENTIAL_VAULT_BYTES
  )
    return invalid();
  return result;
}
export function databaseCredentialMetadata(
  entry: DatabaseCredentialEntry,
): DatabaseCredentialMetadata {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    availableFacets: DATABASE_CREDENTIAL_FACETS.filter((key) =>
      hasOwn(entry.facets, key),
    ),
  };
}
export function selectDatabaseCredentialFacets(
  entry: DatabaseCredentialEntry,
  requested: readonly DatabaseCredentialFacet[],
): DatabaseCredentialFacets {
  if (
    !Array.isArray(requested) ||
    !requested.length ||
    requested.length > DATABASE_CREDENTIAL_FACETS.length ||
    new Set(requested).size !== requested.length ||
    requested.some(
      (key) =>
        !DATABASE_CREDENTIAL_FACETS.includes(key) || !hasOwn(entry.facets, key),
    )
  )
    throw new Error(
      "The requested credential facets are unavailable. Review the selected vault entry.",
    );
  return structuredClone(
    Object.fromEntries(
      (requested as readonly DatabaseCredentialFacet[]).map((key) => [
        key,
        entry.facets[key],
      ]),
    ),
  ) as DatabaseCredentialFacets;
}
export function applyDatabaseCredentialChanges(
  current: DatabaseCredentialVault,
  changes: readonly DatabaseCredentialChange[],
): DatabaseCredentialVault {
  if (
    !Array.isArray(changes) ||
    !changes.length ||
    changes.length > MAX_DATABASE_CREDENTIALS
  )
    return invalid();
  const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
  const changed = new Set<string>();
  for (const change of changes) {
    if (!change || !["put", "delete"].includes(change.operation))
      return invalid();
    const row = object(
      change,
      change.operation === "put" ? ["operation", "entry"] : ["operation", "id"],
    );
    const entry =
      change.operation === "put"
        ? normalizeDatabaseCredentialEntry(row.entry)
        : null;
    const key = entry?.id ?? id(row.id);
    if (changed.has(key)) return invalid();
    changed.add(key);
    if (entry) entries.set(key, entry);
    else if (!entries.delete(key))
      throw new Error(
        "The selected vault entry no longer exists. Reload and review the vault.",
      );
  }
  return normalizeDatabaseCredentialVault({
    version: 1,
    revision: current.revision + 1,
    entries: [...entries.values()],
  });
}
export function normalizeConnectionCredentialSource(
  value: unknown,
): ConnectionCredentialSource | undefined {
  if (value === undefined) return undefined;
  const row = object(value, ["kind"], ["credentialId", "totpId"]);
  if (
    row.kind === "local" &&
    !hasOwn(row, "credentialId") &&
    !hasOwn(row, "totpId")
  )
    return { kind: "local" };
  if (row.kind === "vault")
    return {
      kind: "vault",
      credentialId: id(row.credentialId),
      ...(hasOwn(row, "totpId") ? { totpId: id(row.totpId) } : {}),
    };
  return invalid();
}
