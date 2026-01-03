import { debugLog } from './debugLogger';
// SSH Library Abstraction Layer
export interface SSHLibraryConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;
}

export interface SSHLibraryCallbacks {
  onData: (data: string) => void;
  onConnect: () => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export type SSHLibraryType = 'node-ssh' | 'ssh2' | 'ssh3' | 'simple-ssh' | 'webssh' | 'websocket';

export abstract class BaseSSHClient {
  protected config: SSHLibraryConfig;
  protected callbacks: Partial<SSHLibraryCallbacks> = {};
  protected isConnected = false;

  constructor(config: SSHLibraryConfig) {
    this.config = config;
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

  abstract connect(): Promise<void>;
  abstract sendData(data: string): void;
  abstract resize(cols: number, rows: number): void;
  abstract disconnect(): void;
}

// Node-SSH 13.2.1 Implementation
export class NodeSSHClient extends BaseSSHClient {
  private ssh: any = null;
  private shell: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        this.callbacks.onError?.('NodeSSHClient is not supported in the browser');
        return;
      }
      // Import node-ssh dynamically (ignored by Vite to avoid bundling)
      const { NodeSSH } = await import(/* @vite-ignore */ 'node-ssh');
      this.ssh = new NodeSSH();

      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.timeout || 20000,
      };

