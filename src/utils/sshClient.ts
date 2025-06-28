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
  private commandBuffer = '';
  private currentDirectory = '~';

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
    
    // Send welcome message with proper formatting
    setTimeout(() => {
      this.callbacks.onData?.('\r\n');
      this.callbacks.onData?.(`Welcome to ${this.config.host}\r\n`);
      this.callbacks.onData?.(this.getMotd());
      this.callbacks.onData?.(`\x1b[32m${this.config.username}@${this.config.host}\x1b[0m:\x1b[34m${this.currentDirectory}\x1b[0m$ `);
    }, 500);
  }

  private getMotd(): string {
    const now = new Date();
    return `Last login: ${now.toLocaleString()}
Ubuntu 22.04.3 LTS

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/advantage

System information as of ${now.toLocaleString()}:

  System load:  0.08              Processes:             123
  Usage of /:   45.2% of 9.78GB   Users logged in:       1
  Memory usage: 23%               IPv4 address for eth0: ${this.config.host}
  Swap usage:   0%

`;
  }

  sendData(data: string): void {
    if (!this.isConnected) return;

    // Process each character
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const charCode = char.charCodeAt(0);

      switch (charCode) {
        case 13: // Enter (CR)
          this.callbacks.onData?.('\r\n');
          this.processCommand(this.commandBuffer.trim());
          this.commandBuffer = '';
          break;
        case 127: // Backspace
          if (this.commandBuffer.length > 0) {
            this.commandBuffer = this.commandBuffer.slice(0, -1);
            this.callbacks.onData?.('\b \b');
          }
          break;
        case 3: // Ctrl+C
          this.callbacks.onData?.('^C\r\n');
          this.commandBuffer = '';
          this.showPrompt();
          break;
        case 4: // Ctrl+D (EOF)
          if (this.commandBuffer.length === 0) {
            this.callbacks.onData?.('logout\r\n');
            this.disconnect();
            return;
          }
          break;
        case 9: // Tab
          this.handleTabCompletion();
          break;
        case 27: // Escape sequences (arrow keys, etc.)
          this.handleEscapeSequence(data, i);
          break;
        default:
          if (charCode >= 32 && charCode <= 126) { // Printable characters
            this.commandBuffer += char;
            this.callbacks.onData?.(char);
          }
          break;
      }
    }
  }

  private handleEscapeSequence(data: string, index: number): void {
    // Handle arrow keys and other escape sequences
    if (index + 2 < data.length && data[index + 1] === '[') {
      const key = data[index + 2];
      switch (key) {
        case 'A': // Up arrow
          // TODO: Implement command history
          break;
        case 'B': // Down arrow
          // TODO: Implement command history
          break;
        case 'C': // Right arrow
          // TODO: Implement cursor movement
          break;
        case 'D': // Left arrow
          // TODO: Implement cursor movement
          break;
      }
    }
  }

  private handleTabCompletion(): void {
    // Simple tab completion for common commands
    const commonCommands = ['ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv'];
    const matches = commonCommands.filter(cmd => cmd.startsWith(this.commandBuffer));
    
    if (matches.length === 1) {
      const completion = matches[0].substring(this.commandBuffer.length);
      this.commandBuffer += completion;
      this.callbacks.onData?.(completion);
    } else if (matches.length > 1) {
      this.callbacks.onData?.('\r\n');
      this.callbacks.onData?.(matches.join('  ') + '\r\n');
      this.showPrompt();
      this.callbacks.onData?.(this.commandBuffer);
    }
  }

  private processCommand(command: string): void {
    if (command === '') {
      this.showPrompt();
      return;
    }

    // Simulate command execution delay
    setTimeout(() => {
      this.executeCommand(command);
    }, 50);
  }

  private executeCommand(command: string): void {
    const parts = command.split(' ').filter(part => part.length > 0);
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'ls':
        this.handleLsCommand(args);
        break;
      case 'pwd':
        this.callbacks.onData?.(`${this.currentDirectory}\r\n`);
        break;
      case 'cd':
        this.handleCdCommand(args);
        break;
      case 'whoami':
        this.callbacks.onData?.(`${this.config.username}\r\n`);
        break;
      case 'date':
        this.callbacks.onData?.(`${new Date().toString()}\r\n`);
        break;
      case 'uname':
        if (args.includes('-a')) {
          this.callbacks.onData?.('Linux ubuntu 5.15.0-72-generic #79-Ubuntu SMP Wed Apr 19 08:22:18 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux\r\n');
        } else {
          this.callbacks.onData?.('Linux\r\n');
        }
        break;
      case 'echo':
        this.callbacks.onData?.(`${args.join(' ')}\r\n`);
        break;
      case 'cat':
        this.handleCatCommand(args);
        break;
      case 'clear':
        this.callbacks.onData?.('\x1b[2J\x1b[H');
        break;
      case 'help':
        this.callbacks.onData?.('Available commands: ls, pwd, cd, whoami, date, uname, echo, cat, clear, help, exit, logout\r\n');
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

    this.showPrompt();
  }

  private handleLsCommand(args: string[]): void {
    const showHidden = args.includes('-a') || args.includes('-la') || args.includes('-al');
    const longFormat = args.includes('-l') || args.includes('-la') || args.includes('-al');

    let files = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'];
    
    if (showHidden) {
      files = ['.', '..', '.bashrc', '.profile', '.ssh', ...files];
    }

    if (longFormat) {
      this.callbacks.onData?.('total 24\r\n');
      files.forEach(file => {
        const isHidden = file.startsWith('.');
        const permissions = isHidden ? '-rw-r--r--' : 'drwxr-xr-x';
        const size = isHidden ? '1024' : '4096';
        const date = 'Jan 15 10:30';
        this.callbacks.onData?.(`${permissions} 1 ${this.config.username} ${this.config.username} ${size.padStart(8)} ${date} ${file}\r\n`);
      });
    } else {
      this.callbacks.onData?.(`${files.join('  ')}\r\n`);
    }
  }

  private handleCdCommand(args: string[]): void {
    if (args.length === 0) {
      this.currentDirectory = '~';
    } else {
      const path = args[0];
      if (path === '..') {
        if (this.currentDirectory !== '~' && this.currentDirectory !== '/') {
          const parts = this.currentDirectory.split('/');
          parts.pop();
          this.currentDirectory = parts.join('/') || '/';
        }
      } else if (path.startsWith('/')) {
        this.currentDirectory = path;
      } else {
        if (this.currentDirectory === '~') {
          this.currentDirectory = `~/${path}`;
        } else {
          this.currentDirectory = `${this.currentDirectory}/${path}`;
        }
      }
    }
  }

  private handleCatCommand(args: string[]): void {
    if (args.length === 0) {
      this.callbacks.onData?.('cat: missing file operand\r\n');
      return;
    }

    const filename = args[0];
    switch (filename) {
      case '.bashrc':
        this.callbacks.onData?.('# ~/.bashrc: executed by bash(1) for non-login shells.\r\n');
        this.callbacks.onData?.('# see /usr/share/doc/bash/examples/startup-files\r\n');
        break;
      case '/etc/passwd':
        this.callbacks.onData?.(`root:x:0:0:root:/root:/bin/bash\r\n`);
        this.callbacks.onData?.(`${this.config.username}:x:1000:1000::/home/${this.config.username}:/bin/bash\r\n`);
        break;
      default:
        this.callbacks.onData?.(`cat: ${filename}: No such file or directory\r\n`);
        break;
    }
  }

  private showPrompt(): void {
    this.callbacks.onData?.(`\x1b[32m${this.config.username}@${this.config.host}\x1b[0m:\x1b[34m${this.currentDirectory}\x1b[0m$ `);
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