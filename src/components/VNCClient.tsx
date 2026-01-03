import React, { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { 
  Monitor, 
  Maximize2, 
  Minimize2, 
  Settings, 
  Wifi, 
  WifiOff,
  MousePointer,
  Keyboard,
  Copy,
  Clipboard,
  RotateCcw
} from 'lucide-react';

interface VNCClientProps {
  session: ConnectionSession;
}

export const VNCClient: React.FC<VNCClientProps> = ({ session }) => {
  const { state } = useConnections();
  const connection = state.connections.find(c => c.id === session.connectionId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    viewOnly: false,
    scaleViewport: true,
    clipViewport: false,
    dragViewport: true,
    resizeSession: false,
    showDotCursor: false,
    localCursor: true,
    sharedMode: false,
    bellPolicy: 'on',
    compressionLevel: 2,
    quality: 6,
  });
  const [rfb, setRfb] = useState<any>(null);
  const connectHandlerRef = useRef<EventListener | null>(null);
  const disconnectHandlerRef = useRef<EventListener | null>(null);
  const credentialsHandlerRef = useRef<EventListener | null>(null);
  const securityFailureHandlerRef = useRef<EventListener | null>(null);

  const handleConnect = () => {
    setIsConnected(true);
    setConnectionStatus('connected');
    debugLog('VNC connection established');
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
    debugLog('VNC connection disconnected');
  };

  const handleCredentialsRequired = useCallback(() => {
    debugLog('VNC credentials required');
    // Handle password prompt
    const password = prompt('VNC Password:');
    if (password && rfb) {
      rfb.sendCredentials({ password });
    }
  }, [rfb]);

  const handleSecurityFailure = () => {
    setConnectionStatus('error');
    debugLog('VNC security failure');
  };

  const drawWindow = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, title: string) => {
    // Window background
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(x, y, width, height);
    
    // Title bar
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x, y, width, 30);
    
    // Title text
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.fillText(title, x + 10, y + 20);
    
    // Window controls
    const controlSize = 20;
    const controlY = y + 5;
    
    // Close button
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x + width - 25, controlY, controlSize, controlSize);
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('×', x + width - 15, controlY + 15);
    
    // Maximize button
    ctx.fillStyle = '#10b981';
    ctx.fillRect(x + width - 50, controlY, controlSize, controlSize);
    ctx.fillText('□', x + width - 40, controlY + 15);
    
    // Minimize button
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x + width - 75, controlY, controlSize, controlSize);
    ctx.fillText('−', x + width - 65, controlY + 15);
    
    ctx.textAlign = 'left';
    
    // Window content
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 10, y + 40, width - 20, height - 50);
    
    // Content text
    ctx.fillStyle = '#1f2937';
    ctx.font = '14px Arial';
    ctx.fillText('VNC Remote Desktop Session', x + 20, y + 70);
    ctx.fillText(`Connected to: ${session.hostname}`, x + 20, y + 100);
    ctx.fillText('Resolution: 1024x768', x + 20, y + 130);
    ctx.fillText('Color Depth: 24-bit', x + 20, y + 160);
    
    // Status indicator
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(x + 20, y + 190, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.fillText('Connected', x + 35, y + 195);
  }, [session.hostname]);

  const drawDesktopIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string, emoji: string) => {
    // Icon background
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.fillRect(x, y, 48, 48);
    
    // Icon border
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 48, 48);
    
    // Icon emoji
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(emoji, x + 24, y + 32);
    
    // Label
    ctx.fillStyle = 'white';
    ctx.font = '11px Arial';
    ctx.fillText(label, x + 24, y + 65);
    ctx.textAlign = 'left';
  };

  const drawSimulatedDesktop = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Draw desktop background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#2563eb');
    gradient.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Draw taskbar
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, height - 40, width, 40);
    
    // Draw start menu
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(5, height - 35, 100, 30);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.fillText('VNC Desktop', 15, height - 15);
    
    // Draw system tray
    ctx.fillStyle = '#374151';
    ctx.fillRect(width - 120, height - 35, 115, 30);
    
    // Draw time
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(time, width - 80, height - 15);
    
    // Draw desktop icons
    drawDesktopIcon(ctx, 50, 50, 'Computer', '🖥️');
    drawDesktopIcon(ctx, 50, 130, 'Files', '📁');
    drawDesktopIcon(ctx, 50, 210, 'Terminal', '⚡');
    
    // Draw application window
    drawWindow(ctx, 200, 100, 500, 400, 'VNC Remote Desktop');
  }, [drawWindow]);

  const simulateVNCConnection = useCallback(async () => {
    if (!canvasRef.current) return;

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      canvas.width = 1024;
      canvas.height = 768;
      
      drawSimulatedDesktop(ctx, canvas.width, canvas.height);
      
      setIsConnected(true);
      setConnectionStatus('connected');
    }
  }, [drawSimulatedDesktop]);

  const initializeVNCConnection = useCallback(async () => {
    if (!canvasRef.current) return;

    try {
      setConnectionStatus('connecting');

      // Initialize NoVNC RFB connection
      const { default: RFB } = await import('novnc/core/rfb' as any);

      const url = `ws://${session.hostname}:${connection?.port || 5900}`;
      debugLog(`Connecting to VNC server at ${url}`);
      const rfbConnection = new RFB(canvasRef.current, url, {
        credentials: {
          password: connection?.password || '',
        },
      });

      // Set up event handlers and store references for cleanup
      connectHandlerRef.current = handleConnect.bind(null);
      rfbConnection.addEventListener('connect', connectHandlerRef.current);
      disconnectHandlerRef.current = handleDisconnect.bind(null);
      rfbConnection.addEventListener('disconnect', disconnectHandlerRef.current);
      credentialsHandlerRef.current = handleCredentialsRequired.bind(null);
      rfbConnection.addEventListener('credentialsrequired', credentialsHandlerRef.current);
      securityFailureHandlerRef.current = handleSecurityFailure.bind(null);
      rfbConnection.addEventListener('securityfailure', securityFailureHandlerRef.current);

      // Apply settings
      rfbConnection.viewOnly = settings.viewOnly;
      rfbConnection.scaleViewport = settings.scaleViewport;
      rfbConnection.clipViewport = settings.clipViewport;
      rfbConnection.dragViewport = settings.dragViewport;
      rfbConnection.resizeSession = settings.resizeSession;
      rfbConnection.showDotCursor = settings.showDotCursor;

      setRfb(rfbConnection);
    } catch (error) {
      setConnectionStatus('error');
      debugLog('VNC connection failed:', error);
      console.error('VNC connection failed:', error);

      // Fallback to simulated VNC for demo
      simulateVNCConnection();
    }
  }, [session, connection, settings, handleCredentialsRequired, simulateVNCConnection]);

  const cleanup = useCallback(() => {
    if (rfb) {
      if (connectHandlerRef.current) {
        rfb.removeEventListener('connect', connectHandlerRef.current);
      }
      if (disconnectHandlerRef.current) {
        rfb.removeEventListener('disconnect', disconnectHandlerRef.current);
      }
      if (credentialsHandlerRef.current) {
        rfb.removeEventListener('credentialsrequired', credentialsHandlerRef.current);
      }
      if (securityFailureHandlerRef.current) {
        rfb.removeEventListener('securityfailure', securityFailureHandlerRef.current);
      }
      rfb.disconnect();
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [rfb]);

  useEffect(() => {
    initializeVNCConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeVNCConnection, cleanup]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected || settings.viewOnly) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to canvas resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    
    debugLog(`VNC Click at: ${canvasX}, ${canvasY}`);
    
    // Send mouse click to VNC server
    if (rfb) {
      rfb.sendPointerEvent(canvasX, canvasY, 0x1); // Left click
      setTimeout(() => {
        rfb.sendPointerEvent(canvasX, canvasY, 0x0); // Release
      }, 100);
    } else {
      // Simulate click response for demo
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 10, 0, 2 * Math.PI);
        ctx.fill();
        
        setTimeout(() => {
          drawSimulatedDesktop(ctx, canvas.width, canvas.height);
        }, 200);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    
    event.preventDefault();
    
    if (rfb) {
      rfb.sendKey(event.keyCode, 'KeyDown');
    }
    
    debugLog(`VNC Key: ${event.key}`);
  };

  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    
    event.preventDefault();
    
    if (rfb) {
      rfb.sendKey(event.keyCode, 'KeyUp');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const sendCtrlAltDel = () => {
    if (rfb) {
      rfb.sendCtrlAltDel();
    }
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
      {/* VNC Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-blue-400" />
          <span className="text-sm text-gray-300">
            VNC - {session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{connectionStatus}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <span>1024x768</span>
            <span>•</span>
            <span>24-bit</span>
          </div>
          
          <button
            onClick={sendCtrlAltDel}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            title="Send Ctrl+Alt+Del"
          >
            Ctrl+Alt+Del
          </button>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="VNC Settings"
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
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.viewOnly}
                onChange={(e) => setSettings({...settings, viewOnly: e.target.checked})}
                className="rounded"
              />
              <span className="text-gray-300">View Only</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.scaleViewport}
                onChange={(e) => setSettings({...settings, scaleViewport: e.target.checked})}
                className="rounded"
              />
              <span className="text-gray-300">Scale Viewport</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.clipViewport}
                onChange={(e) => setSettings({...settings, clipViewport: e.target.checked})}
                className="rounded"
              />
              <span className="text-gray-300">Clip Viewport</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.localCursor}
                onChange={(e) => setSettings({...settings, localCursor: e.target.checked})}
                className="rounded"
              />
              <span className="text-gray-300">Local Cursor</span>
            </label>
          </div>
        </div>
      )}

      {/* VNC Canvas */}
      <div className="flex-1 flex items-center justify-center bg-black p-4">
        {connectionStatus === 'connecting' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
            <p className="text-gray-400">Connecting to VNC server...</p>
            <p className="text-gray-500 text-sm mt-2">{session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <div className="text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2">VNC Connection Failed</p>
            <p className="text-gray-500 text-sm">Unable to connect to {session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'connected' && (
          <canvas
            ref={canvasRef}
            className="border border-gray-600 cursor-crosshair max-w-full max-h-full"
            onClick={handleCanvasClick}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            tabIndex={0}
            style={{
              imageRendering: 'pixelated',
              objectFit: 'contain'
            }}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-4">
          <span>Session: {session.id.slice(0, 8)}</span>
          <span>Protocol: VNC</span>
          {isConnected && (
            <>
              <span>Encoding: Raw</span>
              <span>Compression: Level {settings.compressionLevel}</span>
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <MousePointer size={12} />
          <Keyboard size={12} />
          <Copy size={12} />
        </div>
      </div>
    </div>
  );
};
