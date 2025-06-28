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
      // Import node-ssh dynamically
      const { NodeSSH } = await import('node-ssh');
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
      // Import ssh2 dynamically
      const { Client } = await import('ssh2');
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
      // Import simple-ssh dynamically
      const SSH = await import('simple-ssh');
      
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
      console.log('Simple-SSH: Sending data:', data);
    }
  }

  resize(cols: number, rows: number): void {
    console.log(`Simple-SSH: Terminal resized to ${cols}x${rows}`);
  }

  disconnect(): void {
    if (this.ssh) {
      this.ssh.end();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
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

// SSH Library Factory
export type SSHLibraryType = 'node-ssh' | 'ssh2' | 'simple-ssh' | 'websocket';

export class SSHLibraryFactory {
  static createClient(type: SSHLibraryType, config: SSHLibraryConfig): BaseSSHClient {
    switch (type) {
      case 'node-ssh':
        return new NodeSSHClient(config);
      case 'ssh2':
        return new SSH2Client(config);
      case 'simple-ssh':
        return new SimpleSSHClient(config);
      case 'websocket':
      default:
        return new WebSocketSSHClient(config);
    }
  }
}