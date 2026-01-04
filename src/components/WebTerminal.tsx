import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ConnectionSession } from '../types/connection';
import { Maximize2, Minimize2, Copy, Download } from 'lucide-react';
import { useConnections } from '../contexts/useConnections';
import { invoke } from '@tauri-apps/api/core';

interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

export const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const { state } = useConnections();
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sshSessionId = useRef<string | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string>('');
  const sshOutputIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentLine, setCurrentLine] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnectingRef = useRef(false);

  // Function to poll for SSH output
  const pollSSHOutput = useCallback(async () => {
    if (!sshSessionId.current || !isConnectedRef.current || !terminal.current) return;

    try {
      const output = await invoke('receive_ssh_output', {
        sessionId: sshSessionId.current
      }) as string;

      if (output && output.length > 0) {
        terminal.current.write(output);
      }
    } catch (error) {
      // Ignore errors when polling - the session might not be ready yet
    }
  }, []);

  // Start polling for SSH output when connected
  useEffect(() => {
    if (isConnected && session.protocol === 'ssh' && !sshOutputIntervalRef.current) {
      const interval = setInterval(pollSSHOutput, 100); // Poll every 100ms
      sshOutputIntervalRef.current = interval;

      return () => {
        clearInterval(interval);
        sshOutputIntervalRef.current = null;
      };
    } else if (!isConnected && sshOutputIntervalRef.current) {
      clearInterval(sshOutputIntervalRef.current);
      sshOutputIntervalRef.current = null;
    }
  }, [isConnected, session.protocol, pollSSHOutput]);

  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);
  const ignoreSshSecurityErrors = connection?.ignoreSshSecurityErrors ?? true;

  const executeCommand = useCallback((command: string) => {
    if (!terminal.current) return;

    const parts = command.split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'ls':
        terminal.current.writeln('Desktop  Documents  Downloads  Pictures  Videos');
        break;
      case 'pwd':
        terminal.current.writeln('/home/user');
        break;
      case 'whoami':
        terminal.current.writeln('user');
        break;
      case 'date':
        terminal.current.writeln(new Date().toString());
        break;
      case 'echo':
        terminal.current.writeln(parts.slice(1).join(' '));
        break;
      case 'clear':
        terminal.current.clear();
        break;
      case 'help':
        terminal.current.writeln('Available commands: ls, pwd, whoami, date, echo, clear, help, exit');
        break;
      case 'exit':
        terminal.current.writeln('logout');
        setIsConnected(false);
        break;
      default:
        terminal.current.writeln(`Command not found: ${cmd}`);
        break;
    }

    if (cmd !== 'clear' && cmd !== 'exit') {
      terminal.current.write('\x1b[33m$ \x1b[0m');
    }
  }, []);

  const processCommand = useCallback((command: string) => {
    if (!terminal.current) return;

    const cmd = command.trim();
    if (cmd === '') {
      terminal.current.write('\x1b[33m$ \x1b[0m');
      return;
    }

    // Simulate command execution
    setTimeout(() => {
      executeCommand(cmd);
    }, 100);
  }, [executeCommand]);

  const handleNonSSHInput = useCallback((data: string) => {
    if (!terminal.current) return;

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const charCode = char.charCodeAt(0);

      switch (charCode) {
        case 13: // Enter (CR)
          terminal.current.write('\r\n');
          processCommand(currentLine);
          setCurrentLine('');
          break;
        case 127: // Backspace
          if (currentLine.length > 0) {
            setCurrentLine(currentLine.slice(0, -1));
            terminal.current.write('\b \b');
          }
          break;
        case 3: // Ctrl+C
          terminal.current.write('^C\r\n\x1b[33m$ \x1b[0m');
          setCurrentLine('');
          break;
        case 4: // Ctrl+D
          terminal.current.write('logout\r\n');
          break;
        default:
          if (charCode >= 32 && charCode <= 126) { // Printable characters
            setCurrentLine(currentLine + char);
            terminal.current.write(char);
          }
          break;
      }
    }
  }, [currentLine, processCommand]);

  const initializeSSHConnection = useCallback(async () => {
    if (!terminal.current || !connection) return;

    try {
      setIsConnecting(true);
      setConnectionError('');
      terminal.current.writeln('\x1b[36mConnecting to SSH server...\x1b[0m');
      terminal.current.writeln('\x1b[90mHost: ' + session.hostname + '\x1b[0m');
      terminal.current.writeln('\x1b[90mPort: ' + (connection.port || 22) + '\x1b[0m');
      terminal.current.writeln('\x1b[90mUser: ' + (connection.username || 'unknown') + '\x1b[0m');

      // Determine authentication method based on authType
      let authMethod = 'password'; // default
      if (connection.authType) {
        authMethod = connection.authType;
      } else if (connection.privateKey) {
        authMethod = 'key';
      }

      terminal.current.writeln('\x1b[90mAuth: ' + authMethod + '\x1b[0m');

      // Prepare SSH connection config based on authentication method
      const sshConfig: any = {
        host: session.hostname,
        port: connection.port || 22,
        username: connection.username || '',
        jump_hosts: [],
        proxy_config: null,
        openvpn_config: null,
        connect_timeout: 30000,
        keep_alive_interval: 60,
        strict_host_key_checking: !ignoreSshSecurityErrors,
        known_hosts_path: null,
      };

      // Set authentication parameters based on method
      switch (authMethod) {
        case 'password':
          if (!connection.password) {
            throw new Error('Password authentication selected but no password provided');
          }
          sshConfig.password = connection.password;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;

        case 'key':
          if (!connection.privateKey) {
            throw new Error('Key authentication selected but no private key provided');
          }
          sshConfig.password = null;
          sshConfig.private_key_path = connection.privateKey;
          sshConfig.private_key_passphrase = connection.passphrase || null;
          break;

        case 'totp':
          if (!connection.password || !connection.totpSecret) {
            throw new Error('TOTP authentication requires both password and TOTP secret');
          }
          sshConfig.password = connection.password;
          sshConfig.totp_secret = connection.totpSecret;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;

        default:
          throw new Error(`Unsupported authentication method: ${authMethod}`);
      }

      // Connect to SSH server
      const sessionId = await invoke('connect_ssh', { config: sshConfig }) as string;
      sshSessionId.current = sessionId;

      if (!terminal.current) return;
      terminal.current.writeln('\x1b[32mSSH connection established\x1b[0m');

      // Start the shell
      await invoke('start_shell', { sessionId });
      if (!terminal.current) return;
      terminal.current.writeln('\x1b[32mShell started successfully\x1b[0m');
      terminal.current.write('\x1b[33m$ \x1b[0m');

      setIsConnected(true);
      isConnectedRef.current = true;
      setIsConnecting(false);

    } catch (error: any) {
      console.error('SSH connection failed:', error);
      setIsConnecting(false);

      // Handle different types of authentication errors
      let errorMessage = 'SSH connection failed';
      const errorString = error?.toString() || error?.message || '';

      if (errorString.includes('All authentication methods failed')) {
        errorMessage = 'Authentication failed - please check your credentials and authentication method';
      } else if (errorString.includes('Authentication failed')) {
        errorMessage = 'Authentication failed - please check your credentials';
      } else if (errorString.includes('Connection refused')) {
        errorMessage = 'Connection refused - please check the host and port';
      } else if (errorString.includes('timeout')) {
        errorMessage = 'Connection timeout - please check network connectivity';
      } else if (errorString.includes('Host key verification failed')) {
        errorMessage = 'Host key verification failed - server may have changed';
      } else if (errorString.includes('No such file or directory') && errorString.includes('private key')) {
        errorMessage = 'Private key file not found - please check the key path';
      } else if (errorString.includes('Permission denied')) {
        errorMessage = 'Permission denied - please check your credentials';
      }

      setConnectionError(errorMessage);
      terminal.current?.writeln(`\x1b[31m${errorMessage}\x1b[0m`);
      terminal.current?.writeln('\x1b[33m$ \x1b[0m');
    }
  }, [session.hostname, connection, ignoreSshSecurityErrors]);

  useEffect(() => {
    const terminalElement = terminalRef.current;
    if (!terminalElement) return;

    // Initialize terminal with proper settings for SSH
    terminal.current = new Terminal({
      theme: {
        background: '#1f2937',
        foreground: '#f9fafb',
        cursor: '#60a5fa',
        selectionBackground: '#374151',
        black: '#1f2937',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f9fafb',
        brightBlack: '#374151',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      tabStopWidth: 4,
      convertEol: false, // Let SSH handle line endings
      allowTransparency: false,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      scrollSensitivity: 1,
      macOptionIsMeta: true,
      rightClickSelectsWord: false,
      wordSeparator: ' ()[]{}\'"`',
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(new WebLinksAddon());

    if (terminalElement?.parentElement) {
      terminal.current.open(terminalElement);
      terminal.current.focus();

      // Delay the fit operation to ensure terminal is fully initialized
      setTimeout(() => {
        if (fitAddon.current && terminal.current) {
          try {
            fitAddon.current.fit();
          } catch (error) {
            console.warn('Failed to fit terminal:', error);
          }
        }
      }, 100);
    } else {
      console.error('Terminal requires parent element');
    }

    // Initialize SSH connection for SSH protocol
    if (session.protocol === 'ssh') {
      initializeSSHConnection();
    } else {
      // For other protocols, show a simple terminal interface
      terminal.current.writeln('\x1b[32mTerminal ready for ' + session.protocol.toUpperCase() + ' session\x1b[0m');
      terminal.current.writeln('\x1b[36mConnected to: ' + session.hostname + '\x1b[0m');
      terminal.current.write('\x1b[33m$ \x1b[0m');
      setIsConnected(true);
      isConnectedRef.current = true;
    }

    // Handle terminal input
    const dataDisposable = terminal.current.onData(async (data) => {
      if (session.protocol === 'ssh') {
        // For SSH connections, send all input directly to the SSH session
        if (sshSessionId.current && isConnectedRef.current && !isConnectingRef.current) {
          try {
            await invoke('send_ssh_input', {
              sessionId: sshSessionId.current,
              data: data
            });
          } catch (error) {
            console.error('Failed to send SSH input:', error);
          }
        }
        // Ignore input while connecting
      } else {
        // For non-SSH protocols, handle input locally
        handleNonSSHInput(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
          const { cols, rows } = terminal.current;
          onResize?.(cols, rows);
          // TODO: Implement resize for SSH sessions if needed
        } catch (error) {
          console.warn('Failed to resize terminal:', error);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      dataDisposable.dispose();

      // Clear SSH output polling
      if (sshOutputIntervalRef.current) {
        clearInterval(sshOutputIntervalRef.current);
        sshOutputIntervalRef.current = null;
      }

      // Disconnect SSH session if connected
      if (sshSessionId.current && isConnectedRef.current) {
        invoke('disconnect_ssh', { sessionId: sshSessionId.current }).catch((error) => {
          console.error('Failed to disconnect SSH session:', error);
        });
        sshSessionId.current = null;
      }

      if (terminal.current) {
        terminal.current.dispose();
      }
      if (terminalElement) {
        terminalElement.innerHTML = '';
      }
      terminal.current = null;
      fitAddon.current = null;
      setIsConnected(false);
      isConnectedRef.current = false;
      setConnectionError('');
      setCurrentLine('');
      setIsConnecting(false);
    };
  }, [session.protocol, session.hostname, handleNonSSHInput, initializeSSHConnection, onResize]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    }, 100);
  };

  const copySelection = () => {
    if (terminal.current) {
      const selection = terminal.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (terminal.current && session.protocol === 'ssh') {
        if (sshSessionId.current && isConnectedRef.current) {
          await invoke('send_ssh_input', {
            sessionId: sshSessionId.current,
            data: text
          });
        }
      } else if (terminal.current) {
        // For non-SSH, handle paste character by character
        for (const char of text) {
          handleNonSSHInput(char);
        }
      }
    } catch (error) {
      console.error('Failed to paste from clipboard:', error);
    }
  };

  return (
    <div className={`flex flex-col bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-100">
                {session.name || "Terminal"}
              </div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">
                {session.protocol.toUpperCase()} • {session.hostname}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={copySelection}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Copy selection"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={pasteFromClipboard}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Paste"
            >
              <Download size={14} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
          {isConnecting && (
            <span className="text-yellow-300 bg-yellow-400/20 px-2 py-0.5 rounded">
              Connecting
            </span>
          )}
          {isConnected && (
            <span className="text-green-300 bg-green-400/20 px-2 py-0.5 rounded">
              Connected
            </span>
          )}
          {connectionError && (
            <span className="text-red-300 bg-red-400/20 px-2 py-0.5 rounded">
              Error: {connectionError}
            </span>
          )}
          {connection && session.protocol === 'ssh' && (
            <span className="text-blue-300 bg-blue-400/20 px-2 py-0.5 rounded">
              SSH lib: Rust
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 p-3 min-h-0">
        <div
          ref={terminalRef}
          className="w-full h-full rounded-md border border-gray-700 bg-gray-900 min-h-0"
          style={{ minHeight: '320px' }}
        />
      </div>
    </div>
  );
};
