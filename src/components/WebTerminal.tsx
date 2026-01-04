import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ConnectionSession } from '../types/connection';
import { Maximize2, Minimize2, Copy, Download, Upload } from 'lucide-react';
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
  const [commandBuffer, setCommandBuffer] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

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

      // Prepare SSH connection config
      const sshConfig = {
        host: session.hostname,
        port: connection.port || 22,
        username: connection.username || '',
        password: connection.password || null,
        private_key_path: connection.privateKey || null,
        private_key_passphrase: connection.passphrase || null,
        jump_hosts: [],
        proxy_config: null,
        openvpn_config: null,
        connect_timeout: 30000,
        keep_alive_interval: 60,
        strict_host_key_checking: false,
        known_hosts_path: null,
      };

      // Connect to SSH server
      const sessionId = await invoke('connect_ssh', { config: sshConfig }) as string;
      sshSessionId.current = sessionId;

      terminal.current.writeln('\x1b[32mSSH connection established\x1b[0m');

      // Start the shell
      await invoke('start_shell', { sessionId });
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
      if (error.includes && error.includes('Authentication failed')) {
        errorMessage = 'Authentication failed - please check your credentials';
      } else if (error.includes && error.includes('Connection refused')) {
        errorMessage = 'Connection refused - please check the host and port';
      } else if (error.includes && error.includes('timeout')) {
        errorMessage = 'Connection timeout - please check network connectivity';
      } else if (error.includes && error.includes('Host key verification failed')) {
        errorMessage = 'Host key verification failed - server may have changed';
      }

      setConnectionError(errorMessage);
      terminal.current?.writeln(`\x1b[31m${errorMessage}\x1b[0m`);
      terminal.current?.writeln('\x1b[33m$ \x1b[0m');
    }
  }, [session.id, session.connectionId, session.hostname, connection]);

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
        if (sshSessionId.current && isConnectedRef.current && !isConnecting) {
          // Handle special keys
          if (data === '\r' || data === '\n') {
            // Enter pressed - execute command
            try {
              terminal.current?.writeln(''); // New line
              if (commandBuffer.trim()) {
                const output = await invoke('execute_command', {
                  sessionId: sshSessionId.current,
                  command: commandBuffer.trim(),
                  timeout: 30000
                }) as string;
                terminal.current?.write(output);
              }
              terminal.current?.write('\x1b[33m$ \x1b[0m');
              setCommandBuffer('');
            } catch (error) {
              console.error('Failed to execute SSH command:', error);
              terminal.current?.writeln('\x1b[31mCommand execution failed\x1b[0m');
              terminal.current?.write('\x1b[33m$ \x1b[0m');
              setCommandBuffer('');
            }
          } else if (data === '\x7f' || data === '\b') {
            // Backspace
            if (commandBuffer.length > 0) {
              const newBuffer = commandBuffer.slice(0, -1);
              setCommandBuffer(newBuffer);
              terminal.current?.write('\b \b');
            }
          } else if (data >= ' ' && data <= '~') {
            // Printable character
            const newBuffer = commandBuffer + data;
            setCommandBuffer(newBuffer);
            terminal.current?.write(data);
          }
          // Ignore other control characters for now
        }
        // ignore input while connecting
      } else {
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
      setCommandBuffer('');
    };
  }, [session.id, session.protocol, session.hostname, handleNonSSHInput, initializeSSHConnection, onResize]);

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
      if (terminal.current && websocket.current && isConnected) {
        // Send paste data through WebSocket for SSH connections
        websocket.current.send(JSON.stringify({
          type: 'data',
          data: text
        }));
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
      {/* Terminal Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex space-x-1">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
          </div>
          <span className="text-sm text-gray-300">
            {session.name} - {session.hostname}
          </span>
          {isConnected && (
            <span className="text-xs text-green-400 bg-green-400/20 px-2 py-1 rounded">
              Connected
            </span>
          )}
          {connectionError && (
            <span className="text-xs text-red-400 bg-red-400/20 px-2 py-1 rounded">
              Error: {connectionError}
            </span>
          )}
          {connection && session.protocol === 'ssh' && (
            <span className="text-xs text-blue-400 bg-blue-400/20 px-2 py-1 rounded">
              SSH Library: {connection.description?.match(/\[SSH_LIBRARY:([^\]]+)\]/)?.[1] || 'webssh'}
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={copySelection}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Copy selection"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={pasteFromClipboard}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Paste"
          >
            <Download size={14} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 p-2">
        <div
          ref={terminalRef}
          className="w-full h-full rounded border border-gray-700"
          style={{ minHeight: '300px' }}
        />
      </div>
    </div>
  );
};
