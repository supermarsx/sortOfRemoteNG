import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { ConnectionSession } from '../types/connection';
import { SSHClient } from '../utils/sshClient';
import { Maximize2, Minimize2, Copy, Download, Upload } from 'lucide-react';

interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

export const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sshClient = useRef<SSHClient | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string>('');

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize terminal
    terminal.current = new Terminal({
      theme: {
        background: '#1f2937',
        foreground: '#f9fafb',
        cursor: '#60a5fa',
        selection: '#374151',
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
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      tabStopWidth: 4,
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(new WebLinksAddon());

    terminal.current.open(terminalRef.current);
    fitAddon.current.fit();

    // Initialize SSH connection for SSH protocol
    if (session.protocol === 'ssh') {
      initializeSSHConnection();
    } else {
      // For other protocols, show a simple terminal interface
      terminal.current.writeln('Terminal ready for ' + session.protocol.toUpperCase() + ' session');
      terminal.current.writeln('Connected to: ' + session.hostname);
      terminal.current.write('$ ');
      setIsConnected(true);
    }

    // Handle terminal input
    terminal.current.onData((data) => {
      if (sshClient.current && isConnected) {
        sshClient.current.sendData(data);
      } else {
        // Echo input for non-SSH connections
        terminal.current?.write(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        fitAddon.current.fit();
        const { cols, rows } = terminal.current;
        onResize?.(cols, rows);
        if (sshClient.current && isConnected) {
          sshClient.current.resize(cols, rows);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (sshClient.current) {
        sshClient.current.disconnect();
      }
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, [session]);

  const initializeSSHConnection = async () => {
    if (!terminal.current) return;

    try {
      terminal.current.writeln('Connecting to SSH server...');
      terminal.current.writeln(`Host: ${session.hostname}`);
      
      sshClient.current = new SSHClient({
        host: session.hostname,
        port: 22, // Default SSH port
        username: 'user', // This should come from connection config
        password: 'password', // This should come from connection config
      });

      sshClient.current.onData((data) => {
        terminal.current?.write(data);
      });

      sshClient.current.onConnect(() => {
        setIsConnected(true);
        setConnectionError('');
        terminal.current?.writeln('\r\nSSH connection established!');
      });

      sshClient.current.onError((error) => {
        setConnectionError(error);
        terminal.current?.writeln(`\r\nConnection error: ${error}`);
      });

      sshClient.current.onClose(() => {
        setIsConnected(false);
        terminal.current?.writeln('\r\nConnection closed');
      });

      await sshClient.current.connect();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Connection failed');
      terminal.current.writeln(`\r\nFailed to connect: ${error}`);
    }
  };

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
      if (terminal.current) {
        terminal.current.paste(text);
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