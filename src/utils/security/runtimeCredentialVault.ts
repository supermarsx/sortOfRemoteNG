import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  DatabaseCredentialFacet,
  DatabaseCredentialFacets,
  DatabaseCredentialMetadata,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
  VaultDeviceTrustFacet,
} from "../../types/security/databaseCredentialVault";
import type { DatabaseDataTarget } from "../connection/databaseManager";
import {
  MAX_VAULT_DEVICE_TRUST_ROWS,
  normalizeConnectionCredentialSource,
  normalizeDatabaseCredentialEntry,
} from "./databaseCredentialVault";
import {
  isSynologyFileConnection,
  normalizeSynologySettings,
} from "../../types/protocols/synology";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { parseCanonicalWebAuthority } from "../connection/sanitizeHostname";
import { normalizeHttpRedirectOrigin } from "../protocol/httpTrustedRedirectDestinations";

export function getVaultRuntimeUnsupportedMessage(
  connection: Partial<Connection>,
): string | null {
  let source;
  try {
    source = normalizeConnectionCredentialSource(connection.credentialSource);
  } catch {
    return "The credential source is invalid. Choose local credentials or a valid entry in the owning database vault.";
  }
  if (source?.kind !== "vault") return null;
  if (connection.protocol === "http" || connection.protocol === "https") {
    const mode = connection.httpApplication?.loginMode;
    if (
      (mode !== undefined &&
        !["manual", "basic", "digest", "form"].includes(mode)) ||
      Object.keys(connection.httpHeaders ?? {}).length > 0 ||
      (connection.httpFormAutomation?.fields?.length ?? 0) > 0
    )
      return "Vault website login cannot be combined with connection-local custom headers, cookies or literal form fields. Remove those values or choose local credentials; no local fallback was used.";
  }
  if (
    connection.protocol === "ssh" &&
    ["password", "key", "totp"].includes(connection.authType ?? "password")
  )
    return null;
  if (connection.protocol === "rdp") return null;
  if (isSynologyFileConnection(connection)) return null;
  if (
    (connection.protocol === "http" || connection.protocol === "https") &&
    !isSynologyFileConnection(connection) &&
    ["password", "basic", "digest"].includes(connection.authType ?? "basic")
  )
    return null;
  return "Database vault authentication is unavailable for this protocol or login mode. Supported adapters are SSH password/key/TOTP, RDP username/password/domain, HTTP(S) website login, and Synology NAS API. Social sign-in and passkeys remain interactive; no connection-local fallback was used.";
}

/** Attempt-local revocation identity; never log, persist or put it in a session. */
export function runtimeCredentialTargetKey(
  connection: Partial<Connection>,
): string {
  return stableJsonStringify([
    connection.id,
    connection.protocol,
    connection.hostname,
    connection.port,
    connection.credentialSource,
    connection.authType,
    connection.httpApplication,
    connection.synologySettings,
    connection.httpAutoLogin,
    connection.httpAutoLoginSelectors,
    connection.httpHeaders,
    connection.httpFormAutomation,
    connection.httpAutoMfa,
    connection.httpProxyPolicy,
    connection.httpVerifySsl,
    connection.httpsTrustPolicy,
  ]);
}

/** Ignored local secrets must not enter automation contexts or redirect drafts. */
export function withoutConnectionLocalCredentials(
  connection: Connection,
): Connection {
  if (
    normalizeConnectionCredentialSource(connection.credentialSource)?.kind !==
    "vault"
  )
    return connection;
  return {
    ...connection,
    username: undefined,
    password: undefined,
    domain: undefined,
    privateKey: undefined,
    passphrase: undefined,
    totpSecret: undefined,
    totpConfigs: undefined,
    basicAuthUsername: undefined,
    basicAuthPassword: undefined,
    // Reference-only consent is safe; the local seeds remain excluded above.
    httpAutoMfa: connection.httpAutoMfa,
    httpHeaders: undefined,
    httpFormAutomation: undefined,
  };
}

export interface RuntimeVaultCredentialResult {
  facets: DatabaseCredentialFacets;
  assertCurrent: () => void;
  /** Present only for the `deviceTrust` intent. */
  deviceTrust?: RuntimeDeviceTrustController;
}
export type RuntimeVaultCredentialIntent =
  "login" | "totp" | "bindings" | "deviceTrust";

/** One attempt's owner boundary: the values `useRuntimeCredentialVault` captures. */
export interface RuntimeVaultAttempt {
  api: DatabaseCredentialVaultApi;
  connection: Connection;
  session: ConnectionSession;
  target: DatabaseDataTarget;
  assertCurrent: () => void;
}