      if (this.config.privateKey) {
        connectionConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectionConfig.passphrase = this.config.passphrase;
        }
      } else if (this.config.password) {
        connectionConfig.password = this.config.password;
      }

      await this.ssh.connect(connectionConfig);
      
      // Request shell
      this.shell = await this.ssh.requestShell({
        cols: 80,
        rows: 24,
        term: 'xterm-256color',
      });

      this.shell.on('data', (data: Buffer) => {
        this.callbacks.onData?.(data.toString());
      });

      this.shell.on('close', () => {
        this.isConnected = false;
        this.callbacks.onClose?.();
      });

      this.shell.on('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
      });

      this.isConnected = true;
      this.callbacks.onConnect?.();
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Node-SSH connection failed');
    }
  }

  sendData(data: string): void {
    if (this.shell && this.isConnected) {
      this.shell.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.shell && this.isConnected) {
      this.shell.setWindow(rows, cols);
    }
  }

  disconnect(): void {
    if (this.shell) {
      this.shell.end();
    }
    if (this.ssh) {
      this.ssh.dispose();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// SSH2 Library Implementation
export class SSH2Client extends BaseSSHClient {
  private connection: any = null;
  private stream: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        this.callbacks.onError?.('SSH2Client is not supported in the browser');
        return;
      }
      // Import ssh2 dynamically (ignored by Vite to avoid bundling)
      const { Client } = await import(/* @vite-ignore */ 'ssh2');
      this.connection = new Client();

      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.timeout || 20000,
      };

      if (this.config.privateKey) {
        connectionConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectionConfig.passphrase = this.config.passphrase;
        }
      } else if (this.config.password) {
        connectionConfig.password = this.config.password;
      }

      this.connection.on('ready', () => {
        this.connection.shell((err: Error, stream: any) => {
          if (err) {
            this.callbacks.onError?.(err.message);
            return;
          }

          this.stream = stream;
          
          stream.on('data', (data: Buffer) => {
            this.callbacks.onData?.(data.toString());
          });

          stream.on('close', () => {
            this.isConnected = false;
            this.callbacks.onClose?.();
          });

          stream.on('error', (error: Error) => {
            this.callbacks.onError?.(error.message);
          });

          this.isConnected = true;
          this.callbacks.onConnect?.();
        });
      });

      this.connection.on('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
      });

      this.connection.connect(connectionConfig);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'SSH2 connection failed');
    }
  }

  sendData(data: string): void {
    if (this.stream && this.isConnected) {
      this.stream.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.stream && this.isConnected) {
      this.stream.setWindow(rows, cols);
    }
  }

  disconnect(): void {
    if (this.stream) {
      this.stream.end();
    }
    if (this.connection) {
      this.connection.end();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// Simple-SSH Library Implementation
export class SimpleSSHClient extends BaseSSHClient {
  private ssh: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        this.callbacks.onError?.('SimpleSSHClient is not supported in the browser');
        return;
      }
      // Import simple-ssh dynamically (ignored by Vite to avoid bundling)
      const SSH = await import(/* @vite-ignore */ 'simple-ssh');
      
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        user: this.config.username,
      };

      if (this.config.privateKey) {
        connectionConfig.key = this.config.privateKey;
        if (this.config.passphrase) {
          connectionConfig.passphrase = this.config.passphrase;
        }
      } else if (this.config.password) {
        connectionConfig.pass = this.config.password;
      }

      this.ssh = new SSH.default(connectionConfig);

      this.ssh.on('connect', () => {
        this.isConnected = true;
        this.callbacks.onConnect?.();
      });

      this.ssh.on('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
      });

      this.ssh.on('close', () => {
        this.isConnected = false;
        this.callbacks.onClose?.();
      });

      // Start shell session
      this.ssh.exec('bash', {
        out: (stdout: string) => {
          this.callbacks.onData?.(stdout);
        },
        err: (stderr: string) => {
          this.callbacks.onData?.(stderr);
        },
      });

      await new Promise((resolve, reject) => {
        this.ssh.start({
          success: resolve,
          fail: reject,
        });
      });
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Simple-SSH connection failed');
    }
  }

  sendData(data: string): void {
    if (this.ssh && this.isConnected) {
      // Simple-SSH doesn't support interactive shell input in the same way
      // This is a limitation of the library
      debugLog('Simple-SSH: Sending data:', data);
    }
  }

  resize(cols: number, rows: number): void {
    debugLog(`Simple-SSH: Terminal resized to ${cols}x${rows}`);
  }

  disconnect(): void {
    if (this.ssh) {
      this.ssh.end();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// SSH3 Compatibility Layer (Extended Protocol Support)
export class SSH3Client extends BaseSSHClient {
  private ssh2Client: SSH2Client;
  private protocolVersion: number = 2;
  private extendedFeatures: boolean = false;

  constructor(config: SSHLibraryConfig) {
    super(config);
    // SSH3 is backward compatible with SSH2, so we use SSH2Client as base
    this.ssh2Client = new SSH2Client(config);
  }

  async connect(): Promise<void> {
    try {
      debugLog('SSH3: Initializing compatibility layer');

      // Set up extended feature detection
      this.ssh2Client.onConnect(() => {
        this.isConnected = true;
        // Detect if server supports SSH3 features
        this.detectExtendedFeatures();
        this.callbacks.onConnect?.();
      });

      this.ssh2Client.onData((data: string) => {
        // Process data through SSH3 compatibility layer
        const processedData = this.processSSH3Data(data);
        this.callbacks.onData?.(processedData);
      });

      this.ssh2Client.onError((error: string) => {
        this.callbacks.onError?.(error);
      });

      this.ssh2Client.onClose(() => {
        this.isConnected = false;
        this.callbacks.onClose?.();
      });

      await this.ssh2Client.connect();

    } catch (error) {
      debugLog('SSH3: Connection failed:', error);
      this.callbacks.onError?.(error instanceof Error ? error.message : 'SSH3 connection failed');
    }
  }

  private detectExtendedFeatures(): void {
    // Send SSH3 feature detection probe
    if (this.ssh2Client && this.isConnected) {
      // In a real implementation, this would send protocol version negotiation
      // For now, we assume SSH2 compatibility
      this.protocolVersion = 2;
      this.extendedFeatures = false;
      debugLog('SSH3: Detected SSH2 protocol, extended features disabled');
    }
  }

  private processSSH3Data(data: string): string {
    // Process data through SSH3 compatibility layer
    // This could include extended encoding, compression, or other features
    if (this.extendedFeatures) {
      // Apply SSH3-specific processing
      debugLog('SSH3: Processing data with extended features');
      return data; // For now, pass through
    }
    return data;
  }

  sendData(data: string): void {
    if (this.ssh2Client && this.isConnected) {
      // Apply SSH3 encoding if extended features are available
      const processedData = this.extendedFeatures ? this.encodeSSH3Data(data) : data;
      this.ssh2Client.sendData(processedData);
    }
  }

  private encodeSSH3Data(data: string): string {
    // SSH3-specific encoding (placeholder for future implementation)
    debugLog('SSH3: Encoding data with extended protocol');
    return data; // For now, pass through
  }

  resize(cols: number, rows: number): void {
    if (this.ssh2Client && this.isConnected) {
      this.ssh2Client.resize(cols, rows);
    }
  }

  disconnect(): void {
    if (this.ssh2Client) {
      this.ssh2Client.disconnect();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }

  // SSH3-specific methods
  getProtocolVersion(): number {
    return this.protocolVersion;
  }

  hasExtendedFeatures(): boolean {
    return this.extendedFeatures;
  }

  enableExtendedFeatures(): void {
    if (this.protocolVersion >= 3) {
      this.extendedFeatures = true;
      debugLog('SSH3: Extended features enabled');
    } else {
      debugLog('SSH3: Extended features not supported by server');
    }
  }
}

// WebSocket SSH Implementation (fallback)
export class WebSocketSSHClient extends BaseSSHClient {
  private websocket: WebSocket | null = null;

  async connect(): Promise<void> {
    try {
      // Connect to WebSocket SSH proxy
      const wsUrl = `ws://${this.config.host}:${this.config.port || 22}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        // Send authentication
        const authData = {
          type: 'auth',
          username: this.config.username,
          password: this.config.password,
          privateKey: this.config.privateKey,
          passphrase: this.config.passphrase,
        };
        this.websocket?.send(JSON.stringify(authData));
      };

      this.websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'auth_success') {
          this.isConnected = true;
          this.callbacks.onConnect?.();
        } else if (data.type === 'auth_error') {
          this.callbacks.onError?.(data.message);
        } else if (data.type === 'data') {
          this.callbacks.onData?.(data.content);
        }
      };

      this.websocket.onerror = () => {
        this.callbacks.onError?.('WebSocket connection failed');
      };

      this.websocket.onclose = () => {
        this.isConnected = false;
        this.callbacks.onClose?.();
      };
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'WebSocket SSH connection failed');
    }
  }

  sendData(data: string): void {
    if (this.websocket && this.isConnected) {
      this.websocket.send(JSON.stringify({
        type: 'input',
        data: data,
      }));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.websocket && this.isConnected) {
      this.websocket.send(JSON.stringify({
        type: 'resize',
        cols: cols,
        rows: rows,
      }));
    }
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// WebSSH2 Frontend Implementation
export class WebSSHClientFrontend extends BaseSSHClient {
  private terminal: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window === 'undefined') {
        this.callbacks.onError?.('WebSSHClientFrontend is only supported in the browser');
        return;
      }

      const { WebSSHTerminal } = await import('webssh2-frontend');
      const container = document.createElement('div');
      document.body.appendChild(container);

      this.terminal = new WebSSHTerminal(container, {
        socketUrl: `http://${this.config.host}:${this.config.port || 22}`,
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        onConnected: () => {
          this.isConnected = true;
          this.callbacks.onConnect?.();
        },
        onDisconnected: () => {
          this.isConnected = false;
          this.callbacks.onClose?.();
        },
        onError: (err: string) => {
          this.callbacks.onError?.(err);
        },
        onData: (data: string) => {
          this.callbacks.onData?.(data);
        }
      });

      this.terminal.connect();
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'WebSSH connection failed');
    }
  }

  sendData(data: string): void {
    this.terminal?.sendData(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal?.resize(cols, rows);
  }

  disconnect(): void {
    this.terminal?.disconnect();
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// SSH Library Factory
export class SSHLibraryFactory {
  static createClient(type: SSHLibraryType, config: SSHLibraryConfig): BaseSSHClient {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser && type !== 'webssh') {
      console.warn(`SSH library "${type}" is not supported in the browser, falling back to webssh`);
      type = 'webssh';
    }
    switch (type) {
      case 'node-ssh':
        return new NodeSSHClient(config);
      case 'ssh2':
        return new SSH2Client(config);
      case 'ssh3':
        return new SSH3Client(config);
      case 'simple-ssh':
        return new SimpleSSHClient(config);
      case 'webssh':
        return new WebSSHClientFrontend(config);
      case 'websocket':
      default:
        return new WebSocketSSHClient(config);
    }
  }
}
