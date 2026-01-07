import { invoke } from '@tauri-apps/api/core';
import { Connection } from '../types/connection';

export interface SSHTunnelConfig {
  id: string;
  name: string;
  // The SSH connection to use as the tunnel host
  sshConnectionId: string;
  // Local port to bind (0 = auto-assign)
  localPort: number;
  // Remote host to forward to (from the SSH server's perspective)
  // Not used for dynamic tunnels
  remoteHost?: string;
  // Remote port to forward to
  // Not used for dynamic tunnels
  remotePort?: number;
  // Tunnel type
  type: 'local' | 'remote' | 'dynamic';
  // Status
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  // Auto-connect when associated connection starts
  autoConnect: boolean;
  // Error message if any
  error?: string;
  // Actual local port (may differ from requested if auto-assigned)
  actualLocalPort?: number;
  // SSH session ID (for connected tunnels)
  sshSessionId?: string;
  // Port forward ID (for connected tunnels)
  portForwardId?: string;
  // Created timestamp
  createdAt: Date;
}

export interface SSHTunnelCreateParams {
  name: string;
  sshConnectionId: string;
  localPort?: number;
  // Remote host/port - required for local/remote, not used for dynamic
  remoteHost?: string;
  remotePort?: number;
  type?: 'local' | 'remote' | 'dynamic';
  autoConnect?: boolean;
}

interface PortForwardConfig {
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  direction: 'Local' | 'Remote' | 'Dynamic';
}

