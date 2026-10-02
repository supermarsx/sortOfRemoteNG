import type { Connection } from "../../types/connection/connection";

type SshReference = { connectionId?: string; ownerDatabaseId?: string };
const sshTypes = new Set([
  "ssh-tunnel",
  "ssh-jump",
  "ssh-proxycmd",
  "ssh-stdio",
]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Only schema-owned inline SSH references, never arbitrary ownerDatabaseId
 * fields or app-wide route profiles. Shared by archive admission and rebinding. */
export function mapArchiveSshReferences(
  connection: Connection,
  map: (reference: SshReference, path: string) => SshReference,
): Connection {
  const layers = connection.security?.tunnelChain;
  if (!Array.isArray(layers)) return connection;
  let changed = false;
  const tunnelChain = layers.map((layer, layerIndex) => {
    if (
      !isObject(layer) ||
      !sshTypes.has(layer.type) ||
      !isObject(layer.sshTunnel)
    )
      return layer;
    const original = layer.sshTunnel;
    const path = `security.tunnelChain[${layerIndex}].sshTunnel`;
    let sshTunnel = map(original, path) as typeof original;
    if (Array.isArray(original.jumpHosts)) {
      const jumpHosts = original.jumpHosts.map((host, hostIndex) =>
        isObject(host)
          ? (map(host, `${path}.jumpHosts[${hostIndex}]`) as typeof host)
          : host,
      );
      if (jumpHosts.some((host, index) => host !== original.jumpHosts![index]))
        sshTunnel = { ...sshTunnel, jumpHosts };
    }
    if (sshTunnel === original) return layer;
    changed = true;
    return { ...layer, sshTunnel };
  });
  return changed
    ? { ...connection, security: { ...connection.security, tunnelChain } }
    : connection;
}

export function isIncludedSshReference(
  reference: SshReference,
  databaseId: string,
  connections: ReadonlyMap<string, Connection>,
): boolean {
  const target =
    typeof reference.connectionId === "string"
      ? connections.get(reference.connectionId)
      : undefined;
  return (
    reference.ownerDatabaseId === databaseId &&
    target?.protocol === "ssh" &&
    !target.isGroup
  );
}
