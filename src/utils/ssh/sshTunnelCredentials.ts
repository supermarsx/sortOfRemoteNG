import { SecureStorage } from "../storage/storage";

const SERVICE = "sortofremoteng.ssh-tunnels";
export interface TunnelEndpoint {
  host: string;
  port: number;
  username: string;
}

/** The endpoint is sealed with the password, so edited plain metadata cannot redirect it. */
export async function readTunnelPassword(
  id: string,
  reference: string | undefined,
  endpoint: TunnelEndpoint,
): Promise<string> {
  try {
    if (!reference?.startsWith(`${id}:`)) throw new Error();
    const secret = JSON.parse(
      await SecureStorage.vaultReadSecret(SERVICE, reference),
    );
    if (
      secret.host !== endpoint.host ||
      secret.port !== endpoint.port ||
      secret.username !== endpoint.username ||
      typeof secret.password !== "string" ||
      !secret.password
    )
      throw new Error();
    return secret.password;
  } catch {
    throw new Error(
      "The tunnel password is unavailable or its SSH destination changed. Unlock the OS credential vault, then edit the tunnel and enter its password again.",
    );
  }
}

export async function writeTunnelPassword(
  id: string,
  endpoint: TunnelEndpoint,
  password: string,
): Promise<string> {
  const reference = `${id}:${crypto.randomUUID()}`;
  try {
    await SecureStorage.vaultStoreSecret(
      SERVICE,
      reference,
      JSON.stringify({ ...endpoint, password }),
    );
    return reference;
  } catch {
    throw new Error(
      "Could not save the tunnel password in the OS credential vault. Use the desktop app and unlock its credential vault, then retry. No plaintext password was saved.",
    );
  }
}

export async function deleteTunnelPassword(
  id: string,
  reference?: string,
): Promise<void> {
  if (!reference) return;
  try {
    if (!reference.startsWith(`${id}:`)) throw new Error();
    await SecureStorage.vaultDeleteSecret(SERVICE, reference);
  } catch {
    throw new Error(
      "Could not remove the old SSH tunnel password from the OS credential vault. Unlock the vault and remove the unused sortofremoteng.ssh-tunnels entry.",
    );
  }
}
