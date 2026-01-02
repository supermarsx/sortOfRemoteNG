import { invoke } from '@tauri-apps/api/core';
import {
  ProxyConfig,
  OpenVPNConfig,
  WireGuardConfig,
  IKEv2Config,
  SSTPConfig,
  L2TPConfig,
  PPTPConfig,
  SoftEtherConfig,
  ZeroTierConfig,
  TailscaleConfig
} from '../types/settings';

export enum ConnectionType {
  Proxy = 'Proxy',
  OpenVPN = 'OpenVPN',
  WireGuard = 'WireGuard',
  IKEv2 = 'IKEv2',
  SSTP = 'SSTP',
  L2TP = 'L2TP',
  PPTP = 'PPTP',
  SoftEther = 'SoftEther',
  ZeroTier = 'ZeroTier',
  Tailscale = 'Tailscale',
}

export interface ChainLayer {
  id: string;
  connection_type: ConnectionType;
  connection_id: string;
  position: number;
  status: ChainLayerStatus;
  local_port?: number;
  error?: string;
}

export enum ChainLayerStatus {
  Disconnected = 'Disconnected',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Disconnecting = 'Disconnecting',
  Error = 'Error',
}

export interface ConnectionChain {
  id: string;
  name: string;
  description?: string;
  layers: ChainLayer[];
  status: ChainStatus;
  created_at: string;
  connected_at?: string;
  final_local_port?: number;
  error?: string;
}

export enum ChainStatus {
  Disconnected = 'Disconnected',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Disconnecting = 'Disconnecting',
  Error = 'Error',
}

export interface ProxyConnection {
  id: string;
  targetHost: string;
  targetPort: number;
  proxyConfig: ProxyConfig;
  localPort?: number;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  chainPosition?: number;
  upstreamConnection?: string; // ID of the connection this proxy routes through
}

