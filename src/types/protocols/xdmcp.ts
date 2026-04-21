// Types mirroring sorng_xdmcp::xdmcp::types (subset exposed to the UI).

export interface XdmcpConfig {
  host: string;
  port: number;
  displayNumber: number;
  indirect?: boolean;
  authName?: string | null;
}

export interface XdmcpSessionInfo {
  id: string;
  host: string;
  displayNumber: number;
  connected: boolean;
}

export interface XdmcpSessionStats {
  id: string;
  packetsSent: number;
  packetsReceived: number;
}

export interface XdmcpDiscoveredHost {
  host: string;
  port: number;
  willingStatus: string;
}