/** Owner, saved-target and entry checks shared by every runtime disclosure. */
async function openRuntimeVaultEntry(
  { api, connection, session, target, assertCurrent }: RuntimeVaultAttempt,
  credentialId: string,
): Promise<{
  snapshot: DatabaseCredentialSnapshot;
  row: DatabaseCredentialMetadata;
  check: () => void;
}> {
  const scope = api.scope ? { ...api.scope } : null;
  const key = runtimeCredentialTargetKey(connection);
  const check = () => {
    assertCurrent();
    if (
      !scope ||
      session.ownerDatabaseId !== scope.databaseId ||
      target.databaseId !== scope.databaseId ||
      !target.assertAccessible ||
      !target.readCurrent
    )
      throw new Error(
        "Open and unlock this session's owning protected database to use its vault credential.",
      );
    if (
      session.connectionId !== connection.id ||
      session.hostname !== connection.hostname ||
      session.protocol !== connection.protocol
    )
      throw new Error(
        "The session does not match the saved vault connection target. No credential was released.",
      );
    target.assertAccessible();
  };
  check();
  const snapshot = await api.list(scope!);
  check();
  const row = snapshot.entries.find((item) => item.id === credentialId);
  if (!row)
    throw new Error(
      "The selected vault credential is unavailable in this database. No local credential fallback was used.",
    );
  const saved = await target.readCurrent!();
  check();
  const matches = saved?.connections.filter(
    (item) => item.id === connection.id,
  );
  const persisted = matches?.length === 1 ? matches[0] : undefined;
  if (!persisted || runtimeCredentialTargetKey(persisted) !== key)
    throw new Error(
      "Save and review this connection's vault reference and target in its owning database before connecting.",
    );
  return { snapshot, row, check };
}

/** Explicit per-attempt disclosure. The whole private database never leaves this boundary. */
export async function resolveRuntimeVaultCredential(
  input: RuntimeVaultAttempt & {
    validateOnly?: boolean;
    intent?: RuntimeVaultCredentialIntent;
  },
): Promise<RuntimeVaultCredentialResult> {
  const { api, connection, validateOnly = false, intent = "login" } = input;
  const source = normalizeConnectionCredentialSource(
    connection.credentialSource,
  );
  if (source?.kind !== "vault")
    throw new Error("A database vault reference is required.");
  const unsupported = getVaultRuntimeUnsupportedMessage(connection);
  if (unsupported && (intent === "login" || intent === "deviceTrust"))
    throw new Error(unsupported);
  if (!["login", "totp", "bindings", "deviceTrust"].includes(intent))
    throw new Error("Unsupported vault disclosure purpose.");
  if (intent === "deviceTrust") synologyDeviceTrustTarget(connection);
  const { snapshot, row, check } = await openRuntimeVaultEntry(
    input,
    source.credentialId,
  );
  const manual =
    (connection.protocol === "http" || connection.protocol === "https") &&
    connection.httpApplication?.loginMode === "manual";
  const requested: DatabaseCredentialFacet[] =
    intent === "totp"
      ? ["totp"]
      : intent === "bindings"
        ? (["social", "passkey"] as const).filter((facet) =>
            row.availableFacets.includes(facet),
          )
        : intent === "deviceTrust"
          ? []
          : manual && !isSynologyFileConnection(connection)
            ? []
            : connection.protocol === "ssh" && connection.authType === "key"
              ? ["username", "privateKey"]
              : ["username", "password"];
  if (intent === "login" && connection.protocol === "ssh") {
    if (connection.authType === "key") {
      for (const facet of ["passphrase", "password"] as const)
        if (row.availableFacets.includes(facet)) requested.push(facet);
    }
    if (connection.authType === "totp" && !source.totpId)
      throw new Error(
        "Choose a specific vault authenticator in the connection's credential settings before SSH TOTP login.",
      );
    if (source.totpId) requested.push("totp");
  }
  if (
    intent === "login" &&
    connection.protocol === "rdp" &&
    row.availableFacets.includes("domain")
  )
    requested.push("domain");
  if (requested.some((facet) => !row.availableFacets.includes(facet)))
    throw new Error(
      "The selected vault entry does not contain the credential facets required by this operation. No connection-local fallback was used.",
    );
  const facets =
    requested.length && !validateOnly
      ? await api.resolve(snapshot, source.credentialId, requested)
      : {};
  check();
  if (
    !validateOnly &&
    requested.some(
      (facet) =>
        ["username", "password", "domain", "privateKey", "passphrase"].includes(
          facet,
        ) && typeof facets[facet] !== "string",
    )
  )
    throw new Error("The vault returned an invalid credential facet.");
  if (
    !validateOnly &&
    requested.includes("totp") &&
    (!Array.isArray(facets.totp) || !facets.totp.length)
  )
    throw new Error(
      "The selected vault credential has no authenticator entries.",
    );
  if (
    !validateOnly &&
    intent === "login" &&
    connection.protocol === "ssh" &&
    source.totpId &&
    facets.totp?.filter((entry) => entry.id === source.totpId).length !== 1
  )
    throw new Error(
      "The selected SSH vault authenticator is unavailable. Choose it again; no first-entry fallback was used.",
    );
  if (intent === "deviceTrust") {
    const attempt: RuntimeVaultAttempt = {
      api,
      connection,
      session: input.session,
      target: input.target,
      assertCurrent: input.assertCurrent,
    };
    return {
      facets,
      assertCurrent: check,
      deviceTrust: {
        resolve: (account) => resolveDeviceTrust({ ...attempt, account }),
        store: (account, device) =>
          storeDeviceTrust({ ...attempt, account, device }),
        forget: (account) => forgetDeviceTrust({ ...attempt, account }),
      },
    };
  }
  return { facets, assertCurrent: check };
}

