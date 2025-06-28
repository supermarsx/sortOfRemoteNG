import { Connection, ConnectionStatus } from '../types/connection';
import { SettingsManager } from './settingsManager';

export class StatusChecker {
  private static instance: StatusChecker;
  private statusMap = new Map<string, ConnectionStatus>();
  private checkIntervals = new Map<string, NodeJS.Timeout>();
  private settingsManager = SettingsManager.getInstance();

  static getInstance(): StatusChecker {
    if (!StatusChecker.instance) {
      StatusChecker.instance = new StatusChecker();
    }
    return StatusChecker.instance;
  }

  startChecking(connection: Connection): void {
    if (!this.settingsManager.getSettings().enableStatusChecking) return;
    if (!connection.statusCheck?.enabled) return;

    this.stopChecking(connection.id);

    const interval = setInterval(() => {
      this.checkConnection(connection);
    }, (connection.statusCheck?.interval || 30) * 1000);

    this.checkIntervals.set(connection.id, interval);
    
    // Initial check
    this.checkConnection(connection);
  }

  stopChecking(connectionId: string): void {
    const interval = this.checkIntervals.get(connectionId);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(connectionId);
    }
  }

  private async checkConnection(connection: Connection): Promise<void> {
    const startTime = Date.now();
    let status: ConnectionStatus['status'] = 'checking';
    let responseTime: number | undefined;
    let error: string | undefined;

    this.updateStatus(connection.id, {
      connectionId: connection.id,
      status: 'checking',
      lastChecked: new Date(),
    });

    try {
      const method = connection.statusCheck?.method || 'socket';
      const timeout = connection.statusCheck?.timeout || 5000;

      switch (method) {
        case 'socket':
          await this.checkSocket(connection.hostname, connection.port, timeout);
          status = 'online';
          break;
        case 'http':
          await this.checkHttp(connection, timeout);
          status = 'online';
          break;
        case 'ping':
          // Note: Browser ping is limited, using fetch as fallback
          await this.checkHttp(connection, timeout);
          status = 'online';
          break;
        default:
          throw new Error('Unknown check method');
      }

      responseTime = Date.now() - startTime;
    } catch (err) {
      status = 'offline';
      error = err instanceof Error ? err.message : 'Unknown error';
    }

    this.updateStatus(connection.id, {
      connectionId: connection.id,
      status,
      lastChecked: new Date(),
      responseTime,
      error,
    });

    this.settingsManager.logAction(
      status === 'online' ? 'debug' : 'warn',
      'Status check',
      connection.id,
      `Status: ${status}${responseTime ? `, Response time: ${responseTime}ms` : ''}${error ? `, Error: ${error}` : ''}`,
      responseTime
    );
  }

  private async checkSocket(hostname: string, port: number, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use WebSocket for socket checking (limited but works for many protocols)
      const ws = new WebSocket(`ws://${hostname}:${port}`);

      const timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, timeout);
      
      ws.onopen = () => {
        clearTimeout(timeoutId);
        ws.close();
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        ws.close();
        reject(new Error('Connection failed'));
      };

      ws.onclose = (event) => {
        clearTimeout(timeoutId);
        if (event.wasClean) {
          resolve();
        } else {
          reject(new Error('Connection closed unexpectedly'));
        }
      };
    });
  }

  private async checkHttp(connection: Connection, timeout: number): Promise<void> {
    const protocol = connection.protocol === 'https' ? 'https' : 'http';
    const url = `${protocol}://${connection.hostname}:${connection.port}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors', // Avoid CORS issues
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Connection timeout');
      }
      throw error;
    }
  }

  private updateStatus(connectionId: string, status: ConnectionStatus): void {
    this.statusMap.set(connectionId, status);
    
    // Emit status update event
    window.dispatchEvent(new CustomEvent('connectionStatusUpdate', {
      detail: { connectionId, status }
    }));
  }

  getStatus(connectionId: string): ConnectionStatus | undefined {
    return this.statusMap.get(connectionId);
  }

  getAllStatuses(): Map<string, ConnectionStatus> {
    return new Map(this.statusMap);
  }

  cleanup(): void {
    this.checkIntervals.forEach(interval => clearInterval(interval));
    this.checkIntervals.clear();
    this.statusMap.clear();
  }
}