interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
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
  private websocket: WebSocket | null = null;
  private isConnected = false;

  constructor(config: SSHConfig) {
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

  async connect(): Promise<void> {
    try {
      // In a real implementation, you would connect to a WebSocket server
      // that handles SSH connections. For now, we'll simulate the connection.
      
      // Simulate connection delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // For demonstration, we'll create a mock SSH session
      this.simulateSSHConnection();
      
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Connection failed');
    }
  }

  private simulateSSHConnection() {
    // Simulate successful connection
    this.isConnected = true;
    this.callbacks.onConnect?.();
    
    // Send welcome message
    setTimeout(() => {
      this.callbacks.onData?.('\r\n');
      this.callbacks.onData?.(`Welcome to ${this.config.host}\r\n`);
      this.callbacks.onData?.(this.getMotd());
      this.callbacks.onData?.(`${this.config.username}@${this.config.host}:~$ `);
    }, 500);
  }

  private getMotd(): string {
    return `
Last login: ${new Date().toLocaleString()}
Ubuntu 22.04.3 LTS

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/advantage

System information as of ${new Date().toLocaleString()}:

  System load:  0.08              Processes:             123
  Usage of /:   45.2% of 9.78GB   Users logged in:       1
  Memory usage: 23%               IPv4 address for eth0: 192.168.1.100
  Swap usage:   0%

`;
  }

  sendData(data: string): void {
    if (!this.isConnected) return;

    // Handle special keys and commands
    if (data === '\r') {
      // Enter key - process command
      this.processCommand();
    } else if (data === '\u007f') {
      // Backspace
      this.callbacks.onData?.('\b \b');
    } else if (data === '\u0003') {
      // Ctrl+C
      this.callbacks.onData?.('^C\r\n');
      this.callbacks.onData?.(`${this.config.username}@${this.config.host}:~$ `);
    } else if (data === '\u0004') {
      // Ctrl+D (EOF)
      this.callbacks.onData?.('logout\r\n');
      this.disconnect();
    } else {
      // Regular character
      this.callbacks.onData?.(data);
    }
  }

  private currentCommand = '';

  private processCommand(): void {
    this.callbacks.onData?.('\r\n');
    
    const command = this.currentCommand.trim();
    this.currentCommand = '';

    if (command === '') {
      this.callbacks.onData?.(`${this.config.username}@${this.config.host}:~$ `);
      return;
    }

    // Simulate command execution
    setTimeout(() => {
      this.executeCommand(command);
    }, 100);
  }

  private executeCommand(command: string): void {
    const parts = command.split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'ls':
        this.callbacks.onData?.('Desktop  Documents  Downloads  Pictures  Videos\r\n');
        break;
      case 'pwd':
        this.callbacks.onData?.(`/home/${this.config.username}\r\n`);
        break;
      case 'whoami':
        this.callbacks.onData?.(`${this.config.username}\r\n`);
        break;
      case 'date':
        this.callbacks.onData?.(`${new Date().toString()}\r\n`);
        break;
      case 'uname':
        if (parts[1] === '-a') {
          this.callbacks.onData?.('Linux ubuntu 5.15.0-72-generic #79-Ubuntu SMP Wed Apr 19 08:22:18 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux\r\n');
        } else {
          this.callbacks.onData?.('Linux\r\n');
        }
        break;
      case 'echo':
        this.callbacks.onData?.(`${parts.slice(1).join(' ')}\r\n`);
        break;
      case 'clear':
        this.callbacks.onData?.('\x1b[2J\x1b[H');
        break;
      case 'help':
        this.callbacks.onData?.('Available commands: ls, pwd, whoami, date, uname, echo, clear, help, exit\r\n');
        break;
      case 'exit':
      case 'logout':
        this.callbacks.onData?.('logout\r\n');
        this.disconnect();
        return;
      default:
        this.callbacks.onData?.(`bash: ${cmd}: command not found\r\n`);
        break;
    }

    this.callbacks.onData?.(`${this.config.username}@${this.config.host}:~$ `);
  }

  resize(cols: number, rows: number): void {
    // In a real implementation, this would send resize information to the SSH server
    console.log(`Terminal resized to ${cols}x${rows}`);
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}