/** One native login attempt's values. Never log, render, persist or keep in React state. */
export interface RuntimeTrustedDevice {
  deviceName: string;
  deviceId: string;
}
export type RuntimeDeviceTrustWrite =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "not-saved"; message: string };

/**
 * Bound to the vault revision seen when it was created. A successful write
 * advances that revision, so request a fresh controller before writing again.
 */
export interface RuntimeDeviceTrustController {
  resolve(account: string): Promise<RuntimeTrustedDevice | null>;
  store(
    account: string,
    device: RuntimeTrustedDevice,
  ): Promise<RuntimeDeviceTrustWrite>;
  forget(account: string): Promise<RuntimeDeviceTrustWrite>;
}

export const DEVICE_TRUST_VAULT_REQUIRED_MESSAGE =
  "Store this connection's credentials in the vault to trust this device.";
export const DEVICE_TRUST_NOT_REMEMBERED_MESSAGE =
  "The vault changed; this device was not remembered.";
export const DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE =
  "The vault changed; the trusted device was not forgotten. Remove it from the vault entry instead.";
export const DEVICE_TRUST_LIMIT_MESSAGE = `This vault entry already remembers ${MAX_VAULT_DEVICE_TRUST_ROWS} trusted NAS devices. Forget one in the vault to trust this device.`;

const printable = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

/** Canonical NAS origin a trusted device is bound to, derived from the saved connection only. */
export function synologyDeviceTrustTarget(
  connection: Partial<Connection>,
): string {
  const failure = () =>
    new Error(
      "Trusted devices need a saved Synology NAS API connection with a valid address.",
    );
  if (!isSynologyFileConnection(connection)) throw failure();
  try {
    const scheme =
      connection.protocol === "synology"
        ? normalizeSynologySettings(connection.synologySettings).useHttps
          ? "https"
          : "http"
        : connection.protocol;
    const authority = parseCanonicalWebAuthority(connection.hostname ?? "");
    if (authority.sourceScheme && authority.sourceScheme !== scheme)
      throw failure();
    if (authority.port && connection.port && authority.port !== connection.port)
      throw failure();
    const port =
      connection.port || authority.port || (scheme === "https" ? 443 : 80);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw failure();
    const url = new URL(`${scheme}://${authority.hostname}/`);
    url.port = String(port);
    return normalizeHttpRedirectOrigin(url.origin);
  } catch {
    throw failure();
  }
}

const matchesDeviceTrust = (
  row: VaultDeviceTrustFacet,
  target: string,
  account: string,
) =>
  row.surface === "synology-api" &&
  row.target === target &&
  row.account === account;

/** Argument checks fail before any vault read; the open itself is deferred. */
function prepareDeviceTrust(input: RuntimeVaultAttempt & { account: string }) {
  const source = normalizeConnectionCredentialSource(
    input.connection.credentialSource,
  );
  if (source?.kind !== "vault")
    throw new Error(DEVICE_TRUST_VAULT_REQUIRED_MESSAGE);
  const unsupported = getVaultRuntimeUnsupportedMessage(input.connection);
  if (unsupported) throw new Error(unsupported);
  const target = synologyDeviceTrustTarget(input.connection);
  if (!printable(input.account, 256))
    throw new Error(
      "The NAS account name cannot be used for a trusted device.",
    );
  return {
    target,
    account: input.account,
    credentialId: source.credentialId,
    open: () => openRuntimeVaultEntry(input, source.credentialId),
  };
}

