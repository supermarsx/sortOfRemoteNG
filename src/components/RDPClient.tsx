import React, { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession } from '../types/connection';
import { 
  Monitor, 
  Maximize2, 
  Minimize2, 
  Settings, 
  Wifi, 
  WifiOff,
  MousePointer,
  Keyboard,
  Volume2,
  VolumeX,
  Copy,
  Clipboard,
  Activity,
  X
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useConnections } from '../contexts/useConnections';

interface RDPClientProps {
  session: ConnectionSession;
}

interface RdpFrameEvent {
  session_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: string; // base64 RGBA
}

interface RdpStatusEvent {
  session_id: string;
  status: string;
  message: string;
  desktop_width?: number;
  desktop_height?: number;
}

interface RdpPointerEvent {
  session_id: string;
  pointer_type: string;
  x?: number;
  y?: number;
}

interface RdpStatsEvent {
  session_id: string;
  uptime_secs: number;
  bytes_received: number;
  bytes_sent: number;
  pdus_received: number;
  pdus_sent: number;
  frame_count: number;
  fps: number;
  input_events: number;
  errors_recovered: number;
  reactivations: number;
  phase: string;
  last_error: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Convert JS mouse button index to backend button code
function mouseButtonCode(jsButton: number): number {
  switch (jsButton) {
    case 0: return 0; // Left
    case 1: return 1; // Middle
    case 2: return 2; // Right
    case 3: return 3; // X1
    case 4: return 4; // X2
    default: return 0;
  }
}

// Map JS keyboard event to scancode + extended flag
function keyToScancode(e: KeyboardEvent): { scancode: number; extended: boolean } | null {
  // Use e.code for physical key mapping
  const map: Record<string, [number, boolean]> = {
    Escape: [0x01, false], Digit1: [0x02, false], Digit2: [0x03, false],
    Digit3: [0x04, false], Digit4: [0x05, false], Digit5: [0x06, false],
    Digit6: [0x07, false], Digit7: [0x08, false], Digit8: [0x09, false],
    Digit9: [0x0A, false], Digit0: [0x0B, false], Minus: [0x0C, false],
    Equal: [0x0D, false], Backspace: [0x0E, false], Tab: [0x0F, false],
    KeyQ: [0x10, false], KeyW: [0x11, false], KeyE: [0x12, false],
    KeyR: [0x13, false], KeyT: [0x14, false], KeyY: [0x15, false],
    KeyU: [0x16, false], KeyI: [0x17, false], KeyO: [0x18, false],
    KeyP: [0x19, false], BracketLeft: [0x1A, false], BracketRight: [0x1B, false],
    Enter: [0x1C, false], ControlLeft: [0x1D, false], KeyA: [0x1E, false],
    KeyS: [0x1F, false], KeyD: [0x20, false], KeyF: [0x21, false],
    KeyG: [0x22, false], KeyH: [0x23, false], KeyJ: [0x24, false],
    KeyK: [0x25, false], KeyL: [0x26, false], Semicolon: [0x27, false],
    Quote: [0x28, false], Backquote: [0x29, false], ShiftLeft: [0x2A, false],
    Backslash: [0x2B, false], KeyZ: [0x2C, false], KeyX: [0x2D, false],
    KeyC: [0x2E, false], KeyV: [0x2F, false], KeyB: [0x30, false],
    KeyN: [0x31, false], KeyM: [0x32, false], Comma: [0x33, false],
    Period: [0x34, false], Slash: [0x35, false], ShiftRight: [0x36, false],
    NumpadMultiply: [0x37, false], AltLeft: [0x38, false], Space: [0x39, false],
    CapsLock: [0x3A, false], F1: [0x3B, false], F2: [0x3C, false],
    F3: [0x3D, false], F4: [0x3E, false], F5: [0x3F, false],
    F6: [0x40, false], F7: [0x41, false], F8: [0x42, false],
    F9: [0x43, false], F10: [0x44, false], NumLock: [0x45, false],
    ScrollLock: [0x46, false], Numpad7: [0x47, false], Numpad8: [0x48, false],
    Numpad9: [0x49, false], NumpadSubtract: [0x4A, false],
    Numpad4: [0x4B, false], Numpad5: [0x4C, false], Numpad6: [0x4D, false],
    NumpadAdd: [0x4E, false], Numpad1: [0x4F, false], Numpad2: [0x50, false],
    Numpad3: [0x51, false], Numpad0: [0x52, false], NumpadDecimal: [0x53, false],
    F11: [0x57, false], F12: [0x58, false],
    // Extended keys
    NumpadEnter: [0x1C, true], ControlRight: [0x1D, true], NumpadDivide: [0x35, true],
    PrintScreen: [0x37, true], AltRight: [0x38, true], Home: [0x47, true],
    ArrowUp: [0x48, true], PageUp: [0x49, true], ArrowLeft: [0x4B, true],
    ArrowRight: [0x4D, true], End: [0x4F, true], ArrowDown: [0x50, true],
    PageDown: [0x51, true], Insert: [0x52, true], Delete: [0x53, true],
    MetaLeft: [0x5B, true], MetaRight: [0x5C, true], ContextMenu: [0x5D, true],
  };

  const entry = map[e.code];
  if (!entry) return null;
  return { scancode: entry[0], extended: entry[1] };
}

const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const { state } = useConnections();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rdpSessionId, setRdpSessionId] = useState<string | null>(null);
  const [desktopSize, setDesktopSize] = useState({ width: 1920, height: 1080 });
  const [pointerStyle, setPointerStyle] = useState<string>('default');
  const [showInternals, setShowInternals] = useState(false);
  const [stats, setStats] = useState<RdpStatsEvent | null>(null);
  const [settings, setSettings] = useState({
    resolution: '1920x1080',
    colorDepth: 32,
    audioEnabled: true,
    clipboardEnabled: true,
    compressionEnabled: true,
    encryptionEnabled: true
  });

  // Track current session ID for event filtering
  const sessionIdRef = useRef<string | null>(null);

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

  // ─── Initialize RDP connection ─────────────────────────────────────

  const initializeRDPConnection = useCallback(async () => {
    if (!connection) return;

    try {
      setConnectionStatus('connecting');
      setStatusMessage('Initiating connection...');

      const [resW, resH] = settings.resolution.split('x').map(Number);
      const connectionDetails = {
        host: session.hostname,
        port: connection.port || 3389,
        username: connection.username || '',
        password: connection.password || '',
        domain: (connection as Record<string, unknown>).domain as string | undefined,
        width: resW,
        height: resH,
      };

      debugLog(`Attempting RDP connection to ${connectionDetails.host}:${connectionDetails.port}`);

      const sessionId = await invoke('connect_rdp', connectionDetails) as string;
      debugLog(`RDP session created: ${sessionId}`);
      setRdpSessionId(sessionId);
      sessionIdRef.current = sessionId;

      // Set canvas to requested resolution initially
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = resW;
        canvas.height = resH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, resW, resH);
          ctx.fillStyle = '#888';
          ctx.font = '16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Connecting...', resW / 2, resH / 2);
        }
      }
    } catch (error) {
      setConnectionStatus('error');
      setStatusMessage(`Connection failed: ${error}`);
      console.error('RDP initialization failed:', error);
    }
  }, [session, connection, settings.resolution]);

  // ─── Disconnect ────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await invoke('disconnect_rdp', { sessionId: sid });
      } catch {
        // ignore disconnect errors during cleanup
      }
      sessionIdRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setRdpSessionId(null);
  }, []);

  // ─── Event listeners for RDP frames/status/pointer ─────────────────

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    // Listen for frame updates
    listen<RdpFrameEvent>('rdp://frame', (event) => {
      const frame = event.payload;
      if (frame.session_id !== sessionIdRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      try {
        // Decode base64 RGBA data
        const binary = atob(frame.data);
        const bytes = new Uint8ClampedArray(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        // Create ImageData and paint the dirty region
        const imgData = new ImageData(bytes, frame.width, frame.height);
        ctx.putImageData(imgData, frame.x, frame.y);
      } catch (e) {
        debugLog(`Frame decode error: ${e}`);
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for status updates
    listen<RdpStatusEvent>('rdp://status', (event) => {
      const status = event.payload;
      if (status.session_id !== sessionIdRef.current) return;

      setStatusMessage(status.message);

      switch (status.status) {
        case 'connected':
          setIsConnected(true);
          setConnectionStatus('connected');
          if (status.desktop_width && status.desktop_height) {
            setDesktopSize({ width: status.desktop_width, height: status.desktop_height });
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.width = status.desktop_width;
              canvas.height = status.desktop_height;
            }
          }
          break;
        case 'connecting':
          setConnectionStatus('connecting');
          break;
        case 'error':
          setConnectionStatus('error');
          break;
        case 'disconnected':
          setIsConnected(false);
          setConnectionStatus('disconnected');
          setRdpSessionId(null);
          sessionIdRef.current = null;
          break;
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for pointer updates
    listen<RdpPointerEvent>('rdp://pointer', (event) => {
      const ptr = event.payload;
      if (ptr.session_id !== sessionIdRef.current) return;

      switch (ptr.pointer_type) {
        case 'default':
          setPointerStyle('default');
          break;
        case 'hidden':
          setPointerStyle('none');
          break;
        case 'position':
          // Server-side pointer position, could render custom cursor overlay
          break;
      }
    }).then(fn => unlisteners.push(fn));

    // Listen for session statistics
    listen<RdpStatsEvent>('rdp://stats', (event) => {
      const s = event.payload;
      if (s.session_id !== sessionIdRef.current) return;
      setStats(s);
    }).then(fn => unlisteners.push(fn));

    return () => {
      unlisteners.forEach(fn => fn());
    };
  }, []);

  // ─── Connect on mount, disconnect on unmount ───────────────────────

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeRDPConnection, cleanup]);

  // ─── Input handlers ────────────────────────────────────────────────

  const sendInput = useCallback((events: Record<string, unknown>[]) => {
    const sid = sessionIdRef.current;
    if (!sid || !isConnected) return;
    invoke('rdp_send_input', { sessionId: sid, events }).catch(e => {
      debugLog(`Input send error: ${e}`);
    });
  }, [isConnected]);

  const scaleCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseMove', x, y }]);
  }, [isConnected, scaleCoords, sendInput]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    e.preventDefault();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: true }]);
  }, [isConnected, scaleCoords, sendInput]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    sendInput([{ type: 'MouseButton', x, y, button: mouseButtonCode(e.button), pressed: false }]);
  }, [isConnected, scaleCoords, sendInput]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    e.preventDefault();
    const { x, y } = scaleCoords(e.clientX, e.clientY);
    // Normalize delta to ±120 increments (standard Windows wheel delta)
    const delta = Math.sign(e.deltaY) * -120;
    sendInput([{ type: 'Wheel', x, y, delta, horizontal: e.shiftKey }]);
  }, [isConnected, scaleCoords, sendInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isConnected) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: true, extended: scan.extended }]);
    }
  }, [isConnected, sendInput]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (!isConnected) return;
    e.preventDefault();

    const scan = keyToScancode(e.nativeEvent);
    if (scan) {
      sendInput([{ type: 'KeyboardKey', scancode: scan.scancode, pressed: false, extended: scan.extended }]);
    }
  }, [isConnected, sendInput]);

  // Prevent default context menu on right-click
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  return (
    <div className={`flex flex-col bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* RDP Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-blue-400" />
          <span className="text-sm text-gray-300">
            RDP - {session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{connectionStatus}</span>
          </div>
          {statusMessage && (
            <span className="text-xs text-gray-500 ml-2 truncate max-w-xs">{statusMessage}</span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <span>{desktopSize.width}x{desktopSize.height}</span>
            <span>•</span>
            <span>{settings.colorDepth}-bit</span>
          </div>
          
          <button
            onClick={() => setShowInternals(!showInternals)}
            className={`p-1 hover:bg-gray-700 rounded transition-colors ${showInternals ? 'text-green-400 bg-gray-700' : 'text-gray-400 hover:text-white'}`}
            title="RDP Internals"
          >
            <Activity size={14} />
          </button>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="RDP Settings"
          >
            <Settings size={14} />
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

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <label className="block text-gray-300 mb-1">Resolution</label>
              <select
                value={settings.resolution}
                onChange={(e) => setSettings({...settings, resolution: e.target.value})}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
              >
                <option value="800x600">800x600</option>
                <option value="1024x768">1024x768</option>
                <option value="1280x1024">1280x1024</option>
                <option value="1920x1080">1920x1080</option>
              </select>
            </div>
            
            <div>
              <label className="block text-gray-300 mb-1">Color Depth</label>
              <select
                value={settings.colorDepth}
                onChange={(e) => setSettings({...settings, colorDepth: parseInt(e.target.value)})}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
              >
                <option value="16">16-bit</option>
                <option value="24">24-bit</option>
                <option value="32">32-bit</option>
              </select>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.audioEnabled}
                onChange={(e) => setSettings({...settings, audioEnabled: e.target.checked})}
                className="rounded"
              />
              <label className="text-gray-300 text-xs">Audio</label>
              {settings.audioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.clipboardEnabled}
                onChange={(e) => setSettings({...settings, clipboardEnabled: e.target.checked})}
                className="rounded"
              />
              <label className="text-gray-300 text-xs">Clipboard</label>
              <Clipboard size={12} />
            </div>
          </div>
        </div>
      )}

      {/* RDP Internals Panel */}
      {showInternals && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Activity size={14} className="text-green-400" />
              RDP Session Internals
            </h3>
            <button onClick={() => setShowInternals(false)} className="text-gray-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Phase</div>
                <div className="text-white font-mono capitalize">{stats.phase}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Uptime</div>
                <div className="text-white font-mono">{formatUptime(stats.uptime_secs)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">FPS</div>
                <div className={`font-mono font-bold ${stats.fps >= 20 ? 'text-green-400' : stats.fps >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {stats.fps.toFixed(1)}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Frames</div>
                <div className="text-white font-mono">{stats.frame_count.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Received</div>
                <div className="text-cyan-400 font-mono">{formatBytes(stats.bytes_received)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Sent</div>
                <div className="text-orange-400 font-mono">{formatBytes(stats.bytes_sent)}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">PDUs In</div>
                <div className="text-white font-mono">{stats.pdus_received.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">PDUs Out</div>
                <div className="text-white font-mono">{stats.pdus_sent.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Input Events</div>
                <div className="text-white font-mono">{stats.input_events.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Reactivations</div>
                <div className="text-white font-mono">{stats.reactivations}</div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Errors (Recovered)</div>
                <div className={`font-mono ${stats.errors_recovered > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {stats.errors_recovered}
                </div>
              </div>
              <div className="bg-gray-900 rounded p-2">
                <div className="text-gray-500 mb-1">Bandwidth</div>
                <div className="text-white font-mono">
                  {stats.uptime_secs > 0 ? formatBytes(Math.round(stats.bytes_received / stats.uptime_secs)) : '0 B'}/s
                </div>
              </div>
              {stats.last_error && (
                <div className="bg-gray-900 rounded p-2 col-span-2 md:col-span-4 lg:col-span-6">
                  <div className="text-gray-500 mb-1">Last Error</div>
                  <div className="text-red-400 font-mono truncate" title={stats.last_error}>{stats.last_error}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-xs">Waiting for session statistics...</p>
          )}
        </div>
      )}

      {/* RDP Canvas */}
      <div className="flex-1 flex items-center justify-center bg-black p-1 relative">
        <canvas
          ref={canvasRef}
          className="border border-gray-600 max-w-full max-h-full"
          style={{
            cursor: pointerStyle,
            imageRendering: 'auto',
            objectFit: 'contain',
            display: connectionStatus !== 'disconnected' ? 'block' : 'none'
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={handleContextMenu}
          tabIndex={0}
          width={desktopSize.width}
          height={desktopSize.height}
        />
        
        {connectionStatus === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <p className="text-gray-400">Connecting to RDP server...</p>
              <p className="text-gray-500 text-sm mt-2">{session.hostname}</p>
              {statusMessage && <p className="text-gray-600 text-xs mt-1">{statusMessage}</p>}
            </div>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <div className="text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2">RDP Connection Failed</p>
            <p className="text-gray-500 text-sm">{statusMessage || `Unable to connect to ${session.hostname}`}</p>
          </div>
        )}

        {connectionStatus === 'disconnected' && (
          <div className="text-center">
            <Monitor size={48} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Disconnected</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-4">
          <span>Session: {(rdpSessionId || session.id).slice(0, 8)}</span>
          <span>Protocol: RDP</span>
          {isConnected && (
            <>
              <span>Desktop: {desktopSize.width}x{desktopSize.height}</span>
              <span>Encryption: TLS/NLA</span>
              {stats && (
                <>
                  <span className="text-green-400">{stats.fps.toFixed(0)} FPS</span>
                  <span>↓{formatBytes(stats.bytes_received)}</span>
                  <span>↑{formatBytes(stats.bytes_sent)}</span>
                </>
              )}
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <MousePointer size={12} />
          <Keyboard size={12} />
          {settings.audioEnabled && <Volume2 size={12} />}
          {settings.clipboardEnabled && <Copy size={12} />}
        </div>
      </div>
    </div>
  );
};

export default RDPClient;