export interface OpenVPNConnection {
  id: string;
  name: string;
  config: OpenVPNConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface WireGuardConnection {
  id: string;
  name: string;
  config: WireGuardConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  interfaceName?: string;
  localIp?: string;
  peerIp?: string;
  chainPosition?: number;
}

export interface IKEv2Connection {
  id: string;
  name: string;
  config: IKEv2Config;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface SSTPConnection {
  id: string;
  name: string;
  config: SSTPConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface L2TPConnection {
  id: string;
  name: string;
  config: L2TPConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface PPTPConnection {
  id: string;
  name: string;
  config: PPTPConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface SoftEtherConnection {
  id: string;
  name: string;
  config: SoftEtherConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  chainPosition?: number;
}

export interface ZeroTierConnection {
  id: string;
  name: string;
  config: ZeroTierConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  nodeId?: string;
  networkId?: string;
  chainPosition?: number;
}

export interface TailscaleConnection {
  id: string;
  name: string;
  config: TailscaleConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  createdAt: Date;
  connectedAt?: Date;
  nodeIp?: string;
  tailnetIp?: string;
  chainPosition?: number;
}

export interface ChainHop {
  id: string;
  type: 'proxy' | 'openvpn' | 'wireguard' | 'ikev2' | 'sstp' | 'l2tp' | 'pptp' | 'softether' | 'zerotier' | 'tailscale';
  config: ProxyConfig | OpenVPNConfig | WireGuardConfig | IKEv2Config | SSTPConfig | L2TPConfig | PPTPConfig | SoftEtherConfig | ZeroTierConfig | TailscaleConfig;
  position: number;
  targetHost?: string;
  targetPort?: number;
  upstreamHop?: string; // ID of the hop this routes through
  localPort?: number;
  status: 'pending' | 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface ConnectionChain {
  id: string;
  name: string;
  hops: ChainHop[];
  targetHost: string;
  targetPort: number;
  finalLocalPort?: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'partial';
  createdAt: Date;
  connectedAt?: Date;
}

export class ProxyOpenVPNManager {
  private static instance: ProxyOpenVPNManager;

  static getInstance(): ProxyOpenVPNManager {
    if (!ProxyOpenVPNManager.instance) {
      ProxyOpenVPNManager.instance = new ProxyOpenVPNManager();
    }
    return ProxyOpenVPNManager.instance;
  }

  // Proxy Management Methods
  async createProxyConnection(
    targetHost: string,
    targetPort: number,
    proxyConfig: ProxyConfig
  ): Promise<string> {
    return await invoke('create_proxy_connection', {
      targetHost,
      targetPort,
      proxyConfig,
    });
  }

  async connectViaProxy(connectionId: string): Promise<number> {
    return await invoke('connect_via_proxy', { connectionId });
  }

  async disconnectProxy(connectionId: string): Promise<void> {
    return await invoke('disconnect_proxy', { connectionId });
  }

  async getProxyConnection(connectionId: string): Promise<ProxyConnection> {
    return await invoke('get_proxy_connection', { connectionId });
  }

  async listProxyConnections(): Promise<ProxyConnection[]> {
    return await invoke('list_proxy_connections');
  }

  async deleteProxyConnection(connectionId: string): Promise<void> {
    return await invoke('delete_proxy_connection', { connectionId });
  }

  // OpenVPN Management Methods
  async createOpenVPNConnection(name: string, config: OpenVPNConfig): Promise<string> {
    return await invoke('create_openvpn_connection', { name, config });
  }

  async connectOpenVPN(connectionId: string): Promise<void> {
    return await invoke('connect_openvpn', { connectionId });
  }

  async disconnectOpenVPN(connectionId: string): Promise<void> {
    return await invoke('disconnect_openvpn', { connectionId });
  }

  async getOpenVPNConnection(connectionId: string): Promise<OpenVPNConnection> {
    const result = await invoke('get_openvpn_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listOpenVPNConnections(): Promise<OpenVPNConnection[]> {
    const results = await invoke('list_openvpn_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteOpenVPNConnection(connectionId: string): Promise<void> {
    return await invoke('delete_openvpn_connection', { connectionId });
  }

  async getOpenVPNStatus(connectionId: string): Promise<string> {
    return await invoke('get_openvpn_status', { connectionId });
  }

  // WireGuard Management Methods
  async createWireGuardConnection(name: string, config: WireGuardConfig): Promise<string> {
    return await invoke('create_wireguard_connection', { name, config });
  }

  async connectWireGuard(connectionId: string): Promise<void> {
    return await invoke('connect_wireguard', { connectionId });
  }

  async disconnectWireGuard(connectionId: string): Promise<void> {
    return await invoke('disconnect_wireguard', { connectionId });
  }

  async getWireGuardConnection(connectionId: string): Promise<WireGuardConnection> {
    const result = await invoke('get_wireguard_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listWireGuardConnections(): Promise<WireGuardConnection[]> {
    const results = await invoke('list_wireguard_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteWireGuardConnection(connectionId: string): Promise<void> {
    return await invoke('delete_wireguard_connection', { connectionId });
  }

  async getWireGuardStatus(connectionId: string): Promise<string> {
    return await invoke('get_wireguard_status', { connectionId });
  }

  // IKEv2 Management Methods
  async createIKEv2Connection(name: string, config: IKEv2Config): Promise<string> {
    return await invoke('create_ikev2_connection', { name, config });
  }

  async connectIKEv2(connectionId: string): Promise<void> {
    return await invoke('connect_ikev2', { connectionId });
  }

  async disconnectIKEv2(connectionId: string): Promise<void> {
    return await invoke('disconnect_ikev2', { connectionId });
  }

  async getIKEv2Connection(connectionId: string): Promise<IKEv2Connection> {
    const result = await invoke('get_ikev2_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listIKEv2Connections(): Promise<IKEv2Connection[]> {
    const results = await invoke('list_ikev2_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteIKEv2Connection(connectionId: string): Promise<void> {
    return await invoke('delete_ikev2_connection', { connectionId });
  }

  async getIKEv2Status(connectionId: string): Promise<string> {
    return await invoke('get_ikev2_status', { connectionId });
  }

  // SSTP Management Methods
  async createSSTPConnection(name: string, config: SSTPConfig): Promise<string> {
    return await invoke('create_sstp_connection', { name, config });
  }

  async connectSSTP(connectionId: string): Promise<void> {
    return await invoke('connect_sstp', { connectionId });
  }

  async disconnectSSTP(connectionId: string): Promise<void> {
    return await invoke('disconnect_sstp', { connectionId });
  }

  async getSSTPConnection(connectionId: string): Promise<SSTPConnection> {
    const result = await invoke('get_sstp_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listSSTPConnections(): Promise<SSTPConnection[]> {
    const results = await invoke('list_sstp_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteSSTPConnection(connectionId: string): Promise<void> {
    return await invoke('delete_sstp_connection', { connectionId });
  }

  async getSSTPStatus(connectionId: string): Promise<string> {
    return await invoke('get_sstp_status', { connectionId });
  }

  // L2TP Management Methods
  async createL2TPConnection(name: string, config: L2TPConfig): Promise<string> {
    return await invoke('create_l2tp_connection', { name, config });
  }

  async connectL2TP(connectionId: string): Promise<void> {
    return await invoke('connect_l2tp', { connectionId });
  }

  async disconnectL2TP(connectionId: string): Promise<void> {
    return await invoke('disconnect_l2tp', { connectionId });
  }

  async getL2TPConnection(connectionId: string): Promise<L2TPConnection> {
    const result = await invoke('get_l2tp_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listL2TPConnections(): Promise<L2TPConnection[]> {
    const results = await invoke('list_l2tp_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteL2TPConnection(connectionId: string): Promise<void> {
    return await invoke('delete_l2tp_connection', { connectionId });
  }

  async getL2TPStatus(connectionId: string): Promise<string> {
    return await invoke('get_l2tp_status', { connectionId });
  }

  // PPTP Management Methods
  async createPPTPConnection(name: string, config: PPTPConfig): Promise<string> {
    return await invoke('create_pptp_connection', { name, config });
  }

  async connectPPTP(connectionId: string): Promise<void> {
    return await invoke('connect_pptp', { connectionId });
  }

  async disconnectPPTP(connectionId: string): Promise<void> {
    return await invoke('disconnect_pptp', { connectionId });
  }

  async getPPTPConnection(connectionId: string): Promise<PPTPConnection> {
    const result = await invoke('get_pptp_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listPPTPConnections(): Promise<PPTPConnection[]> {
    const results = await invoke('list_pptp_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deletePPTPConnection(connectionId: string): Promise<void> {
    return await invoke('delete_pptp_connection', { connectionId });
  }

  async getPPTPStatus(connectionId: string): Promise<string> {
    return await invoke('get_pptp_status', { connectionId });
  }

  // SoftEther Management Methods
  async createSoftEtherConnection(name: string, config: SoftEtherConfig): Promise<string> {
    return await invoke('create_softether_connection', { name, config });
  }

  async connectSoftEther(connectionId: string): Promise<void> {
    return await invoke('connect_softether', { connectionId });
  }

  async disconnectSoftEther(connectionId: string): Promise<void> {
    return await invoke('disconnect_softether', { connectionId });
  }

  async getSoftEtherConnection(connectionId: string): Promise<SoftEtherConnection> {
    const result = await invoke('get_softether_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listSoftEtherConnections(): Promise<SoftEtherConnection[]> {
    const results = await invoke('list_softether_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteSoftEtherConnection(connectionId: string): Promise<void> {
    return await invoke('delete_softether_connection', { connectionId });
  }

  async getSoftEtherStatus(connectionId: string): Promise<string> {
    return await invoke('get_softether_status', { connectionId });
  }

  // ZeroTier Management Methods
  async createZeroTierConnection(name: string, config: ZeroTierConfig): Promise<string> {
    return await invoke('create_zerotier_connection', { name, config });
  }

  async connectZeroTier(connectionId: string): Promise<void> {
    return await invoke('connect_zerotier', { connectionId });
  }

  async disconnectZeroTier(connectionId: string): Promise<void> {
    return await invoke('disconnect_zerotier', { connectionId });
  }

  async getZeroTierConnection(connectionId: string): Promise<ZeroTierConnection> {
    const result = await invoke('get_zerotier_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listZeroTierConnections(): Promise<ZeroTierConnection[]> {
    const results = await invoke('list_zerotier_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteZeroTierConnection(connectionId: string): Promise<void> {
    return await invoke('delete_zerotier_connection', { connectionId });
  }

  async getZeroTierStatus(connectionId: string): Promise<string> {
    return await invoke('get_zerotier_status', { connectionId });
  }

  // Tailscale Management Methods
  async createTailscaleConnection(name: string, config: TailscaleConfig): Promise<string> {
    return await invoke('create_tailscale_connection', { name, config });
  }

  async connectTailscale(connectionId: string): Promise<void> {
    return await invoke('connect_tailscale', { connectionId });
  }

  async disconnectTailscale(connectionId: string): Promise<void> {
    return await invoke('disconnect_tailscale', { connectionId });
  }

  async getTailscaleConnection(connectionId: string): Promise<TailscaleConnection> {
    const result = await invoke('get_tailscale_connection', { connectionId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listTailscaleConnections(): Promise<TailscaleConnection[]> {
    const results = await invoke('list_tailscale_connections');
    return results.map((result: any) => ({
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    }));
  }

  async deleteTailscaleConnection(connectionId: string): Promise<void> {
    return await invoke('delete_tailscale_connection', { connectionId });
  }

  async getTailscaleStatus(connectionId: string): Promise<string> {
    return await invoke('get_tailscale_status', { connectionId });
  }

  // Utility Methods
  async establishProxiedConnection(
    targetHost: string,
    targetPort: number,
    proxyConfig?: ProxyConfig,
    vpnConfig?: {
      type: 'openvpn' | 'wireguard' | 'ikev2' | 'sstp' | 'l2tp' | 'pptp' | 'softether' | 'zerotier' | 'tailscale';
      enabled: boolean;
      configId?: string;
      chainPosition?: number;
    }
  ): Promise<{ localPort?: number; vpnActive?: boolean }> {
    const result: { localPort?: number; vpnActive?: boolean } = {};

    // Handle VPN connections first
    if (vpnConfig?.enabled && vpnConfig.configId) {
      const status = await this.getVPNStatus(vpnConfig.type, vpnConfig.configId);
      if (status !== 'Connected') {
        await this.connectVPN(vpnConfig.type, vpnConfig.configId);
      }
      result.vpnActive = true;
    }

    // Handle proxy
    if (proxyConfig?.enabled) {
      const proxyConnectionId = await this.createProxyConnection(
        targetHost,
        targetPort,
        proxyConfig
      );
      const localPort = await this.connectViaProxy(proxyConnectionId);
      result.localPort = localPort;
    }

    return result;
  }

  private async getVPNStatus(vpnType: string, connectionId: string): Promise<string> {
    switch (vpnType) {
      case 'openvpn':
        return await this.getOpenVPNStatus(connectionId);
      case 'wireguard':
        return await this.getWireGuardStatus(connectionId);
      case 'ikev2':
        return await this.getIKEv2Status(connectionId);
      case 'sstp':
        return await this.getSSTPStatus(connectionId);
      case 'l2tp':
        return await this.getL2TPStatus(connectionId);
      case 'pptp':
        return await this.getPPTPStatus(connectionId);
      case 'softether':
        return await this.getSoftEtherStatus(connectionId);
      case 'zerotier':
        return await this.getZeroTierStatus(connectionId);
      case 'tailscale':
        return await this.getTailscaleStatus(connectionId);
      default:
        throw new Error(`Unsupported VPN type: ${vpnType}`);
    }
  }

  private async connectVPN(vpnType: string, connectionId: string): Promise<void> {
    switch (vpnType) {
      case 'openvpn':
        return await this.connectOpenVPN(connectionId);
      case 'wireguard':
        return await this.connectWireGuard(connectionId);
      case 'ikev2':
        return await this.connectIKEv2(connectionId);
      case 'sstp':
        return await this.connectSSTP(connectionId);
      case 'l2tp':
        return await this.connectL2TP(connectionId);
      case 'pptp':
        return await this.connectPPTP(connectionId);
      case 'softether':
        return await this.connectSoftEther(connectionId);
      case 'zerotier':
        return await this.connectZeroTier(connectionId);
      case 'tailscale':
        return await this.connectTailscale(connectionId);
      default:
        throw new Error(`Unsupported VPN type: ${vpnType}`);
    }
  }

  private async disconnectVPN(vpnType: string, connectionId: string): Promise<void> {
    switch (vpnType) {
      case 'openvpn':
        return await this.disconnectOpenVPN(connectionId);
      case 'wireguard':
        return await this.disconnectWireGuard(connectionId);
      case 'ikev2':
        return await this.disconnectIKEv2(connectionId);
      case 'sstp':
        return await this.disconnectSSTP(connectionId);
      case 'l2tp':
        return await this.disconnectL2TP(connectionId);
      case 'pptp':
        return await this.disconnectPPTP(connectionId);
      case 'softether':
        return await this.disconnectSoftEther(connectionId);
      case 'zerotier':
        return await this.disconnectZeroTier(connectionId);
      case 'tailscale':
        return await this.disconnectTailscale(connectionId);
      default:
        throw new Error(`Unsupported VPN type: ${vpnType}`);
    }
  }

  async cleanupConnections(
    proxyConnectionId?: string,
    vpnConnection?: { type: string; id: string }
  ): Promise<void> {
    if (proxyConnectionId) {
      try {
        await this.disconnectProxy(proxyConnectionId);
        await this.deleteProxyConnection(proxyConnectionId);
      } catch (error) {
        console.warn('Failed to cleanup proxy connection:', error);
      }
    }

    if (vpnConnection) {
      try {
        await this.disconnectVPN(vpnConnection.type, vpnConnection.id);
      } catch (error) {
        console.warn(`Failed to cleanup ${vpnConnection.type} connection:`, error);
      }
    }
  }

  // Connection chaining utilities
  async createConnectionChain(
    connections: Array<{
      type: 'proxy' | 'openvpn' | 'wireguard' | 'ikev2' | 'sstp' | 'l2tp' | 'pptp' | 'softether' | 'zerotier' | 'tailscale';
      config: ProxyConfig | OpenVPNConfig | WireGuardConfig | IKEv2Config | SSTPConfig | L2TPConfig | PPTPConfig | SoftEtherConfig | ZeroTierConfig | TailscaleConfig;
      targetHost?: string;
      targetPort?: number;
    }>
  ): Promise<{
    proxyConnections: string[];
    vpnConnections: Array<{ type: string; id: string }>;
    finalLocalPort?: number;
  }> {
    const proxyConnections: string[] = [];
    const vpnConnections: Array<{ type: string; id: string }> = [];
    let finalLocalPort: number | undefined;

    // Sort by chain position for VPN connections
    const sortedConnections = connections.sort((a, b) => {
      if (a.type !== 'proxy' && b.type !== 'proxy') {
        const aPos = (a.config as any).chainPosition || 0;
        const bPos = (b.config as any).chainPosition || 0;
        return aPos - bPos;
      }
      return 0;
    });

    for (const connection of sortedConnections) {
      if (connection.type === 'proxy' && connection.targetHost && connection.targetPort) {
        const proxyConfig = connection.config as ProxyConfig;
        const proxyId = await this.createProxyConnection(
          connection.targetHost,
          connection.targetPort,
          proxyConfig
        );
        finalLocalPort = await this.connectViaProxy(proxyId);
        proxyConnections.push(proxyId);
      } else if (connection.type !== 'proxy') {
        // Handle VPN connections
        const vpnId = await this.createVPNConnection(connection.type, `Chain ${connection.type} ${vpnConnections.length + 1}`, connection.config);
        await this.connectVPN(connection.type, vpnId);
        vpnConnections.push({ type: connection.type, id: vpnId });
      }
    }

    return {
      proxyConnections,
      vpnConnections,
      finalLocalPort,
    };
  }

  private async createVPNConnection(
    vpnType: string,
    name: string,
    config: any
  ): Promise<string> {
    switch (vpnType) {
      case 'openvpn':
        return await this.createOpenVPNConnection(name, config as OpenVPNConfig);
      case 'wireguard':
        return await this.createWireGuardConnection(name, config as WireGuardConfig);
      case 'ikev2':
        return await this.createIKEv2Connection(name, config as IKEv2Config);
      case 'sstp':
        return await this.createSSTPConnection(name, config as SSTPConfig);
      case 'l2tp':
        return await this.createL2TPConnection(name, config as L2TPConfig);
      case 'pptp':
        return await this.createPPTPConnection(name, config as PPTPConfig);
      case 'softether':
        return await this.createSoftEtherConnection(name, config as SoftEtherConfig);
      case 'zerotier':
        return await this.createZeroTierConnection(name, config as ZeroTierConfig);
      case 'tailscale':
        return await this.createTailscaleConnection(name, config as TailscaleConfig);
      default:
        throw new Error(`Unsupported VPN type: ${vpnType}`);
    }
  }

  async disconnectChain(
    proxyConnections: string[],
    vpnConnections: Array<{ type: string; id: string }>
  ): Promise<void> {
    // Disconnect proxies in reverse order
    for (const proxyId of proxyConnections.reverse()) {
      try {
        await this.disconnectProxy(proxyId);
        await this.deleteProxyConnection(proxyId);
      } catch (error) {
        console.warn(`Failed to disconnect proxy ${proxyId}:`, error);
      }
    }

    // Disconnect VPNs in reverse order
    for (const vpnConn of vpnConnections.reverse()) {
      try {
        await this.disconnectVPN(vpnConn.type, vpnConn.id);
        await this.deleteVPNConnection(vpnConn.type, vpnConn.id);
      } catch (error) {
        console.warn(`Failed to disconnect ${vpnConn.type} ${vpnConn.id}:`, error);
      }
    }
  }

  private async deleteVPNConnection(vpnType: string, connectionId: string): Promise<void> {
    switch (vpnType) {
      case 'openvpn':
        return await this.deleteOpenVPNConnection(connectionId);
      case 'wireguard':
        return await this.deleteWireGuardConnection(connectionId);
      case 'ikev2':
        return await this.deleteIKEv2Connection(connectionId);
      case 'sstp':
        return await this.deleteSSTPConnection(connectionId);
      case 'l2tp':
        return await this.deleteL2TPConnection(connectionId);
      case 'pptp':
        return await this.deletePPTPConnection(connectionId);
      case 'softether':
        return await this.deleteSoftEtherConnection(connectionId);
      case 'zerotier':
        return await this.deleteZeroTierConnection(connectionId);
      case 'tailscale':
        return await this.deleteTailscaleConnection(connectionId);
      default:
        throw new Error(`Unsupported VPN type: ${vpnType}`);
    }
  }

  // Advanced Chaining Capabilities
  async createAdvancedChain(
    name: string,
    hops: Omit<ChainHop, 'id' | 'status' | 'error'>[],
    targetHost: string,
    targetPort: number
  ): Promise<ConnectionChain> {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate chain configuration
    await this.validateChainConfig(hops);

    // Sort hops by position
    const sortedHops = hops.sort((a, b) => a.position - b.position);

    // Create the chain object
    const chain: ConnectionChain = {
      id: chainId,
      name,
      hops: sortedHops.map(hop => ({
        ...hop,
        id: `${chainId}_hop_${hop.position}`,
        status: 'pending' as const,
      })),
      targetHost,
      targetPort,
      status: 'disconnected',
      createdAt: new Date(),
    };

    return chain;
  }

  async connectAdvancedChain(chain: ConnectionChain): Promise<ConnectionChain> {
    const updatedChain = { ...chain, status: 'connecting' as const };

    try {
      // Connect hops in order, building up the chain
      let currentTargetHost = chain.targetHost;
      let currentTargetPort = chain.targetPort;
      let finalLocalPort: number | undefined;

      for (let i = chain.hops.length - 1; i >= 0; i--) {
        const hop = chain.hops[i];
        const hopIndex = chain.hops.findIndex(h => h.id === hop.id);

        try {
          updatedChain.hops[hopIndex].status = 'connecting';

          if (hop.type === 'openvpn') {
            const vpnConfig = hop.config as OpenVPNConfig;
            const vpnId = await this.createOpenVPNConnection(
              `${chain.name} - VPN Hop ${hop.position}`,
              vpnConfig
            );
            await this.connectOpenVPN(vpnId);
            updatedChain.hops[hopIndex].status = 'connected';

            // Update the target for the next hop to route through this VPN
            if (i > 0) {
              // For subsequent hops, they need to route through the VPN
              // This is complex - we'd need to determine the VPN's local IP
              // For now, we'll assume the next hop knows how to route through the VPN
            }

          } else if (hop.type === 'proxy') {
            const proxyConfig = hop.config as ProxyConfig;
            const proxyId = await this.createProxyConnection(
              currentTargetHost,
              currentTargetPort,
              proxyConfig
            );

            const localPort = await this.connectViaProxy(proxyId);
            updatedChain.hops[hopIndex].status = 'connected';
            updatedChain.hops[hopIndex].localPort = localPort;

            // Update target for next hop
            currentTargetHost = '127.0.0.1';
            currentTargetPort = localPort;
            finalLocalPort = localPort;
          }

        } catch (error) {
          updatedChain.hops[hopIndex].status = 'error';
          updatedChain.hops[hopIndex].error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }

      updatedChain.status = 'connected';
      updatedChain.connectedAt = new Date();
      updatedChain.finalLocalPort = finalLocalPort;

    } catch (error) {
      updatedChain.status = 'error';
      // Cleanup any partially established connections
      await this.disconnectAdvancedChain(updatedChain);
    }

    return updatedChain;
  }

  async disconnectAdvancedChain(chain: ConnectionChain): Promise<void> {
    // Disconnect in reverse order (opposite of connection order)
    const proxyConnections: string[] = [];
    const openvpnConnections: string[] = [];

    // Collect all connection IDs
    for (const hop of chain.hops) {
      if (hop.type === 'proxy') {
        // We need to reconstruct the proxy connection ID
        // This is a limitation - we should store the actual connection IDs
        proxyConnections.push(`${chain.id}_proxy_${hop.position}`);
      } else if (hop.type === 'openvpn') {
        openvpnConnections.push(`${chain.name} - VPN Hop ${hop.position}`);
      }
    }

    await this.disconnectChain(proxyConnections, openvpnConnections);
  }

  async validateChainConfig(hops: Omit<ChainHop, 'id' | 'status' | 'error'>[]): Promise<void> {
    if (hops.length === 0) {
      throw new Error('Chain must have at least one hop');
    }

    // Check for duplicate positions
    const positions = hops.map(h => h.position);
    if (new Set(positions).size !== positions.length) {
      throw new Error('Chain hop positions must be unique');
    }

    // Validate position ordering (should start from 0 or 1)
    const minPosition = Math.min(...positions);
    if (minPosition < 0) {
      throw new Error('Chain hop positions must be non-negative');
    }

    // Check for VPN positioning constraints
    const vpnHops = hops.filter(h => h.type === 'openvpn');
    if (vpnHops.length > 1) {
      // Multiple VPNs are allowed but should be at the beginning
      const vpnPositions = vpnHops.map(h => h.position).sort((a, b) => a - b);
      const nonVpnHops = hops.filter(h => h.type !== 'openvpn');
      const minVpnPos = Math.min(...vpnPositions);
      const maxNonVpnPos = nonVpnHops.length > 0 ? Math.max(...nonVpnHops.map(h => h.position)) : -1;

      if (minVpnPos > maxNonVpnPos) {
        throw new Error('VPN hops should generally be positioned before proxy hops for optimal routing');
      }
    }

    // Validate proxy configurations
    for (const hop of hops) {
      if (hop.type === 'proxy') {
        const proxyConfig = hop.config as ProxyConfig;
        if (!proxyConfig.enabled) {
          throw new Error(`Proxy hop at position ${hop.position} is not enabled`);
        }
        if (!proxyConfig.host || proxyConfig.port <= 0) {
          throw new Error(`Proxy hop at position ${hop.position} has invalid host/port configuration`);
        }
      } else if (hop.type === 'openvpn') {
        const vpnConfig = hop.config as OpenVPNConfig;
        if (!vpnConfig.remoteHost && !vpnConfig.configFile) {
          throw new Error(`OpenVPN hop at position ${hop.position} must have either remote host or config file`);
        }
      }
    }
  }

  // Proxy Chaining Methods
  async createProxyChain(
    proxies: Array<{ config: ProxyConfig; position: number }>,
    targetHost: string,
    targetPort: number
  ): Promise<{ chainId: string; finalLocalPort: number; proxyIds: string[] }> {
    const chainId = `proxy_chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const proxyIds: string[] = [];

    // Sort proxies by position (closest to target first)
    const sortedProxies = proxies.sort((a, b) => b.position - a.position);

    let currentTargetHost = targetHost;
    let currentTargetPort = targetPort;
    let finalLocalPort = targetPort;

    for (const proxy of sortedProxies) {
      const proxyId = await this.createProxyConnection(
        currentTargetHost,
        currentTargetPort,
        proxy.config
      );

      const localPort = await this.connectViaProxy(proxyId);
      proxyIds.push(proxyId);

      // Next proxy routes through this one
      currentTargetHost = '127.0.0.1';
      currentTargetPort = localPort;
      finalLocalPort = localPort;
    }

    return {
      chainId,
      finalLocalPort,
      proxyIds,
    };
  }

  // VPN + Proxy Combo Methods
  async createVPNProxyCombo(
    vpnConfig: OpenVPNConfig,
    proxyConfigs: ProxyConfig[],
    targetHost: string,
    targetPort: number,
    comboType: 'vpn-first' | 'proxy-first' | 'interleaved'
  ): Promise<{
    chainId: string;
    vpnId?: string;
    proxyIds: string[];
    finalLocalPort?: number;
  }> {
    const chainId = `combo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const proxyIds: string[] = [];
    let vpnId: string | undefined;
    let finalLocalPort: number | undefined;

    switch (comboType) {
      case 'vpn-first':
        // Connect VPN first, then route proxies through it
        vpnId = await this.createOpenVPNConnection(`Combo VPN - ${chainId}`, vpnConfig);
        await this.connectOpenVPN(vpnId);

        // Create proxy chain that routes through the VPN
        const proxyChain = await this.createProxyChain(
          proxyConfigs.map((config, index) => ({ config, position: index })),
          targetHost,
          targetPort
        );
        proxyIds.push(...proxyChain.proxyIds);
        finalLocalPort = proxyChain.finalLocalPort;
        break;

      case 'proxy-first':
        // Create proxy chain first, then route VPN through the final proxy
        const proxyChainResult = await this.createProxyChain(
          proxyConfigs.map((config, index) => ({ config, position: index })),
          targetHost,
          targetPort
        );
        proxyIds.push(...proxyChainResult.proxyIds);

        // Connect VPN through the proxy chain
        const modifiedVpnConfig = {
          ...vpnConfig,
          // Modify VPN to route through the proxy chain
          // This would require updating the VPN config to use the proxy
        };
        vpnId = await this.createOpenVPNConnection(`Combo VPN - ${chainId}`, modifiedVpnConfig);
        await this.connectOpenVPN(vpnId);
        finalLocalPort = proxyChainResult.finalLocalPort;
        break;

      case 'interleaved':
        // Alternate between VPN and proxy connections
        let currentHost = targetHost;
        let currentPort = targetPort;

        for (let i = 0; i < Math.max(proxyConfigs.length, 1); i++) {
          // Add proxy if available
          if (i < proxyConfigs.length) {
            const proxyId = await this.createProxyConnection(
              currentHost,
              currentPort,
              proxyConfigs[i]
            );
            const localPort = await this.connectViaProxy(proxyId);
            proxyIds.push(proxyId);
            currentHost = '127.0.0.1';
            currentPort = localPort;
            finalLocalPort = localPort;
          }

          // Add VPN if this is the last iteration or at specific intervals
          if (i === proxyConfigs.length - 1) {
            vpnId = await this.createOpenVPNConnection(`Combo VPN - ${chainId}`, vpnConfig);
            await this.connectOpenVPN(vpnId);
          }
        }
        break;
    }

    return {
      chainId,
      vpnId,
      proxyIds,
      finalLocalPort,
    };
  }

  // Chain Optimization and Analysis
  async analyzeChainPerformance(
    chain: ConnectionChain
  ): Promise<{
    totalLatency: number;
    bandwidth: number;
    reliability: number;
    recommendations: string[];
  }> {
    // This would implement performance analysis
    // For now, return mock data
    return {
      totalLatency: 150, // ms
      bandwidth: 50, // Mbps
      reliability: 0.95, // 95%
      recommendations: [
        'Consider moving VPN closer to target for better performance',
        'Proxy chain is optimal for current configuration',
      ],
    };
  }

  async optimizeChain(
    chain: ConnectionChain
  ): Promise<ConnectionChain> {
    // Analyze current chain and suggest optimizations
    const analysis = await this.analyzeChainPerformance(chain);

    // Implement optimization logic
    const optimizedHops = [...chain.hops];

    // Example optimization: move VPNs to the beginning
    const vpnHops = optimizedHops.filter(h => h.type === 'openvpn');
    const proxyHops = optimizedHops.filter(h => h.type === 'proxy');

    // Reorder: VPNs first, then proxies
    const reorderedHops = [
      ...vpnHops.map((hop, index) => ({ ...hop, position: index })),
      ...proxyHops.map((hop, index) => ({ ...hop, position: vpnHops.length + index })),
    ];

    return {
      ...chain,
      hops: reorderedHops,
      name: `${chain.name} (Optimized)`,
    };
  }

  // Dynamic Chain Management
  async reconfigureChain(
    chainId: string,
    newHops: Omit<ChainHop, 'id' | 'status' | 'error'>[]
  ): Promise<ConnectionChain> {
    // Find existing chain (this would need to be stored)
    // For now, create a new optimized chain
    const newChain = await this.createAdvancedChain(
      `Reconfigured Chain ${chainId}`,
      newHops,
      'target-host', // This should come from existing chain
      22 // This should come from existing chain
    );

    return newChain;
  }

  // Chain Monitoring and Health Checks
  async monitorChain(chain: ConnectionChain): Promise<{
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    hopStatuses: Array<{ hopId: string; health: 'healthy' | 'degraded' | 'unhealthy'; metrics: any }>;
    recommendations: string[];
  }> {
    const hopStatuses: Array<{ hopId: string; health: 'healthy' | 'degraded' | 'unhealthy'; metrics: any }> = [];
    let overallHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    for (const hop of chain.hops) {
      // Perform health check for each hop
      const health = await this.checkHopHealth(hop);
      hopStatuses.push({
        hopId: hop.id,
        health: health.status,
        metrics: health.metrics,
      });

      if (health.status === 'unhealthy') {
        overallHealth = 'unhealthy';
      } else if (health.status === 'degraded' && overallHealth === 'healthy') {
        overallHealth = 'degraded';
      }
    }

    const recommendations = this.generateHealthRecommendations(hopStatuses);

    return {
      overallHealth,
      hopStatuses,
      recommendations,
    };
  }

  private async checkHopHealth(hop: ChainHop): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: any;
  }> {
    // Implement health checking logic for each hop type
    if (hop.type === 'proxy') {
      // Check proxy connectivity and latency
      return {
        status: 'healthy',
        metrics: { latency: 50, successRate: 0.98 },
      };
    } else if (hop.type === 'openvpn') {
      // Check VPN connectivity and tunnel status
      return {
        status: 'healthy',
        metrics: { latency: 100, bytesTransferred: 1024000 },
      };
    }

    return {
      status: 'healthy',
      metrics: {},
    };
  }

  private generateHealthRecommendations(
    hopStatuses: Array<{ hopId: string; health: 'healthy' | 'degraded' | 'unhealthy'; metrics: any }>
  ): string[] {
    const recommendations: string[] = [];

    const unhealthyHops = hopStatuses.filter(h => h.health === 'unhealthy');
    if (unhealthyHops.length > 0) {
      recommendations.push(`Replace or reconfigure ${unhealthyHops.length} unhealthy hop(s)`);
    }

    const degradedHops = hopStatuses.filter(h => h.health === 'degraded');
    if (degradedHops.length > 0) {
      recommendations.push(`Monitor ${degradedHops.length} degraded hop(s) for potential issues`);
    }

    // Add more sophisticated recommendations based on metrics
    const highLatencyHops = hopStatuses.filter(h => h.metrics.latency > 200);
    if (highLatencyHops.length > 0) {
      recommendations.push('Consider optimizing high-latency hops or reordering the chain');
    }

    return recommendations;
  }

  // New Chaining Service Methods
  async createConnectionChain(
    name: string,
    description: string | undefined,
    layers: ChainLayer[]
  ): Promise<string> {
    return await invoke('create_connection_chain', {
      name,
      description,
      layers,
    });
  }

  async connectConnectionChain(chainId: string): Promise<void> {
    return await invoke('connect_connection_chain', { chainId });
  }

  async disconnectConnectionChain(chainId: string): Promise<void> {
    return await invoke('disconnect_connection_chain', { chainId });
  }

  async getConnectionChain(chainId: string): Promise<ConnectionChain> {
    const result = await invoke('get_connection_chain', { chainId });
    return {
      ...result,
      createdAt: new Date(result.created_at),
      connectedAt: result.connected_at ? new Date(result.connected_at) : undefined,
    };
  }

  async listConnectionChains(): Promise<ConnectionChain[]> {
    const results = await invoke('list_connection_chains');
    return results.map((chain: any) => ({
      ...chain,
      createdAt: new Date(chain.created_at),
      connectedAt: chain.connected_at ? new Date(chain.connected_at) : undefined,
    }));
  }

  async deleteConnectionChain(chainId: string): Promise<void> {
    return await invoke('delete_connection_chain', { chainId });
  }

  async updateConnectionChainLayers(
    chainId: string,
    layers: ChainLayer[]
  ): Promise<void> {
    return await invoke('update_connection_chain_layers', {
      chainId,
      layers,
    });
  }
}