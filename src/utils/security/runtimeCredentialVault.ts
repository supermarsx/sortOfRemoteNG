import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  DatabaseCredentialFacet,
  DatabaseCredentialFacets,
  DatabaseCredentialVaultApi,
} from "../../types/security/databaseCredentialVault";
import type { DatabaseDataTarget } from "../connection/databaseManager";
import { normalizeConnectionCredentialSource } from "./databaseCredentialVault";
import { isSynologyFileConnection } from "../../types/protocols/synology";
import { stableJsonStringify } from "../core/stableJsonStringify";

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
    (connection.authType ?? "password") === "password"
  )
    return null;
  if (connection.protocol === "rdp") return null;
  if (
    (connection.protocol === "http" || connection.protocol === "https") &&
    !isSynologyFileConnection(connection) &&
    ["password", "basic", "digest"].includes(connection.authType ?? "basic")
  )
    return null;
  return "Database vault authentication is not supported for this protocol or login mode yet. Supported modes are SSH password, RDP username/password/domain, and HTTP(S) website username/password. Vault private-key material, TOTP, social sign-in and passkeys require a compatible adapter or interactive authenticator; no connection-local fallback was used.";
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
    httpAutoMfa: undefined,
    httpHeaders: undefined,
    httpFormAutomation: undefined,
  };
}

export interface RuntimeVaultCredentialResult {
  facets: DatabaseCredentialFacets;
  assertCurrent: () => void;
}

/** Explicit per-attempt disclosure. The whole private database never leaves this boundary. */
export async function resolveRuntimeVaultCredential({
  api,
  connection,
  session,
  target,
  assertCurrent,
  validateOnly = false,
}: {
  api: DatabaseCredentialVaultApi;
  connection: Connection;
  session: ConnectionSession;
  target: DatabaseDataTarget;
  assertCurrent: () => void;
  validateOnly?: boolean;
}): Promise<RuntimeVaultCredentialResult> {
  const source = normalizeConnectionCredentialSource(
    connection.credentialSource,
  );
  if (source?.kind !== "vault")
    throw new Error("A database vault reference is required.");
  const unsupported = getVaultRuntimeUnsupportedMessage(connection);
  if (unsupported) throw new Error(unsupported);
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
  const row = snapshot.entries.find((item) => item.id === source.credentialId);
  if (!row)
    throw new Error(
      "The selected vault credential is unavailable in this database. No local credential fallback was used.",
    );
  const saved = await target.readCurrent!();
  check();
  const persisted = saved?.connections.find(
    (item) => item.id === connection.id,
  );
  if (!persisted || runtimeCredentialTargetKey(persisted) !== key)
    throw new Error(
      "Save and review this connection's vault reference and target in its owning database before connecting.",
    );
  const manual =
    (connection.protocol === "http" || connection.protocol === "https") &&
    connection.httpApplication?.loginMode === "manual";
  const requested: DatabaseCredentialFacet[] = manual
    ? []
    : ["username", "password"];
  if (connection.protocol === "rdp" && row.availableFacets.includes("domain"))
    requested.push("domain");
  if (requested.some((facet) => !row.availableFacets.includes(facet)))
    throw new Error(
      "This login requires a vault username and password. Other credential types are not substituted or selected automatically.",
    );
  const facets =
    requested.length && !validateOnly
      ? await api.resolve(snapshot, source.credentialId, requested)
      : {};
  check();
  if (
    !validateOnly &&
    requested.length &&
    (typeof facets.username !== "string" || typeof facets.password !== "string")
  )
    throw new Error("This login requires vault username and password facets.");
  return { facets, assertCurrent: check };
}
