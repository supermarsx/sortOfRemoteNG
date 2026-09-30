import type { Connection } from "../../types/connection/connection";

/** Keep this check free of runtime imports: direct web login needs no catalog I/O. */
export function hasConfiguredNetworkPath(connection: Connection): boolean {
  return Boolean(
    connection.proxyProfileId !== undefined ||
    connection.tunnelProfileId !== undefined ||
    connection.proxyChainId ||
    connection.tunnelChainId ||
    connection.connectionChainId ||
    connection.security?.proxy?.enabled ||
    connection.security?.openvpn?.enabled ||
    connection.security?.sshTunnel?.enabled ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled),
  );
}
