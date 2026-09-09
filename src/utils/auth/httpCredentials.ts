import type { Connection } from "../../types/connection/connection";

/** Match HTTP editor/Quick Connect defaults without changing the selected auth
 * mode or mixing a dedicated Basic username with an unrelated generic secret. */
export function resolveHttpBasicCredentials(
  connection: Partial<Connection> | null | undefined,
): { username: string; password: string } | null {
  if (
    !connection ||
    (connection.authType !== undefined &&
      connection.authType !== "basic" &&
      connection.authType !== "password")
  )
    return null;
  const pairs = [
    [connection.basicAuthUsername, connection.basicAuthPassword],
    [connection.username, connection.password],
  ];
  for (const [username, password] of pairs) {
    if (
      (username != null && typeof username !== "string") ||
      (password != null && typeof password !== "string")
    )
      return null;
    if ((username?.length ?? 0) > 0 || (password?.length ?? 0) > 0)
      return { username: username ?? "", password: password ?? "" };
  }
  return null;
}
