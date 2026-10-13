import type { Connection } from "../../types/connection/connection";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";

/**
 * The one rule for which saved pair a connection-local credential comes from.
 * Where the protocol has a dedicated pair (the HTTP Basic fields), it wins as a
 * whole pair as soon as either of its fields is set; otherwise the generic pair
 * is used. The two are never mixed, so a dedicated username is never combined
 * with an unrelated generic secret. Null when a field that had to be inspected
 * is not text.
 */
export function selectSavedCredentialPair(
  connection: Partial<Connection>,
  hasDedicatedPair: boolean,
): { username: string; password: string; dedicated: boolean } | null {
  const text = (value: unknown): value is string | null | undefined =>
    value == null || typeof value === "string";
  const { basicAuthUsername, basicAuthPassword, username, password } =
    connection;
  if (hasDedicatedPair) {
    if (!text(basicAuthUsername) || !text(basicAuthPassword)) return null;
    if (basicAuthUsername || basicAuthPassword)
      return {
        username: basicAuthUsername ?? "",
        password: basicAuthPassword ?? "",
        dedicated: true,
      };
  }
  if (!text(username) || !text(password)) return null;
  return {
    username: username ?? "",
    password: password ?? "",
    dedicated: false,
  };
}

/** Match HTTP editor/Quick Connect defaults without changing the selected auth
 * mode or mixing a dedicated Basic username with an unrelated generic secret. */
export function resolveHttpBasicCredentials(
  connection: Partial<Connection> | null | undefined,
): { username: string; password: string } | null {
  if (
    !connection ||
    normalizeConnectionCredentialSource(connection.credentialSource)?.kind ===
      "vault" ||
    (connection.authType !== undefined &&
      connection.authType !== "basic" &&
      connection.authType !== "password")
  )
    return null;
  const pair = selectSavedCredentialPair(connection, true);
  return pair && (pair.username.length > 0 || pair.password.length > 0)
    ? { username: pair.username, password: pair.password }
    : null;
}
