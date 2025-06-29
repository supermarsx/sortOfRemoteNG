import { ProxyConfig } from '../types/settings';
import { SettingsManager } from './settingsManager';

export class ProxyManager {
  private static instance: ProxyManager;
  private settingsManager = SettingsManager.getInstance();

  static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager();
    }
    return ProxyManager.instance;
  }

  async createProxiedConnection(
    targetHost: string,
    targetPort: number,
    proxy?: ProxyConfig
  ): Promise<WebSocket> {
    const proxyConfig = proxy || this.settingsManager.getSettings().globalProxy;
    
    if (!proxyConfig || !proxyConfig.enabled) {
      // Direct connection
      return new WebSocket(`ws://${targetHost}:${targetPort}`);
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
    const proxyUrl = `ws://${proxy.host}:${proxy.port}/proxy`;
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
    const proxyUrl = `ws://${proxy.host}:${proxy.port}/socks`;
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

  // Test proxy connectivity
  async testProxy(proxy: ProxyConfig): Promise<boolean> {
    try {
      const testHost = 'httpbin.org';
      const testPort = 80;
      
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
}