class SSHTunnelService {
  private static instance: SSHTunnelService;
  private tunnels: Map<string, SSHTunnelConfig> = new Map();
  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.loadTunnels();
  }

  static getInstance(): SSHTunnelService {
    if (!SSHTunnelService.instance) {
      SSHTunnelService.instance = new SSHTunnelService();
    }
    return SSHTunnelService.instance;
  }

  private async loadTunnels(): Promise<void> {
    try {
      const stored = localStorage.getItem('ssh-tunnels');
      if (stored) {
        const data = JSON.parse(stored);
        for (const tunnel of data) {
          this.tunnels.set(tunnel.id, {
            ...tunnel,
            status: 'disconnected',
            createdAt: new Date(tunnel.createdAt),
          });
        }
      }
    } catch (error) {
      console.error('Failed to load SSH tunnels:', error);
    }
  }

  private saveTunnels(): void {
    try {
      const data = Array.from(this.tunnels.values()).map(t => ({
        ...t,
        status: 'disconnected', // Don't persist status
        error: undefined,
        actualLocalPort: undefined,
      }));
      localStorage.setItem('ssh-tunnels', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save SSH tunnels:', error);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getTunnels(): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values());
  }

  getTunnel(id: string): SSHTunnelConfig | undefined {
    return this.tunnels.get(id);
  }

  getTunnelsByConnection(connectionId: string): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values()).filter(
      t => t.sshConnectionId === connectionId
    );
  }

  async createTunnel(params: SSHTunnelCreateParams): Promise<SSHTunnelConfig> {
    const id = `tunnel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const tunnel: SSHTunnelConfig = {
      id,
      name: params.name,
      sshConnectionId: params.sshConnectionId,
      localPort: params.localPort || 0,
      remoteHost: params.remoteHost,
      remotePort: params.remotePort,
      type: params.type || 'local',
      status: 'disconnected',
      autoConnect: params.autoConnect ?? false,
      createdAt: new Date(),
    };

    this.tunnels.set(id, tunnel);
    this.saveTunnels();
    this.notifyListeners();

    return tunnel;
  }

  async updateTunnel(id: string, updates: Partial<SSHTunnelCreateParams>): Promise<SSHTunnelConfig | null> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return null;

    // If tunnel is connected, disconnect first
    if (tunnel.status === 'connected') {
      await this.disconnectTunnel(id);
    }

    const updated: SSHTunnelConfig = {
      ...tunnel,
      name: updates.name ?? tunnel.name,
      sshConnectionId: updates.sshConnectionId ?? tunnel.sshConnectionId,
      localPort: updates.localPort ?? tunnel.localPort,
      remoteHost: updates.remoteHost ?? tunnel.remoteHost,
      remotePort: updates.remotePort ?? tunnel.remotePort,
      type: updates.type ?? tunnel.type,
      autoConnect: updates.autoConnect ?? tunnel.autoConnect,
    };

    this.tunnels.set(id, updated);
    this.saveTunnels();
    this.notifyListeners();

    return updated;
  }

  async deleteTunnel(id: string): Promise<boolean> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return false;

    // Disconnect if connected
    if (tunnel.status === 'connected') {
      await this.disconnectTunnel(id);
    }

    this.tunnels.delete(id);
    this.saveTunnels();
    this.notifyListeners();

    return true;
  }

  async connectTunnel(id: string, sshConnection: Connection): Promise<SSHTunnelConfig> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) {
      throw new Error(`Tunnel ${id} not found`);
    }

    // Update status to connecting
    tunnel.status = 'connecting';
    tunnel.error = undefined;
    this.tunnels.set(id, tunnel);
    this.notifyListeners();

    try {
      // Get SSH connection overrides from the connection
      const override = sshConnection.sshConnectionConfigOverride;
      
      // First, connect to the SSH server
      const sessionId = await invoke<string>('connect_ssh', {
        config: {
          host: sshConnection.hostname,
          port: sshConnection.port || 22,
          username: sshConnection.username || '',
          password: sshConnection.password || null,
          private_key_path: sshConnection.privateKey || null,
          private_key_passphrase: sshConnection.passphrase || null,
          jump_hosts: [],
          proxy_config: null,
          openvpn_config: null,
          connect_timeout: override?.connectTimeout ?? sshConnection.sshConnectTimeout ?? 30,
          keep_alive_interval: override?.keepAliveInterval ?? sshConnection.sshKeepAliveInterval ?? 60,
          strict_host_key_checking: override?.strictHostKeyChecking ?? !sshConnection.ignoreSshSecurityErrors ?? false,
          known_hosts_path: override?.knownHostsPath ?? sshConnection.sshKnownHostsPath ?? null,
          tcp_no_delay: override?.tcpNoDelay ?? true,
          tcp_keepalive: override?.tcpKeepalive ?? true,
          keepalive_probes: override?.keepaliveProbes ?? 3,
          ip_protocol: override?.ipProtocol ?? 'any',
          compression: override?.compression ?? false,
          compression_level: override?.compressionLevel ?? 6,
          ssh_version: override?.sshVersion ?? '2',
          preferred_ciphers: override?.preferredCiphers ?? [],
          preferred_macs: override?.preferredMacs ?? [],
          preferred_kex: override?.preferredKex ?? [],
          preferred_host_keys: override?.preferredHostKeys ?? [],
        },
      });

      // Determine the local port (use requested or find available)
      const localPort = tunnel.localPort || await this.findAvailablePort();

      // Set up port forwarding
      const portForwardConfig: PortForwardConfig = {
        local_host: '127.0.0.1',
        local_port: localPort,
        remote_host: tunnel.remoteHost,
        remote_port: tunnel.remotePort,
        direction: tunnel.type === 'local' ? 'Local' : 
                   tunnel.type === 'remote' ? 'Remote' : 'Dynamic',
      };

      const portForwardId = await invoke<string>('setup_port_forward', {
        sessionId,
        config: portForwardConfig,
      });

      tunnel.status = 'connected';
      tunnel.actualLocalPort = localPort;
      tunnel.sshSessionId = sessionId;
      tunnel.portForwardId = portForwardId;
      tunnel.error = undefined;
      this.tunnels.set(id, tunnel);
      this.notifyListeners();

      return tunnel;
    } catch (error) {
      tunnel.status = 'error';
      tunnel.error = error instanceof Error ? error.message : String(error);
      this.tunnels.set(id, tunnel);
      this.notifyListeners();
      throw error;
    }
  }

  async disconnectTunnel(id: string): Promise<void> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return;

    try {
      // Disconnect the SSH session if we have one
      if (tunnel.sshSessionId) {
        await invoke('disconnect_ssh', { sessionId: tunnel.sshSessionId });
      }
    } catch (error) {
      console.error('Failed to close SSH tunnel:', error);
    }

    tunnel.status = 'disconnected';
    tunnel.actualLocalPort = undefined;
    tunnel.sshSessionId = undefined;
    tunnel.portForwardId = undefined;
    tunnel.error = undefined;
    this.tunnels.set(id, tunnel);
    this.notifyListeners();
  }

  private async findAvailablePort(): Promise<number> {
    // Use a simple approach: try ports starting from 10000
    // The actual binding will happen in the Rust backend
    // This is just a fallback - ideally the backend returns the actual port
    return 10000 + Math.floor(Math.random() * 50000);
  }

  async disconnectAllTunnels(): Promise<void> {
    for (const tunnel of this.tunnels.values()) {
      if (tunnel.status === 'connected') {
        await this.disconnectTunnel(tunnel.id);
      }
    }
  }

  // Get available tunnels that can be used for a target connection
  getAvailableTunnelsForConnection(targetProtocol: string): SSHTunnelConfig[] {
    return Array.from(this.tunnels.values()).filter(t => t.status === 'connected');
  }

  // Check if a tunnel is using a specific SSH connection
  isTunnelUsingSshConnection(tunnelId: string, connectionId: string): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel?.sshConnectionId === connectionId;
  }
}

export const sshTunnelService = SSHTunnelService.getInstance();
export default sshTunnelService;
