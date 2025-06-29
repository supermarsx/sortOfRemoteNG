import { SSHLibraryFactory, BaseSSHClient, SSHLibraryType, SSHLibraryConfig } from './sshLibraries';

interface SSHConfig extends SSHLibraryConfig {
  library?: SSHLibraryType;
}

interface SSHClientCallbacks {
  onData: (data: string) => void;
  onConnect: () => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export class SSHClient {
  private config: SSHConfig;
  private callbacks: Partial<SSHClientCallbacks> = {};
  private client: BaseSSHClient;

  constructor(config: SSHConfig) {
    this.config = config;
    this.client = SSHLibraryFactory.createClient(config.library || 'node-ssh', config);
  }

  onData(callback: (data: string) => void) {
    this.callbacks.onData = callback;
  }

  onConnect(callback: () => void) {
    this.callbacks.onConnect = callback;
  }

  onError(callback: (error: string) => void) {
    this.callbacks.onError = callback;
  }

  onClose(callback: () => void) {
    this.callbacks.onClose = callback;
  }

  async connect(): Promise<void> {
    this.client.onData(data => this.callbacks.onData?.(data));
    this.client.onConnect(() => this.callbacks.onConnect?.());
    this.client.onError(err => this.callbacks.onError?.(err));
    this.client.onClose(() => this.callbacks.onClose?.());
    await this.client.connect();
  }

  sendData(data: string): void {
    this.client.sendData(data);
  }

  resize(cols: number, rows: number): void {
    this.client.resize(cols, rows);
  }

  disconnect(): void {
    this.client.disconnect();
  }
}