/** Rewrites only this entry's trusted-device rows through one reviewed CAS put. */
async function writeDeviceTrust(
  api: DatabaseCredentialVaultApi,
  credentialId: string,
  opened: Awaited<ReturnType<typeof openRuntimeVaultEntry>>,
  update: (
    rows: readonly VaultDeviceTrustFacet[],
  ) => VaultDeviceTrustFacet[] | "unchanged" | "full",
): Promise<RuntimeDeviceTrustWrite> {
  const { snapshot, row, check } = opened;
  // A put replaces the whole entry, so every facet is disclosed transiently here.
  const facets = await api.resolve(snapshot, credentialId, row.availableFacets);
  check();
  const next = update(facets.deviceTrust ?? []);
  if (next === "unchanged") return { status: "unchanged" };
  if (next === "full")
    return { status: "not-saved", message: DEVICE_TRUST_LIMIT_MESSAGE };
  const updated: DatabaseCredentialFacets = { ...facets };
  if (next.length) updated.deviceTrust = next;
  else delete updated.deviceTrust;
  const now = new Date().toISOString();
  const entry = normalizeDatabaseCredentialEntry({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: now < row.createdAt ? row.createdAt : now,
    facets: updated,
  });
  check();
  await api.compareAndSwap(snapshot, [{ operation: "put", entry }]);
  return { status: "saved" };
}

/**
 * The saved trusted device for this connection's NAS address and DSM account,
 * read only from the connection's own entry in its owning database.
 */
export async function resolveDeviceTrust(
  input: RuntimeVaultAttempt & { account: string },
): Promise<RuntimeTrustedDevice | null> {
  const { target, account, credentialId, open } = prepareDeviceTrust(input);
  const { snapshot, row, check } = await open();
  if (!row.availableFacets.includes("deviceTrust")) return null;
  const facets = await input.api.resolve(snapshot, credentialId, [
    "deviceTrust",
  ]);
  check();
  if (!Array.isArray(facets.deviceTrust))
    throw new Error("The vault returned an invalid credential facet.");
  const match = facets.deviceTrust.find((item) =>
    matchesDeviceTrust(item, target, account),
  );
  if (
    !match ||
    !printable(match.deviceName, 64) ||
    !printable(match.deviceId, 1024)
  )
    return null;
  return { deviceName: match.deviceName, deviceId: match.deviceId };
}

/**
 * Remember DSM's returned device token for this NAS address and account,
 * replacing an older token for the same pair. Vault failures are non-fatal.
 */
export async function storeDeviceTrust(
  input: RuntimeVaultAttempt & {
    account: string;
    device: RuntimeTrustedDevice;
  },
): Promise<RuntimeDeviceTrustWrite> {
  const device = input.device;
  if (
    !device ||
    !printable(device.deviceName, 64) ||
    !printable(device.deviceId, 1024)
  )
    throw new Error("DSM returned a trusted device that cannot be stored.");
  const { target, account, credentialId, open } = prepareDeviceTrust(input);
  try {
    return await writeDeviceTrust(
      input.api,
      credentialId,
      await open(),
      (rows) => {
        const kept = rows.filter(
          (item) => !matchesDeviceTrust(item, target, account),
        );
        if (kept.length >= MAX_VAULT_DEVICE_TRUST_ROWS) return "full";
        return [
          ...kept,
          {
            id: crypto.randomUUID(),
            surface: "synology-api",
            target,
            account,
            deviceName: device.deviceName,
            deviceId: device.deviceId,
            createdAt: new Date().toISOString(),
            portable: false,
          },
        ];
      },
    );
  } catch {
    return {
      status: "not-saved",
      message: DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
    };
  }
}

/** Remove the trusted device for this NAS address and account. Vault failures are non-fatal. */
export async function forgetDeviceTrust(
  input: RuntimeVaultAttempt & { account: string },
): Promise<RuntimeDeviceTrustWrite> {
  const { target, account, credentialId, open } = prepareDeviceTrust(input);
  try {
    const opened = await open();
    if (!opened.row.availableFacets.includes("deviceTrust"))
      return { status: "unchanged" };
    return await writeDeviceTrust(input.api, credentialId, opened, (rows) => {
      const kept = rows.filter(
        (item) => !matchesDeviceTrust(item, target, account),
      );
      return kept.length === rows.length ? "unchanged" : kept;
    });
  } catch {
    return {
      status: "not-saved",
      message: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
    };
  }
}
