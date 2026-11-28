import type { Connection } from "../../types/connection/connection";
import type {
  ConnectionCredentialAccount,
  ConnectionCredentialSource,
} from "../../types/security/databaseCredentialVault";
import { normalizeConnectionCredentialSource } from "./databaseCredentialVault";

export const MAX_CONNECTION_CREDENTIAL_ACCOUNTS = 32;

export function normalizeConnectionCredentialAccounts(
  value: unknown,
): ConnectionCredentialAccount[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_CONNECTION_CREDENTIAL_ACCOUNTS
  )
    throw new Error(
      "Associated accounts are invalid. Review this connection's saved accounts.",
    );
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) => key !== "credentialId" && key !== "totpId",
      )
    )
      throw new Error("Associated account reference is invalid.");
    const source = normalizeConnectionCredentialSource({
      kind: "vault",
      ...item,
    });
    if (source?.kind !== "vault" || ids.has(source.credentialId))
      throw new Error(
        "Associated accounts must have distinct credential references.",
      );
    ids.add(source.credentialId);
    return {
      credentialId: source.credentialId,
      ...(source.totpId ? { totpId: source.totpId } : {}),
    };
  });
}

export function connectionCredentialAccounts(
  connection: Pick<
    Partial<Connection>,
    "credentialSource" | "credentialAccounts"
  >,
): ConnectionCredentialAccount[] {
  const accounts =
    normalizeConnectionCredentialAccounts(connection.credentialAccounts) ?? [];
  const source = connection.credentialSource;
  if (
    source?.kind !== "vault" ||
    typeof source.credentialId !== "string" ||
    !source.credentialId
  )
    return accounts;
  return [
    {
      credentialId: source.credentialId,
      ...(source.totpId ? { totpId: source.totpId } : {}),
    },
    ...accounts.filter(
      (account) => account.credentialId !== source.credentialId,
    ),
  ];
}

/** Explicit selection changes only the default; previously associated accounts remain available. */
export function credentialAccountSelection(
  connection: Partial<Connection>,
  source: ConnectionCredentialSource | undefined,
): Partial<Connection> {
  const accounts =
    normalizeConnectionCredentialAccounts(connection.credentialAccounts) ?? [];
  let prior: ConnectionCredentialSource | undefined;
  try {
    prior = normalizeConnectionCredentialSource(connection.credentialSource);
  } catch {
    /* Explicit selection may repair an invalid old source. */
  }
  if (prior?.kind === "vault") {
    const previous = prior;
    if (
      !accounts.some(
        (account) => account.credentialId === previous.credentialId,
      )
    )
      accounts.unshift({
        credentialId: previous.credentialId,
        ...(previous.totpId ? { totpId: previous.totpId } : {}),
      });
  }
  if (source?.kind === "vault") {
    const index = accounts.findIndex(
      (account) => account.credentialId === source.credentialId,
    );
    const account = {
      credentialId: source.credentialId,
      ...(source.totpId ? { totpId: source.totpId } : {}),
    };
    if (index < 0) accounts.push(account);
    else accounts[index] = account;
  }
  if (accounts.length > MAX_CONNECTION_CREDENTIAL_ACCOUNTS)
    throw new Error("A connection can have up to 32 associated accounts.");
  return {
    credentialSource: source,
    ...(accounts.length ? { credentialAccounts: accounts } : {}),
    httpAutoMfa: connection.httpAutoMfa
      ? { version: 1, enabled: false }
      : undefined,
  };
}
