import { ProxyConfig } from '../types/settings';
import { SettingsManager } from './settingsManager';

export interface ProxyChainLayer {
  id: string;
  proxyConfig: ProxyConfig;
  position: number;
  status: 'pending' | 'connecting' | 'connected' | 'failed';
  localPort?: number;
  error?: string;
}

export interface ProxyChain {
  id: string;
  name: string;
  description?: string;
  layers: ProxyChainLayer[];
  status: 'inactive' | 'connecting' | 'connected' | 'disconnecting' | 'error' | 'partial';
  createdAt: Date;
  connectedAt?: Date;
  finalLocalPort?: number;
  error?: string;
}

export interface ProxyChainPreset {
  id: string;
  name: string;
  description: string;
  layers: Omit<ProxyChainLayer, 'id' | 'status' | 'localPort' | 'error'>[];
  tags: string[];
}

export class ProxyManager {
  private static instance: ProxyManager;
  private settingsManager = SettingsManager.getInstance();
  private chains: Map<string, ProxyChain> = new Map();
  private presets: Map<string, ProxyChainPreset> = new Map();

  static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager();
    }
    return ProxyManager.instance;
  }

  static resetInstance(): void {
    (ProxyManager as any).instance = undefined;
  }

  async createProxiedConnection(
    targetHost: string,
    targetPort: number,
    proxy?: ProxyConfig
  ): Promise<WebSocket> {
    const proxyConfig = proxy || this.settingsManager.getSettings().globalProxy;

    if (!proxyConfig || !proxyConfig.enabled) {
      // Direct connection
      const scheme = this.getWebSocketScheme();
      return new WebSocket(`${scheme}://${targetHost}:${targetPort}`);
    }

    this.settingsManager.logAction(
      'info',
      'Proxy connection initiated',
      undefined,
      `Target: ${targetHost}:${targetPort}, Proxy: ${proxyConfig.type}://${proxyConfig.host}:${proxyConfig.port}`
    );

    switch (proxyConfig.type) {
      case 'http':
      case 'https':
        return this.createHttpProxyConnection(targetHost, targetPort, proxyConfig);
      case 'socks4':
      case 'socks5':
        return this.createSocksProxyConnection(targetHost, targetPort, proxyConfig);
      default:
        throw new Error(`Unsupported proxy type: ${proxyConfig.type}`);
    }
  }

  private async createHttpProxyConnection(
    targetHost: string,
    targetPort: number,
    proxy: ProxyConfig
  ): Promise<WebSocket> {
    // HTTP proxy connection through WebSocket proxy server
    const scheme = this.getWebSocketScheme(proxy);
    const proxyUrl = `${scheme}://${proxy.host}:${proxy.port}/proxy`;
    const ws = new WebSocket(proxyUrl);

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        // Send CONNECT request
        const connectRequest = {
          method: 'CONNECT',
          target: `${targetHost}:${targetPort}`,
          auth: proxy.username && proxy.password ? {
            username: proxy.username,
            password: proxy.password,
          } : undefined,
        };

        ws.send(JSON.stringify(connectRequest));
      };

      ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.status === 'connected') {
          resolve(ws);
        } else {
          reject(new Error(`Proxy connection failed: ${response.error}`));
        }
      };

      ws.onerror = () => {
        reject(new Error('Proxy connection failed'));
      };
    });
  }

  private async createSocksProxyConnection(
    targetHost: string,
    targetPort: number,
    proxy: ProxyConfig
  ): Promise<WebSocket> {
    // SOCKS proxy connection through WebSocket proxy server
    const scheme = this.getWebSocketScheme(proxy);
    const proxyUrl = `${scheme}://${proxy.host}:${proxy.port}/socks`;
    const ws = new WebSocket(proxyUrl);

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        // Send SOCKS connection request
        const socksRequest = {
          version: proxy.type === 'socks5' ? 5 : 4,
          target: targetHost,
          port: targetPort,
          auth: proxy.username && proxy.password ? {
            username: proxy.username,
            password: proxy.password,
          } : undefined,
        };

        ws.send(JSON.stringify(socksRequest));
      };

      ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.status === 'connected') {
          resolve(ws);
        } else {
          reject(new Error(`SOCKS proxy connection failed: ${response.error}`));
        }
      };

      ws.onerror = () => {
        reject(new Error('SOCKS proxy connection failed'));
      };
    });
  }

  private getWebSocketScheme(proxy?: ProxyConfig): 'ws' | 'wss' {
    const pageSecure = typeof location !== 'undefined' && location.protocol === 'https:';
    const proxySecure = proxy?.type === 'https';
    return pageSecure || proxySecure ? 'wss' : 'ws';
  }

  // Test proxy connectivity
  async testProxy(
    proxy: ProxyConfig,
    testHost = 'httpbin.org',
    testPort = 80
  ): Promise<boolean> {
    try {
      const ws = await this.createProxiedConnection(testHost, testPort, proxy);
      ws.close();
      
      this.settingsManager.logAction(
        'info',
        'Proxy test successful',
        undefined,
        `Proxy: ${proxy.type}://${proxy.host}:${proxy.port}`
      );
      
      return true;
    } catch (error) {
      this.settingsManager.logAction(
        'error',
        'Proxy test failed',
        undefined,
        `Proxy: ${proxy.type}://${proxy.host}:${proxy.port}, Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      return false;
    }
  }

  // Create SSH tunnel through existing connection
  async createSSHTunnel(
    tunnelConnection: string,
    localPort: number,
    remoteHost: string,
    remotePort: number
  ): Promise<void> {
    this.settingsManager.logAction(
      'info',
      'SSH tunnel creation initiated',
      tunnelConnection,
      `Local port: ${localPort}, Remote: ${remoteHost}:${remotePort}`
    );

    // This would integrate with the SSH client to create a tunnel
    // For now, we'll simulate the tunnel creation
    
    try {
      // Simulate tunnel creation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.settingsManager.logAction(
        'info',
        'SSH tunnel created successfully',
        tunnelConnection,
        `Tunnel: localhost:${localPort} -> ${remoteHost}:${remotePort}`
      );
    } catch (error) {
      this.settingsManager.logAction(
        'error',
        'SSH tunnel creation failed',
        tunnelConnection,
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  // Proxy Chain Management Methods
  async createProxyChain(
    name: string,
    layers: ProxyConfig[],
    description?: string
  ): Promise<string> {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const chain: ProxyChain = {
      id: chainId,
      name,
      description,
      layers: layers.map((layer, index) => ({
        id: `layer_${index}_${Date.now()}`,
        proxyConfig: layer,
        position: index,
        status: 'pending'
      })),
      status: 'inactive',
      createdAt: new Date(),
    };

    this.chains.set(chainId, chain);

    this.settingsManager.logAction(
      'info',
      'Proxy chain created',
      chainId,
      `Chain: ${name}, Layers: ${layers.length}`
    );

    return chainId;
  }

  async connectProxyChain(
    chainId: string,
    targetHost: string,
    targetPort: number
  ): Promise<number | undefined> {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not found`);
    }

    chain.status = 'connecting';
    let currentTargetHost = targetHost;
    let currentTargetPort = targetPort;
    let finalLocalPort: number | undefined;

    this.settingsManager.logAction(
      'info',
      'Proxy chain connection initiated',
      chainId,
      `Target: ${targetHost}:${targetPort}, Layers: ${chain.layers.length}`
    );

    try {
      // Sort layers by position
      const sortedLayers = chain.layers.sort((a, b) => a.position - b.position);

      for (const layer of sortedLayers) {
        layer.status = 'connecting';

        // Create proxied connection for this layer
        const ws = await this.createProxiedConnection(
          currentTargetHost,
          currentTargetPort,
          layer.proxyConfig
        );

        // For chaining, we need to get the local port that the proxy is listening on
        // This is a simplified implementation - in practice, you'd need to track
        // the actual local ports assigned by each proxy layer
        const localPort = await this.getLocalPortFromWebSocket(ws);
        layer.localPort = localPort;
        layer.status = 'connected';

        // Update targets for next layer
        currentTargetHost = '127.0.0.1';
        currentTargetPort = localPort;
        finalLocalPort = localPort;

        this.settingsManager.logAction(
          'info',
          'Proxy chain layer connected',
          chainId,
          `Layer ${layer.position}: ${layer.proxyConfig.type}://${layer.proxyConfig.host}:${layer.proxyConfig.port} -> localhost:${localPort}`
        );
      }

      chain.status = 'connected';
      chain.connectedAt = new Date();
      chain.finalLocalPort = finalLocalPort;

      this.settingsManager.logAction(
        'info',
        'Proxy chain fully connected',
        chainId,
        `Final local port: ${finalLocalPort}`
      );

      return finalLocalPort;

    } catch (error) {
      chain.status = 'error';
      chain.error = error instanceof Error ? error.message : 'Unknown error';

      // Mark failed layer
      const failedLayer = chain.layers.find(l => l.status === 'connecting');
      if (failedLayer) {
        failedLayer.status = 'failed';
        failedLayer.error = chain.error;
      }

      this.settingsManager.logAction(
        'error',
        'Proxy chain connection failed',
        chainId,
        `Error: ${chain.error}`
      );

      throw error;
    }
  }

  async disconnectProxyChain(chainId: string): Promise<void> {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not found`);
    }

    chain.status = 'disconnecting';

    this.settingsManager.logAction(
      'info',
      'Proxy chain disconnection initiated',
      chainId,
      `Layers: ${chain.layers.length}`
    );

    // Disconnect in reverse order
    const reversedLayers = [...chain.layers].sort((a, b) => b.position - a.position);

    for (const layer of reversedLayers) {
      if (layer.status === 'connected') {
        try {
          // In a real implementation, you'd close the WebSocket connections
          // For now, we'll just mark as disconnected
          layer.status = 'pending';
          layer.localPort = undefined;

          this.settingsManager.logAction(
            'info',
            'Proxy chain layer disconnected',
            chainId,
            `Layer ${layer.position} disconnected`
          );
        } catch (error) {
          console.warn(`Failed to disconnect layer ${layer.id}:`, error);
        }
      }
    }

    chain.status = 'inactive';
    chain.connectedAt = undefined;
    chain.finalLocalPort = undefined;
    chain.error = undefined;

    this.settingsManager.logAction(
      'info',
      'Proxy chain fully disconnected',
      chainId
    );
  }

  async getProxyChain(chainId: string): Promise<ProxyChain | undefined> {
    return this.chains.get(chainId);
  }

  async listProxyChains(): Promise<ProxyChain[]> {
    return Array.from(this.chains.values());
  }

  async deleteProxyChain(chainId: string): Promise<void> {
    const chain = this.chains.get(chainId);
    if (chain && chain.status !== 'inactive') {
      await this.disconnectProxyChain(chainId);
    }
    this.chains.delete(chainId);

    this.settingsManager.logAction(
      'info',
      'Proxy chain deleted',
      chainId
    );
  }

  // Preset Management Methods
  async createProxyChainPreset(
    name: string,
    description: string,
    layers: Omit<ProxyChainLayer, 'id' | 'status' | 'localPort' | 'error'>[],
    tags: string[] = []
  ): Promise<string> {
    const presetId = `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const preset: ProxyChainPreset = {
      id: presetId,
      name,
      description,
      layers,
      tags,
    };

    this.presets.set(presetId, preset);

    this.settingsManager.logAction(
      'info',
      'Proxy chain preset created',
      presetId,
      `Preset: ${name}, Layers: ${layers.length}`
    );

    return presetId;
  }

  async getProxyChainPreset(presetId: string): Promise<ProxyChainPreset | undefined> {
    return this.presets.get(presetId);
  }

  async listProxyChainPresets(): Promise<ProxyChainPreset[]> {
    return Array.from(this.presets.values());
  }

  async deleteProxyChainPreset(presetId: string): Promise<void> {
    this.presets.delete(presetId);

    this.settingsManager.logAction(
      'info',
      'Proxy chain preset deleted',
      presetId
    );
  }

  async createChainFromPreset(
    presetId: string,
    chainName?: string,
    targetHost?: string,
    targetPort?: number
  ): Promise<{ chainId: string; localPort?: number }> {
    const preset = this.presets.get(presetId);
    if (!preset) {
      throw new Error(`Preset ${presetId} not found`);
    }

    const chainId = await this.createProxyChain(
      chainName || `${preset.name} Instance`,
      preset.layers.map(layer => layer.proxyConfig),
      preset.description
    );

    let localPort: number | undefined;
    if (targetHost && targetPort) {
      localPort = await this.connectProxyChain(chainId, targetHost, targetPort);
    }

    return { chainId, localPort };
  }

  // Health monitoring
  async getProxyChainHealth(chainId: string): Promise<{
    overall: 'healthy' | 'degraded' | 'failed';
    layers: Array<{
      id: string;
      position: number;
      status: string;
      healthy: boolean;
      localPort?: number;
      error?: string;
    }>;
  }> {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not found`);
    }

    const layerHealth = chain.layers.map(layer => ({
      id: layer.id,
      position: layer.position,
      status: layer.status,
      healthy: layer.status === 'connected',
      localPort: layer.localPort,
      error: layer.error,
    }));

    const healthyLayers = layerHealth.filter(l => l.healthy).length;
    const overall = healthyLayers === chain.layers.length ? 'healthy' :
                   healthyLayers > 0 ? 'degraded' : 'failed';

    return {
      overall,
      layers: layerHealth,
    };
  }

  // Utility method to extract local port from WebSocket (simplified)
  private async getLocalPortFromWebSocket(ws: WebSocket): Promise<number> {
    // In a real implementation, this would extract the actual local port
    // For now, we'll simulate by finding an available port
    // This is a placeholder - actual implementation would depend on how
    // the WebSocket proxy server assigns local ports
    return new Promise((resolve) => {
      // Simulate async operation
      setTimeout(() => {
        // Return a mock local port - in practice, this would come from the proxy server
        resolve(Math.floor(Math.random() * 10000) + 20000);
      }, 100);
    });
  }

  // Initialize built-in presets
  async initializeBuiltInPresets(): Promise<void> {
    const presets = [
      {
        name: 'Anonymous Browsing Chain',
        description: 'Multi-proxy chain for enhanced anonymity',
        layers: [
          {
            proxyConfig: {
              type: 'socks5' as const,
              host: 'proxy1.example.com',
              port: 1080,
              enabled: true,
            },
            position: 0,
          },
          {
            proxyConfig: {
              type: 'http' as const,
              host: 'proxy2.example.com',
              port: 3128,
              enabled: true,
            },
            position: 1,
          },
        ],
        tags: ['anonymity', 'browsing'],
      },
      {
        name: 'Corporate Access Chain',
        description: 'Corporate proxy with SOCKS fallback',
        layers: [
          {
            proxyConfig: {
              type: 'http' as const,
              host: 'corporate-proxy.company.com',
              port: 8080,
              enabled: true,
              username: 'user',
              password: 'pass',
            },
            position: 0,
          },
          {
            proxyConfig: {
              type: 'socks5' as const,
              host: 'backup-proxy.company.com',
              port: 1080,
              enabled: true,
            },
            position: 1,
          },
        ],
        tags: ['corporate', 'fallback'],
      },
    ];

    for (const preset of presets) {
      await this.createProxyChainPreset(
        preset.name,
        preset.description,
        preset.layers,
        preset.tags
      );
    }
  }
}
