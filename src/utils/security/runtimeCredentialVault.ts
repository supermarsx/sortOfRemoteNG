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
}
export type RuntimeVaultCredentialIntent = "login" | "totp" | "bindings";

/** Explicit per-attempt disclosure. The whole private database never leaves this boundary. */
export async function resolveRuntimeVaultCredential({
  api,
  connection,
  session,
  target,
  assertCurrent,
  validateOnly = false,
  intent = "login",
}: {
  api: DatabaseCredentialVaultApi;
  connection: Connection;
  session: ConnectionSession;
  target: DatabaseDataTarget;
  assertCurrent: () => void;
  validateOnly?: boolean;
  intent?: RuntimeVaultCredentialIntent;
}): Promise<RuntimeVaultCredentialResult> {
  const source = normalizeConnectionCredentialSource(
    connection.credentialSource,
  );
  if (source?.kind !== "vault")
    throw new Error("A database vault reference is required.");
  const unsupported = getVaultRuntimeUnsupportedMessage(connection);
  if (unsupported && intent === "login") throw new Error(unsupported);
  if (!["login", "totp", "bindings"].includes(intent))
    throw new Error("Unsupported vault disclosure purpose.");
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
  const matches = saved?.connections.filter(
    (item) => item.id === connection.id,
  );
  const persisted = matches?.length === 1 ? matches[0] : undefined;
  if (!persisted || runtimeCredentialTargetKey(persisted) !== key)
    throw new Error(
      "Save and review this connection's vault reference and target in its owning database before connecting.",
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
  return { facets, assertCurrent: check };
}
