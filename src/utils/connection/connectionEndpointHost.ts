import {
  isIntegrationConnectionProtocol,
  type Connection,
} from "../../types/connection/connection";

/** Integration panel endpoints belong only to integration protocols. Retained
 * settings from a previous protocol must never redirect SSH/RDP credentials. */
export function connectionEndpointHost(
  connection: Pick<Connection, "protocol" | "hostname" | "integration">,
): string {
  return isIntegrationConnectionProtocol(connection.protocol)
    ? connection.integration?.host || connection.hostname
    : connection.hostname;
}
