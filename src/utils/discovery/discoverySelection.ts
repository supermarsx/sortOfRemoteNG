import type {
  DiscoveredHost,
  DiscoveredService,
} from "../../types/connection/connection";

/** Endpoint identity keeps IPv6 and distinct protocols sharing a port unambiguous. */
export function discoveryServiceKey(
  hostIp: string,
  service: Pick<DiscoveredService, "port" | "protocol">,
): string {
  return JSON.stringify([hostIp, service.port, service.protocol]);
}

export interface DiscoveryEndpoint {
  key: string;
  host: DiscoveredHost;
  service: DiscoveredService;
}

/** Resolve only observed service endpoints, never synthesize a service from a
 * host selection or bare open-port number. Repeated observations dispatch once.
 */
export function discoveryEndpoints(
  hosts: readonly DiscoveredHost[],
  selected?: ReadonlySet<string>,
): DiscoveryEndpoint[] {
  const endpoints = new Map<string, DiscoveryEndpoint>();
  for (const host of hosts) {
    for (const service of host.services) {
      if (
        !Number.isInteger(service.port) ||
        service.port < 1 ||
        service.port > 65535 ||
        typeof service.protocol !== "string"
      )
        continue;
      const key = discoveryServiceKey(host.ip, service);
      if ((!selected || selected.has(key)) && !endpoints.has(key))
        endpoints.set(key, { key, host, service });
    }
  }
  return [...endpoints.values()];
}
