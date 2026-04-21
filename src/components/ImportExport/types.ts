import { Connection } from '../../types/connection/connection';
import {
  OpenVPNConnection,
  WireGuardConnection,
  TailscaleConnection,
  ZeroTierConnection,
} from '../../utils/network/proxyOpenVPNManager';
import { SavedTunnelChain } from '../../types/settings/settings';

export interface ImportVpnData {
  openvpn: OpenVPNConnection[];
  wireguard: WireGuardConnection[];
  tailscale: TailscaleConnection[];
  zerotier: ZeroTierConnection[];
}

export interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  connections: Connection[];
  vpnConnections?: ImportVpnData;
  tunnelChainTemplates?: SavedTunnelChain[];
}
